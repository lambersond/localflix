"use server";

import { revalidatePath } from "next/cache";

import {
  AUTO_SCAN_ENABLED_KEY,
  CACHE_ARTWORK_ON_SCAN_KEY,
  findBrokenLinks,
  INCLUDE_NON_PLAYABLE_KEY,
  listOpenReports,
  removeBrokenLinks,
  resolveReport,
  searchLibraryTitles,
  setSetting,
  type BrokenLink,
  type LibraryMatch,
  type OpenReport,
  type RemovalSummary,
} from "@/db/queries";
import {
  triggerArtwork,
  triggerScan,
  triggerTranscode,
  type TriggerResult,
} from "@/lib/jobs";
import {
  assignUntrackedMatch,
  matchMovieToTv,
  rematchTitle,
  type RetagResult,
} from "@/lib/retag";
import {
  getMovieDetails,
  getShowDetails,
  movieDetailsToHit,
  searchMovies,
  searchShows,
  showDetailsToHit,
  type TmdbSearchHit,
} from "@/lib/tmdb";
import { findUntrackedFiles, type UntrackedResult } from "@/lib/untracked";

/** Kick off a TMDB library scan (background job). `onlyNew` skips indexed files. */
export async function triggerScanAction(onlyNew = false): Promise<TriggerResult> {
  const result = triggerScan(onlyNew);
  revalidatePath("/admin");
  return result;
}

/** Kick off a transcode of all non-playable library files (background job). */
export async function triggerTranscodeAction(
  deleteOriginals: boolean,
): Promise<TriggerResult> {
  const result = triggerTranscode(deleteOriginals);
  revalidatePath("/admin");
  return result;
}

/** Toggle whether scans ingest files browsers can't play natively. */
export async function setIncludeNonPlayableAction(value: boolean): Promise<void> {
  setSetting(INCLUDE_NON_PLAYABLE_KEY, value ? "true" : "false");
  revalidatePath("/admin");
}

/** Kick off a pass that downloads all referenced artwork to local disk. */
export async function triggerArtworkAction(): Promise<TriggerResult> {
  const result = triggerArtwork();
  revalidatePath("/admin");
  return result;
}

/** Toggle whether scans pre-download artwork to local disk. */
export async function setCacheArtworkOnScanAction(value: boolean): Promise<void> {
  setSetting(CACHE_ARTWORK_ON_SCAN_KEY, value ? "true" : "false");
  revalidatePath("/admin");
}

/** Toggle whether the scheduler runs automatic (daily / on-startup) scans. */
export async function setAutoScanEnabledAction(value: boolean): Promise<void> {
  setSetting(AUTO_SCAN_ENABLED_KEY, value ? "true" : "false");
  revalidatePath("/admin");
}

/** List library rows whose file is missing from disk (on-demand; stats each file). */
export async function findBrokenLinksAction(): Promise<BrokenLink[]> {
  return findBrokenLinks();
}

/** Delete the selected broken rows (re-verifies each file is still missing first). */
export async function removeBrokenLinksAction(
  items: { kind: "movie" | "episode"; id: number }[],
): Promise<RemovalSummary> {
  const summary = removeBrokenLinks(items);
  revalidatePath("/admin");
  return summary;
}

/** List video files on disk that have no DB record (on-demand; walks MEDIA_DIR). */
export async function findUntrackedFilesAction(): Promise<UntrackedResult> {
  return findUntrackedFiles();
}

/** A pasted TMDB id or `themoviedb.org/(movie|tv)/<id>` URL, when it matches `kind`. */
function parseTmdbRef(input: string, kind: "movie" | "show"): number | null {
  const s = input.trim();
  if (/^\d+$/.test(s)) return Number(s);
  const m = s.match(/themoviedb\.org\/(movie|tv)\/(\d+)/i);
  if (m && (m[1].toLowerCase() === "tv" ? "show" : "movie") === kind) {
    return Number(m[2]);
  }
  return null;
}

/** Search TMDB for a match to pick from. Also resolves a pasted id / URL to one hit. */
export async function searchTmdbAction(
  kind: "movie" | "show",
  query: string,
): Promise<{ hits: TmdbSearchHit[] } | { error: string }> {
  const term = query.trim();
  if (!term) return { hits: [] };
  try {
    const ref = parseTmdbRef(term, kind);
    if (ref !== null) {
      const hit =
        kind === "movie"
          ? movieDetailsToHit(await getMovieDetails(ref))
          : showDetailsToHit(await getShowDetails(ref));
      return { hits: [hit] };
    }
    const hits = kind === "movie" ? await searchMovies(term) : await searchShows(term);
    return { hits };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Tracked titles matching `query` — to locate a mis-matched record to re-tag (read-only). */
export async function searchLibraryTitlesAction(query: string): Promise<LibraryMatch[]> {
  return searchLibraryTitles(query);
}

/** Ingest an untracked file against an operator-chosen TMDB id. */
export async function assignUntrackedMatchAction(input: {
  path: string;
  area: "movie" | "show";
  tmdbId: number;
}): Promise<RetagResult> {
  const result = await assignUntrackedMatch(input);
  if (result.ok) revalidatePath("/admin");
  return result;
}

/** Replace a tracked title's TMDB match (deletes the old record, re-ingests the new). */
export async function rematchTitleAction(input: {
  kind: "movie" | "show";
  id: number;
  tmdbId: number;
}): Promise<RetagResult> {
  const result = await rematchTitle(input);
  if (result.ok) revalidatePath("/admin");
  return result;
}

/** Point a movie at a TMDB TV entry, keeping it a single playable item. */
export async function matchMovieToTvAction(input: {
  movieId: number;
  tmdbTvId: number;
}): Promise<RetagResult> {
  const result = await matchMovieToTv(input);
  if (result.ok) revalidatePath("/admin");
  return result;
}

/** Open "incorrect item" reports for the admin queue (read-only). */
export async function listOpenReportsAction(): Promise<OpenReport[]> {
  return listOpenReports();
}

/** Mark a report resolved. */
export async function resolveReportAction(id: number): Promise<void> {
  resolveReport(id);
  revalidatePath("/admin");
}
