import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type Database from "better-sqlite3";

import * as schema from "../db/schema";
import type { Logger } from "./scan";

type DB = BetterSQLite3Database<typeof schema>;

/** The underlying better-sqlite3 connection (for raw SQL / FTS5). */
function raw(db: DB): Database.Database {
  return (db as unknown as { $client: Database.Database }).$client;
}

/**
 * Full-text search index over the library. drizzle can't model a virtual table,
 * so it's created/queried with raw SQL via the underlying connection. Columns:
 * indexed text first (so bm25 weights line up), then UNINDEXED keys we read back.
 */
export function ensureSearchIndex(db: DB): void {
  raw(db).exec(`CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
    title,
    cast_names,
    genres,
    kind UNINDEXED,
    media_id UNINDEXED,
    tokenize = 'unicode61'
  )`);
}

/** Number of rows currently in the search index. */
export function searchIndexCount(db: DB): number {
  ensureSearchIndex(db);
  const row = raw(db).prepare("SELECT count(*) AS n FROM search_index").get() as
    | { n: number }
    | undefined;
  return row?.n ?? 0;
}

/**
 * Rebuild the entire search index from the library. One document per movie/show;
 * a show's episode names are folded into its title text so episode-name searches
 * still surface the show (matching the previous LIKE behavior).
 */
export function reindexSearch(db: DB, log: Logger): void {
  ensureSearchIndex(db);

  const movieRows = db
    .select({ id: schema.movies.id, title: schema.movies.title })
    .from(schema.movies)
    .all();
  const showRows = db
    .select({ id: schema.shows.id, name: schema.shows.name })
    .from(schema.shows)
    .all();

  const insert = raw(db).prepare(
    "INSERT INTO search_index (title, cast_names, genres, kind, media_id) VALUES (?, ?, ?, ?, ?)",
  );
  const clear = raw(db).prepare("DELETE FROM search_index");

  const rebuild = raw(db).transaction(() => {
    clear.run();

    for (const m of movieRows) {
      const cast = db
        .select({ name: schema.people.name })
        .from(schema.movieCast)
        .innerJoin(schema.people, eq(schema.movieCast.personId, schema.people.id))
        .where(eq(schema.movieCast.movieId, m.id))
        .all()
        .map((r) => r.name)
        .join(" ");
      const genres = db
        .select({ name: schema.genres.name })
        .from(schema.movieGenres)
        .innerJoin(schema.genres, eq(schema.movieGenres.genreId, schema.genres.id))
        .where(eq(schema.movieGenres.movieId, m.id))
        .all()
        .map((r) => r.name)
        .join(" ");
      insert.run(m.title, cast, genres, "movie", m.id);
    }

    for (const s of showRows) {
      const episodeNames = db
        .select({ name: schema.episodes.name })
        .from(schema.episodes)
        .innerJoin(schema.seasons, eq(schema.episodes.seasonId, schema.seasons.id))
        .where(eq(schema.seasons.showId, s.id))
        .orderBy(asc(schema.episodes.id))
        .all()
        .map((r) => r.name)
        .filter((n): n is string => !!n)
        .join(" ");
      const cast = db
        .select({ name: schema.people.name })
        .from(schema.showCast)
        .innerJoin(schema.people, eq(schema.showCast.personId, schema.people.id))
        .where(eq(schema.showCast.showId, s.id))
        .all()
        .map((r) => r.name)
        .join(" ");
      const genres = db
        .select({ name: schema.genres.name })
        .from(schema.showGenres)
        .innerJoin(schema.genres, eq(schema.showGenres.genreId, schema.genres.id))
        .where(eq(schema.showGenres.showId, s.id))
        .all()
        .map((r) => r.name)
        .join(" ");
      insert.run(`${s.name} ${episodeNames}`.trim(), cast, genres, "show", s.id);
    }
  });

  rebuild();
  log(`  ✓ search index: ${movieRows.length + showRows.length} document(s)`);
}

/**
 * Turn a raw user query into a safe FTS5 MATCH expression: keep only letter/digit
 * runs (so quotes/operators can't break the query), prefix-match each token, AND
 * them together. Returns null when there's nothing to search.
 */
export function toMatchQuery(query: string): string | null {
  const tokens = query.toLowerCase().match(/[\p{L}\p{N}]+/gu);
  if (!tokens || tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(" ");
}
