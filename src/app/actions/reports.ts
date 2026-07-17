"use server";

import { revalidatePath } from "next/cache";

import { createReport } from "@/db/queries";
import { getActiveProfileId } from "@/lib/profile";

const MAX_NOTE = 500;

/**
 * File a "this item is wrong" report from a detail page. Open to any viewer
 * (LAN-trust, like the rest of the app); the optional note helps the admin
 * identify what the media actually is.
 */
export async function submitReportAction(
  mediaType: "movie" | "show",
  mediaId: number,
  note: string,
): Promise<{ ok: boolean; message: string }> {
  if (
    (mediaType !== "movie" && mediaType !== "show") ||
    !Number.isInteger(mediaId) ||
    mediaId <= 0
  ) {
    return { ok: false, message: "Couldn't file that report." };
  }
  const trimmed = note.trim().slice(0, MAX_NOTE);
  const profileId = await getActiveProfileId();
  createReport({ mediaType, mediaId, note: trimmed || null, profileId });
  revalidatePath("/admin");
  return { ok: true, message: "Thanks — an admin will take a look." };
}
