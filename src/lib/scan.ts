import { statSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "../db/schema";
import { cacheArtwork } from "./images";
import { reindexSearch } from "./search-index";
import { isBrowserPlayable, mimeTypeForFile } from "./media";
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
  type TmdbVideo,
} from "./tmdb";
import { filterAvailableVideos } from "./youtube";

export type DB = BetterSQLite3Database<typeof schema>;
export type Logger = (line: string) => void;

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
      log(`  ⚠ file not found on disk (still recorded): ${absPath}`);
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
      log(`  ⚠ could not resolve show: ${entry.searchTitle ?? "(no title)"}`);
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

    for (const [seasonNumber, eps] of bySeason) {
      const season = await getSeasonDetails(tmdbId, seasonNumber);
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
        const meta = tmdbEpisodes.get(ep.episode);
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

  async function scanMovies(rootDir: string, includeNonPlayable: boolean): Promise<number> {
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

    for (const file of files) {
      const { title, year } = parseMovieFilename(file);
      const yearLabel = year ? ` (${year})` : "";
      let tmdbId = await searchMovie(title, year);
      if (!tmdbId && year) tmdbId = await searchMovie(title);
      if (!tmdbId) {
        log(`  ⚠ no TMDB match for "${title}"${yearLabel} — ${basename(file)}`);
        continue;
      }

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
        filePath: file,
      });
      await ingestMovieCast(id, d.id);
      const yr = d.release_date ? ` (${d.release_date.slice(0, 4)})` : "";
      log(`  ✓ ${d.title}${yr} -> ${basename(file)} (id ${id})`);
      if (!seen.has(d.id)) {
        seen.add(d.id);
        matched.push(d.id);
      }
    }

    if (matched.length === 0) return 0;

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
    return matched.length;
  }

  async function scanShows(rootDir: string, includeNonPlayable: boolean): Promise<number> {
    const root = resolve(rootDir);
    const scannedTmdbIds: number[] = [];

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

        const { kept: files, skipped } = filterFiles(
          await walkVideos(join(showsRoot, showDir.name)),
          includeNonPlayable,
        );
        if (skipped > 0) log(`  ⏭ skipped ${skipped} non-playable file(s) in ${showDir.name}.`);
        if (files.length === 0) continue;

        const episodes: { season: number; episode: number; filePath: string }[] = [];
        for (const file of files) {
          const parsed = parseEpisodeNumbers(file);
          if (!parsed) {
            log(`  ⚠ no SxxEyy pattern in ${basename(file)} — skipping`);
            continue;
          }
          episodes.push({ ...parsed, filePath: file });
        }
        if (episodes.length === 0) continue;

        log(`Scanning show "${showDir.name}" (${episodes.length} episode file(s))…`);
        const showId = await ingestShow({ searchTitle: showDir.name, episodes });
        if (showId !== null) {
          const show = db
            .select({ tmdbId: schema.shows.tmdbId })
            .from(schema.shows)
            .where(eq(schema.shows.id, showId))
            .get();
          if (show) scannedTmdbIds.push(show.tmdbId);
        }
      }
    }

    if (scannedTmdbIds.length === 0) return 0;
    buildCollections([
      {
        slug: "tv-shows",
        title: "TV Shows",
        kind: "row",
        sortOrder: 2,
        items: scannedTmdbIds.map((tmdbId) => ({ type: "show" as const, tmdbId })),
      },
    ]);
    return scannedTmdbIds.length;
  }

  async function runScan(opts: ScanOptions): Promise<ScanSummary> {
    if (!process.env.TMDB_API_TOKEN) {
      throw new Error(
        "TMDB_API_TOKEN is not set — scanning needs it to look up titles. Add a v4 read token to .env.local.",
      );
    }
    const movies = await scanMovies(opts.mediaDir, opts.includeNonPlayable);
    const shows = await scanShows(opts.mediaDir, opts.includeNonPlayable);
    if (opts.cacheArtwork) await cacheArtwork(db, log);
    reindexSearch(db, log);
    return { movies, shows, skipped: 0 };
  }

  return { upsertMovie, ingestMovieCast, ingestShow, buildCollections, runScan };
}
