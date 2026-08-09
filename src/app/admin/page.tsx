import { notFound } from "next/navigation";

import { db } from "@/db";
import {
  countOpenReports,
  getAutoScanEnabled,
  getCacheArtworkOnScan,
  getIncludeNonPlayable,
  getLastRun,
  getLibraryFileCount,
  getNonPlayableCount,
} from "@/db/queries";
import { countArtwork } from "@/lib/images";
import { currentJob, nextScanAt } from "@/lib/job-state";
import { getActiveProfile } from "@/lib/profile";

import AdminPanel, { type AdminStatus } from "../components/admin/AdminPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // The admin tools show (and can re-tag) the whole library, so a restricted
  // profile can't have them — this URL is unlinked, not secret.
  const profile = await getActiveProfile();
  if (profile?.isKids === 1) notFound();

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
    openReports: countOpenReports(),
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-16 pt-20 sm:pt-24 sm:px-8">
      <h1 className="text-2xl font-bold">Admin</h1>
      <AdminPanel initial={initial} />
    </main>
  );
}
