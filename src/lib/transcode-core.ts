import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { dirname, extname, join } from "node:path";

import { eq } from "drizzle-orm";
import ffmpegStatic from "ffmpeg-static";

import * as schema from "../db/schema";
import { isBrowserPlayable } from "./media";
import { walkVideos } from "./fs-scan";
import type { DB, Logger } from "./scan";

/**
 * Resolve the ffmpeg binary. In Docker we install the system package (apt) and
 * point `FFMPEG_PATH` at it; locally `ffmpeg-static` ships a bundled binary;
 * otherwise fall back to whatever `ffmpeg` is on PATH.
 */
export function resolveFfmpeg(): string {
  return process.env.FFMPEG_PATH ?? ffmpegStatic ?? "ffmpeg";
}

/** The transcoded output path for a source file: same dir + basename, .mp4. */
export function outputFor(filePath: string): string {
  const dir = dirname(filePath);
  const base = filePath.slice(0, filePath.length - extname(filePath).length);
  return join(dir, `${base.slice(dir.length + 1)}.mp4`);
}

/** Transcode one file to MP4 (H.264/AAC, faststart) via ffmpeg. */
export function transcodeFile(input: string, output: string): Promise<void> {
  const bin = resolveFfmpeg();
  const args = [
    "-y",
    "-i", input,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    output,
  ];
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "inherit"] });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

export interface TranscodeSummary {
  transcoded: number;
  alreadyDone: number;
  failed: number;
}

interface DbJob {
  kind: "movie" | "episode" | "version";
  id: number;
  filePath: string;
}

export interface DbTranscodeOptions {
  /** Delete the original (e.g. `.avi`) after a successful convert + repoint. */
  deleteOriginals?: boolean;
}

/**
 * DB mode: transcode every library row whose `filePath` isn't browser-playable
 * and repoint the row at the `.mp4`. Idempotent — an existing `.mp4` is reused.
 */
export async function runDbTranscode(
  db: DB,
  opts: DbTranscodeOptions,
  log: Logger,
): Promise<TranscodeSummary> {
  const movies = db
    .select({ id: schema.movies.id, filePath: schema.movies.filePath })
    .from(schema.movies)
    .all()
    .filter((r) => !isBrowserPlayable(r.filePath))
    .map((r): DbJob => ({ kind: "movie", id: r.id, filePath: r.filePath }));
  const episodes = db
    .select({ id: schema.episodes.id, filePath: schema.episodes.filePath })
    .from(schema.episodes)
    .all()
    .filter((r) => !isBrowserPlayable(r.filePath))
    .map((r): DbJob => ({ kind: "episode", id: r.id, filePath: r.filePath }));
  const versions = db
    .select({ id: schema.mediaFiles.id, filePath: schema.mediaFiles.filePath })
    .from(schema.mediaFiles)
    .all()
    .filter((r) => !isBrowserPlayable(r.filePath))
    .map((r): DbJob => ({ kind: "version", id: r.id, filePath: r.filePath }));
  const jobs = [...movies, ...episodes, ...versions];

  const summary: TranscodeSummary = { transcoded: 0, alreadyDone: 0, failed: 0 };
  if (jobs.length === 0) {
    log("Nothing to transcode — all library files are already browser-playable.");
    return summary;
  }

  log(`Transcoding ${jobs.length} file(s) to MP4 (H.264/AAC)…`);
  for (const job of jobs) {
    const output = outputFor(job.filePath);
    const original = job.filePath;

    if (existsSync(output)) {
      repoint(db, job, output);
      if (opts.deleteOriginals) await safeDelete(original, output, log);
      log(`  ↺ already transcoded: ${output}`);
      summary.alreadyDone += 1;
      continue;
    }
    if (!existsSync(original)) {
      log(`  ⚠ source missing, skipping: ${original}`);
      summary.failed += 1;
      continue;
    }

    log(`  → ${original}`);
    try {
      await transcodeFile(original, output);
      repoint(db, job, output);
      if (opts.deleteOriginals) await safeDelete(original, output, log);
      log(`  ✓ ${output}`);
      summary.transcoded += 1;
    } catch (err) {
      log(`  ✗ failed: ${original} — ${err instanceof Error ? err.message : err}`);
      summary.failed += 1;
    }
  }

  log(`Done. transcoded=${summary.transcoded} alreadyDone=${summary.alreadyDone} failed=${summary.failed}`);
  return summary;
}

function repoint(db: DB, job: DbJob, output: string) {
  const fileSize = statSync(output).size;
  const set = { filePath: output, mimeType: "video/mp4", fileSize };
  if (job.kind === "movie") {
    db.update(schema.movies).set(set).where(eq(schema.movies.id, job.id)).run();
  } else if (job.kind === "version") {
    db.update(schema.mediaFiles).set(set).where(eq(schema.mediaFiles.id, job.id)).run();
  } else {
    db.update(schema.episodes).set(set).where(eq(schema.episodes.id, job.id)).run();
  }
}

export interface FolderTranscodeOptions {
  deleteOriginals?: boolean;
  dryRun?: boolean;
}

/**
 * Folder/prep mode: walk a directory (symlink-aware), transcode every
 * non-playable file to a sibling `.mp4`, and optionally delete the original.
 * Purely filesystem — touches no database. Useful before a scan.
 */
export async function transcodeFolder(
  dir: string,
  opts: FolderTranscodeOptions,
  log: Logger,
): Promise<TranscodeSummary> {
  const files = (await walkVideos(dir)).filter((f) => !isBrowserPlayable(f));
  const summary: TranscodeSummary = { transcoded: 0, alreadyDone: 0, failed: 0 };

  if (files.length === 0) {
    log(`No non-playable files found under ${dir}.`);
    return summary;
  }

  log(`Found ${files.length} non-playable file(s) under ${dir}.`);
  for (const input of files) {
    const output = outputFor(input);

    if (existsSync(output)) {
      log(`  ↺ already has MP4: ${output}`);
      if (opts.deleteOriginals && !opts.dryRun) await safeDelete(input, output, log);
      summary.alreadyDone += 1;
      continue;
    }

    if (opts.dryRun) {
      log(`  • would transcode: ${input} -> ${output}${opts.deleteOriginals ? " (then delete original)" : ""}`);
      summary.transcoded += 1;
      continue;
    }

    log(`  → ${input}`);
    try {
      await transcodeFile(input, output);
      log(`  ✓ ${output}`);
      if (opts.deleteOriginals) await safeDelete(input, output, log);
      summary.transcoded += 1;
    } catch (err) {
      log(`  ✗ failed: ${input} — ${err instanceof Error ? err.message : err}`);
      summary.failed += 1;
    }
  }

  log(`Done. transcoded=${summary.transcoded} alreadyDone=${summary.alreadyDone} failed=${summary.failed}`);
  return summary;
}

/** Delete `original` only if the `.mp4` output exists and is non-empty. */
async function safeDelete(original: string, output: string, log: Logger) {
  if (original === output) return;
  try {
    if (!existsSync(output) || statSync(output).size === 0) return;
    await unlink(original);
    log(`  🗑 deleted original: ${original}`);
  } catch (err) {
    log(`  ⚠ could not delete original ${original} — ${err instanceof Error ? err.message : err}`);
  }
}
