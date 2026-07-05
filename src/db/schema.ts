import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Movies. The playable file lives directly on the row (`filePath`).
 */
export const movies = sqliteTable("movies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tmdbId: integer("tmdb_id").notNull().unique(),
  title: text("title").notNull(),
  overview: text("overview"),
  posterPath: text("poster_path"),
  backdropPath: text("backdrop_path"),
  releaseDate: text("release_date"),
  runtimeMinutes: integer("runtime_minutes"),
  certification: text("certification"),
  tmdbCollectionId: integer("tmdb_collection_id"),
  filePath: text("file_path").notNull(),
  fileSize: integer("file_size"),
  mimeType: text("mime_type"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => [index("movies_title_idx").on(t.title, t.id)]);

/**
 * TV shows. The show itself has no playable file — episodes do.
 */
export const shows = sqliteTable("shows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tmdbId: integer("tmdb_id").notNull().unique(),
  name: text("name").notNull(),
  overview: text("overview"),
  posterPath: text("poster_path"),
  backdropPath: text("backdrop_path"),
  firstAirDate: text("first_air_date"),
  certification: text("certification"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => [index("shows_name_idx").on(t.name, t.id)]);

export const seasons = sqliteTable(
  "seasons",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    showId: integer("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    tmdbSeasonNumber: integer("tmdb_season_number").notNull(),
    name: text("name"),
    overview: text("overview"),
    posterPath: text("poster_path"),
  },
  (t) => [uniqueIndex("seasons_show_number_unq").on(t.showId, t.tmdbSeasonNumber)],
);

export const episodes = sqliteTable(
  "episodes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    tmdbEpisodeNumber: integer("tmdb_episode_number").notNull(),
    name: text("name"),
    overview: text("overview"),
    stillPath: text("still_path"),
    runtimeMinutes: integer("runtime_minutes"),
    airDate: text("air_date"),
    filePath: text("file_path").notNull(),
    fileSize: integer("file_size"),
    mimeType: text("mime_type"),
  },
  (t) => [
    uniqueIndex("episodes_season_number_unq").on(t.seasonId, t.tmdbEpisodeNumber),
  ],
);

/**
 * Genres — `id` is the TMDB genre id (stable across movie & TV lists).
 */
export const genres = sqliteTable("genres", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
});

export const movieGenres = sqliteTable(
  "movie_genres",
  {
    movieId: integer("movie_id")
      .notNull()
      .references(() => movies.id, { onDelete: "cascade" }),
    genreId: integer("genre_id")
      .notNull()
      .references(() => genres.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.movieId, t.genreId] })],
);

export const showGenres = sqliteTable(
  "show_genres",
  {
    showId: integer("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    genreId: integer("genre_id")
      .notNull()
      .references(() => genres.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.showId, t.genreId] })],
);

/**
 * People (cast members) — `id` is the TMDB person id.
 */
export const people = sqliteTable("people", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  profilePath: text("profile_path"),
});

export const movieCast = sqliteTable(
  "movie_cast",
  {
    movieId: integer("movie_id")
      .notNull()
      .references(() => movies.id, { onDelete: "cascade" }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    ord: integer("ord"),
  },
  (t) => [primaryKey({ columns: [t.movieId, t.personId] })],
);

export const showCast = sqliteTable(
  "show_cast",
  {
    showId: integer("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    personId: integer("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    ord: integer("ord"),
  },
  (t) => [primaryKey({ columns: [t.showId, t.personId] })],
);

/**
 * Collections drive the homepage: a `hero` collection feeds the banner,
 * `row` collections become the horizontally scrollable rows.
 */
export const collections = sqliteTable("collections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  kind: text("kind", { enum: ["hero", "row"] }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

/**
 * Polymorphic membership so a single row can mix movies and shows.
 * Integrity for (mediaType, mediaId) is enforced in application code.
 */
export const collectionItems = sqliteTable("collection_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  collectionId: integer("collection_id")
    .notNull()
    .references(() => collections.id, { onDelete: "cascade" }),
  mediaType: text("media_type", { enum: ["movie", "show"] }).notNull(),
  mediaId: integer("media_id").notNull(),
  position: integer("position").notNull().default(0),
});

/**
 * Viewing profiles (no auth). The active one is tracked via a cookie.
 */
export const profiles = sqliteTable("profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  avatarPath: text("avatar_path"),
  createdAt: text("created_at").default(sql`(CURRENT_TIMESTAMP)`),
});

/**
 * Per-profile watch progress for a single playable (a movie or an episode).
 * `playableId` is the numeric id keyed by `playableKind` (polymorphic).
 */
export const watchProgress = sqliteTable(
  "watch_progress",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    playableKind: text("playable_kind", { enum: ["movie", "episode"] }).notNull(),
    playableId: integer("playable_id").notNull(),
    positionSeconds: real("position_seconds").notNull().default(0),
    durationSeconds: real("duration_seconds"),
    completed: integer("completed").notNull().default(0),
    updatedAt: text("updated_at").default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [
    uniqueIndex("watch_progress_unq").on(t.profileId, t.playableKind, t.playableId),
  ],
);

/**
 * Per-profile "My List". Polymorphic membership over movies and shows.
 */
export const watchlist = sqliteTable(
  "watchlist",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    profileId: integer("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    mediaType: text("media_type", { enum: ["movie", "show"] }).notNull(),
    mediaId: integer("media_id").notNull(),
    addedAt: text("added_at").default(sql`(CURRENT_TIMESTAMP)`),
  },
  (t) => [uniqueIndex("watchlist_unq").on(t.profileId, t.mediaType, t.mediaId)],
);

/**
 * Key/value application settings (e.g. whether to include non-browser-playable
 * files when scanning). Edited from the admin page.
 */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/**
 * History of background jobs (scan / transcode), so the admin page can show the
 * last run time and outcome across restarts. The live progress of a running job
 * is held in memory by the job manager.
 */
export const jobRuns = sqliteTable("job_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["scan", "transcode", "artwork"] }).notNull(),
  status: text("status", { enum: ["running", "success", "error"] }).notNull(),
  startedAt: text("started_at").default(sql`(CURRENT_TIMESTAMP)`),
  finishedAt: text("finished_at"),
  summary: text("summary"),
});

export type Movie = typeof movies.$inferSelect;
export type Show = typeof shows.$inferSelect;
export type Season = typeof seasons.$inferSelect;
export type Episode = typeof episodes.$inferSelect;
export type Genre = typeof genres.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Collection = typeof collections.$inferSelect;
export type CollectionItem = typeof collectionItems.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type WatchProgress = typeof watchProgress.$inferSelect;
export type Watchlist = typeof watchlist.$inferSelect;
export type AppSetting = typeof appSettings.$inferSelect;
export type JobRun = typeof jobRuns.$inferSelect;
