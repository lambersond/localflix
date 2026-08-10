"use client";

import Image from "next/image";
import { useCallback, useEffect, useState, useTransition } from "react";

import {
  listTmdbEpisodesAction,
  listTmdbSeasonsAction,
  resolveTmdbEpisodeRefAction,
} from "@/app/actions/admin";
import type { TmdbEpisode, TmdbSeasonSummary } from "@/lib/tmdb";
import { tmdbImage } from "@/lib/tmdb-image";

const INPUT_CLASS =
  "w-full min-w-0 rounded bg-black/40 px-3 py-2 text-sm outline-none ring-1 ring-white/15 focus:ring-white/40";
const BUTTON_CLASS =
  "rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent/80 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";
const ROW_BUTTON_CLASS =
  "shrink-0 rounded px-2 py-1 text-xs font-medium text-muted ring-1 ring-white/20 transition hover:bg-white/5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";

interface TmdbEpisodePickerProps {
  tmdbShowId: number;
  /** Season to open on — the record's own season, so the likely match is in view. */
  defaultSeason: number;
  /** True while the parent applies a choice (disables the buttons). */
  applying: boolean;
  onApply: (seasonNumber: number, episodeNumber: number, label: string) => void;
}

/**
 * Pick one TMDB episode for a local record. Season 0 (Specials) is listed like
 * any other season — it is where episodes that never aired in broadcast order
 * live, so excluding it would hide the matches this tool exists to find.
 */
export default function TmdbEpisodePicker({
  tmdbShowId,
  defaultSeason,
  applying,
  onApply,
}: Readonly<TmdbEpisodePickerProps>) {
  const [seasons, setSeasons] = useState<TmdbSeasonSummary[] | null>(null);
  const [season, setSeason] = useState(defaultSeason);
  const [episodes, setEpisodes] = useState<TmdbEpisode[] | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [ref, setRef] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();

  useEffect(() => {
    startLoad(async () => {
      const res = await listTmdbSeasonsAction(tmdbShowId);
      if ("error" in res) setError(res.error);
      else setSeasons(res.seasons);
    });
  }, [tmdbShowId]);

  const loadEpisodes = useCallback(
    (n: number) => {
      startLoad(async () => {
        const res = await listTmdbEpisodesAction(tmdbShowId, n);
        if ("error" in res) {
          setError(res.error);
          setEpisodes(null);
        } else {
          setError(null);
          setEpisodes(res.episodes);
        }
      });
    },
    [tmdbShowId],
  );

  useEffect(() => {
    loadEpisodes(season);
  }, [loadEpisodes, season]);

  function onResolveRef(event: React.FormEvent) {
    event.preventDefault();
    if (!ref.trim()) return;
    startLoad(async () => {
      const parsed = await resolveTmdbEpisodeRefAction(ref);
      if (!parsed) {
        setError("Paste a themoviedb.org episode link, or type S01E02.");
        return;
      }
      setError(null);
      // Jump to that season and mark the episode; the operator still confirms,
      // so a mistyped link can't silently rewrite a record.
      setHighlight(parsed.episodeNumber);
      setSeason(parsed.seasonNumber);
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded bg-black/20 p-3">
      <form onSubmit={onResolveRef} className="flex gap-2">
        <input
          className={INPUT_CLASS}
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="Paste a TMDB episode link (…/tv/1437/season/1/episode/11), or S01E11"
          aria-label="TMDB episode link"
        />
        <button type="submit" className={BUTTON_CLASS} disabled={loading || !ref.trim()}>
          Go
        </button>
      </form>

      <label className="flex items-center gap-2 text-xs text-muted">
        Season
        <select
          className="rounded bg-black/40 px-2 py-1 text-xs text-foreground outline-none ring-1 ring-white/15 focus:ring-white/40"
          value={season}
          onChange={(e) => {
            setHighlight(null);
            setSeason(Number(e.target.value));
          }}
        >
          {(seasons ?? [{ season_number: season, name: null, episode_count: 0, air_date: null }]).map(
            (s) => (
              <option key={s.season_number} value={s.season_number}>
                {s.name ?? `Season ${s.season_number}`}
                {s.episode_count ? ` (${s.episode_count})` : ""}
              </option>
            ),
          )}
        </select>
      </label>

      {error && <p className="text-sm text-accent">{error}</p>}
      {loading && <p className="text-xs text-muted">Loading…</p>}

      {episodes && episodes.length === 0 && (
        <p className="text-xs text-muted">TMDB lists no episodes for this season.</p>
      )}

      {episodes && episodes.length > 0 && (
        <ul className="flex max-h-72 flex-col divide-y divide-white/10 overflow-auto rounded bg-black/30">
          {episodes.map((e) => {
            const still = tmdbImage(e.still_path);
            return (
              <li
                key={e.episode_number}
                className={`flex items-start gap-3 p-2 ${
                  highlight === e.episode_number ? "bg-white/10" : ""
                }`}
              >
                <div className="relative aspect-video w-20 shrink-0 overflow-hidden rounded bg-white/10">
                  {still && <Image src={still} alt="" fill sizes="80px" className="object-cover" />}
                </div>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {e.episode_number}. {e.name ?? "(untitled)"}
                  </span>
                  {e.air_date && <span className="block text-[11px] text-muted">{e.air_date}</span>}
                  {e.overview && (
                    <span className="mt-0.5 line-clamp-2 block text-[11px] text-muted/80">
                      {e.overview}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className={ROW_BUTTON_CLASS}
                  disabled={applying}
                  onClick={() =>
                    onApply(
                      season,
                      e.episode_number,
                      `S${season}:E${e.episode_number} ${e.name ?? "(untitled)"}`,
                    )
                  }
                >
                  Use this
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
