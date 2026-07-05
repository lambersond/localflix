import { extname } from "node:path";

export type PlayableKind = "movie" | "episode";

export interface PlayableId {
  kind: PlayableKind;
  numericId: number;
}

/**
 * Playable ids are prefixed strings so movie ids and episode ids share a single
 * namespace without colliding: `m{movieId}` and `e{episodeId}`.
 */
export function parsePlayableId(id: string): PlayableId | null {
  const match = /^([me])(\d+)$/.exec(id);
  if (!match) return null;
  const numericId = Number(match[2]);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;
  return {
    kind: match[1] === "m" ? "movie" : "episode",
    numericId,
  };
}

export function toPlayableId(kind: PlayableKind, numericId: number): string {
  return `${kind === "movie" ? "m" : "e"}${numericId}`;
}

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
};

/**
 * Best-effort content type from a file extension. Note that browsers cannot
 * always play `.mkv` natively even though we serve a plausible type.
 */
export function mimeTypeForFile(filePath: string): string {
  return MIME_BY_EXT[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/** Extensions browsers can play natively in <video> (H.264/VP8-9/AV1 containers). */
export const BROWSER_PLAYABLE_EXTENSIONS = new Set([
  ".mp4",
  ".m4v",
  ".webm",
  ".ogv",
  ".mov",
]);

/** True if the file's container is one browsers can stream without transcoding. */
export function isBrowserPlayable(filePath: string): boolean {
  return BROWSER_PLAYABLE_EXTENSIONS.has(extname(filePath).toLowerCase());
}

export function formatRuntime(minutes: number | null | undefined): string | null {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function releaseYear(date: string | null | undefined): string | null {
  if (!date) return null;
  const year = date.slice(0, 4);
  return /^\d{4}$/.test(year) ? year : null;
}
