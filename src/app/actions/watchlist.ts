"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { isTitleVisible } from "@/db/queries";
import { watchlist } from "@/db/schema";
import { getActiveProfileId, getContentRules } from "@/lib/profile";

/**
 * Toggle a movie/show in the active profile's "My List".
 * Returns whether the item is in the list AFTER the toggle.
 */
export async function toggleWatchlist(
  mediaType: "movie" | "show",
  mediaId: number,
): Promise<boolean> {
  const profileId = await getActiveProfileId();
  if (profileId === null) return false;
  // The button never renders for a blocked title, but the action is callable.
  if (!isTitleVisible(await getContentRules(), mediaType, mediaId)) return false;

  const where = and(
    eq(watchlist.profileId, profileId),
    eq(watchlist.mediaType, mediaType),
    eq(watchlist.mediaId, mediaId),
  );

  const existing = db.select({ id: watchlist.id }).from(watchlist).where(where).get();

  let nowInList: boolean;
  if (existing) {
    db.delete(watchlist).where(where).run();
    nowInList = false;
  } else {
    db.insert(watchlist).values({ profileId, mediaType, mediaId }).run();
    nowInList = true;
  }

  revalidatePath("/", "layout");
  return nowInList;
}
