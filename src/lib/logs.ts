import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type { JobKind } from "./job-state";

/** Where per-run job logs are written. Own volume in Docker (`/data/logs`). */
const LOG_DIR = process.env.LOG_DIR ?? "./data/logs";

export interface JobLog {
  /** Absolute-or-relative path of the log file on disk. */
  path: string;
  /** Append one line (a newline is added). */
  write(line: string): void;
  close(): void;
}

/**
 * Open a per-run log file named by job kind + ISO start time, e.g.
 * `scan-2026-07-16T09-30-00-000Z.log`. Unlike the in-memory job log (capped at
 * 500 lines for the live panel), this keeps every line so a scan can be reviewed
 * afterwards. Failing to open a log file must never break the job, so a failure
 * here degrades to a no-op writer.
 */
export function openJobLog(kind: JobKind, startedAtISO: string): JobLog {
  const stamp = startedAtISO.replace(/:/g, "-"); // colons aren't path-safe on all FSes
  const path = join(LOG_DIR, `${kind}-${stamp}.log`);

  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(path, `# ${kind} log — started ${startedAtISO}\n`);
  } catch (err) {
    console.error(`[logs] could not open ${path}:`, err);
    return { path, write() {}, close() {} };
  }

  return {
    path,
    write(line: string) {
      try {
        appendFileSync(path, `${line}\n`);
      } catch {
        // A mid-run write failure shouldn't abort the job.
      }
    },
    close() {},
  };
}
