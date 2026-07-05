import { NextResponse } from "next/server";

import {
  getCacheArtworkOnScan,
  getIncludeNonPlayable,
  getLastRun,
  getNonPlayableCount,
} from "@/db/queries";
import { db } from "@/db";
import { countArtwork } from "@/lib/images";
import { currentJob, nextScanAt } from "@/lib/job-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Live admin status for the polling panel. */
export async function GET() {
  const job = currentJob();
  return NextResponse.json({
    current: job ? { ...job, log: job.log.slice(-40) } : null,
    lastScan: getLastRun("scan"),
    lastTranscode: getLastRun("transcode"),
    lastArtwork: getLastRun("artwork"),
    nonPlayable: getNonPlayableCount(),
    includeNonPlayable: getIncludeNonPlayable(),
    artwork: countArtwork(db),
    cacheArtworkOnScan: getCacheArtworkOnScan(),
    nextScanAt: nextScanAt(),
  });
}
