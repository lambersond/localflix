import { join, resolve } from "node:path";

import { db } from "@/db";
import { episodes, movies } from "@/db/schema";

import {
  parseEpisodeNumbers,
  preferPlayable,
  SHOW_ROOT_NAMES,
  walkVideos,
} from "./fs-scan";
import { isBrowserPlayable } from "./media";

export type UntrackedReason = "no-match" | "non-playable" | "no-episode-number";

export interface UntrackedFile {
  path: string;
  area: "movie" | "show";
  reason: UntrackedReason;
}

export interface UntrackedResult {
  /** Total video files seen on disk — 0 usually means the share is unmounted. */
  discovered: number;
  files: UntrackedFile[];
}

/** Absolute paths of every file already recorded in the library. */
function trackedPaths(): Set<string> {
  const set = new Set<string>();
  for (const m of db.select({ filePath: movies.filePath }).from(movies).all()) {
    set.add(m.filePath);
  }
  for (const e of db.select({ filePath: episodes.filePath }).from(episodes).all()) {
    set.add(e.filePath);
  }
  return set;
}

function classify(file: string, area: "movie" | "show"): UntrackedReason {
  if (!isBrowserPlayable(file)) return "non-playable";
  if (area === "show" && parseEpisodeNumbers(file) === null) return "no-episode-number";
  return "no-match";
}

/**
 * Video files on disk with no DB record — the inverse of `findBrokenLinks`. The
 * scan keeps rows when a file vanishes; this finds files the scan never tracked
 * (a title that didn't match TMDB, a show file missing SxxEyy, a skipped
 * non-playable file). Discovery mirrors the scan (same `walkVideos` +
 * `preferPlayable`) so the list reflects what the scan actually considers.
 * Read-only and on-demand — it walks the media dir, so never call it on a poll.
 */
export async function findUntrackedFiles(): Promise<UntrackedResult> {
  const root = resolve(process.env.MEDIA_DIR ?? "./media");
  const tracked = trackedPaths();

  // Discover files, remembering which are in the TV area (shows/ or tv/).
  const discovered: { file: string; area: "movie" | "show" }[] = [];

  for (const file of preferPlayable(await walkVideos(root, { skipShowDirs: true }))) {
    discovered.push({ file, area: "movie" });
  }
  for (const rootName of SHOW_ROOT_NAMES) {
    const showFiles = preferPlayable(await walkVideos(join(root, rootName)));
    for (const file of showFiles) {
      discovered.push({ file, area: "show" });
    }
  }

  const files: UntrackedFile[] = [];
  for (const { file, area } of discovered) {
    if (tracked.has(resolve(file))) continue;
    files.push({ path: file, area, reason: classify(file, area) });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { discovered: discovered.length, files };
}
