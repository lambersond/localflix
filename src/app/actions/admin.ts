"use server";

import { revalidatePath } from "next/cache";

import {
  AUTO_SCAN_ENABLED_KEY,
  CACHE_ARTWORK_ON_SCAN_KEY,
  findBrokenLinks,
  INCLUDE_NON_PLAYABLE_KEY,
  removeBrokenLinks,
  setSetting,
  type BrokenLink,
  type RemovalSummary,
} from "@/db/queries";
import {
  triggerArtwork,
  triggerScan,
  triggerTranscode,
  type TriggerResult,
} from "@/lib/jobs";
import { findUntrackedFiles, type UntrackedResult } from "@/lib/untracked";

/** Kick off a TMDB library scan (background job). `onlyNew` skips indexed files. */
export async function triggerScanAction(onlyNew = false): Promise<TriggerResult> {
  const result = triggerScan(onlyNew);
  revalidatePath("/admin");
  return result;
}

/** Kick off a transcode of all non-playable library files (background job). */
export async function triggerTranscodeAction(
  deleteOriginals: boolean,
): Promise<TriggerResult> {
  const result = triggerTranscode(deleteOriginals);
  revalidatePath("/admin");
  return result;
}

/** Toggle whether scans ingest files browsers can't play natively. */
export async function setIncludeNonPlayableAction(value: boolean): Promise<void> {
  setSetting(INCLUDE_NON_PLAYABLE_KEY, value ? "true" : "false");
  revalidatePath("/admin");
}

/** Kick off a pass that downloads all referenced artwork to local disk. */
export async function triggerArtworkAction(): Promise<TriggerResult> {
  const result = triggerArtwork();
  revalidatePath("/admin");
  return result;
}

/** Toggle whether scans pre-download artwork to local disk. */
export async function setCacheArtworkOnScanAction(value: boolean): Promise<void> {
  setSetting(CACHE_ARTWORK_ON_SCAN_KEY, value ? "true" : "false");
  revalidatePath("/admin");
}

/** Toggle whether the scheduler runs automatic (daily / on-startup) scans. */
export async function setAutoScanEnabledAction(value: boolean): Promise<void> {
  setSetting(AUTO_SCAN_ENABLED_KEY, value ? "true" : "false");
  revalidatePath("/admin");
}

/** List library rows whose file is missing from disk (on-demand; stats each file). */
export async function findBrokenLinksAction(): Promise<BrokenLink[]> {
  return findBrokenLinks();
}

/** Delete the selected broken rows (re-verifies each file is still missing first). */
export async function removeBrokenLinksAction(
  items: { kind: "movie" | "episode"; id: number }[],
): Promise<RemovalSummary> {
  const summary = removeBrokenLinks(items);
  revalidatePath("/admin");
  return summary;
}

/** List video files on disk that have no DB record (on-demand; walks MEDIA_DIR). */
export async function findUntrackedFilesAction(): Promise<UntrackedResult> {
  return findUntrackedFiles();
}
