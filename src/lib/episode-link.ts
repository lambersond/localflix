import { statSync } from "node:fs";
import { basename, extname, resolve, sep } from "node:path";

import { eq, like } from "drizzle-orm";

import { db } from "@/db";
import { listShowEpisodeRecords, type ShowEpisodeRecord } from "@/db/queries";
import * as schema from "@/db/schema";

import { mimeTypeForFile } from "./media";
import type { RetagResult } from "./retag";
import { showFolderOf } from "./retag";
import { reindexSearch } from "./search-index";
import { getSeasonDetails, getShowDetails, type TmdbEpisode } from "./tmdb";

/**
 * Manual episode ↔ TMDB links.
 *
 * An episode's metadata is normally looked up by the number in its filename, so
 * a library numbered in DVD order — or a pilot filed as `S01E00` — lands on the
 * wrong TMDB entry or on none at all (a blank row). These ops let the operator
 * say "this record's metadata comes from *that* TMDB episode", possibly in a
 * different season: episodes that never aired in broadcast order typically live
 * under Specials (season 0).
 *
 * The link is stored as `episodes.tmdbSourceSeason/tmdbSourceEpisode` and is a
 * pure annotation — the row keeps its own slot, so `episodes.id`, its watch
 * progress and its position in the season list are all untouched, and two
 * records may legitimately cite one TMDB episode. `ingestShow` reads these
 * columns so a rescan refreshes from the linked coordinates instead of
 * overwriting the fix.
 */

/** No-op logger — these ops surface a single summary, not a live log. */
const quiet = () => {};

/** Below this bigram score a suggestion is withheld rather than guessed at. */
const SUGGEST_THRESHOLD = 0.62;

// ── TMDB fetch memo ──────────────────────────────────────────────────────────

/**
 * One fetch per season per operation. Linking a whole show walks the same one or
 * two seasons for every record, so without this a 14-episode fix would issue 14
 * identical requests.
 */
function seasonFetcher(tmdbShowId: number) {
  const cache = new Map<number, Promise<TmdbEpisode[]>>();
  return (seasonNumber: number): Promise<TmdbEpisode[]> => {
    const hit = cache.get(seasonNumber);
    if (hit !== undefined) return hit;
    const pending = getSeasonDetails(tmdbShowId, seasonNumber).then((s) => s.episodes);
    cache.set(seasonNumber, pending);
    return pending;
  };
}

// ── Lookups ──────────────────────────────────────────────────────────────────

interface EpisodeContext {
  episodeId: number;
  seasonId: number;
  seasonNumber: number;
  episodeNumber: number;
  showId: number;
  showName: string;
  showTmdbId: number;
}

function episodeContext(episodeId: number): EpisodeContext | undefined {
  const row = db
    .select({
      episodeId: schema.episodes.id,
      seasonId: schema.seasons.id,
      seasonNumber: schema.seasons.tmdbSeasonNumber,
      episodeNumber: schema.episodes.tmdbEpisodeNumber,
      showId: schema.shows.id,
      showName: schema.shows.name,
      showTmdbId: schema.shows.tmdbId,
    })
    .from(schema.episodes)
    .innerJoin(schema.seasons, eq(schema.episodes.seasonId, schema.seasons.id))
    .innerJoin(schema.shows, eq(schema.seasons.showId, schema.shows.id))
    .where(eq(schema.episodes.id, episodeId))
    .get();
  return row;
}

function showById(showId: number) {
  return db
    .select({ id: schema.shows.id, name: schema.shows.name, tmdbId: schema.shows.tmdbId })
    .from(schema.shows)
    .where(eq(schema.shows.id, showId))
    .get();
}

/** The tracked show that owns a folder — matched via any episode file inside it. */
function showOwningFolder(folder: string) {
  return db
    .select({ id: schema.shows.id, name: schema.shows.name, tmdbId: schema.shows.tmdbId })
    .from(schema.episodes)
    .innerJoin(schema.seasons, eq(schema.episodes.seasonId, schema.seasons.id))
    .innerJoin(schema.shows, eq(schema.seasons.showId, schema.shows.id))
    .where(like(schema.episodes.filePath, `${resolve(folder)}${sep}%`))
    .get();
}

function label(seasonNumber: number, episodeNumber: number): string {
  return `S${seasonNumber}:E${episodeNumber}`;
}

// ── Write helpers ────────────────────────────────────────────────────────────

/** Copy a TMDB episode's fields onto a row and record where they came from. */
function writeLink(
  episodeId: number,
  meta: TmdbEpisode | undefined,
  source: { seasonNumber: number; episodeNumber: number } | null,
): void {
  db.update(schema.episodes)
    .set({
      name: meta?.name ?? null,
      overview: meta?.overview ?? null,
      stillPath: meta?.still_path ?? null,
      runtimeMinutes: meta?.runtime ?? null,
      airDate: meta?.air_date ?? null,
      tmdbSourceSeason: source?.seasonNumber ?? null,
      tmdbSourceEpisode: source?.episodeNumber ?? null,
    })
    .where(eq(schema.episodes.id, episodeId))
    .run();
}

// ── Public ops ───────────────────────────────────────────────────────────────

/**
 * Point one tracked episode record at a specific TMDB episode. The record keeps
 * its id, file and slot — only the metadata (and the link itself) changes — so
 * watch progress and any `/watch/e<id>` bookmark survive.
 */
export async function linkEpisodeToTmdb(input: {
  episodeId: number;
  seasonNumber: number;
  episodeNumber: number;
}): Promise<RetagResult> {
  const ctx = episodeContext(input.episodeId);
  if (!ctx) return { ok: false, message: "That episode record no longer exists." };

  try {
    const eps = await seasonFetcher(ctx.showTmdbId)(input.seasonNumber);
    const meta = eps.find((e) => e.episode_number === input.episodeNumber);
    if (!meta) {
      return {
        ok: false,
        message: `TMDB has no ${label(input.seasonNumber, input.episodeNumber)} for "${ctx.showName}".`,
      };
    }

    writeLink(input.episodeId, meta, input);
    reindexSearch(db, quiet);
    return {
      ok: true,
      message: `${label(ctx.seasonNumber, ctx.episodeNumber)} now shows "${meta.name ?? "(untitled)"}" from ${label(input.seasonNumber, input.episodeNumber)}.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Drop a manual link and refresh from the record's own number again — which may
 * legitimately leave it blank, since that is the state the link was fixing.
 */
export async function unlinkEpisode(episodeId: number): Promise<RetagResult> {
  const ctx = episodeContext(episodeId);
  if (!ctx) return { ok: false, message: "That episode record no longer exists." };

  try {
    const eps = await seasonFetcher(ctx.showTmdbId)(ctx.seasonNumber);
    const meta = eps.find((e) => e.episode_number === ctx.episodeNumber);
    writeLink(episodeId, meta, null);
    reindexSearch(db, quiet);
    return {
      ok: true,
      message: meta
        ? `${label(ctx.seasonNumber, ctx.episodeNumber)} is back to its own TMDB entry, "${meta.name ?? "(untitled)"}".`
        : `${label(ctx.seasonNumber, ctx.episodeNumber)} unlinked — TMDB has no episode at that number, so it is blank again.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The tracked show an untracked file belongs to, derived from its folder — what
 * the picker needs before it can list episodes. Null when the folder isn't a
 * tracked show yet (the operator must match the show first).
 */
export function showForUntrackedFile(
  path: string,
): { showId: number; showName: string; tmdbShowId: number } | null {
  const folder = showFolderOf(path);
  if (!folder) return null;
  const show = showOwningFolder(folder);
  if (!show) return null;
  return { showId: show.id, showName: show.name, tmdbShowId: show.tmdbId };
}

/**
 * Give a file the scan skipped (no `SxxEyy` in its name, so it has no number to
 * look up) an episode record linked to a chosen TMDB episode. The owning show is
 * derived from the folder, exactly like the scan groups episodes.
 */
export async function linkUntrackedFile(input: {
  path: string;
  seasonNumber: number;
  episodeNumber: number;
}): Promise<RetagResult> {
  const absPath = resolve(input.path);

  const already = db
    .select({ id: schema.episodes.id })
    .from(schema.episodes)
    .where(eq(schema.episodes.filePath, absPath))
    .get();
  if (already) {
    return { ok: false, message: "That file already has an episode record." };
  }

  const folder = showFolderOf(input.path);
  if (!folder) {
    return { ok: false, message: "Couldn't locate the show folder for that file." };
  }
  const show = showOwningFolder(folder);
  if (!show) {
    return {
      ok: false,
      message:
        "No tracked show owns that folder yet — match the show first, then link this file.",
    };
  }

  try {
    const season = await getSeasonDetails(show.tmdbId, input.seasonNumber);
    const meta = season.episodes.find((e) => e.episode_number === input.episodeNumber);
    if (!meta) {
      return {
        ok: false,
        message: `TMDB has no ${label(input.seasonNumber, input.episodeNumber)} for "${show.name}".`,
      };
    }

    const seasonRow = db
      .insert(schema.seasons)
      .values({
        showId: show.id,
        tmdbSeasonNumber: input.seasonNumber,
        name: season.name,
        overview: season.overview,
        posterPath: season.poster_path,
      })
      .onConflictDoUpdate({
        target: [schema.seasons.showId, schema.seasons.tmdbSeasonNumber],
        set: { name: season.name, overview: season.overview, posterPath: season.poster_path },
      })
      .returning({ id: schema.seasons.id })
      .get();

    // The slot is only identity + ordering, and the link is what carries the
    // metadata — so a taken slot files the record at the next free number rather
    // than dead-ending the operator. Say so in the result either way.
    const taken = new Set(
      db
        .select({ n: schema.episodes.tmdbEpisodeNumber })
        .from(schema.episodes)
        .where(eq(schema.episodes.seasonId, seasonRow.id))
        .all()
        .map((r) => r.n),
    );
    let slot = input.episodeNumber;
    while (taken.has(slot)) slot += 1;

    let fileSize: number | null = null;
    try {
      fileSize = statSync(absPath).size;
    } catch {
      fileSize = null; // recorded anyway, same as the scan does
    }

    db.insert(schema.episodes)
      .values({
        seasonId: seasonRow.id,
        tmdbEpisodeNumber: slot,
        name: meta.name,
        overview: meta.overview,
        stillPath: meta.still_path,
        runtimeMinutes: meta.runtime,
        airDate: meta.air_date,
        filePath: absPath,
        fileSize,
        mimeType: mimeTypeForFile(absPath),
        tmdbSourceSeason: input.seasonNumber,
        tmdbSourceEpisode: input.episodeNumber,
      })
      .run();

    reindexSearch(db, quiet);

    const target = label(input.seasonNumber, input.episodeNumber);
    return {
      ok: true,
      message:
        slot === input.episodeNumber
          ? `Linked ${basename(absPath)} to ${target} — "${meta.name ?? "(untitled)"}".`
          : `Linked ${basename(absPath)} to ${target} — "${meta.name ?? "(untitled)"}". Filed as ${label(input.seasonNumber, slot)} because ${target} was already taken.`,
    };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

// ── Suggestions ──────────────────────────────────────────────────────────────

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
function normalizeTitle(s: string): string {
  return s
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The episode title a filename is trying to express, with its numbering removed. */
function titleFromFilename(filePath: string): string {
  return basename(filePath, extname(filePath))
    .replaceAll(/[Ss]\d{1,2}[\s._-]*[Ee]\d{1,3}/g, " ")
    .replaceAll(/\b\d{1,2}[xX]\d{1,3}\b/g, " ")
    .replaceAll(/[._]+/g, " ")
    .replace(/^[\s\-–—]+/, "")
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const compact = s.replaceAll(" ", "");
  const out = new Map<string, number>();
  for (let i = 0; i < compact.length - 1; i += 1) {
    const g = compact.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/**
 * Dice coefficient over character bigrams. Chosen over exact match or word
 * overlap because it handles all three real cases at once: identical after
 * normalization ("Our Mrs Reynolds" → "Our Mrs. Reynolds"), a misspelling in the
 * library ("Bushwacked" → "Bushwhacked", which both alternatives miss entirely),
 * and titles that merely differ in punctuation or spacing.
 */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;

  // A short title fully contained in a longer one ("Serenity" in "Serenity
  // (Pilot)") is a strong signal that bigram overlap alone under-rates.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const contained = short.length >= 5 && long.includes(short);

  const A = bigrams(a);
  const B = bigrams(b);
  let intersection = 0;
  let total = 0;
  for (const [g, n] of A) {
    total += n;
    intersection += Math.min(n, B.get(g) ?? 0);
  }
  for (const n of B.values()) total += n;
  const dice = total === 0 ? 0 : (2 * intersection) / total;

  return contained ? Math.max(dice, 0.9) : dice;
}

export interface EpisodeProposal {
  seasonNumber: number;
  episodeNumber: number;
  name: string | null;
  airDate: string | null;
  stillPath: string | null;
  score: number;
}

export interface EpisodeSuggestion {
  episodeId: number;
  /** The record's own slot — unchanged by any link. */
  seasonNumber: number;
  episodeNumber: number;
  fileName: string;
  currentName: string | null;
  /** True when this record is already manually linked. */
  linked: boolean;
  proposal: EpisodeProposal | null;
  /** Why there's no proposal, or a warning about the one there is. */
  note: string | null;
}

type Candidate = EpisodeProposal & { normalized: string };

/** Best-scoring TMDB episode for one record, or a note explaining the absence. */
function proposeFor(
  record: ShowEpisodeRecord,
  candidates: readonly Candidate[],
): { proposal: EpisodeProposal | null; note: string | null } {
  const guess = normalizeTitle(titleFromFilename(record.filePath));
  if (!guess) return { proposal: null, note: "Filename has no title to match on." };

  let best: EpisodeProposal | null = null;
  for (const c of candidates) {
    // Break ties toward the record's own season, so an episode that exists under
    // both a season and Specials resolves the unsurprising way.
    const score =
      similarity(guess, c.normalized) + (c.seasonNumber === record.seasonNumber ? 0.001 : 0);
    if (!best || score > best.score) best = { ...c, score };
  }

  if (!best || best.score < SUGGEST_THRESHOLD) {
    return { proposal: null, note: "No confident match." };
  }
  // Compare against where the record's metadata already comes from, so a row
  // that's right (linked or not) isn't offered as a change.
  const sourceSeason = record.sourceSeason ?? record.seasonNumber;
  const sourceEpisode = record.sourceEpisode ?? record.episodeNumber;
  if (best.seasonNumber === sourceSeason && best.episodeNumber === sourceEpisode) {
    return { proposal: null, note: "Already correct." };
  }
  return { proposal: best, note: null };
}

/**
 * Propose a TMDB episode for every record of a show by comparing filenames to
 * episode titles across **all** seasons, Specials included. Nothing is applied —
 * the panel renders these for review, because a heuristic that silently rewrote
 * a library would be far worse than one that occasionally proposes nothing.
 */
export async function suggestEpisodeLinks(showId: number): Promise<EpisodeSuggestion[]> {
  const show = showById(showId);
  if (!show) return [];

  const details = await getShowDetails(show.tmdbId);
  const seasonNumbers = (details.seasons ?? []).map((s) => s.season_number);
  const fetchSeason = seasonFetcher(show.tmdbId);

  const candidates: Candidate[] = [];
  for (const n of seasonNumbers) {
    for (const e of await fetchSeason(n)) {
      candidates.push({
        seasonNumber: n,
        episodeNumber: e.episode_number,
        name: e.name,
        airDate: e.air_date,
        stillPath: e.still_path,
        score: 0,
        normalized: normalizeTitle(e.name ?? ""),
      });
    }
  }

  const suggestions: EpisodeSuggestion[] = listShowEpisodeRecords(showId).map((record) => ({
    episodeId: record.id,
    seasonNumber: record.seasonNumber,
    episodeNumber: record.episodeNumber,
    fileName: basename(record.filePath),
    currentName: record.name,
    linked: record.sourceSeason != null && record.sourceEpisode != null,
    ...proposeFor(record, candidates),
  }));

  // Two files claiming one TMDB episode is legal (the link is an annotation, not
  // an identity) but is usually a mis-suggestion, so flag it for review.
  const counts = new Map<string, number>();
  for (const s of suggestions) {
    if (!s.proposal) continue;
    const key = label(s.proposal.seasonNumber, s.proposal.episodeNumber);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const s of suggestions) {
    if (!s.proposal) continue;
    const key = label(s.proposal.seasonNumber, s.proposal.episodeNumber);
    if ((counts.get(key) ?? 0) > 1) s.note = `Also proposed for another file (${key}).`;
  }

  return suggestions;
}

/** Apply a reviewed batch of links, reindexing once at the end rather than per row. */
export async function applyEpisodeLinks(
  links: { episodeId: number; seasonNumber: number; episodeNumber: number }[],
): Promise<RetagResult> {
  if (links.length === 0) return { ok: false, message: "Nothing selected." };

  const fetchers = new Map<number, ReturnType<typeof seasonFetcher>>();
  let applied = 0;
  const failures: string[] = [];

  for (const link of links) {
    const ctx = episodeContext(link.episodeId);
    if (!ctx) {
      failures.push(`#${link.episodeId} no longer exists`);
      continue;
    }
    let fetchSeason = fetchers.get(ctx.showTmdbId);
    if (!fetchSeason) {
      fetchSeason = seasonFetcher(ctx.showTmdbId);
      fetchers.set(ctx.showTmdbId, fetchSeason);
    }
    try {
      const eps = await fetchSeason(link.seasonNumber);
      const meta = eps.find((e) => e.episode_number === link.episodeNumber);
      if (!meta) {
        failures.push(
          `${label(ctx.seasonNumber, ctx.episodeNumber)} → no ${label(link.seasonNumber, link.episodeNumber)} on TMDB`,
        );
        continue;
      }
      writeLink(link.episodeId, meta, link);
      applied += 1;
    } catch (err) {
      failures.push(
        `${label(ctx.seasonNumber, ctx.episodeNumber)} → ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (applied > 0) reindexSearch(db, quiet);

  const tail = failures.length > 0 ? ` ${failures.length} failed: ${failures.join("; ")}.` : "";
  return {
    ok: applied > 0,
    message: `Linked ${applied} episode(s).${tail}`,
  };
}
