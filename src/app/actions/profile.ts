"use server";

import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { db } from "@/db";
import { listGenres } from "@/db/queries";
import { profiles } from "@/db/schema";
import {
  ALLOWED_AVATAR_TYPES,
  MAX_AVATAR_BYTES,
  MAX_AVATAR_MB,
} from "@/lib/avatar";
import { AVATAR_DIR, localAvatarFile } from "@/lib/avatar-store";
import {
  isUsableAllowance,
  KIDS_DEFAULT_CERTIFICATIONS,
  sanitizeCertifications,
} from "@/lib/content-rules";
import {
  ACTIVE_PROFILE_COOKIE,
  getActiveProfile,
  getActiveProfileId,
} from "@/lib/profile";

export interface ProfileFormState {
  error?: string;
}

/**
 * Persist an uploaded avatar to AVATAR_DIR and return its URL. The file is served
 * by the `/avatars/[file]` route handler (not from public/, which Next won't
 * serve for files written after startup).
 */
async function saveAvatar(file: File | null): Promise<string | null> {
  if (!file || file.size === 0) return null;
  const ext = ALLOWED_AVATAR_TYPES.get(file.type);
  if (!ext) throw new Error("Unsupported image type — use JPEG, PNG, or WebP.");
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error(`Image too large (max ${MAX_AVATAR_MB} MB).`);
  }

  await mkdir(AVATAR_DIR, { recursive: true });
  const filename = `${randomUUID()}${ext}`;
  await writeFile(join(AVATAR_DIR, filename), Buffer.from(await file.arrayBuffer()));
  return `/avatars/${filename}`;
}

/** Best-effort delete of a previously-stored avatar file. */
async function removeAvatar(avatarPath: string | null) {
  if (!avatarPath?.startsWith("/avatars/")) return;
  const file = localAvatarFile(avatarPath.slice("/avatars/".length));
  if (!file) return;
  try {
    await unlink(file);
  } catch {
    // ignore missing files
  }
}

async function setActiveCookie(id: number) {
  const store = await cookies();
  store.set(ACTIVE_PROFILE_COOKIE, String(id), {
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

/** Read a text field from FormData as a trimmed string (File values become ""). */
function formText(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Form action: set the active profile cookie. */
export async function selectProfileAction(formData: FormData) {
  const id = Number(formData.get("profileId"));
  if (!Number.isInteger(id)) return;
  const exists = db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, id)).get();
  if (!exists) return;
  await setActiveCookie(id);
  revalidatePath("/", "layout");
}

/** useActionState: create a profile (name + optional avatar), then select it. */
export async function createProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const name = formText(formData, "name");
  if (!name) return { error: "Please enter a name." };

  let avatarPath: string | null;
  try {
    avatarPath = await saveAvatar(formData.get("avatar") as File | null);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Avatar upload failed." };
  }

  // A kids profile starts on the safe defaults; the parent tunes it afterwards.
  const isKids = formData.get("isKids") === "on" ? 1 : 0;
  const row = db
    .insert(profiles)
    .values({
      name,
      avatarPath,
      isKids,
      allowedCertifications: isKids ? KIDS_DEFAULT_CERTIFICATIONS : null,
      allowUnrated: isKids ? 0 : 1,
      blockedGenreIds: [],
    })
    .returning({ id: profiles.id })
    .get();

  // Creating normally switches you to the new profile — but a parent setting up
  // a kids profile shouldn't be dropped into it. Only switch when there's no
  // active profile yet (i.e. this came from the "Who's watching?" gate).
  if (!isKids || (await getActiveProfileId()) === null) {
    await setActiveCookie(row.id);
  }
  revalidatePath("/", "layout");
  return {};
}

/**
 * useActionState: save one profile's parental controls.
 *
 * Refuses when the *active* profile is itself restricted, so a kids profile
 * can't widen its own allowance from /profiles. Everything is re-validated
 * server-side — the form is a convenience, not the authority.
 */
export async function updateParentalControlsAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const active = await getActiveProfile();
  if (active?.isKids === 1) {
    return { error: "Switch to a grown-up profile to change parental controls." };
  }

  const id = Number(formData.get("profileId"));
  if (!Number.isInteger(id)) return { error: "Profile not found." };
  const existing = db.select().from(profiles).where(eq(profiles.id, id)).get();
  if (!existing) return { error: "Profile not found." };

  // Turning restrictions off keeps the saved allowance, so re-enabling later
  // doesn't come back as "nothing allowed".
  if (formData.get("isKids") !== "on") {
    db.update(profiles).set({ isKids: 0 }).where(eq(profiles.id, id)).run();
    revalidatePath("/", "layout");
    return {};
  }

  const allowedCertifications = sanitizeCertifications(
    formData.getAll("certifications").filter((v): v is string => typeof v === "string"),
  );
  const allowUnrated = formData.get("allowUnrated") === "on" ? 1 : 0;
  if (!isUsableAllowance(allowedCertifications, allowUnrated === 1)) {
    return {
      error: "Allow at least one rating, or this profile would see nothing at all.",
    };
  }

  const validGenreIds = new Set(listGenres().map((g) => g.id));
  const blockedGenreIds = formData
    .getAll("blockedGenres")
    .map((v) => Number(v))
    .filter((genreId) => validGenreIds.has(genreId));

  db.update(profiles)
    .set({ isKids: 1, allowedCertifications, allowUnrated, blockedGenreIds })
    .where(eq(profiles.id, id))
    .run();

  revalidatePath("/", "layout");
  return {};
}

/** useActionState: update a profile's name and/or avatar. */
export async function updateProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const id = Number(formData.get("profileId"));
  const name = formText(formData, "name");
  if (!Number.isInteger(id) || !name) return { error: "Please enter a name." };

  const existing = db.select().from(profiles).where(eq(profiles.id, id)).get();
  if (!existing) return { error: "Profile not found." };

  let avatarPath = existing.avatarPath;
  const file = formData.get("avatar") as File | null;
  if (file && file.size > 0) {
    try {
      avatarPath = await saveAvatar(file);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Avatar upload failed." };
    }
    await removeAvatar(existing.avatarPath);
  }

  db.update(profiles).set({ name, avatarPath }).where(eq(profiles.id, id)).run();
  revalidatePath("/", "layout");
  return {};
}

/** Form action: delete a profile (cascades progress + watchlist). */
export async function deleteProfileAction(formData: FormData) {
  const id = Number(formData.get("profileId"));
  if (!Number.isInteger(id)) return;

  const existing = db.select().from(profiles).where(eq(profiles.id, id)).get();
  if (!existing) return;

  db.delete(profiles).where(eq(profiles.id, id)).run();
  await removeAvatar(existing.avatarPath);

  if ((await getActiveProfileId()) === id) {
    (await cookies()).delete(ACTIVE_PROFILE_COOKIE);
  }
  revalidatePath("/", "layout");
}
