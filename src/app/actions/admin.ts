"use server";

import { revalidatePath } from "next/cache";

import {
  CACHE_ARTWORK_ON_SCAN_KEY,
  INCLUDE_NON_PLAYABLE_KEY,
  setSetting,
} from "@/db/queries";
import {
  triggerArtwork,
  triggerScan,
  triggerTranscode,
  type TriggerResult,
} from "@/lib/jobs";

/** Kick off a TMDB library scan (background job). */
export async function triggerScanAction(): Promise<TriggerResult> {
  const result = triggerScan();
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
