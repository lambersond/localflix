import { extname } from "node:path";

export type PlayableKind = "movie" | "episode";

export interface PlayableId {
  kind: PlayableKind;
  numericId: number;
  /** Which file version: 0 = the primary file on the row, else a media_files id. */
  versionId: number;
}

/**
 * Playable ids are prefixed strings so movie ids and episode ids share a single
 * namespace without colliding: `m{movieId}` / `e{episodeId}`. An optional
 * `.v{fileId}` suffix selects a non-primary file version (e.g. `m12.v3`).
 */
export function parsePlayableId(id: string): PlayableId | null {
  const match = /^([me])(\d+)(?:\.v(\d+))?$/.exec(id);
  if (!match) return null;
  const numericId = Number(match[2]);
  if (!Number.isInteger(numericId) || numericId <= 0) return null;
  const versionId = match[3] ? Number(match[3]) : 0;
  if (!Number.isInteger(versionId) || versionId < 0) return null;
  return {
    kind: match[1] === "m" ? "movie" : "episode",
    numericId,
    versionId,
  };
}

export function toPlayableId(
  kind: PlayableKind,
  numericId: number,
  versionId = 0,
): string {
  const base = `${kind === "movie" ? "m" : "e"}${numericId}`;
  return versionId > 0 ? `${base}.v${versionId}` : base;
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

/**
 * Derive a version label from a filename's quality/edition tokens, e.g.
 * "Bridesmaids 2011 2160p Unrated.mkv" → "4K · Unrated". Returns null when the
 * name has no recognizable tokens (the caller falls back to a generic label).
 */
export function parseVersionLabel(filePath: string): string | null {
  const name = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
  const hay = name.toLowerCase();
  const parts: string[] = [];

  if (/\b(2160p|4k|uhd)\b/.test(hay)) parts.push("4K");
  else if (/\b1080p\b/.test(hay)) parts.push("1080p");
  else if (/\b720p\b/.test(hay)) parts.push("720p");
  else if (/\b480p\b/.test(hay)) parts.push("480p");

  if (/director'?s?[\s._-]*cut/.test(hay)) parts.push("Director's Cut");
  else if (/\bextended\b/.test(hay)) parts.push("Extended");
  else if (/\bunrated\b/.test(hay)) parts.push("Unrated");
  else if (/\btheatrical\b/.test(hay)) parts.push("Theatrical");
  else if (/\bremaster(ed)?\b/.test(hay)) parts.push("Remastered");
  else if (/\bimax\b/.test(hay)) parts.push("IMAX");

  return parts.length > 0 ? parts.join(" · ") : null;
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
