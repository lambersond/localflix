/** Shared avatar upload constraints (used by the form UI and the Server Action). */
export const MAX_AVATAR_MB = 5;
export const MAX_AVATAR_BYTES = MAX_AVATAR_MB * 1024 * 1024;

/** Allowed image MIME types → file extension. */
export const ALLOWED_AVATAR_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

export const AVATAR_HINT = `JPEG, PNG, or WebP · max ${MAX_AVATAR_MB} MB`;
