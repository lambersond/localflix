import { statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { and, asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "../db/schema";
import { cacheArtwork } from "./images";
import { reindexSearch } from "./search-index";
import { isBrowserPlayable, mimeTypeForFile, parseVersionLabel } from "./media";
import {
  parseEpisodeNumbers,
  parseMovieFilename,
  preferPlayable,
  SHOW_ROOT_NAMES,
  walkVideos,
} from "./fs-scan";
import {
  getMovieCast,
  getMovieCertification,
  getMovieDetails,
  getSeasonDetails,
  getShowCast,
  getShowCertification,
  getShowDetails,
  keywordsOf,
  searchMovie,
  searchTv,
  videosOf,
  type TmdbSeasonDetails,
  type TmdbVideo,
} from "./tmdb";
import { filterAvailableVideos } from "./youtube";

export type DB = BetterSQLite3Database<typeof schema>;

/** Coarse "how far along is this job" signal for the admin panel's progress bar. */
export interface ScanProgress {
  phase: "movies" | "shows" | "artwork";
  done: number;
  total: number;
}

/**
 * Job logger. `progress` is optional so plain `(line) => console.log(line)`
 * callers (the CLI script) still satisfy the type unchanged.
 */
export type Logger = (line: string, progress?: ScanProgress) => void;

export interface MovieData {
  tmdbId: number;
  title: string;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: string | null;
  runtimeMinutes: number | null;
  certification: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  tmdbCollectionId: number | null;
  genres: { id: number; name: string }[];
  keywords: { id: number; name: string }[];
  videos: TmdbVideo[];
  filePath: string;
}

export interface ScanOptions {
  mediaDir: string;
  /** When false, files browsers can't play natively are skipped entirely. */
  includeNonPlayable: boolean;
  /** When true, pre-download artwork to local disk after ingest. */
  cacheArtwork?: boolean;
  /** When true, skip files already in the library (no TMDB lookup for them). */
  onlyNew?: boolean;
}

export interface ScanSummary {
  movies: number;
  shows: number;
  skipped: number;
}

export interface CollectionConfig {
  slug: string;
  title: string;
  kind: "hero" | "row";
  sortOrder?: number;
  items: { type: "movie" | "show"; tmdbId: number }[];
}

const TOP_CAST = 15;
/** Emit a progress heartbeat every N silently-skipped files. */
const HEARTBEAT_EVERY = 25;

/**
 * Build a scanner bound to a specific DB connection and logger. The CLI passes
 * its script-opened connection + `console.log`; the in-app job manager passes
 * the shared app connection + a buffer-appending logger.
 */
export function createScanner(db: DB, log: Logger) {
  function fileInfo(filePath: string): {
    absPath: string;
    fileSize: number | null;
    mimeType: string;
  } {
    const absPath = resolve(filePath);
    let fileSize: number | null = null;
    try {
      fileSize = statSync(absPath).size;
    } catch {
      log(`  ✗ FILE MISSING (recorded anyway): ${absPath}`);
    }
    return { absPath, fileSize, mimeType: mimeTypeForFile(absPath) };
  }

  function upsertGenres(list: { id: number; name: string }[]) {
    for (const g of list) {
      db.insert(schema.genres)
        .values({ id: g.id, name: g.name })
        .onConflictDoUpdate({ target: schema.genres.id, set: { name: g.name } })
        .run();
    }
  }

  function upsertKeywords(list: { id: number; name: string }[]) {
    for (const k of list) {
      db.insert(schema.keywords)
        .values({ id: k.id, name: k.name })
        .onConflictDoUpdate({ target: schema.keywords.id, set: { name: k.name } })
        .run();
    }
  }

  /** Videos are owned by one title, so just swap the whole set on each scan. */
  function replaceVideos(
    mediaType: "movie" | "show",
    mediaId: number,
    list: TmdbVideo[],
  ) {
    db.delete(schema.videos)
      .where(
        and(
          eq(schema.videos.mediaType, mediaType),
          eq(schema.videos.mediaId, mediaId),
        ),
      )
      .run();

    list.forEach((v, index) => {
      db.insert(schema.videos)
        .values({
          mediaType,
          mediaId,
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
  }

  function upsertPerson(c: { id: number; name: string; profile_path: string | null }) {
    db.insert(schema.people)
      .values({ id: c.id, name: c.name, profilePath: c.profile_path })
      .onConflictDoUpdate({
        target: schema.people.id,
        set: { name: c.name, profilePath: c.profile_path },
      })
      .run();
  }

  function upsertMovie(data: MovieData): number {
    const { absPath, fileSize, mimeType } = fileInfo(data.filePath);

    const row = db
      .insert(schema.movies)
      .values({
        tmdbId: data.tmdbId,
        title: data.title,
        overview: data.overview,
        posterPath: data.posterPath,
        backdropPath: data.backdropPath,
        releaseDate: data.releaseDate,
        runtimeMinutes: data.runtimeMinutes,
        certification: data.certification,
        voteAverage: data.voteAverage,
        voteCount: data.voteCount,
        tmdbCollectionId: data.tmdbCollectionId,
        filePath: absPath,
        fileSize,
        mimeType,
      })
      .onConflictDoUpdate({
        target: schema.movies.tmdbId,
        set: {
          title: data.title,
          overview: data.overview,
          posterPath: data.posterPath,
          backdropPath: data.backdropPath,
          releaseDate: data.releaseDate,
          runtimeMinutes: data.runtimeMinutes,
          certification: data.certification,
          voteAverage: data.voteAverage,
          voteCount: data.voteCount,
          tmdbCollectionId: data.tmdbCollectionId,
          filePath: absPath,
          fileSize,
          mimeType,
        },
      })
      .returning({ id: schema.movies.id })
      .get();

    upsertGenres(data.genres);
    db.delete(schema.movieGenres).where(eq(schema.movieGenres.movieId, row.id)).run();
    for (const g of data.genres) {
      db.insert(schema.movieGenres)
        .values({ movieId: row.id, genreId: g.id })
        .onConflictDoNothing()
        .run();
    }

    upsertKeywords(data.keywords);
    db.delete(schema.movieKeywords).where(eq(schema.movieKeywords.movieId, row.id)).run();
    for (const k of data.keywords) {
      db.insert(schema.movieKeywords)
        .values({ movieId: row.id, keywordId: k.id })
        .onConflictDoNothing()
        .run();
    }

    replaceVideos("movie", row.id, data.videos);
    return row.id;
  }

  async function ingestMovieCast(movieId: number, tmdbMovieId: number) {
    const cast = (await getMovieCast(tmdbMovieId)).slice(0, TOP_CAST);
    db.delete(schema.movieCast).where(eq(schema.movieCast.movieId, movieId)).run();
    for (const c of cast) {
      upsertPerson(c);
      db.insert(schema.movieCast)
        .values({ movieId, personId: c.id, ord: c.order ?? null })
        .onConflictDoNothing()
        .run();
    }
  }

  /**
   * Fetch a movie from TMDB by id and (re)write its row + related data for the
   * given file. The core of the movie scan path, split out so the admin
   * re-tag / assign tools can drive it for one operator-chosen title.
   */
  async function ingestMovieByTmdbId(
    tmdbId: number,
    filePath: string,
  ): Promise<{ id: number; title: string; releaseDate: string | null }> {
    const d = await getMovieDetails(tmdbId);
    const id = upsertMovie({
      tmdbId: d.id,
      title: d.title,
      overview: d.overview,
      posterPath: d.poster_path,
      backdropPath: d.backdrop_path,
      releaseDate: d.release_date,
      runtimeMinutes: d.runtime,
      certification: await getMovieCertification(d.id),
      voteAverage: d.vote_average,
      voteCount: d.vote_count,
      tmdbCollectionId: d.belongs_to_collection?.id ?? null,
      genres: d.genres,
      keywords: keywordsOf(d),
      videos: await filterAvailableVideos(videosOf(d), log),
      filePath,
    });
    await ingestMovieCast(id, d.id);
    return { id, title: d.title, releaseDate: d.release_date };
  }

  async function ingestShowCast(showId: number, tmdbShowId: number) {
    const cast = (await getShowCast(tmdbShowId)).slice(0, TOP_CAST);
    db.delete(schema.showCast).where(eq(schema.showCast.showId, showId)).run();
    for (const c of cast) {
      upsertPerson(c);
      db.insert(schema.showCast)
        .values({ showId, personId: c.id, ord: c.order ?? null })
        .onConflictDoNothing()
        .run();
    }
  }

  async function ingestShow(entry: {
    tmdbId?: number;
    searchTitle?: string;
    episodes: { season: number; episode: number; filePath: string }[];
  }): Promise<number | null> {
    const tmdbId =
      entry.tmdbId ?? (entry.searchTitle ? await searchTv(entry.searchTitle) : null);
    if (!tmdbId) {
      log(`  ✗ NO TMDB MATCH (show): ${entry.searchTitle ?? "(no title)"}`);
      return null;
    }

    const show = await getShowDetails(tmdbId);
    const certification = await getShowCertification(show.id);
    const showRow = db
      .insert(schema.shows)
      .values({
        tmdbId: show.id,
        name: show.name,
        overview: show.overview,
        posterPath: show.poster_path,
        backdropPath: show.backdrop_path,
        firstAirDate: show.first_air_date,
        certification,
        voteAverage: show.vote_average,
        voteCount: show.vote_count,
      })
      .onConflictDoUpdate({
        target: schema.shows.tmdbId,
        set: {
          name: show.name,
          overview: show.overview,
          posterPath: show.poster_path,
          backdropPath: show.backdrop_path,
          firstAirDate: show.first_air_date,
          certification,
          voteAverage: show.vote_average,
          voteCount: show.vote_count,
        },
      })
      .returning({ id: schema.shows.id })
      .get();

    upsertGenres(show.genres);
    db.delete(schema.showGenres).where(eq(schema.showGenres.showId, showRow.id)).run();
    for (const g of show.genres) {
      db.insert(schema.showGenres)
        .values({ showId: showRow.id, genreId: g.id })
        .onConflictDoNothing()
        .run();
    }

    const showKeywordList = keywordsOf(show);
    upsertKeywords(showKeywordList);
    db.delete(schema.showKeywords).where(eq(schema.showKeywords.showId, showRow.id)).run();
    for (const k of showKeywordList) {
      db.insert(schema.showKeywords)
        .values({ showId: showRow.id, keywordId: k.id })
        .onConflictDoNothing()
        .run();
    }

    replaceVideos("show", showRow.id, await filterAvailableVideos(videosOf(show), log));

    await ingestShowCast(showRow.id, tmdbId);

    const bySeason = new Map<number, typeof entry.episodes>();
    for (const ep of entry.episodes) {
      const list = bySeason.get(ep.season) ?? [];
      list.push(ep);
      bySeason.set(ep.season, list);
    }

    // One fetch per season per run. A manual link can point into a season this
    // show has no files for (Specials, typically), so the same cache serves both
    // the season loop below and the override lookups inside it.
    const seasonCache = new Map<number, TmdbSeasonDetails>();
    async function seasonDetails(n: number): Promise<TmdbSeasonDetails> {
      const hit = seasonCache.get(n);
      if (hit) return hit;
      const fetched = await getSeasonDetails(show.id, n);
      seasonCache.set(n, fetched);
      return fetched;
    }

    for (const [seasonNumber, eps] of bySeason) {
      const season = await seasonDetails(seasonNumber);
      const seasonRow = db
        .insert(schema.seasons)
        .values({
          showId: showRow.id,
          tmdbSeasonNumber: seasonNumber,
          name: season.name,
          overview: season.overview,
          posterPath: season.poster_path,
        })
        .onConflictDoUpdate({
          target: [schema.seasons.showId, schema.seasons.tmdbSeasonNumber],
          set: { name: season.name, overview: season.overview, posterPath: season.poster_path },
        })
        .returning({ id: schema.seasons.id })
        .get();

      const tmdbEpisodes = new Map(season.episodes.map((e) => [e.episode_number, e]));

      for (const ep of eps) {
        // A record the operator linked to a different TMDB episode keeps taking
        // its metadata from there, or a rescan would overwrite the fix with the
        // blank/wrong entry at its own number. The link columns are absent from
        // the `set` below, so the link itself survives untouched either way.
        const linked = db
          .select({
            season: schema.episodes.tmdbSourceSeason,
            episode: schema.episodes.tmdbSourceEpisode,
          })
          .from(schema.episodes)
          .where(
            and(
              eq(schema.episodes.seasonId, seasonRow.id),
              eq(schema.episodes.tmdbEpisodeNumber, ep.episode),
            ),
          )
          .get();

        let meta = tmdbEpisodes.get(ep.episode);
        if (linked?.season != null && linked.episode != null) {
          const source = await seasonDetails(linked.season);
          meta = source.episodes.find((e) => e.episode_number === linked.episode);
        }

        const { absPath, fileSize, mimeType } = fileInfo(ep.filePath);
        db.insert(schema.episodes)
          .values({
            seasonId: seasonRow.id,
            tmdbEpisodeNumber: ep.episode,
            name: meta?.name ?? null,
            overview: meta?.overview ?? null,
            stillPath: meta?.still_path ?? null,
            runtimeMinutes: meta?.runtime ?? null,
            airDate: meta?.air_date ?? null,
            filePath: absPath,
            fileSize,
            mimeType,
          })
          .onConflictDoUpdate({
            target: [schema.episodes.seasonId, schema.episodes.tmdbEpisodeNumber],
            set: {
              name: meta?.name ?? null,
              overview: meta?.overview ?? null,
              stillPath: meta?.still_path ?? null,
              runtimeMinutes: meta?.runtime ?? null,
              airDate: meta?.air_date ?? null,
              filePath: absPath,
              fileSize,
              mimeType,
            },
          })
          .run();
      }
      log(`  ✓ show: ${show.name} S${seasonNumber} (${eps.length} episode(s))`);
    }

    return showRow.id;
  }

  function buildCollections(configs: CollectionConfig[]) {
    for (const cfg of configs) {
      const collection = db
        .insert(schema.collections)
        .values({
          slug: cfg.slug,
          title: cfg.title,
          kind: cfg.kind,
          sortOrder: cfg.sortOrder ?? 0,
        })
        .onConflictDoUpdate({
          target: schema.collections.slug,
          set: { title: cfg.title, kind: cfg.kind, sortOrder: cfg.sortOrder ?? 0 },
        })
        .returning({ id: schema.collections.id })
        .get();

      db.delete(schema.collectionItems)
        .where(eq(schema.collectionItems.collectionId, collection.id))
        .run();

      cfg.items.forEach((item, index) => {
        const internalId =
          item.type === "movie"
            ? db
                .select({ id: schema.movies.id })
                .from(schema.movies)
                .where(eq(schema.movies.tmdbId, item.tmdbId))
                .get()?.id
            : db
                .select({ id: schema.shows.id })
                .from(schema.shows)
                .where(eq(schema.shows.tmdbId, item.tmdbId))
                .get()?.id;

        if (!internalId) {
          log(
            `  ⚠ collection "${cfg.slug}" references ${item.type} tmdbId ${item.tmdbId} which isn't in the library`,
          );
          return;
        }

        db.insert(schema.collectionItems)
          .values({
            collectionId: collection.id,
            mediaType: item.type,
            mediaId: internalId,
            position: index,
          })
          .run();
      });
      log(`  ✓ collection: ${cfg.title} (${cfg.items.length} item(s))`);
    }
  }

  /** Apply preferPlayable, then optionally drop non-playable files. */
  function filterFiles(files: string[], includeNonPlayable: boolean): {
    kept: string[];
    skipped: number;
  } {
    const preferred = preferPlayable(files);
    if (includeNonPlayable) return { kept: preferred, skipped: 0 };
    const kept = preferred.filter(isBrowserPlayable);
    return { kept, skipped: preferred.length - kept.length };
  }

  /** Absolute paths of every file already in the library (movies + episodes + versions). */
  function loadKnownPaths(): Set<string> {
    const set = new Set<string>();
    for (const m of db.select({ filePath: schema.movies.filePath }).from(schema.movies).all()) {
      set.add(m.filePath);
    }
    for (const e of db.select({ filePath: schema.episodes.filePath }).from(schema.episodes).all()) {
      set.add(e.filePath);
    }
    for (const v of db.select({ filePath: schema.mediaFiles.filePath }).from(schema.mediaFiles).all()) {
      set.add(v.filePath);
    }
    return set;
  }

  /**
   * Identity of already-tracked files, so a scan never re-derives it from the
   * filename. Re-searching TMDB for a tracked file is what created duplicate
   * rows: if the search resolved to a different id than the one stored (certain
   * after a manual re-match, e.g. a movie pointed at a TV entry), the "already
   * exists?" check — which looks up by the *fresh* id — missed the existing row
   * and inserted a second one for the same file.
   */
  function loadMovieTmdbByPath(): Map<string, number> {
    const map = new Map<string, number>();
    for (const m of db
      .select({ filePath: schema.movies.filePath, tmdbId: schema.movies.tmdbId })
      .from(schema.movies)
      .all()) {
      map.set(resolve(m.filePath), m.tmdbId);
    }
    return map;
  }

  /**
   * Resolved path of each extra (non-primary) movie version → the tmdbId of the
   * movie that owns it. The owner is needed when skipping the file so the title
   * still counts toward the rebuilt home rows (a movie whose primary file isn't
   * in this scan — filtered out as non-playable, or gone from disk — would
   * otherwise drop out of the "Movies" row entirely).
   */
  function loadVersionOwnerByPath(): Map<string, number> {
    const map = new Map<string, number>();
    for (const v of db
      .select({ filePath: schema.mediaFiles.filePath, tmdbId: schema.movies.tmdbId })
      .from(schema.mediaFiles)
      .innerJoin(schema.movies, eq(schema.mediaFiles.mediaId, schema.movies.id))
      .where(eq(schema.mediaFiles.mediaType, "movie"))
      .all()) {
      map.set(resolve(v.filePath), v.tmdbId);
    }
    return map;
  }

  /** Episode file path → the owning show's tmdbId, so shows skip `searchTv` too. */
  function loadShowTmdbByEpisodePath(): Map<string, number> {
    const map = new Map<string, number>();
    for (const e of db
      .select({ filePath: schema.episodes.filePath, tmdbId: schema.shows.tmdbId })
      .from(schema.episodes)
      .innerJoin(schema.seasons, eq(schema.episodes.seasonId, schema.seasons.id))
      .innerJoin(schema.shows, eq(schema.seasons.showId, schema.shows.id))
      .all()) {
      map.set(resolve(e.filePath), e.tmdbId);
    }
    return map;
  }

  /**
   * True when `filePath` already belongs to a movie row other than `exceptId`.
   * Last-ditch guard against writing a second row for one file (there is no
   * unique constraint on `movies.filePath`).
   */
  function moviePathOwnedByOther(filePath: string, exceptTmdbId: number): number | null {
    const abs = resolve(filePath);
    for (const m of db
      .select({ tmdbId: schema.movies.tmdbId, filePath: schema.movies.filePath })
      .from(schema.movies)
      .all()) {
      if (m.tmdbId !== exceptTmdbId && resolve(m.filePath) === abs) return m.tmdbId;
    }
    return null;
  }

  /**
   * Attach `file` as an additional version of an existing movie — or promote it
   * to primary when it's browser-playable and the current primary isn't (so the
   * default stream stays playable). De-duped by resolved path.
   */
  function attachMovieVersion(
    movie: { id: number; filePath: string },
    file: string,
  ): "added" | "promoted" | "exists" {
    const abs = resolve(file);
    if (resolve(movie.filePath) === abs) return "exists";
    const already = db
      .select({ id: schema.mediaFiles.id })
      .from(schema.mediaFiles)
      .where(
        and(
          eq(schema.mediaFiles.mediaType, "movie"),
          eq(schema.mediaFiles.mediaId, movie.id),
          eq(schema.mediaFiles.filePath, abs),
        ),
      )
      .get();
    if (already) return "exists";

    const info = fileInfo(file);
    if (isBrowserPlayable(file) && !isBrowserPlayable(movie.filePath)) {
      const old = fileInfo(movie.filePath);
      db.insert(schema.mediaFiles)
        .values({
          mediaType: "movie",
          mediaId: movie.id,
          label: parseVersionLabel(movie.filePath) ?? "Alternate",
          filePath: old.absPath,
          fileSize: old.fileSize,
          mimeType: old.mimeType,
        })
        .run();
      db.update(schema.movies)
        .set({ filePath: info.absPath, fileSize: info.fileSize, mimeType: info.mimeType })
        .where(eq(schema.movies.id, movie.id))
        .run();
      return "promoted";
    }

    db.insert(schema.mediaFiles)
      .values({
        mediaType: "movie",
        mediaId: movie.id,
        label: parseVersionLabel(file) ?? "Alternate",
        filePath: info.absPath,
        fileSize: info.fileSize,
        mimeType: info.mimeType,
      })
      .run();
    return "added";
  }

  /**
   * Rebuild a "row" collection from the full library (all movies or all shows),
   * ordered alphabetically. Used by an incremental scan so newly-added titles
   * join the home rows without shrinking them to just this run's matches.
   */
  function rebuildRowFromDb(mediaType: "movie" | "show") {
    if (mediaType === "movie") {
      const all = db
        .select({ tmdbId: schema.movies.tmdbId })
        .from(schema.movies)
        .orderBy(asc(schema.movies.title))
        .all();
      buildCollections([
        {
          slug: "my-movies",
          title: "Movies",
          kind: "row",
          sortOrder: 1,
          items: all.map((m) => ({ type: "movie" as const, tmdbId: m.tmdbId })),
        },
      ]);
    } else {
      const all = db
        .select({ tmdbId: schema.shows.tmdbId })
        .from(schema.shows)
        .orderBy(asc(schema.shows.name))
        .all();
      buildCollections([
        {
          slug: "tv-shows",
          title: "TV Shows",
          kind: "row",
          sortOrder: 2,
          items: all.map((s) => ({ type: "show" as const, tmdbId: s.tmdbId })),
        },
      ]);
    }
  }

  async function scanMovies(
    rootDir: string,
    includeNonPlayable: boolean,
    onlyNew: boolean,
    knownPaths: Set<string>,
  ): Promise<number> {
    const root = resolve(rootDir);
    log(`Scanning ${root} for movies…`);

    const { kept: files, skipped } = filterFiles(
      await walkVideos(root, { skipShowDirs: true }),
      includeNonPlayable,
    );
    if (skipped > 0) log(`  ⏭ skipped ${skipped} non-playable file(s) (setting: skip).`);
    if (files.length === 0) {
      log("  no movie files found (TV shows live under shows/ or tv/).");
      return 0;
    }

    const matched: number[] = [];
    const seen = new Set<number>();
    let imported = 0;
    let versions = 0;
    let noMatch = 0;
    let errors = 0;
    let skippedExisting = 0;

    // Identity of files already tracked, so a rescan never re-derives it.
    const tmdbByPath = loadMovieTmdbByPath();
    const versionOwnerByPath = loadVersionOwnerByPath();
    const total = files.length;
    let processed = 0;

    for (const file of files) {
      processed++;
      const progress: ScanProgress = { phase: "movies", done: processed, total };
      const abs = resolve(file);

      // An extra version of a tracked movie — nothing to resolve, but its owner
      // still counts toward the home rows rebuilt from `matched` below.
      const versionOwner = versionOwnerByPath.get(abs);
      if (versionOwner !== undefined || (onlyNew && knownPaths.has(abs))) {
        skippedExisting++;
        if (versionOwner !== undefined && !seen.has(versionOwner)) {
          seen.add(versionOwner);
          matched.push(versionOwner);
        }
        if (processed % HEARTBEAT_EVERY === 0 || processed === total) {
          log(`  … ${processed}/${total} file(s) checked.`, progress);
        }
        continue;
      }
      // A file we already track is left completely alone — no TMDB lookup, no
      // rewrite. Re-deriving identity from the filename is what inserted
      // duplicate rows, and re-fetching by the stored id is unsafe too: a movie
      // pointed at a TV entry (matchMovieToTv) would pull whatever unrelated
      // movie happens to share that number. Manual fixes therefore survive
      // rescans. Its id still counts toward the home rows rebuilt below.
      const trackedTmdbId = tmdbByPath.get(abs);
      if (trackedTmdbId !== undefined) {
        skippedExisting++;
        if (!seen.has(trackedTmdbId)) {
          seen.add(trackedTmdbId);
          matched.push(trackedTmdbId);
        }
        // Skips are silent, but the bar must still advance (on a rescan almost
        // every file takes this path).
        if (processed % HEARTBEAT_EVERY === 0 || processed === total) {
          log(`  … ${processed}/${total} file(s) checked.`, progress);
        }
        continue;
      }

      // Isolate each file so one bad title (or a TMDB hiccup) doesn't abort the run.
      try {
        const { title, year } = parseMovieFilename(file);
        const yearLabel = year ? ` (${year})` : "";
        let tmdbId = await searchMovie(title, year);
        if (!tmdbId && year) tmdbId = await searchMovie(title);
        if (!tmdbId) {
          log(`  ✗ NO TMDB MATCH: "${title}"${yearLabel} — ${basename(file)}`, progress);
          noMatch++;
          continue;
        }

        // A second file for a movie already in the library becomes a version
        // instead of overwriting the primary (which is the old collapse bug).
        const existing = db
          .select({ id: schema.movies.id, filePath: schema.movies.filePath })
          .from(schema.movies)
          .where(eq(schema.movies.tmdbId, tmdbId))
          .get();

        if (existing && resolve(existing.filePath) !== abs) {
          const tag = attachMovieVersion(existing, file);
          if (tag !== "exists") {
            log(`  ✓ version (${tag}) -> ${basename(file)} (movie id ${existing.id})`, progress);
            versions++;
            versionOwnerByPath.set(abs, tmdbId);
          }
        } else if (!existing && moviePathOwnedByOther(file, tmdbId) !== null) {
          // Guard: this path already belongs to another movie row, so importing
          // would create a duplicate record for one file.
          log(
            `  ⚠ SKIPPED (already tracked under a different title): ${basename(file)}`,
            progress,
          );
          skippedExisting++;
          continue;
        } else {
          const info = await ingestMovieByTmdbId(tmdbId, file);
          const yr = info.releaseDate ? ` (${info.releaseDate.slice(0, 4)})` : "";
          log(`  ✓ ${info.title}${yr} -> ${basename(file)} (id ${info.id})`, progress);
          imported++;
          tmdbByPath.set(abs, tmdbId);
        }
        if (!seen.has(tmdbId)) {
          seen.add(tmdbId);
          matched.push(tmdbId);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`  ✗ TMDB ERROR: ${basename(file)} — ${msg}`, progress);
        errors++;
      }
    }

    const versionsMsg = versions > 0 ? ` · ${versions} version(s)` : "";
    const existingMsg =
      skippedExisting > 0 ? ` · ${skippedExisting} already-tracked (unchanged)` : "";
    log(
      `Movies: ${imported} imported${versionsMsg} · ${noMatch} no-match · ${errors} error(s)${existingMsg}`,
    );

    if (onlyNew) {
      // Fold new titles into the full Movies row; leave the hero untouched.
      if (imported > 0) rebuildRowFromDb("movie");
    } else if (matched.length > 0) {
      buildCollections([
        {
          slug: "featured",
          title: "Featured",
          kind: "hero",
          items: [{ type: "movie", tmdbId: matched[0] }],
        },
        {
          slug: "my-movies",
          title: "Movies",
          kind: "row",
          sortOrder: 1,
          items: matched.map((tmdbId) => ({ type: "movie" as const, tmdbId })),
        },
      ]);
    }
    return matched.length;
  }

  async function scanShows(
    rootDir: string,
    includeNonPlayable: boolean,
    onlyNew: boolean,
    knownPaths: Set<string>,
  ): Promise<number> {
    const root = resolve(rootDir);
    const scannedTmdbIds: number[] = [];
    let errors = 0;
    let skippedShows = 0;

    // Walk every show folder up front (once) so the total is known for progress
    // and each folder's file list is reused below rather than walked twice.
    const showEntries: { name: string; files: string[] }[] = [];
    for (const rootName of SHOW_ROOT_NAMES) {
      const showsRoot = join(root, rootName);
      let showDirs;
      try {
        showDirs = await readdir(showsRoot, { withFileTypes: true });
      } catch {
        continue; // no shows/ or tv/ folder
      }
      for (const showDir of showDirs) {
        if (!showDir.isDirectory() || showDir.name.startsWith(".")) continue;
        const { kept, skipped } = filterFiles(
          await walkVideos(join(showsRoot, showDir.name)),
          includeNonPlayable,
        );
        if (skipped > 0) log(`  ⏭ skipped ${skipped} non-playable file(s) in ${showDir.name}.`);
        if (kept.length === 0) continue;
        showEntries.push({ name: showDir.name, files: kept });
      }
    }

    const tmdbByEpisodePath = loadShowTmdbByEpisodePath();
    const total = showEntries.length;
    let processed = 0;

    for (const entry of showEntries) {
      processed++;
      const progress: ScanProgress = { phase: "shows", done: processed, total };

      // Isolate each show so one bad title (or a TMDB hiccup) doesn't abort the run.
      try {
        // A show with any already-tracked episode file keeps its stored identity
        // rather than re-resolving via `searchTv` (which could drift and insert
        // a duplicate show, cascading duplicate seasons/episodes under it).
        let trackedTmdbId: number | undefined;
        for (const file of entry.files) {
          const found = tmdbByEpisodePath.get(resolve(file));
          if (found !== undefined) {
            trackedTmdbId = found;
            break;
          }
        }

        const episodes: { season: number; episode: number; filePath: string }[] = [];
        for (const file of entry.files) {
          if (onlyNew && knownPaths.has(resolve(file))) continue; // already indexed
          const parsed = parseEpisodeNumbers(file);
          if (!parsed) {
            log(`  ✗ NO SxxEyy: ${basename(file)}`, progress);
            continue;
          }
          episodes.push({ ...parsed, filePath: file });
        }
        if (episodes.length === 0) {
          if (onlyNew) skippedShows++; // no new episodes — skip TMDB entirely
          continue;
        }

        log(`Scanning show "${entry.name}" (${episodes.length} episode file(s))…`, progress);
        const showId = await ingestShow(
          trackedTmdbId !== undefined
            ? { tmdbId: trackedTmdbId, episodes }
            : { searchTitle: entry.name, episodes },
        );
        if (showId !== null) {
          const show = db
            .select({ tmdbId: schema.shows.tmdbId })
            .from(schema.shows)
            .where(eq(schema.shows.id, showId))
            .get();
          if (show) scannedTmdbIds.push(show.tmdbId);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`  ✗ TMDB ERROR (show ${entry.name}): ${msg}`, progress);
        errors++;
      }
    }

    const existingMsg = onlyNew ? ` · ${skippedShows} show(s) with no new episodes` : "";
    log(`Shows: ${scannedTmdbIds.length} ingested · ${errors} error(s)${existingMsg}`);

    if (scannedTmdbIds.length === 0) return 0;

    if (onlyNew) {
      rebuildRowFromDb("show");
    } else {
      buildCollections([
        {
          slug: "tv-shows",
          title: "TV Shows",
          kind: "row",
          sortOrder: 2,
          items: scannedTmdbIds.map((tmdbId) => ({ type: "show" as const, tmdbId })),
        },
      ]);
    }
    return scannedTmdbIds.length;
  }

  async function runScan(opts: ScanOptions): Promise<ScanSummary> {
    if (!process.env.TMDB_API_TOKEN) {
      throw new Error(
        "TMDB_API_TOKEN is not set — scanning needs it to look up titles. Add a v4 read token to .env.local.",
      );
    }
    const onlyNew = !!opts.onlyNew;
    const knownPaths = onlyNew ? loadKnownPaths() : new Set<string>();
    if (onlyNew) {
      log(`Incremental scan: ${knownPaths.size} already-indexed file(s) will be skipped.`);
    }
    const movies = await scanMovies(opts.mediaDir, opts.includeNonPlayable, onlyNew, knownPaths);
    const shows = await scanShows(opts.mediaDir, opts.includeNonPlayable, onlyNew, knownPaths);
    if (opts.cacheArtwork) await cacheArtwork(db, log);
    reindexSearch(db, log);
    return { movies, shows, skipped: 0 };
  }

  return {
    upsertMovie,
    ingestMovieCast,
    ingestMovieByTmdbId,
    ingestShow,
    buildCollections,
    rebuildRowFromDb,
    runScan,
  };
}
