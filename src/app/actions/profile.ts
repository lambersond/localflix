"use server";

import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

import { db } from "@/db";
import { profiles } from "@/db/schema";
import {
  ALLOWED_AVATAR_TYPES,
  MAX_AVATAR_BYTES,
  MAX_AVATAR_MB,
} from "@/lib/avatar";
import { ACTIVE_PROFILE_COOKIE, getActiveProfileId } from "@/lib/profile";

export interface ProfileFormState {
  error?: string;
}

const AVATAR_DIR = join(process.cwd(), "public", "avatars");

/** Persist an uploaded avatar to public/avatars and return its public path. */
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
  try {
    await unlink(join(process.cwd(), "public", avatarPath));
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
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Please enter a name." };

  let avatarPath: string | null;
  try {
    avatarPath = await saveAvatar(formData.get("avatar") as File | null);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Avatar upload failed." };
  }

  const row = db
    .insert(profiles)
    .values({ name, avatarPath })
    .returning({ id: profiles.id })
    .get();

  await setActiveCookie(row.id);
  revalidatePath("/", "layout");
  return {};
}

/** useActionState: update a profile's name and/or avatar. */
export async function updateProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const id = Number(formData.get("profileId"));
  const name = String(formData.get("name") ?? "").trim();
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
