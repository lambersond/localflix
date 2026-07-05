import { db } from "@/db";
import {
  getCacheArtworkOnScan,
  getIncludeNonPlayable,
  getLastRun,
  getNonPlayableCount,
} from "@/db/queries";
import { countArtwork } from "@/lib/images";
import { currentJob, nextScanAt } from "@/lib/job-state";

import AdminPanel, { type AdminStatus } from "../components/admin/AdminPanel";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  const job = currentJob();
  const initial: AdminStatus = {
    current: job ? { ...job, log: job.log.slice(-40) } : null,
    lastScan: getLastRun("scan"),
    lastTranscode: getLastRun("transcode"),
    lastArtwork: getLastRun("artwork"),
    nonPlayable: getNonPlayableCount(),
    includeNonPlayable: getIncludeNonPlayable(),
    artwork: countArtwork(db),
    cacheArtworkOnScan: getCacheArtworkOnScan(),
    nextScanAt: nextScanAt(),
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-16 pt-24 sm:px-8">
      <h1 className="text-2xl font-bold">Admin</h1>
      <AdminPanel initial={initial} />
    </main>
  );
}
