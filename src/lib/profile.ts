import { cookies } from "next/headers";
import { cache } from "react";

import { getProfileById } from "@/db/queries";
import type { Profile } from "@/db/schema";
import { rulesForProfile, type ContentRules } from "@/lib/content-rules";

export const ACTIVE_PROFILE_COOKIE = "active_profile";

/** The active profile id from the cookie, or null. */
export async function getActiveProfileId(): Promise<number | null> {
  const store = await cookies();
  const raw = store.get(ACTIVE_PROFILE_COOKIE)?.value;
  if (!raw) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * The active profile row, or null. Returns null when the cookie points at a
 * profile that no longer exists (so the "Who's watching?" gate re-shows).
 */
export async function getActiveProfile(): Promise<Profile | null> {
  const id = await getActiveProfileId();
  if (id === null) return null;
  return getProfileById(id) ?? null;
}

/**
 * The parental-control rules for the active profile — the single source every
 * viewer-facing query filters by. `cache` dedupes it per request, so the many
 * call sites on a page cost one profile lookup between them.
 */
export const getContentRules = cache(async (): Promise<ContentRules> => {
  return rulesForProfile(await getActiveProfile());
});
