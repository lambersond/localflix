import { resolve } from "node:path";

import Database from "better-sqlite3";
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { createScanner, type MovieData } from "../lib/scan";
import {
  getMovieCertification,
  getMovieDetails,
  keywordsOf,
  searchMovie,
  videosOf,
} from "../lib/tmdb";
import { filterAvailableVideos } from "../lib/youtube";
import * as schema from "../db/schema";
import {
  collections as collectionsConfig,
  library,
  type MovieEntry,
} from "./library.config";

// Standalone scripts must load env explicitly. Mirror Next's precedence:
// .env.local overrides .env (dotenv keeps the first value it sees per key).
config({ path: [".env.local", ".env"] });

const DATABASE_PATH = process.env.DATABASE_PATH ?? "./media.sqlite";

const sqlite = new Database(DATABASE_PATH);
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

migrate(db, { migrationsFolder: "./drizzle" });

const scanner = createScanner(db, (line) => console.log(line));

/** Read a boolean app setting from this script's own connection (default true). */
function boolSetting(key: string): boolean {
  const row = db
    .select({ value: schema.appSettings.value })
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, key))
    .get();
  return row?.value !== "false";
}

/** Ingest a single configured movie entry (library.config). */
async function ingestMovieEntry(entry: MovieEntry) {
  const tmdbId =
    entry.tmdbId ?? (entry.searchTitle ? await searchMovie(entry.searchTitle) : null);
  if (!tmdbId) {
    console.warn(`  ⚠ could not resolve movie for ${entry.filePath}`);
    return;
  }
  const d = await getMovieDetails(tmdbId);
  const id = scanner.upsertMovie({
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
    videos: await filterAvailableVideos(videosOf(d), console.log),
    filePath: entry.filePath,
  });
  await scanner.ingestMovieCast(id, d.id);
  console.log(`  ✓ movie: ${d.title} (id ${id})`);
}

const BIG_BUCK_BUNNY_TMDB_ID = 10378;

async function seedSample() {
  const samplePath = process.env.SAMPLE_VIDEO_PATH ?? "./public/sample/big-buck-bunny.mp4";

  let data: MovieData;
  if (process.env.TMDB_API_TOKEN) {
    const d = await getMovieDetails(BIG_BUCK_BUNNY_TMDB_ID);
    data = {
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
      videos: await filterAvailableVideos(videosOf(d), console.log),
      filePath: samplePath,
    };
  } else {
    console.log("  (no TMDB token — using built-in sample metadata)");
    data = {
      tmdbId: BIG_BUCK_BUNNY_TMDB_ID,
      title: "Big Buck Bunny",
      overview:
        "A large and lovable rabbit deals with three tiny bullies, led by a flying squirrel, who are determined to squelch his happiness.",
      posterPath: null,
      backdropPath: null,
      releaseDate: "2008-05-20",
      runtimeMinutes: 10,
      certification: null,
      voteAverage: null,
      voteCount: null,
      tmdbCollectionId: null,
      genres: [
        { id: 16, name: "Animation" },
        { id: 10751, name: "Family" },
        { id: 35, name: "Comedy" },
      ],
      keywords: [],
      videos: [],
      filePath: samplePath,
    };
  }

  const movieId = scanner.upsertMovie(data);
  if (process.env.TMDB_API_TOKEN) {
    await scanner.ingestMovieCast(movieId, data.tmdbId);
  }
  console.log(`  ✓ sample movie seeded from ${resolve(samplePath)}`);

  scanner.buildCollections([
    {
      slug: "featured",
      title: "Featured",
      kind: "hero",
      items: [{ type: "movie", tmdbId: BIG_BUCK_BUNNY_TMDB_ID }],
    },
    {
      slug: "sample",
      title: "Sample Library",
      kind: "row",
      sortOrder: 0,
      items: [{ type: "movie", tmdbId: BIG_BUCK_BUNNY_TMDB_ID }],
    },
  ]);
}

async function main() {
  const sample = process.argv.includes("--sample");
  const scan = process.argv.includes("--scan");

  if (sample) {
    console.log("Seeding sample content…");
    await seedSample();
  } else if (scan) {
    const root = process.env.MEDIA_DIR ?? "./media";
    const includeNonPlayable =
      !process.argv.includes("--skip-non-playable") && boolSetting("include_non_playable");
    const cacheArtwork =
      !process.argv.includes("--no-artwork") && boolSetting("cache_artwork_on_scan");
    const onlyNew = process.argv.includes("--new");
    await scanner.runScan({ mediaDir: root, includeNonPlayable, cacheArtwork, onlyNew });
  } else {
    console.log(`Ingesting ${library.length} library entr(ies)…`);
    for (const entry of library) {
      if (entry.type === "movie") await ingestMovieEntry(entry);
      else await scanner.ingestShow(entry);
    }
    scanner.buildCollections(collectionsConfig);
  }

  console.log("Done.");
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  sqlite.close();
  process.exit(1);
});
