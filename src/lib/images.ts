import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "../db/schema";
import type { Logger } from "./scan";

/** Where downloaded artwork lives. In Docker this is a mounted volume. */
export const IMAGE_DIR = process.env.IMAGE_DIR ?? "./data/images";

const TMDB_IMG_BASE = "https://image.tmdb.org/t/p";

export type ImageKind = "poster" | "backdrop" | "profile" | "still";

/** Stored size per kind — the largest actually displayed, with some headroom. */
const SIZE_BY_KIND: Record<ImageKind, string> = {
  poster: "w500",
  backdrop: "w1280",
  profile: "w185",
  still: "w300",
};

/** Default fetch size for the lazy route (kind unknown from the path alone). */
export const DEFAULT_LAZY_SIZE = "w780";

/**
 * Resolve a TMDB relative path to an on-disk file inside IMAGE_DIR, rejecting any
 * path that would escape the directory (traversal guard). Returns null if unsafe.
 */
export function localFileFor(tmdbPath: string): string | null {
  const rel = normalize(tmdbPath.replace(/^\/+/, ""));
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || rel.includes("\0")) {
    return null;
  }
  const full = join(IMAGE_DIR, rel);
  // Defense in depth: ensure the resolved path is still under IMAGE_DIR.
  const root = normalize(IMAGE_DIR.endsWith("/") ? IMAGE_DIR : `${IMAGE_DIR}/`);
  if (!normalize(full).startsWith(normalize(root))) return null;
  return full;
}

export function tmdbCdnUrl(tmdbPath: string, size: string): string {
  return `${TMDB_IMG_BASE}/${size}/${tmdbPath.replace(/^\/+/, "")}`;
}

/**
 * Ensure a TMDB image is cached locally; returns the local file path (or null on
 * failure). Idempotent — an existing file is reused. Writes atomically.
 */
export async function ensureImage(
  tmdbPath: string,
  size: string,
): Promise<string | null> {
  const file = localFileFor(tmdbPath);
  if (!file) return null;
  if (existsSync(file)) return file;

  const res = await fetch(tmdbCdnUrl(tmdbPath, size));
  if (!res.ok || !res.body) {
    throw new Error(`TMDB image ${tmdbPath} → ${res.status}`);
  }

  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(tmp));
  await rename(tmp, file);
  return file;
}

type DB = BetterSQLite3Database<typeof schema>;

/** All distinct (path, kind) artwork references actually displayed in the app. */
function referencedArtwork(db: DB): { path: string; kind: ImageKind }[] {
  const out = new Map<string, ImageKind>();
  const add = (path: string | null, kind: ImageKind) => {
    if (path) out.set(path, kind);
  };

  for (const m of db
    .select({ poster: schema.movies.posterPath, backdrop: schema.movies.backdropPath })
    .from(schema.movies)
    .all()) {
    add(m.poster, "poster");
    add(m.backdrop, "backdrop");
  }
  for (const s of db
    .select({ poster: schema.shows.posterPath, backdrop: schema.shows.backdropPath })
    .from(schema.shows)
    .all()) {
    add(s.poster, "poster");
    add(s.backdrop, "backdrop");
  }
  for (const e of db.select({ still: schema.episodes.stillPath }).from(schema.episodes).all()) {
    add(e.still, "still");
  }
  for (const p of db.select({ profile: schema.people.profilePath }).from(schema.people).all()) {
    add(p.profile, "profile");
  }

  return [...out.entries()].map(([path, kind]) => ({ path, kind }));
}

export interface ArtworkSummary {
  downloaded: number;
  skipped: number;
  failed: number;
}

/** Pre-download every referenced image into IMAGE_DIR (idempotent). */
export async function cacheArtwork(db: DB, log: Logger): Promise<ArtworkSummary> {
  const refs = referencedArtwork(db);
  const summary: ArtworkSummary = { downloaded: 0, skipped: 0, failed: 0 };
  if (refs.length === 0) {
    log("No artwork to cache.");
    return summary;
  }

  log(`Caching ${refs.length} artwork file(s) to ${IMAGE_DIR}…`);
  for (const { path, kind } of refs) {
    const file = localFileFor(path);
    if (file && existsSync(file)) {
      summary.skipped += 1;
      continue;
    }
    try {
      await ensureImage(path, SIZE_BY_KIND[kind]);
      summary.downloaded += 1;
    } catch (err) {
      log(`  ⚠ failed: ${path} — ${err instanceof Error ? err.message : err}`);
      summary.failed += 1;
    }
  }

  log(`Done. downloaded=${summary.downloaded} skipped=${summary.skipped} failed=${summary.failed}`);
  return summary;
}

/** Count referenced images vs. how many are cached on disk (for the admin page). */
export function countArtwork(db: DB): { referenced: number; cached: number } {
  const refs = referencedArtwork(db);
  let cached = 0;
  for (const { path } of refs) {
    const file = localFileFor(path);
    if (file && existsSync(file)) cached += 1;
  }
  return { referenced: refs.length, cached };
}
