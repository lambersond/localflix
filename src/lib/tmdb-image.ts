/**
 * Client-safe TMDB image helpers. Kept separate from `tmdb.ts` (which reads the
 * API token and does server-side fetches) so client components can build image
 * URLs without bundling the token-reading code.
 */

/**
 * Resolve a TMDB relative path to the app's local artwork route. Artwork is
 * cached on disk and served by `/tmdb-img/[...path]` (disk-first, with a TMDB
 * fallback), so the app keeps working offline. `next/image` handles display
 * sizing from the local source, so no size argument is needed here.
 */
export function tmdbImage(path: string | null | undefined): string | null {
  if (!path) return null;
  return `/tmdb-img/${path.replace(/^\//, "")}`;
}
