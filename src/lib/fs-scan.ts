import { stat } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { isBrowserPlayable } from "./media";

/** Video container extensions we recognize during a scan (playable or not). */
export const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
  ".ogv",
  ".avi",
]);

/** Top-level folders treated as TV libraries (everything else is movies). */
export const SHOW_ROOT_NAMES = new Set(["shows", "tv"]);

/**
 * Resolve whether a directory entry is a directory, following symlinks. NAS
 * libraries are commonly built from symlinked folders/files; `Dirent.isDirectory()`
 * is `false` for a symlink, so we must `stat()` the target to classify it.
 */
async function entryIsDirectory(entry: { isSymbolicLink(): boolean; isDirectory(): boolean }, full: string): Promise<boolean> {
  if (entry.isSymbolicLink()) {
    try {
      return (await stat(full)).isDirectory();
    } catch {
      return false; // broken symlink
    }
  }
  return entry.isDirectory();
}

/** Recursively collect video files under a directory (symlink-aware). */
export async function walkVideos(
  dir: string,
  options: { skipShowDirs?: boolean } = {},
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const out: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue; // skip hidden files (.DS_Store, etc.)
    const full = join(dir, entry.name);
    if (await entryIsDirectory(entry, full)) {
      if (options.skipShowDirs && SHOW_ROOT_NAMES.has(entry.name.toLowerCase())) {
        continue; // movies scan must not descend into the TV library
      }
      out.push(...(await walkVideos(full, options)));
    } else if (VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Drop a non-playable file when a transcoded `.mp4` sibling (same basename) is
 * present, so re-scanning stays consistent with `npm run transcode`.
 */
export function preferPlayable(files: string[]): string[] {
  const present = new Set(files);
  return files.filter((file) => {
    if (isBrowserPlayable(file)) return true;
    const mp4 = `${file.slice(0, file.length - extname(file).length)}.mp4`;
    return !present.has(mp4);
  });
}

/** Parse season/episode numbers from a filename (e.g. "S01E02", "1x02"). */
export function parseEpisodeNumbers(
  filePath: string,
): { season: number; episode: number } | null {
  const name = basename(filePath);
  const sxxexx = /[Ss](\d{1,2})[\s._-]*[Ee](\d{1,2})/.exec(name);
  if (sxxexx) return { season: Number(sxxexx[1]), episode: Number(sxxexx[2]) };
  const nxn = /\b(\d{1,2})[xX](\d{1,2})\b/.exec(name);
  if (nxn) return { season: Number(nxn[1]), episode: Number(nxn[2]) };
  return null;
}

/** Derive a search title (and year, if present) from a movie filename. */
export function parseMovieFilename(filePath: string): {
  title: string;
  year?: number;
} {
  const normalized = basename(filePath, extname(filePath))
    .replace(/[._]+/g, " ")
    .trim();

  // Use the last 4-digit year that isn't at the very start (e.g. keep
  // "2001 A Space Odyssey" intact, but cut "Some Movie 2014 1080p").
  let year: number | undefined;
  let cutIndex = -1;
  for (const m of normalized.matchAll(/\b(?:19|20)\d{2}\b/g)) {
    if (m.index !== undefined && m.index > 0) {
      year = Number(m[0]);
      cutIndex = m.index;
    }
  }

  let title = cutIndex >= 0 ? normalized.slice(0, cutIndex) : normalized;
  title = title.replace(/[([{\-\s]+$/g, "").trim();
  return { title: title || normalized, year };
}
