import type { Logger } from "./scan";
import type { TmdbVideo } from "./tmdb";

/**
 * TMDB keeps listing videos long after YouTube makes them private or deletes
 * them, and its payload has no flag for it — the only way to know is to ask
 * YouTube. oEmbed answers without an API key: 200 for a playable video, and a
 * client error for one that will never play.
 */
const OEMBED = "https://www.youtube.com/oembed";

/** Definitively unplayable: malformed id, private, or removed. */
const DEAD_STATUSES = new Set([400, 401, 403, 404]);

async function isAvailable(key: string): Promise<boolean> {
  const url = `${OEMBED}?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${key}`,
  )}&format=json`;

  try {
    const res = await fetch(url);
    return !DEAD_STATUSES.has(res.status);
  } catch {
    // Fail open. A network blip or a rate-limit must never silently wipe out a
    // title's whole gallery — better a dead tile than no videos at all.
    return true;
  }
}

/**
 * Drop videos YouTube won't play. Checked concurrently; a title has at most a
 * couple dozen videos, so no concurrency pool is needed.
 */
export async function filterAvailableVideos(
  videos: TmdbVideo[],
  log: Logger,
): Promise<TmdbVideo[]> {
  const checked = await Promise.all(
    videos.map(async (video) => ({ video, ok: await isAvailable(video.key) })),
  );

  const kept: TmdbVideo[] = [];
  for (const { video, ok } of checked) {
    if (ok) {
      kept.push(video);
    } else {
      log(`  ⏭ skipping private/unavailable video: ${video.name}`);
    }
  }
  return kept;
}
