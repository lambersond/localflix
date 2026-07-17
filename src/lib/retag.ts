import { statSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import * as schema from "@/db/schema";

import {
  parseEpisodeNumbers,
  preferPlayable,
  SHOW_ROOT_NAMES,
  walkVideos,
} from "./fs-scan";
import { mimeTypeForFile, parseVersionLabel } from "./media";
import { createScanner } from "./scan";
import { reindexSearch } from "./search-index";
import {
  getShowCast,
  getShowCertification,
  getShowDetails,
  keywordsOf,
  videosOf,
} from "./tmdb";
import { filterAvailableVideos } from "./youtube";

const TOP_CAST = 15;

/**
 * Manual TMDB re-matching. The scan matches a filename to `results[0]` of a TMDB
 * search with no disambiguation, so some titles land on the wrong entry and some
 * files never match at all. These ops let the admin panel point one file (or one
 * tracked title) at an operator-chosen TMDB id and (re)ingest it.
 *
 * The crux: `upsertMovie` / `ingestShow` conflict on `tmdbId`, not the internal
 * row id, so re-matching to a *different* tmdbId inserts a second row for the
 * same file. We therefore ingest the corrected match first (safe if TMDB fails)
 * and then delete the stale row — the file is never left with no record.
 */

export interface RetagResult {
  ok: boolean;
  message: string;
}

/** No-op logger — these ops surface a single summary, not a live log. */
const quiet = () => {};

/** Absolute path of the show folder (the dir directly under shows/ or tv/) that owns a file. */
function showFolderOf(filePath: string): string | null {
  const root = resolve(process.env.MEDIA_DIR ?? "./media");
  const rel = relative(root, resolve(filePath));
  if (!rel || rel.startsWith("..")) return null;
  const segments = rel.split(sep);
  if (segments.length < 2) return null;
  const [area, showName] = segments;
  if (!SHOW_ROOT_NAMES.has(area.toLowerCase())) return null;
  return join(root, area, showName);
}

/** Rebuild a show's episode list from disk, exactly like the scan does. */
async function episodesInFolder(folder: string) {
  const files = preferPlayable(await walkVideos(folder));
  const episodes: { season: number; episode: number; filePath: string }[] = [];
  for (const file of files) {
    const parsed = parseEpisodeNumbers(file);
    if (parsed) episodes.push({ ...parsed, filePath: file });
  }
  return episodes;
}

/**
 * Delete a movie and everything orphaned by it — the `removeBrokenLinks` cleanup
 * without the "file is missing" guard, since a re-match keeps the file. The
 * `*Genres`/`*Keywords`/`*Cast` join tables cascade via `foreign_keys = ON`; the
 * polymorphic tables have no FK and are cleaned by hand.
 */
function deleteMovieById(id: number): void {
  db.transaction((tx) => {
    tx.delete(schema.videos)
      .where(and(eq(schema.videos.mediaType, "movie"), eq(schema.videos.mediaId, id)))
      .run();
    tx.delete(schema.watchlist)
      .where(and(eq(schema.watchlist.mediaType, "movie"), eq(schema.watchlist.mediaId, id)))
      .run();
    tx.delete(schema.watchProgress)
      .where(
        and(
          eq(schema.watchProgress.playableKind, "movie"),
          eq(schema.watchProgress.playableId, id),
        ),
      )
      .run();
    tx.delete(schema.collectionItems)
      .where(
        and(
          eq(schema.collectionItems.mediaType, "movie"),
          eq(schema.collectionItems.mediaId, id),
        ),
      )
      .run();
    tx.delete(schema.mediaFiles)
      .where(and(eq(schema.mediaFiles.mediaType, "movie"), eq(schema.mediaFiles.mediaId, id)))
      .run();
    tx.delete(schema.movies).where(eq(schema.movies.id, id)).run();
    tx.run(sql`DELETE FROM search_index WHERE kind = ${"movie"} AND media_id = ${id}`);
  });
}

/** Delete a show and its seasons/episodes (cascade) plus polymorphic + per-episode rows. */
function deleteShowById(id: number): void {
  db.transaction((tx) => {
    // Episode watch progress is keyed by episode id, so clear it before the cascade.
    const eps = tx
      .select({ id: schema.episodes.id })
      .from(schema.episodes)
      .innerJoin(schema.seasons, eq(schema.episodes.seasonId, schema.seasons.id))
      .where(eq(schema.seasons.showId, id))
      .all();
    for (const e of eps) {
      tx.delete(schema.watchProgress)
        .where(
          and(
            eq(schema.watchProgress.playableKind, "episode"),
            eq(schema.watchProgress.playableId, e.id),
          ),
        )
        .run();
    }
    tx.delete(schema.videos)
      .where(and(eq(schema.videos.mediaType, "show"), eq(schema.videos.mediaId, id)))
      .run();
    tx.delete(schema.watchlist)
      .where(and(eq(schema.watchlist.mediaType, "show"), eq(schema.watchlist.mediaId, id)))
      .run();
    tx.delete(schema.collectionItems)
      .where(
        and(
          eq(schema.collectionItems.mediaType, "show"),
          eq(schema.collectionItems.mediaId, id),
        ),
      )
      .run();
    tx.delete(schema.shows).where(eq(schema.shows.id, id)).run(); // cascades seasons/episodes
    tx.run(sql`DELETE FROM search_index WHERE kind = ${"show"} AND media_id = ${id}`);
  });
}

function movieByTmdbId(tmdbId: number) {
  return db
    .select({ id: schema.movies.id, title: schema.movies.title })
    .from(schema.movies)
    .where(eq(schema.movies.tmdbId, tmdbId))
    .get();
}

function showByTmdbId(tmdbId: number) {
  return db
    .select({ id: schema.shows.id, name: schema.shows.name })
    .from(schema.shows)
    .where(eq(schema.shows.tmdbId, tmdbId))
    .get();
}

/**
 * Assign a TMDB match to an untracked file (a "no-match" file the scan skipped).
 * Movies ingest that one file; shows ingest the file's whole folder.
 */
export async function assignUntrackedMatch(input: {
  path: string;
  area: "movie" | "show";
  tmdbId: number;
}): Promise<RetagResult> {
  const scanner = createScanner(db, quiet);
  try {
    if (input.area === "movie") {
      const existing = movieByTmdbId(input.tmdbId);
      if (existing) {
        // Already tracked → attach this file as another version of that movie
        // (e.g. a second resolution or cut) rather than refusing.
        const added = addMovieVersion({ movieId: existing.id, filePath: input.path, label: "" });
        return added.ok
          ? { ok: true, message: `Added as a version of "${existing.title}".` }
          : added;
      }
      const info = await scanner.ingestMovieByTmdbId(input.tmdbId, input.path);
      scanner.rebuildRowFromDb("movie");
      reindexSearch(db, quiet);
      return { ok: true, message: `Added "${info.title}" and linked it to ${basename(input.path)}.` };
    }

    const folder = showFolderOf(input.path);
    if (!folder) {
      return { ok: false, message: "Couldn't locate the show folder for that file." };
    }
    const episodes = await episodesInFolder(folder);
    if (episodes.length === 0) {
      return {
        ok: false,
        message: "No episodes with SxxEyy filenames found in that show folder.",
      };
    }
    const showId = await scanner.ingestShow({ tmdbId: input.tmdbId, episodes });
    if (showId === null) {
      return { ok: false, message: "TMDB lookup failed for that show." };
    }
    scanner.rebuildRowFromDb("show");
    reindexSearch(db, quiet);
    const show = showByTmdbId(input.tmdbId);
    return {
      ok: true,
      message: `Ingested "${show?.name ?? "show"}" (${episodes.length} episode file(s)).`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Replace the TMDB match of a tracked title. Ingests the corrected match against
 * the same file(s), then deletes the old row (and its watch progress / My-List
 * entry — meaningless once it was the wrong title).
 */
export async function rematchTitle(input: {
  kind: "movie" | "show";
  id: number;
  tmdbId: number;
}): Promise<RetagResult> {
  const scanner = createScanner(db, quiet);
  try {
    if (input.kind === "movie") {
      const row = db
        .select({ filePath: schema.movies.filePath })
        .from(schema.movies)
        .where(eq(schema.movies.id, input.id))
        .get();
      if (!row) return { ok: false, message: "That title is no longer in the library." };

      const clash = movieByTmdbId(input.tmdbId);
      if (clash && clash.id !== input.id) {
        return {
          ok: false,
          message: `That TMDB title is already in your library as "${clash.title}".`,
        };
      }

      const info = await scanner.ingestMovieByTmdbId(input.tmdbId, row.filePath);
      if (info.id !== input.id) deleteMovieById(input.id);
      scanner.rebuildRowFromDb("movie");
      reindexSearch(db, quiet);
      return { ok: true, message: `Re-matched to "${info.title}".` };
    }

    const ep = db
      .select({ filePath: schema.episodes.filePath })
      .from(schema.episodes)
      .innerJoin(schema.seasons, eq(schema.episodes.seasonId, schema.seasons.id))
      .where(eq(schema.seasons.showId, input.id))
      .get();
    if (!ep) return { ok: false, message: "That show has no episodes on disk to re-match." };

    const folder = showFolderOf(ep.filePath);
    if (!folder) return { ok: false, message: "Couldn't locate the show folder." };

    const clash = showByTmdbId(input.tmdbId);
    if (clash && clash.id !== input.id) {
      return {
        ok: false,
        message: `That TMDB title is already in your library as "${clash.name}".`,
      };
    }

    const episodes = await episodesInFolder(folder);
    if (episodes.length === 0) {
      return { ok: false, message: "No episodes with SxxEyy filenames found in the show folder." };
    }
    const newShowId = await scanner.ingestShow({ tmdbId: input.tmdbId, episodes });
    if (newShowId === null) return { ok: false, message: "TMDB lookup failed for that show." };
    if (newShowId !== input.id) deleteShowById(input.id);
    scanner.rebuildRowFromDb("show");
    reindexSearch(db, quiet);
    const show = showByTmdbId(input.tmdbId);
    return { ok: true, message: `Re-matched to "${show?.name ?? "show"}".` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Point a movie at a TMDB **TV** entry, keeping it as one playable item. The
 * movie row (its internal id, `filePath`, and watch progress) is preserved; only
 * its metadata is overwritten from the show — for a mini-series a user combined
 * into a single file. All TMDB reads happen first (better-sqlite3 transactions
 * are synchronous), then one transaction rewrites the row + its join tables.
 */
export async function matchMovieToTv(input: {
  movieId: number;
  tmdbTvId: number;
}): Promise<RetagResult> {
  const scanner = createScanner(db, quiet);
  try {
    const movie = db
      .select({ id: schema.movies.id })
      .from(schema.movies)
      .where(eq(schema.movies.id, input.movieId))
      .get();
    if (!movie) return { ok: false, message: "That movie is no longer in the library." };

    const clash = movieByTmdbId(input.tmdbTvId);
    if (clash && clash.id !== input.movieId) {
      return {
        ok: false,
        message: `That TMDB id is already in your library as "${clash.title}".`,
      };
    }

    // Fetch everything up front so a TMDB failure changes nothing in the DB.
    const show = await getShowDetails(input.tmdbTvId);
    const certification = await getShowCertification(show.id);
    const keywords = keywordsOf(show);
    const videos = await filterAvailableVideos(videosOf(show), quiet);
    const cast = (await getShowCast(show.id)).slice(0, TOP_CAST);

    db.transaction((tx) => {
      tx.update(schema.movies)
        .set({
          tmdbId: show.id,
          title: show.name,
          overview: show.overview,
          posterPath: show.poster_path,
          backdropPath: show.backdrop_path,
          releaseDate: show.first_air_date,
          runtimeMinutes: null,
          certification,
          voteAverage: show.vote_average,
          voteCount: show.vote_count,
          tmdbCollectionId: null,
        })
        .where(eq(schema.movies.id, input.movieId))
        .run();

      // Genres.
      tx.delete(schema.movieGenres).where(eq(schema.movieGenres.movieId, input.movieId)).run();
      for (const g of show.genres) {
        tx.insert(schema.genres)
          .values({ id: g.id, name: g.name })
          .onConflictDoUpdate({ target: schema.genres.id, set: { name: g.name } })
          .run();
        tx.insert(schema.movieGenres)
          .values({ movieId: input.movieId, genreId: g.id })
          .onConflictDoNothing()
          .run();
      }

      // Keywords.
      tx.delete(schema.movieKeywords).where(eq(schema.movieKeywords.movieId, input.movieId)).run();
      for (const k of keywords) {
        tx.insert(schema.keywords)
          .values({ id: k.id, name: k.name })
          .onConflictDoUpdate({ target: schema.keywords.id, set: { name: k.name } })
          .run();
        tx.insert(schema.movieKeywords)
          .values({ movieId: input.movieId, keywordId: k.id })
          .onConflictDoNothing()
          .run();
      }

      // Trailers/clips.
      tx.delete(schema.videos)
        .where(and(eq(schema.videos.mediaType, "movie"), eq(schema.videos.mediaId, input.movieId)))
        .run();
      videos.forEach((v, index) => {
        tx.insert(schema.videos)
          .values({
            mediaType: "movie",
            mediaId: input.movieId,
            youtubeKey: v.key,
            name: v.name,
            type: v.type,
            official: v.official ? 1 : 0,
            publishedAt: v.published_at ?? null,
            position: index,
          })
          .onConflictDoNothing()
          .run();
      });

      // Cast.
      tx.delete(schema.movieCast).where(eq(schema.movieCast.movieId, input.movieId)).run();
      for (const c of cast) {
        tx.insert(schema.people)
          .values({ id: c.id, name: c.name, profilePath: c.profile_path })
          .onConflictDoUpdate({
            target: schema.people.id,
            set: { name: c.name, profilePath: c.profile_path },
          })
          .run();
        tx.insert(schema.movieCast)
          .values({ movieId: input.movieId, personId: c.id, ord: c.order ?? null })
          .onConflictDoNothing()
          .run();
      }
    });

    scanner.rebuildRowFromDb("movie");
    reindexSearch(db, quiet);
    return { ok: true, message: `Matched "${show.name}" from TMDB (TV).` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// ── Movie file versions (multiple resolutions / cuts of one title) ──

export interface VersionCandidate {
  path: string;
  suggestedLabel: string;
}

/** Absolute paths of every file already tracked anywhere in the library. */
function allTrackedPaths(): Set<string> {
  const set = new Set<string>();
  for (const m of db.select({ filePath: schema.movies.filePath }).from(schema.movies).all()) {
    set.add(resolve(m.filePath));
  }
  for (const e of db.select({ filePath: schema.episodes.filePath }).from(schema.episodes).all()) {
    set.add(resolve(e.filePath));
  }
  for (const v of db.select({ filePath: schema.mediaFiles.filePath }).from(schema.mediaFiles).all()) {
    set.add(resolve(v.filePath));
  }
  return set;
}

/** Untracked video files in a movie's folder — candidates to attach as versions. */
export async function listMovieVersionCandidates(movieId: number): Promise<VersionCandidate[]> {
  const movie = db
    .select({ filePath: schema.movies.filePath })
    .from(schema.movies)
    .where(eq(schema.movies.id, movieId))
    .get();
  if (!movie) return [];
  const tracked = allTrackedPaths();
  const files = await walkVideos(dirname(movie.filePath));
  return files
    .filter((f) => !tracked.has(resolve(f)))
    .map((f) => ({ path: f, suggestedLabel: parseVersionLabel(f) ?? "Alternate" }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Attach a file as an additional version of a movie. */
export function addMovieVersion(input: {
  movieId: number;
  filePath: string;
  label: string;
}): RetagResult {
  const movie = db
    .select({ id: schema.movies.id })
    .from(schema.movies)
    .where(eq(schema.movies.id, input.movieId))
    .get();
  if (!movie) return { ok: false, message: "That movie is no longer in the library." };

  const abs = resolve(input.filePath);
  if (allTrackedPaths().has(abs)) {
    return { ok: false, message: "That file is already tracked." };
  }
  let fileSize: number | null = null;
  try {
    fileSize = statSync(abs).size;
  } catch {
    return { ok: false, message: "That file doesn't exist on disk." };
  }
  const label = input.label.trim() || parseVersionLabel(abs) || "Alternate";
  db.insert(schema.mediaFiles)
    .values({
      mediaType: "movie",
      mediaId: input.movieId,
      label,
      filePath: abs,
      fileSize,
      mimeType: mimeTypeForFile(abs),
    })
    .run();
  return { ok: true, message: `Added version "${label}".` };
}

/** Remove a version (and its per-version watch progress). */
export function removeMovieVersion(versionId: number): RetagResult {
  const version = db
    .select({ mediaId: schema.mediaFiles.mediaId })
    .from(schema.mediaFiles)
    .where(eq(schema.mediaFiles.id, versionId))
    .get();
  if (!version) return { ok: false, message: "That version no longer exists." };
  db.transaction((tx) => {
    tx.delete(schema.watchProgress)
      .where(
        and(
          eq(schema.watchProgress.playableKind, "movie"),
          eq(schema.watchProgress.playableId, version.mediaId),
          eq(schema.watchProgress.versionId, versionId),
        ),
      )
      .run();
    tx.delete(schema.mediaFiles).where(eq(schema.mediaFiles.id, versionId)).run();
  });
  return { ok: true, message: "Removed that version." };
}

/** Make a version the default (primary) file, demoting the current primary. */
export function setPrimaryVersion(input: { movieId: number; versionId: number }): RetagResult {
  const movie = db
    .select({
      filePath: schema.movies.filePath,
      fileSize: schema.movies.fileSize,
      mimeType: schema.movies.mimeType,
    })
    .from(schema.movies)
    .where(eq(schema.movies.id, input.movieId))
    .get();
  if (!movie) return { ok: false, message: "That movie is no longer in the library." };

  const version = db
    .select({
      filePath: schema.mediaFiles.filePath,
      fileSize: schema.mediaFiles.fileSize,
      mimeType: schema.mediaFiles.mimeType,
      label: schema.mediaFiles.label,
    })
    .from(schema.mediaFiles)
    .where(
      and(eq(schema.mediaFiles.id, input.versionId), eq(schema.mediaFiles.mediaId, input.movieId)),
    )
    .get();
  if (!version) return { ok: false, message: "That version no longer exists." };

  db.transaction((tx) => {
    tx.insert(schema.mediaFiles)
      .values({
        mediaType: "movie",
        mediaId: input.movieId,
        label: parseVersionLabel(movie.filePath) ?? "Alternate",
        filePath: movie.filePath,
        fileSize: movie.fileSize,
        mimeType: movie.mimeType,
      })
      .run();
    tx.update(schema.movies)
      .set({ filePath: version.filePath, fileSize: version.fileSize, mimeType: version.mimeType })
      .where(eq(schema.movies.id, input.movieId))
      .run();
    tx.delete(schema.mediaFiles).where(eq(schema.mediaFiles.id, input.versionId)).run();
    // The two swapped files change versionId, so their old progress no longer
    // lines up — clear it rather than resume the wrong file.
    tx.delete(schema.watchProgress)
      .where(
        and(
          eq(schema.watchProgress.playableKind, "movie"),
          eq(schema.watchProgress.playableId, input.movieId),
          inArray(schema.watchProgress.versionId, [0, input.versionId]),
        ),
      )
      .run();
  });
  return { ok: true, message: `"${version.label}" is now the default version.` };
}
