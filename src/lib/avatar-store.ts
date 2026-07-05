import { isAbsolute, join, normalize } from "node:path";

/**
 * Where uploaded profile avatars are stored on disk. In Docker this lives under
 * the /data volume (AVATAR_DIR=/data/avatars) so it persists across container
 * recreation. Avatars are served by the `/avatars/[file]` route handler — NOT
 * from `public/`, because Next.js does not serve files added to public/ after
 * the server has started.
 *
 * Server-only (uses node:path); keep it out of `@/lib/avatar`, which is imported
 * by client components.
 */
export const AVATAR_DIR = process.env.AVATAR_DIR ?? "./data/avatars";

/**
 * Resolve a stored avatar filename (e.g. "uuid.png") to an on-disk path inside
 * AVATAR_DIR, rejecting anything that would escape it. Avatars are flat files,
 * so any path separator or traversal is rejected. Returns null if unsafe.
 */
export function localAvatarFile(filename: string): string | null {
  const name = normalize(filename.replace(/^\/+/, ""));
  if (
    !name ||
    name.includes("/") ||
    name.startsWith("..") ||
    isAbsolute(name) ||
    name.includes("\0")
  ) {
    return null;
  }
  return join(AVATAR_DIR, name);
}
