import { existsSync } from "node:fs";

import { and, asc, desc, eq, gt, gte, inArray, like, or, sql } from "drizzle-orm";

import {
  formatRuntime,
  isBrowserPlayable,
  toPlayableId,
  type PlayableId,
} from "@/lib/media";
import { ensureSearchIndex, toMatchQuery } from "@/lib/search-index";

import { db } from "./index";
import {
  collectionItems,
  collections,
  episodes,
  genres,
  keywords,
  movieCast,
  movieGenres,
  movieKeywords,
  movies,
  people,
  profiles,
  seasons,
  showCast,
  showGenres,
  showKeywords,
  shows,
  videos,
  watchlist,
  watchProgress,
  appSettings,
  jobRuns,
  type Episode,
  type Movie,
  type Profile,
  type Season,
  type Show,
  type WatchProgress,
} from "./schema";

export interface CardItem {
  mediaType: "movie" | "show";
  id: number;
  title: string;
  posterPath: string | null;
}

export interface RowData {
  slug: string;
  title: string;
  items: CardItem[];
  /** Optional "See all" target for rows whose full list lives on its own page. */
  seeAllHref?: string;
}

/** A page of cards plus an opaque cursor for the next page (null = no more). */
export interface PageResult {
  items: CardItem[];
  nextCursor: string | null;
}

export type GridKind = "movies" | "shows" | "search";

export const PAGE_SIZE = 40;
const ROW_LIMIT = 25;
const SEE_ALL_BY_SLUG: Record<string, string> = {
  "my-movies": "/movies",
  "tv-shows": "/shows",
};

export interface HeroData {
  mediaType: "movie" | "show";
  id: number;
  title: string;
  overview: string | null;
  backdropPath: string | null;
  playableId: string | null;
}

/** Minimal lookup used by the streaming route handler. */
export function getPlayableFile(
  p: PlayableId,
): { filePath: string; mimeType: string | null; title: string } | null {
  if (p.kind === "movie") {
    const row = db
      .select({
        filePath: movies.filePath,
        mimeType: movies.mimeType,
        title: movies.title,
      })
      .from(movies)
      .where(eq(movies.id, p.numericId))
      .get();
    return row ?? null;
  }

  const row = db
    .select({
      filePath: episodes.filePath,
      mimeType: episodes.mimeType,
      title: episodes.name,
    })
    .from(episodes)
    .where(eq(episodes.id, p.numericId))
    .get();
  if (!row) return null;
  return {
    filePath: row.filePath,
    mimeType: row.mimeType,
    title: row.title ?? "Episode",
  };
}

/** Display metadata for the watch page (title + a back-link target). */
export function getWatchMeta(
  p: PlayableId,
): { title: string; backHref: string } | null {
  if (p.kind === "movie") {
    const row = db
      .select({ id: movies.id, title: movies.title })
      .from(movies)
      .where(eq(movies.id, p.numericId))
      .get();
    if (!row) return null;
    return { title: row.title, backHref: `/movie/${row.id}` };
  }

  const row = db
    .select({
      episodeName: episodes.name,
      episodeNumber: episodes.tmdbEpisodeNumber,
      seasonNumber: seasons.tmdbSeasonNumber,
      showId: shows.id,
      showName: shows.name,
    })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .where(eq(episodes.id, p.numericId))
    .get();
  if (!row) return null;
  const label = `${row.showName} — S${row.seasonNumber}:E${row.episodeNumber}${
    row.episodeName ? ` ${row.episodeName}` : ""
  }`;
  return { title: label, backHref: `/show/${row.showId}` };
}

function cardsForItems(
  items: { mediaType: "movie" | "show"; mediaId: number }[],
): CardItem[] {
  const movieIds = items.filter((i) => i.mediaType === "movie").map((i) => i.mediaId);
  const showIds = items.filter((i) => i.mediaType === "show").map((i) => i.mediaId);

  const movieRows = movieIds.length
    ? db
        .select({ id: movies.id, title: movies.title, posterPath: movies.posterPath })
        .from(movies)
        .where(inArray(movies.id, movieIds))
        .all()
    : [];
  const showRows = showIds.length
    ? db
        .select({ id: shows.id, title: shows.name, posterPath: shows.posterPath })
        .from(shows)
        .where(inArray(shows.id, showIds))
        .all()
    : [];

  const movieById = new Map(movieRows.map((r) => [r.id, r]));
  const showById = new Map(showRows.map((r) => [r.id, r]));

  // Preserve the order the items came in (already sorted by position).
  return items
    .map((item): CardItem | null => {
      const source =
        item.mediaType === "movie"
          ? movieById.get(item.mediaId)
          : showById.get(item.mediaId);
      if (!source) return null;
      return {
        mediaType: item.mediaType,
        id: source.id,
        title: source.title,
        posterPath: source.posterPath,
      };
    })
    .filter((c): c is CardItem => c !== null);
}

/** All `row` collections, ordered, each with its ordered cards. */
export function getRows(): RowData[] {
  const rowCollections = db
    .select()
    .from(collections)
    .where(eq(collections.kind, "row"))
    .orderBy(asc(collections.sortOrder))
    .all();

  return rowCollections
    .map((collection): RowData => {
      const items = db
        .select({
          mediaType: collectionItems.mediaType,
          mediaId: collectionItems.mediaId,
        })
        .from(collectionItems)
        .where(eq(collectionItems.collectionId, collection.id))
        .orderBy(asc(collectionItems.position))
        .limit(ROW_LIMIT)
        .all();

      return {
        slug: collection.slug,
        title: collection.title,
        items: cardsForItems(items),
        seeAllHref: SEE_ALL_BY_SLUG[collection.slug],
      };
    })
    .filter((row) => row.items.length > 0);
}

/** First item of the `hero` collection (falls back to the newest movie). */
export function getHero(): HeroData | null {
  const heroCollection = db
    .select()
    .from(collections)
    .where(eq(collections.kind, "hero"))
    .orderBy(asc(collections.sortOrder))
    .get();

  let pick: { mediaType: "movie" | "show"; mediaId: number } | undefined;

  if (heroCollection) {
    pick = db
      .select({
        mediaType: collectionItems.mediaType,
        mediaId: collectionItems.mediaId,
      })
      .from(collectionItems)
      .where(eq(collectionItems.collectionId, heroCollection.id))
      .orderBy(asc(collectionItems.position))
      .get();
  }

  if (!pick) {
    const newest = db.select({ id: movies.id }).from(movies).orderBy(asc(movies.id)).get();
    if (!newest) return null;
    pick = { mediaType: "movie", mediaId: newest.id };
  }

  if (pick.mediaType === "movie") {
    const movie = db.select().from(movies).where(eq(movies.id, pick.mediaId)).get();
    if (!movie) return null;
    return {
      mediaType: "movie",
      id: movie.id,
      title: movie.title,
      overview: movie.overview,
      backdropPath: movie.backdropPath,
      playableId: toPlayableId("movie", movie.id),
    };
  }

  const show = db.select().from(shows).where(eq(shows.id, pick.mediaId)).get();
  if (!show) return null;
  return {
    mediaType: "show",
    id: show.id,
    title: show.name,
    overview: show.overview,
    backdropPath: show.backdropPath,
    playableId: firstEpisodePlayableId(show.id),
  };
}

/** The earliest episode of a show as a playable id (for a show's Play button). */
export function firstEpisodePlayableId(showId: number): string | null {
  const row = db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(eq(seasons.showId, showId))
    .orderBy(asc(seasons.tmdbSeasonNumber), asc(episodes.tmdbEpisodeNumber))
    .get();
  return row ? toPlayableId("episode", row.id) : null;
}

function movieGenresFor(movieId: number) {
  return db
    .select({ id: genres.id, name: genres.name })
    .from(movieGenres)
    .innerJoin(genres, eq(movieGenres.genreId, genres.id))
    .where(eq(movieGenres.movieId, movieId))
    .all();
}

function showGenresFor(showId: number) {
  return db
    .select({ id: genres.id, name: genres.name })
    .from(showGenres)
    .innerJoin(genres, eq(showGenres.genreId, genres.id))
    .where(eq(showGenres.showId, showId))
    .all();
}

function movieKeywordsFor(movieId: number) {
  return db
    .select({ id: keywords.id, name: keywords.name })
    .from(movieKeywords)
    .innerJoin(keywords, eq(movieKeywords.keywordId, keywords.id))
    .where(eq(movieKeywords.movieId, movieId))
    .all();
}

function showKeywordsFor(showId: number) {
  return db
    .select({ id: keywords.id, name: keywords.name })
    .from(showKeywords)
    .innerJoin(keywords, eq(showKeywords.keywordId, keywords.id))
    .where(eq(showKeywords.showId, showId))
    .all();
}

export interface VideoItem {
  id: number;
  youtubeKey: string;
  name: string;
  type: string;
}

/** A title's videos in ingest order (trailers first — see `videosOf` in lib/tmdb). */
function videosFor(mediaType: "movie" | "show", mediaId: number): VideoItem[] {
  return db
    .select({
      id: videos.id,
      youtubeKey: videos.youtubeKey,
      name: videos.name,
      type: videos.type,
    })
    .from(videos)
    .where(and(eq(videos.mediaType, mediaType), eq(videos.mediaId, mediaId)))
    .orderBy(asc(videos.position))
    .all();
}

export interface CastMember {
  id: number;
  name: string;
  profilePath: string | null;
}

function movieCastFor(movieId: number): CastMember[] {
  return db
    .select({ id: people.id, name: people.name, profilePath: people.profilePath })
    .from(movieCast)
    .innerJoin(people, eq(movieCast.personId, people.id))
    .where(eq(movieCast.movieId, movieId))
    .orderBy(asc(movieCast.ord))
    .all();
}

function showCastFor(showId: number): CastMember[] {
  return db
    .select({ id: people.id, name: people.name, profilePath: people.profilePath })
    .from(showCast)
    .innerJoin(people, eq(showCast.personId, people.id))
    .where(eq(showCast.showId, showId))
    .orderBy(asc(showCast.ord))
    .all();
}

export interface MovieDetail extends Movie {
  genres: { id: number; name: string }[];
  keywords: { id: number; name: string }[];
  videos: VideoItem[];
  cast: CastMember[];
}

export function getMovieDetail(id: number): MovieDetail | null {
  const movie = db.select().from(movies).where(eq(movies.id, id)).get();
  if (!movie) return null;
  return {
    ...movie,
    genres: movieGenresFor(id),
    keywords: movieKeywordsFor(id),
    videos: videosFor("movie", id),
    cast: movieCastFor(id),
  };
}

export interface ShowDetail extends Show {
  genres: { id: number; name: string }[];
  keywords: { id: number; name: string }[];
  videos: VideoItem[];
  cast: CastMember[];
  seasons: (Season & { episodes: Episode[] })[];
}

export function getShowDetail(id: number): ShowDetail | null {
  const show = db.select().from(shows).where(eq(shows.id, id)).get();
  if (!show) return null;

  const seasonRows = db
    .select()
    .from(seasons)
    .where(eq(seasons.showId, id))
    .orderBy(asc(seasons.tmdbSeasonNumber))
    .all();

  const seasonsWithEpisodes = seasonRows.map((season) => ({
    ...season,
    episodes: db
      .select()
      .from(episodes)
      .where(eq(episodes.seasonId, season.id))
      .orderBy(asc(episodes.tmdbEpisodeNumber))
      .all(),
  }));

  return {
    ...show,
    genres: showGenresFor(id),
    keywords: showKeywordsFor(id),
    videos: videosFor("show", id),
    cast: showCastFor(id),
    seasons: seasonsWithEpisodes,
  };
}

/**
 * "More Like This": other titles scored by overlap with this one. Keywords are a
 * far more specific signal than genres, so they weigh more. Falls back to
 * genre-only similarity for titles that haven't been re-scanned for keywords yet.
 */
const KEYWORD_WEIGHT = 3;
const GENRE_WEIGHT = 1;
/**
 * The quality floor. A single shared genre is a coincidence, not a
 * recommendation ("Comedy" alone would pair a Pixar film with a Denzel shooter),
 * so genres never qualify a title on their own — they only refine the ranking.
 */
const MIN_SHARED_KEYWORDS = 2;

interface Candidate {
  mediaType: "movie" | "show";
  mediaId: number;
  score: number;
  voteAverage: number;
}

export function getRelated(
  mediaType: "movie" | "show",
  id: number,
  limit = 12,
): CardItem[] {
  const keywordIds = (
    mediaType === "movie" ? movieKeywordsFor(id) : showKeywordsFor(id)
  ).map((k) => k.id);
  // Nothing can clear the bar if this title isn't itself tagged enough.
  if (keywordIds.length < MIN_SHARED_KEYWORDS) return [];

  // 1. Gate: only titles sharing enough keywords are even candidates.
  const keywordHits = new Map<string, number>();
  db.select({ mediaId: movieKeywords.movieId, hits: sql<number>`count(*)` })
    .from(movieKeywords)
    .where(inArray(movieKeywords.keywordId, keywordIds))
    .groupBy(movieKeywords.movieId)
    .all()
    .forEach((r) => keywordHits.set(`movie-${r.mediaId}`, r.hits));

  db.select({ mediaId: showKeywords.showId, hits: sql<number>`count(*)` })
    .from(showKeywords)
    .where(inArray(showKeywords.keywordId, keywordIds))
    .groupBy(showKeywords.showId)
    .all()
    .forEach((r) => keywordHits.set(`show-${r.mediaId}`, r.hits));

  keywordHits.delete(`${mediaType}-${id}`); // never recommend itself
  for (const [key, hits] of keywordHits) {
    if (hits < MIN_SHARED_KEYWORDS) keywordHits.delete(key);
  }
  if (keywordHits.size === 0) return [];

  // 2. Shared genres refine the score of the titles that already qualified.
  const genreIds = (
    mediaType === "movie" ? movieGenresFor(id) : showGenresFor(id)
  ).map((g) => g.id);
  const genreHits = new Map<string, number>();
  if (genreIds.length > 0) {
    db.select({ mediaId: movieGenres.movieId, hits: sql<number>`count(*)` })
      .from(movieGenres)
      .where(inArray(movieGenres.genreId, genreIds))
      .groupBy(movieGenres.movieId)
      .all()
      .forEach((r) => genreHits.set(`movie-${r.mediaId}`, r.hits));

    db.select({ mediaId: showGenres.showId, hits: sql<number>`count(*)` })
      .from(showGenres)
      .where(inArray(showGenres.genreId, genreIds))
      .groupBy(showGenres.showId)
      .all()
      .forEach((r) => genreHits.set(`show-${r.mediaId}`, r.hits));
  }

  // 3. Ratings, so the best of the related titles surface first.
  const movieIds: number[] = [];
  const showIds: number[] = [];
  for (const key of keywordHits.keys()) {
    const [kind, raw] = key.split("-");
    (kind === "movie" ? movieIds : showIds).push(Number(raw));
  }
  const ratings = new Map<string, number>();
  if (movieIds.length > 0) {
    db.select({ id: movies.id, voteAverage: movies.voteAverage })
      .from(movies)
      .where(inArray(movies.id, movieIds))
      .all()
      .forEach((r) => ratings.set(`movie-${r.id}`, r.voteAverage ?? 0));
  }
  if (showIds.length > 0) {
    db.select({ id: shows.id, voteAverage: shows.voteAverage })
      .from(shows)
      .where(inArray(shows.id, showIds))
      .all()
      .forEach((r) => ratings.set(`show-${r.id}`, r.voteAverage ?? 0));
  }

  const candidates: Candidate[] = [...keywordHits].map(([key, hits]) => {
    const [kind, raw] = key.split("-");
    return {
      mediaType: kind as "movie" | "show",
      mediaId: Number(raw),
      score: hits * KEYWORD_WEIGHT + (genreHits.get(key) ?? 0) * GENRE_WEIGHT,
      voteAverage: ratings.get(key) ?? 0,
    };
  });

  // Highest rated first; unrated (0) sinks to the bottom. Similarity breaks ties.
  candidates.sort((a, b) => b.voteAverage - a.voteAverage || b.score - a.score);
  return cardsForItems(candidates.slice(0, limit));
}

export interface CardPreview {
  mediaType: "movie" | "show";
  id: number;
  title: string;
  backdropPath: string | null;
  posterPath: string | null;
  certification: string | null;
  runtime: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  genres: { id: number; name: string }[];
  playableId: string | null;
  inList: boolean;
}

/** Lightweight payload for the hover preview popover on a media card. */
export function getCardPreview(
  mediaType: "movie" | "show",
  id: number,
  profileId: number | null,
): CardPreview | null {
  if (mediaType === "movie") {
    const m = db.select().from(movies).where(eq(movies.id, id)).get();
    if (!m) return null;
    return {
      mediaType,
      id: m.id,
      title: m.title,
      backdropPath: m.backdropPath,
      posterPath: m.posterPath,
      certification: m.certification,
      runtime: formatRuntime(m.runtimeMinutes),
      voteAverage: m.voteAverage,
      voteCount: m.voteCount,
      genres: movieGenresFor(m.id),
      playableId: toPlayableId("movie", m.id),
      inList: profileId ? isInWatchlist(profileId, "movie", m.id) : false,
    };
  }

  const s = db.select().from(shows).where(eq(shows.id, id)).get();
  if (!s) return null;
  // A show has no single runtime; use the earliest episode's as representative.
  const firstEp = db
    .select({ runtimeMinutes: episodes.runtimeMinutes })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(eq(seasons.showId, s.id))
    .orderBy(asc(seasons.tmdbSeasonNumber), asc(episodes.tmdbEpisodeNumber))
    .get();
  return {
    mediaType,
    id: s.id,
    title: s.name,
    backdropPath: s.backdropPath,
    posterPath: s.posterPath,
    certification: s.certification,
    runtime: formatRuntime(firstEp?.runtimeMinutes),
    voteAverage: s.voteAverage,
    voteCount: s.voteCount,
    genres: showGenresFor(s.id),
    playableId: firstEpisodePlayableId(s.id),
    inList: profileId ? isInWatchlist(profileId, "show", s.id) : false,
  };
}

/** Newest movies and shows, interleaved by creation time. */
export function getRecentlyAdded(limit = 20): CardItem[] {
  const movieRows = db
    .select({
      id: movies.id,
      title: movies.title,
      posterPath: movies.posterPath,
      createdAt: movies.createdAt,
    })
    .from(movies)
    .orderBy(desc(movies.createdAt), desc(movies.id))
    .limit(limit)
    .all();
  const showRows = db
    .select({
      id: shows.id,
      title: shows.name,
      posterPath: shows.posterPath,
      createdAt: shows.createdAt,
    })
    .from(shows)
    .orderBy(desc(shows.createdAt), desc(shows.id))
    .limit(limit)
    .all();

  const combined = [
    ...movieRows.map((r) => ({ mediaType: "movie" as const, ...r })),
    ...showRows.map((r) => ({ mediaType: "show" as const, ...r })),
  ];
  combined.sort(
    (a, b) =>
      (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.id - a.id,
  );

  return combined
    .slice(0, limit)
    .map(({ mediaType, id, title, posterPath }) => ({
      mediaType,
      id,
      title,
      posterPath,
    }));
}

/** All movies, alphabetical. */
/** Keyset cursor over an alphabetical `(name, id)` ordering. */
function encodeKeyset(title: string, id: number): string {
  return JSON.stringify({ t: title, i: id });
}
function decodeKeyset(cursor: string | null): { t: string; i: number } | null {
  if (!cursor) return null;
  try {
    const v = JSON.parse(cursor);
    if (typeof v?.t === "string" && Number.isInteger(v?.i)) return { t: v.t, i: v.i };
  } catch {
    /* malformed cursor → start from the beginning */
  }
  return null;
}

/** A page of movies, alphabetical, keyset-paginated by `(title, id)`. */
export function getMoviesPage(cursor: string | null, limit = PAGE_SIZE): PageResult {
  const c = decodeKeyset(cursor);
  let q = db
    .select({ id: movies.id, title: movies.title, posterPath: movies.posterPath })
    .from(movies)
    .$dynamic();
  if (c) {
    q = q.where(or(gt(movies.title, c.t), and(eq(movies.title, c.t), gt(movies.id, c.i))));
  }
  const rows = q.orderBy(asc(movies.title), asc(movies.id)).limit(limit).all();
  const last = rows.at(-1);
  return {
    items: rows.map((r) => ({ mediaType: "movie" as const, ...r })),
    nextCursor: rows.length === limit && last ? encodeKeyset(last.title, last.id) : null,
  };
}

/** A page of shows, alphabetical, keyset-paginated by `(name, id)`. */
export function getShowsPage(cursor: string | null, limit = PAGE_SIZE): PageResult {
  const c = decodeKeyset(cursor);
  let q = db
    .select({ id: shows.id, title: shows.name, posterPath: shows.posterPath })
    .from(shows)
    .$dynamic();
  if (c) {
    q = q.where(or(gt(shows.name, c.t), and(eq(shows.name, c.t), gt(shows.id, c.i))));
  }
  const rows = q.orderBy(asc(shows.name), asc(shows.id)).limit(limit).all();
  const last = rows.at(-1);
  return {
    items: rows.map((r) => ({ mediaType: "show" as const, ...r })),
    nextCursor: rows.length === limit && last ? encodeKeyset(last.title, last.id) : null,
  };
}

/**
 * Case-insensitive search across movies and shows by:
 *  - title (movie title / show name / TV episode name)
 *  - cast member (actor name)
 *  - genre name
 * Returns distinct movies and shows, sorted by title.
 */
export function searchLibraryPage(
  query: string,
  cursor: string | null,
  limit = PAGE_SIZE,
): PageResult {
  const match = toMatchQuery(query);
  if (!match) return { items: [], nextCursor: null };

  ensureSearchIndex(db);
  const offset = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0;

  const rows = db.$client
    .prepare(
      // One weight per column: title, cast_names, genres, keywords, kind, media_id.
      `SELECT kind, media_id AS mediaId FROM search_index
         WHERE search_index MATCH ?
         ORDER BY bm25(search_index, 10, 4, 2, 3, 0, 0)
         LIMIT ? OFFSET ?`,
    )
    .all(match, limit, offset) as { kind: "movie" | "show"; mediaId: number }[];

  // cardsForItems preserves the (ranked) input order.
  const items = cardsForItems(rows.map((r) => ({ mediaType: r.kind, mediaId: r.mediaId })));
  return { items, nextCursor: rows.length === limit ? String(offset + limit) : null };
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export function listProfiles(): Profile[] {
  return db
    .select()
    .from(profiles)
    .orderBy(asc(profiles.createdAt), asc(profiles.id))
    .all();
}

export function getProfileById(id: number): Profile | undefined {
  return db.select().from(profiles).where(eq(profiles.id, id)).get();
}

// ---------------------------------------------------------------------------
// Watchlist ("My List")
// ---------------------------------------------------------------------------

export function isInWatchlist(
  profileId: number,
  mediaType: "movie" | "show",
  mediaId: number,
): boolean {
  return (
    db
      .select({ id: watchlist.id })
      .from(watchlist)
      .where(
        and(
          eq(watchlist.profileId, profileId),
          eq(watchlist.mediaType, mediaType),
          eq(watchlist.mediaId, mediaId),
        ),
      )
      .get() != null
  );
}

export function getMyList(profileId: number, limit?: number): CardItem[] {
  const base = db
    .select({ mediaType: watchlist.mediaType, mediaId: watchlist.mediaId })
    .from(watchlist)
    .where(eq(watchlist.profileId, profileId))
    .orderBy(desc(watchlist.addedAt));
  const items = limit ? base.limit(limit).all() : base.all();
  return cardsForItems(items);
}

// ---------------------------------------------------------------------------
// Watch progress + Continue Watching
// ---------------------------------------------------------------------------

const COMPLETE_FRACTION = 0.9;
const CONTINUE_THRESHOLD_SECONDS = 10;

export interface ResumeCardItem {
  playableId: string; // "m12" / "e34" → /watch/{playableId}
  title: string;
  imagePath: string | null;
  progressFraction: number;
  label: string | null; // "S2:E5" for episodes
  mediaType: "movie" | "show";
  detailId: number;
}

export function getWatchProgress(
  profileId: number,
  p: PlayableId,
): WatchProgress | null {
  return (
    db
      .select()
      .from(watchProgress)
      .where(
        and(
          eq(watchProgress.profileId, profileId),
          eq(watchProgress.playableKind, p.kind),
          eq(watchProgress.playableId, p.numericId),
        ),
      )
      .get() ?? null
  );
}

/** Upsert a progress beacon. Never *un*-completes an already-completed row. */
export function recordProgress(
  profileId: number,
  kind: "movie" | "episode",
  numericId: number,
  position: number,
  duration: number | null,
) {
  const completed = duration && duration > 0 && position / duration >= COMPLETE_FRACTION ? 1 : 0;
  db.insert(watchProgress)
    .values({
      profileId,
      playableKind: kind,
      playableId: numericId,
      positionSeconds: position,
      durationSeconds: duration ?? null,
      completed,
    })
    .onConflictDoUpdate({
      target: [watchProgress.profileId, watchProgress.playableKind, watchProgress.playableId],
      set: {
        positionSeconds: position,
        durationSeconds: duration ?? null,
        completed: sql`max(${watchProgress.completed}, ${completed})`,
        updatedAt: sql`(CURRENT_TIMESTAMP)`,
      },
    })
    .run();
}

/** Manual "mark as watched" / "mark unwatched". */
export function setCompleted(profileId: number, p: PlayableId, completed: boolean) {
  const existing = getWatchProgress(profileId, p);
  if (completed) {
    const duration = existing?.durationSeconds ?? null;
    const position = duration ?? existing?.positionSeconds ?? 0;
    db.insert(watchProgress)
      .values({
        profileId,
        playableKind: p.kind,
        playableId: p.numericId,
        positionSeconds: position,
        durationSeconds: duration,
        completed: 1,
      })
      .onConflictDoUpdate({
        target: [watchProgress.profileId, watchProgress.playableKind, watchProgress.playableId],
        set: { completed: 1, positionSeconds: position, updatedAt: sql`(CURRENT_TIMESTAMP)` },
      })
      .run();
  } else {
    // Reset so it leaves Continue Watching and Up Next rather than reappearing.
    db.insert(watchProgress)
      .values({
        profileId,
        playableKind: p.kind,
        playableId: p.numericId,
        positionSeconds: 0,
        durationSeconds: existing?.durationSeconds ?? null,
        completed: 0,
      })
      .onConflictDoUpdate({
        target: [watchProgress.profileId, watchProgress.playableKind, watchProgress.playableId],
        set: { completed: 0, positionSeconds: 0, updatedAt: sql`(CURRENT_TIMESTAMP)` },
      })
      .run();
  }
}

/** Episode ids the profile has completed for a given show (for ✓ markers). */
export function getCompletedEpisodeIds(profileId: number, showId: number): Set<number> {
  const rows = db
    .select({ id: watchProgress.playableId })
    .from(watchProgress)
    .innerJoin(episodes, eq(watchProgress.playableId, episodes.id))
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(
      and(
        eq(watchProgress.profileId, profileId),
        eq(watchProgress.playableKind, "episode"),
        eq(watchProgress.completed, 1),
        eq(seasons.showId, showId),
      ),
    )
    .all();
  return new Set(rows.map((r) => r.id));
}

function progressFraction(row: WatchProgress): number {
  if (!row.durationSeconds || row.durationSeconds <= 0) return 0;
  return Math.min(Math.max(row.positionSeconds / row.durationSeconds, 0), 1);
}

function movieResumeCard(row: WatchProgress): ResumeCardItem | null {
  const m = db
    .select({ id: movies.id, title: movies.title, posterPath: movies.posterPath })
    .from(movies)
    .where(eq(movies.id, row.playableId))
    .get();
  if (!m) return null;
  return {
    playableId: toPlayableId("movie", m.id),
    title: m.title,
    imagePath: m.posterPath,
    progressFraction: progressFraction(row),
    label: null,
    mediaType: "movie",
    detailId: m.id,
  };
}

function episodeResumeCard(row: WatchProgress): ResumeCardItem | null {
  const e = db
    .select({
      epId: episodes.id,
      stillPath: episodes.stillPath,
      epNum: episodes.tmdbEpisodeNumber,
      seasonNum: seasons.tmdbSeasonNumber,
      showId: shows.id,
      showName: shows.name,
      showPoster: shows.posterPath,
    })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .where(eq(episodes.id, row.playableId))
    .get();
  if (!e) return null;
  return {
    playableId: toPlayableId("episode", e.epId),
    title: e.showName,
    imagePath: e.stillPath ?? e.showPoster,
    progressFraction: progressFraction(row),
    label: `S${e.seasonNum}:E${e.epNum}`,
    mediaType: "show",
    detailId: e.showId,
  };
}

export function getContinueWatching(profileId: number): ResumeCardItem[] {
  const rows = db
    .select()
    .from(watchProgress)
    .where(
      and(
        eq(watchProgress.profileId, profileId),
        eq(watchProgress.completed, 0),
        gte(watchProgress.positionSeconds, CONTINUE_THRESHOLD_SECONDS),
      ),
    )
    .orderBy(desc(watchProgress.updatedAt))
    .all();

  return rows
    .map((r) => (r.playableKind === "movie" ? movieResumeCard(r) : episodeResumeCard(r)))
    .filter((c): c is ResumeCardItem => c !== null);
}

// ---------------------------------------------------------------------------
// Detail-page play state (Play / Continue / Restart)
// ---------------------------------------------------------------------------

export type PlayStateKind = "none" | "in_progress" | "completed";

export interface MoviePlayState {
  state: PlayStateKind;
  fraction: number;
  remainingMinutes: number | null;
}

/** Derive a movie's detail-page play state from its progress row + runtime. */
export function moviePlayState(
  progress: WatchProgress | null,
  runtimeMinutes: number | null,
): MoviePlayState {
  const position = progress?.positionSeconds ?? 0;
  const duration = progress?.durationSeconds ?? (runtimeMinutes ? runtimeMinutes * 60 : null);
  const fraction = duration && duration > 0 ? Math.min(Math.max(position / duration, 0), 1) : 0;
  const remainingMinutes =
    duration && duration > 0 ? Math.max(0, Math.round((duration - position) / 60)) : null;
  if (progress?.completed) return { state: "completed", fraction, remainingMinutes };
  if (position >= CONTINUE_THRESHOLD_SECONDS) return { state: "in_progress", fraction, remainingMinutes };
  return { state: "none", fraction: 0, remainingMinutes };
}

export interface ShowResume {
  totalEpisodes: number;
  watchedCount: number;
  started: boolean;
  allWatched: boolean;
  /** Episode to Continue into (in-progress, else next unwatched); null when all watched. */
  resumePlayableId: string | null;
  resumeLabel: string | null;
  /** First episode overall — for Play / Restart. */
  firstPlayableId: string | null;
  /** Per-episode progress for the episode list. */
  episodeProgress: Map<number, { fraction: number; completed: boolean }>;
}

/** Show-level progress summary + the episode to resume, from one profile's rows. */
export function getShowResume(profileId: number, showId: number): ShowResume {
  const eps = db
    .select({
      id: episodes.id,
      seasonNum: seasons.tmdbSeasonNumber,
      epNum: episodes.tmdbEpisodeNumber,
    })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(eq(seasons.showId, showId))
    .orderBy(asc(seasons.tmdbSeasonNumber), asc(episodes.tmdbEpisodeNumber))
    .all();

  const rows = db
    .select({
      playableId: watchProgress.playableId,
      positionSeconds: watchProgress.positionSeconds,
      durationSeconds: watchProgress.durationSeconds,
      completed: watchProgress.completed,
      updatedAt: watchProgress.updatedAt,
    })
    .from(watchProgress)
    .innerJoin(episodes, eq(watchProgress.playableId, episodes.id))
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(
      and(
        eq(watchProgress.profileId, profileId),
        eq(watchProgress.playableKind, "episode"),
        eq(seasons.showId, showId),
      ),
    )
    .all();

  const byId = new Map(rows.map((r) => [r.playableId, r]));
  const episodeProgress = new Map<number, { fraction: number; completed: boolean }>();
  let watchedCount = 0;
  for (const r of rows) {
    const fraction =
      r.durationSeconds && r.durationSeconds > 0
        ? Math.min(Math.max(r.positionSeconds / r.durationSeconds, 0), 1)
        : 0;
    const completed = !!r.completed;
    if (completed) watchedCount += 1;
    episodeProgress.set(r.playableId, { fraction, completed });
  }

  // Resume target: latest-updated in-progress episode, else first not-completed.
  let resumeEp: { id: number; seasonNum: number; epNum: number } | null = null;
  let latestUpdated = "";
  for (const e of eps) {
    const r = byId.get(e.id);
    if (r && !r.completed && r.positionSeconds >= CONTINUE_THRESHOLD_SECONDS) {
      const u = r.updatedAt ?? "";
      if (!resumeEp || u > latestUpdated) {
        resumeEp = e;
        latestUpdated = u;
      }
    }
  }
  if (!resumeEp) resumeEp = eps.find((e) => !byId.get(e.id)?.completed) ?? null;

  const totalEpisodes = eps.length;
  return {
    totalEpisodes,
    watchedCount,
    started: rows.some((r) => r.completed || r.positionSeconds >= CONTINUE_THRESHOLD_SECONDS),
    allWatched: totalEpisodes > 0 && watchedCount >= totalEpisodes,
    resumePlayableId: resumeEp ? toPlayableId("episode", resumeEp.id) : null,
    resumeLabel: resumeEp ? `S${resumeEp.seasonNum}:E${resumeEp.epNum}` : null,
    firstPlayableId: eps.length ? toPlayableId("episode", eps[0].id) : null,
    episodeProgress,
  };
}

/** Everything this profile has finished: completed movies + fully-watched shows. */
export function getWatchedItems(profileId: number): CardItem[] {
  const movieRows = db
    .select({ id: watchProgress.playableId, updatedAt: watchProgress.updatedAt })
    .from(watchProgress)
    .where(
      and(
        eq(watchProgress.profileId, profileId),
        eq(watchProgress.playableKind, "movie"),
        eq(watchProgress.completed, 1),
      ),
    )
    .all();

  const totals = db
    .select({ showId: seasons.showId, total: sql<number>`count(*)` })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .groupBy(seasons.showId)
    .all();
  const totalByShow = new Map(totals.map((t) => [t.showId, t.total]));

  const completedByShow = db
    .select({
      showId: seasons.showId,
      done: sql<number>`count(*)`,
      lastUpdated: sql<string>`max(${watchProgress.updatedAt})`,
    })
    .from(watchProgress)
    .innerJoin(episodes, eq(watchProgress.playableId, episodes.id))
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(
      and(
        eq(watchProgress.profileId, profileId),
        eq(watchProgress.playableKind, "episode"),
        eq(watchProgress.completed, 1),
      ),
    )
    .groupBy(seasons.showId)
    .all();

  const merged: { mediaType: "movie" | "show"; mediaId: number; updatedAt: string }[] = [
    ...movieRows.map((m) => ({ mediaType: "movie" as const, mediaId: m.id, updatedAt: m.updatedAt ?? "" })),
    ...completedByShow
      .filter((c) => {
        const total = totalByShow.get(c.showId) ?? 0;
        return total > 0 && c.done >= total;
      })
      .map((c) => ({ mediaType: "show" as const, mediaId: c.showId, updatedAt: c.lastUpdated ?? "" })),
  ];
  merged.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return cardsForItems(merged.map(({ mediaType, mediaId }) => ({ mediaType, mediaId })));
}

// ---------------------------------------------------------------------------
// Up Next: next unwatched episode in a series + next unwatched sequel
// ---------------------------------------------------------------------------

/** Shows that currently have an in-progress episode (i.e. in Continue Watching). */
function showsInProgress(profileId: number): Set<number> {
  return new Set(
    db
      .select({ showId: seasons.showId })
      .from(watchProgress)
      .innerJoin(episodes, eq(watchProgress.playableId, episodes.id))
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .where(
        and(
          eq(watchProgress.profileId, profileId),
          eq(watchProgress.playableKind, "episode"),
          eq(watchProgress.completed, 0),
          gte(watchProgress.positionSeconds, CONTINUE_THRESHOLD_SECONDS),
        ),
      )
      .all()
      .map((r) => r.showId),
  );
}

function nextEpisodeUpNext(profileId: number): { item: ResumeCardItem; sortKey: string }[] {
  const completedEps = db
    .select({
      showId: seasons.showId,
      seasonNum: seasons.tmdbSeasonNumber,
      epNum: episodes.tmdbEpisodeNumber,
      updatedAt: watchProgress.updatedAt,
    })
    .from(watchProgress)
    .innerJoin(episodes, eq(watchProgress.playableId, episodes.id))
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(
      and(
        eq(watchProgress.profileId, profileId),
        eq(watchProgress.playableKind, "episode"),
        eq(watchProgress.completed, 1),
      ),
    )
    .all();

  // Per show, the latest completed (season, episode) is the cursor.
  const cursors = new Map<number, { season: number; ep: number; updatedAt: string }>();
  for (const c of completedEps) {
    const cur = cursors.get(c.showId);
    const isLater =
      !cur || c.seasonNum > cur.season || (c.seasonNum === cur.season && c.epNum > cur.ep);
    if (isLater) {
      cursors.set(c.showId, { season: c.seasonNum, ep: c.epNum, updatedAt: c.updatedAt ?? "" });
    }
  }

  const inProgress = showsInProgress(profileId);
  const out: { item: ResumeCardItem; sortKey: string }[] = [];

  for (const [showId, cur] of cursors) {
    if (inProgress.has(showId)) continue;
    const eps = db
      .select({
        id: episodes.id,
        seasonNum: seasons.tmdbSeasonNumber,
        epNum: episodes.tmdbEpisodeNumber,
        stillPath: episodes.stillPath,
      })
      .from(episodes)
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .where(eq(seasons.showId, showId))
      .orderBy(asc(seasons.tmdbSeasonNumber), asc(episodes.tmdbEpisodeNumber))
      .all();
    const next = eps.find(
      (e) => e.seasonNum > cur.season || (e.seasonNum === cur.season && e.epNum > cur.ep),
    );
    if (!next) continue;
    const show = db
      .select({ name: shows.name, posterPath: shows.posterPath })
      .from(shows)
      .where(eq(shows.id, showId))
      .get();
    if (!show) continue;
    out.push({
      sortKey: cur.updatedAt,
      item: {
        playableId: toPlayableId("episode", next.id),
        title: show.name,
        imagePath: next.stillPath ?? show.posterPath,
        progressFraction: 0,
        label: `S${next.seasonNum}:E${next.epNum}`,
        mediaType: "show",
        detailId: showId,
      },
    });
  }
  return out;
}

function sequelUpNext(profileId: number): { item: ResumeCardItem; sortKey: string }[] {
  const completedMovies = db
    .select({
      movieId: movies.id,
      collectionId: movies.tmdbCollectionId,
      releaseDate: movies.releaseDate,
      updatedAt: watchProgress.updatedAt,
    })
    .from(watchProgress)
    .innerJoin(movies, eq(watchProgress.playableId, movies.id))
    .where(
      and(
        eq(watchProgress.profileId, profileId),
        eq(watchProgress.playableKind, "movie"),
        eq(watchProgress.completed, 1),
      ),
    )
    .all();

  const completedIds = new Set(completedMovies.map((m) => m.movieId));
  const inProgressIds = new Set(
    db
      .select({ id: watchProgress.playableId })
      .from(watchProgress)
      .where(
        and(
          eq(watchProgress.profileId, profileId),
          eq(watchProgress.playableKind, "movie"),
          eq(watchProgress.completed, 0),
          gte(watchProgress.positionSeconds, CONTINUE_THRESHOLD_SECONDS),
        ),
      )
      .all()
      .map((r) => r.id),
  );

  // Per franchise, the furthest-released completed movie is the cursor.
  const cursors = new Map<number, { releaseDate: string; updatedAt: string }>();
  for (const m of completedMovies) {
    if (m.collectionId == null) continue;
    const rd = m.releaseDate ?? "";
    const cur = cursors.get(m.collectionId);
    if (!cur || rd > cur.releaseDate) {
      cursors.set(m.collectionId, { releaseDate: rd, updatedAt: m.updatedAt ?? "" });
    }
  }

  const out: { item: ResumeCardItem; sortKey: string }[] = [];
  for (const [collectionId, cur] of cursors) {
    const candidates = db
      .select({
        id: movies.id,
        title: movies.title,
        posterPath: movies.posterPath,
      })
      .from(movies)
      .where(and(eq(movies.tmdbCollectionId, collectionId), gt(movies.releaseDate, cur.releaseDate)))
      .orderBy(asc(movies.releaseDate))
      .all();
    const sequel = candidates.find((s) => !completedIds.has(s.id) && !inProgressIds.has(s.id));
    if (!sequel) continue;
    out.push({
      sortKey: cur.updatedAt,
      item: {
        playableId: toPlayableId("movie", sequel.id),
        title: sequel.title,
        imagePath: sequel.posterPath,
        progressFraction: 0,
        label: null,
        mediaType: "movie",
        detailId: sequel.id,
      },
    });
  }
  return out;
}

export function getUpNext(profileId: number): ResumeCardItem[] {
  return [...nextEpisodeUpNext(profileId), ...sequelUpNext(profileId)]
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey))
    .map((e) => e.item);
}

// ── Admin: settings, job history, library health ─────────────────────────────

/** Read a string setting, or `fallback` if unset. */
export function getSetting(key: string, fallback: string): string {
  const row = db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .get();
  return row?.value ?? fallback;
}

/** Upsert a string setting. */
export function setSetting(key: string, value: string): void {
  db.insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } })
    .run();
}

export const INCLUDE_NON_PLAYABLE_KEY = "include_non_playable";

/** Whether scans should ingest files browsers can't play natively (default true). */
export function getIncludeNonPlayable(): boolean {
  return getSetting(INCLUDE_NON_PLAYABLE_KEY, "true") !== "false";
}

export const CACHE_ARTWORK_ON_SCAN_KEY = "cache_artwork_on_scan";

/** Whether scans should pre-download artwork to local disk (default true). */
export function getCacheArtworkOnScan(): boolean {
  return getSetting(CACHE_ARTWORK_ON_SCAN_KEY, "true") !== "false";
}

export const AUTO_SCAN_ENABLED_KEY = "auto_scan_enabled";

/** Whether the scheduler runs automatic (daily / on-startup) scans (default true). */
export function getAutoScanEnabled(): boolean {
  return getSetting(AUTO_SCAN_ENABLED_KEY, "true") !== "false";
}

/** Count library files (movies + episodes) that aren't browser-playable. */
export function getNonPlayableCount(): number {
  const movieFiles = db.select({ filePath: movies.filePath }).from(movies).all();
  const episodeFiles = db.select({ filePath: episodes.filePath }).from(episodes).all();
  return [...movieFiles, ...episodeFiles].filter((r) => !isBrowserPlayable(r.filePath)).length;
}

// ── Admin: broken media links ────────────────────────────────────────────────

/** Total playable files in the library (movies + episodes). */
export function getLibraryFileCount(): number {
  const m = db.select({ n: sql<number>`count(*)` }).from(movies).get()?.n ?? 0;
  const e = db.select({ n: sql<number>`count(*)` }).from(episodes).get()?.n ?? 0;
  return m + e;
}

export interface BrokenLink {
  kind: "movie" | "episode";
  id: number;
  /** Movie title, or the show name for an episode. */
  title: string;
  /** For episodes, e.g. "S01E04 — Safe"; null for movies. */
  subtitle: string | null;
  filePath: string;
}

/**
 * Library rows whose file is gone from disk. Scans keep such rows on purpose (a
 * NAS may be briefly unmounted), so they accumulate; this surfaces them for the
 * operator to review before deleting. Runs a `statSync` per file, so it is
 * on-demand only — never on the status poll.
 */
export function findBrokenLinks(): BrokenLink[] {
  const broken: BrokenLink[] = [];

  const movieRows = db
    .select({ id: movies.id, title: movies.title, filePath: movies.filePath })
    .from(movies)
    .all();
  for (const m of movieRows) {
    if (!existsSync(m.filePath)) {
      broken.push({ kind: "movie", id: m.id, title: m.title, subtitle: null, filePath: m.filePath });
    }
  }

  const episodeRows = db
    .select({
      id: episodes.id,
      filePath: episodes.filePath,
      episodeNumber: episodes.tmdbEpisodeNumber,
      episodeName: episodes.name,
      seasonNumber: seasons.tmdbSeasonNumber,
      showName: shows.name,
    })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(shows, eq(seasons.showId, shows.id))
    .all();
  for (const e of episodeRows) {
    if (!existsSync(e.filePath)) {
      const code = `S${String(e.seasonNumber).padStart(2, "0")}E${String(e.episodeNumber).padStart(2, "0")}`;
      broken.push({
        kind: "episode",
        id: e.id,
        title: e.showName,
        subtitle: e.episodeName ? `${code} — ${e.episodeName}` : code,
        filePath: e.filePath,
      });
    }
  }

  return broken;
}

export interface LibraryMatch {
  kind: "movie" | "show";
  id: number;
  title: string;
  year: string | null;
  posterPath: string | null;
  /** The movie's file (shows span many files, so null). */
  filePath: string | null;
}

/**
 * Tracked movies/shows whose title matches `q` — lets the operator locate a
 * mis-matched record to re-tag. Case-insensitive substring, capped for the panel.
 */
export function searchLibraryTitles(q: string): LibraryMatch[] {
  const term = q.trim();
  if (!term) return [];
  const pattern = `%${term}%`;

  const movieRows = db
    .select({
      id: movies.id,
      title: movies.title,
      releaseDate: movies.releaseDate,
      posterPath: movies.posterPath,
      filePath: movies.filePath,
    })
    .from(movies)
    .where(like(movies.title, pattern))
    .orderBy(asc(movies.title))
    .limit(20)
    .all();

  const showRows = db
    .select({
      id: shows.id,
      name: shows.name,
      firstAirDate: shows.firstAirDate,
      posterPath: shows.posterPath,
    })
    .from(shows)
    .where(like(shows.name, pattern))
    .orderBy(asc(shows.name))
    .limit(20)
    .all();

  const results: LibraryMatch[] = [];
  for (const m of movieRows) {
    results.push({
      kind: "movie",
      id: m.id,
      title: m.title,
      year: m.releaseDate ? m.releaseDate.slice(0, 4) : null,
      posterPath: m.posterPath,
      filePath: m.filePath,
    });
  }
  for (const s of showRows) {
    results.push({
      kind: "show",
      id: s.id,
      title: s.name,
      year: s.firstAirDate ? s.firstAirDate.slice(0, 4) : null,
      posterPath: s.posterPath,
      filePath: null,
    });
  }
  return results.slice(0, 20);
}

export interface RemovalSummary {
  removedMovies: number;
  removedEpisodes: number;
  prunedSeasons: number;
  prunedShows: number;
  /** Selected items whose file reappeared before delete — skipped, not removed. */
  skippedReappeared: number;
}

/**
 * Delete the selected broken rows and everything orphaned by them. Re-verifies
 * each file is still missing first, so a share that comes back between "find"
 * and "remove" cancels the delete for those items.
 *
 * The polymorphic tables (`videos`, `watchlist`, `watchProgress`,
 * `collectionItems`) have no FK to media rows, so they're cleaned by hand; the
 * `*Genres`/`*Keywords`/`*Cast` join tables cascade via `foreign_keys = ON`.
 */
export function removeBrokenLinks(
  items: { kind: "movie" | "episode"; id: number }[],
): RemovalSummary {
  const summary: RemovalSummary = {
    removedMovies: 0,
    removedEpisodes: 0,
    prunedSeasons: 0,
    prunedShows: 0,
    skippedReappeared: 0,
  };
  if (items.length === 0) return summary;

  db.transaction((tx) => {
    const showsToCheck = new Set<number>();

    for (const item of items) {
      if (item.kind === "movie") {
        const m = tx
          .select({ filePath: movies.filePath })
          .from(movies)
          .where(eq(movies.id, item.id))
          .get();
        if (!m) continue;
        if (existsSync(m.filePath)) {
          summary.skippedReappeared++;
          continue;
        }
        tx.delete(videos)
          .where(and(eq(videos.mediaType, "movie"), eq(videos.mediaId, item.id)))
          .run();
        tx.delete(watchlist)
          .where(and(eq(watchlist.mediaType, "movie"), eq(watchlist.mediaId, item.id)))
          .run();
        tx.delete(watchProgress)
          .where(and(eq(watchProgress.playableKind, "movie"), eq(watchProgress.playableId, item.id)))
          .run();
        tx.delete(collectionItems)
          .where(and(eq(collectionItems.mediaType, "movie"), eq(collectionItems.mediaId, item.id)))
          .run();
        tx.delete(movies).where(eq(movies.id, item.id)).run();
        tx.run(sql`DELETE FROM search_index WHERE kind = ${"movie"} AND media_id = ${item.id}`);
        summary.removedMovies++;
      } else {
        const e = tx
          .select({ filePath: episodes.filePath, seasonId: episodes.seasonId })
          .from(episodes)
          .where(eq(episodes.id, item.id))
          .get();
        if (!e) continue;
        if (existsSync(e.filePath)) {
          summary.skippedReappeared++;
          continue;
        }
        tx.delete(watchProgress)
          .where(and(eq(watchProgress.playableKind, "episode"), eq(watchProgress.playableId, item.id)))
          .run();
        tx.delete(episodes).where(eq(episodes.id, item.id)).run();
        summary.removedEpisodes++;
        const season = tx
          .select({ showId: seasons.showId })
          .from(seasons)
          .where(eq(seasons.id, e.seasonId))
          .get();
        if (season) showsToCheck.add(season.showId);
      }
    }

    // Prune seasons left with no episodes, then shows left with no seasons.
    for (const showId of showsToCheck) {
      const seasonRows = tx
        .select({ id: seasons.id })
        .from(seasons)
        .where(eq(seasons.showId, showId))
        .all();
      for (const season of seasonRows) {
        const remaining = tx
          .select({ id: episodes.id })
          .from(episodes)
          .where(eq(episodes.seasonId, season.id))
          .all();
        if (remaining.length === 0) {
          tx.delete(seasons).where(eq(seasons.id, season.id)).run();
          summary.prunedSeasons++;
        }
      }

      const remainingSeasons = tx
        .select({ id: seasons.id })
        .from(seasons)
        .where(eq(seasons.showId, showId))
        .all();
      if (remainingSeasons.length === 0) {
        tx.delete(videos)
          .where(and(eq(videos.mediaType, "show"), eq(videos.mediaId, showId)))
          .run();
        tx.delete(watchlist)
          .where(and(eq(watchlist.mediaType, "show"), eq(watchlist.mediaId, showId)))
          .run();
        tx.delete(collectionItems)
          .where(and(eq(collectionItems.mediaType, "show"), eq(collectionItems.mediaId, showId)))
          .run();
        tx.delete(shows).where(eq(shows.id, showId)).run();
        tx.run(sql`DELETE FROM search_index WHERE kind = ${"show"} AND media_id = ${showId}`);
        summary.prunedShows++;
      }
    }
  });

  return summary;
}

/** Most recent run record for a job kind, or null. */
export function getLastRun(kind: "scan" | "transcode" | "artwork") {
  return (
    db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.kind, kind))
      .orderBy(desc(jobRuns.id))
      .limit(1)
      .get() ?? null
  );
}
