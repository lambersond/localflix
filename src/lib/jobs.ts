import { eq } from "drizzle-orm";

import { db } from "@/db";
import { jobRuns } from "@/db/schema";
import { getCacheArtworkOnScan, getIncludeNonPlayable } from "@/db/queries";
import { cacheArtwork } from "@/lib/images";
import {
  isJobRunning,
  setCurrentJob,
  type JobKind,
  type JobState,
} from "@/lib/job-state";
import { createScanner, type Logger } from "@/lib/scan";
import { runDbTranscode } from "@/lib/transcode-core";

const MAX_LOG_LINES = 500;

export interface TriggerResult {
  started: boolean;
  message: string;
}

/**
 * Start a background job. Returns immediately; `run` executes un-awaited (valid
 * on a long-lived self-hosted server). Rejects if a job is already running.
 */
export function triggerJob(
  kind: JobKind,
  run: (log: Logger) => Promise<string>,
): TriggerResult {
  if (isJobRunning()) {
    return { started: false, message: "A job is already running." };
  }

  const startedAt = new Date().toISOString();
  const state: JobState = {
    kind,
    status: "running",
    startedAt,
    finishedAt: null,
    log: [],
    summary: null,
  };
  setCurrentJob(state);

  const runId = db
    .insert(jobRuns)
    .values({ kind, status: "running", startedAt })
    .returning({ id: jobRuns.id })
    .get().id;

  const log: Logger = (line) => {
    state.log.push(line);
    if (state.log.length > MAX_LOG_LINES) state.log.shift();
  };

  void (async () => {
    try {
      state.summary = await run(log);
      state.status = "success";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`✗ ${msg}`);
      state.status = "error";
      state.summary = msg;
    } finally {
      state.finishedAt = new Date().toISOString();
      db.update(jobRuns)
        .set({ status: state.status, finishedAt: state.finishedAt, summary: state.summary })
        .where(eq(jobRuns.id, runId))
        .run();
    }
  })();

  return { started: true, message: `${kind} started.` };
}

/** Trigger a TMDB library scan using the current include-non-playable setting. */
export function triggerScan(): TriggerResult {
  return triggerJob("scan", async (log) => {
    const scanner = createScanner(db, log);
    const mediaDir = process.env.MEDIA_DIR ?? "./media";
    const summary = await scanner.runScan({
      mediaDir,
      includeNonPlayable: getIncludeNonPlayable(),
      cacheArtwork: getCacheArtworkOnScan(),
    });
    return `movies=${summary.movies} shows=${summary.shows}`;
  });
}

/** Trigger a DB-driven transcode of all non-playable library files. */
export function triggerTranscode(deleteOriginals: boolean): TriggerResult {
  return triggerJob("transcode", async (log) => {
    const summary = await runDbTranscode(db, { deleteOriginals }, log);
    return `transcoded=${summary.transcoded} alreadyDone=${summary.alreadyDone} failed=${summary.failed}`;
  });
}

/** Trigger a pass that downloads all referenced artwork to local disk. */
export function triggerArtwork(): TriggerResult {
  return triggerJob("artwork", async (log) => {
    const summary = await cacheArtwork(db, log);
    return `downloaded=${summary.downloaded} skipped=${summary.skipped} failed=${summary.failed}`;
  });
}
