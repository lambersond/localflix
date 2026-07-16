import { getAutoScanEnabled } from "@/db/queries";
import { setNextScanAt } from "@/lib/job-state";
import { triggerScan } from "@/lib/jobs";

/**
 * Daily scan scheduler, pinned to globalThis so a dev hot-reload doesn't stack
 * multiple timers. Fires once per day at `SCAN_AT_HOUR` (local time, default 3).
 * Set `SCAN_AT_HOUR=off` to disable; `SCAN_ON_STARTUP=true` to also scan on boot.
 *
 * The `SCAN_AT_HOUR` env var sets *when* the timer fires; the "auto scan enabled"
 * admin setting gates *whether* a fire actually runs a scan. The setting is read
 * at fire time, so toggling it from /admin takes effect with no restart.
 */
function runScheduledScan(label: string): void {
  if (!getAutoScanEnabled()) {
    console.log(`[scheduler] ${label} skipped (automatic scans disabled).`);
    return;
  }
  console.log(`[scheduler] ${triggerScan().message}`);
}
const globalForSched = globalThis as unknown as {
  __mediaSchedulerStarted?: boolean;
};

function msUntilNextRun(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function startScheduler(): void {
  if (globalForSched.__mediaSchedulerStarted) return;
  globalForSched.__mediaSchedulerStarted = true;

  const raw = process.env.SCAN_AT_HOUR ?? "3";
  if (raw.toLowerCase() === "off") {
    console.log("[scheduler] daily scan disabled (SCAN_AT_HOUR=off)");
  } else {
    const hour = Number(raw);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      console.warn(`[scheduler] invalid SCAN_AT_HOUR="${raw}"; daily scan disabled.`);
    } else {
      const schedule = () => {
        const delay = msUntilNextRun(hour);
        const at = Date.now() + delay;
        setNextScanAt(at);
        console.log(`[scheduler] next scan at ${new Date(at).toLocaleString()}`);
        const timer = setTimeout(() => {
          runScheduledScan("daily scan");
          schedule(); // recompute next run (survives DST shifts)
        }, delay);
        timer.unref();
      };
      schedule();
    }
  }

  if (process.env.SCAN_ON_STARTUP === "true") {
    runScheduledScan("startup scan");
  }
}
