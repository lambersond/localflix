import { db } from "@/db";
import {
  getAutoScanEnabled,
  getCacheArtworkOnScan,
  getIncludeNonPlayable,
  getLastRun,
  getLibraryFileCount,
  getNonPlayableCount,
} from "@/db/queries";
import { countArtwork } from "@/lib/images";
import { currentJob, nextScanAt } from "@/lib/job-state";

import AdminPanel, { type AdminStatus } from "../components/admin/AdminPanel";

export const dynamic = "force-dynamic";

export default function AdminPage() {
  const job = currentJob();
  const autoScanEnabled = getAutoScanEnabled();
  const initial: AdminStatus = {
    current: job ? { ...job, log: job.log.slice(-40) } : null,
    lastScan: getLastRun("scan"),
    lastTranscode: getLastRun("transcode"),
    lastArtwork: getLastRun("artwork"),
    nonPlayable: getNonPlayableCount(),
    includeNonPlayable: getIncludeNonPlayable(),
    artwork: countArtwork(db),
    cacheArtworkOnScan: getCacheArtworkOnScan(),
    autoScanEnabled,
    libraryTotal: getLibraryFileCount(),
    nextScanAt: autoScanEnabled ? nextScanAt() : null,
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-16 pt-20 sm:pt-24 sm:px-8">
      <h1 className="text-2xl font-bold">Admin</h1>
      <AdminPanel initial={initial} />
    </main>
  );
}
