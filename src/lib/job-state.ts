/**
 * Pure in-memory job/scheduler state, pinned to globalThis so it survives dev
 * hot-reloads and is shared across requests in the one Node process. This module
 * deliberately imports nothing with filesystem side effects, so lightweight
 * readers (the status route, the admin page) can read state without pulling the
 * scan/transcode/ffmpeg code into their bundle trace.
 */

export type JobKind = "scan" | "transcode" | "artwork";

export interface JobState {
  kind: JobKind;
  status: "running" | "success" | "error";
  startedAt: string;
  finishedAt: string | null;
  log: string[];
  summary: string | null;
}

const globalForJobs = globalThis as unknown as {
  __mediaJobState?: { current: JobState | null; nextScanAt: number | null };
};
const store = globalForJobs.__mediaJobState ?? { current: null, nextScanAt: null };
globalForJobs.__mediaJobState = store;

export function currentJob(): JobState | null {
  return store.current;
}

export function isJobRunning(): boolean {
  return store.current?.status === "running";
}

export function setCurrentJob(state: JobState | null): void {
  store.current = state;
}

/** Epoch ms of the next scheduled scan, or null if disabled/unscheduled. */
export function nextScanAt(): number | null {
  return store.nextScanAt;
}

export function setNextScanAt(ts: number | null): void {
  store.nextScanAt = ts;
}
