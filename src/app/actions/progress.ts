"use server";

import { revalidatePath } from "next/cache";

import { setCompleted } from "@/db/queries";
import { parsePlayableId } from "@/lib/media";
import { getActiveProfileId } from "@/lib/profile";

/**
 * Manually mark a playable (movie/episode) watched or unwatched for the active
 * profile. Drives the same `completed` flag as natural playback, so completing
 * a movie can surface its sequel and completing an episode surfaces the next.
 */
export async function setWatchCompleted(
  playableId: string,
  completed: boolean,
): Promise<boolean> {
  const profileId = await getActiveProfileId();
  if (profileId === null) return false;

  const parsed = parsePlayableId(playableId);
  if (!parsed) return false;

  setCompleted(profileId, parsed, completed);
  revalidatePath("/", "layout");
  return completed;
}
