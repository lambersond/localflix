"use client";

import Image from "next/image";
import { useState, useTransition } from "react";

import { searchTmdbAction } from "@/app/actions/admin";
import type { TmdbSearchHit } from "@/lib/tmdb";
import { tmdbImage } from "@/lib/tmdb-image";

const INPUT_CLASS =
  "w-full min-w-0 rounded bg-black/40 px-3 py-2 text-sm outline-none ring-1 ring-white/15 focus:ring-white/40";
const BUTTON_CLASS =
  "rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent/80 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";

interface TmdbMatchPickerProps {
  kind: "movie" | "show";
  defaultQuery: string;
  /** True while the parent is applying a chosen match (disables the buttons). */
  applying: boolean;
  onApply: (tmdbId: number, label: string) => void;
}

export default function TmdbMatchPicker({
  kind,
  defaultQuery,
  applying,
  onApply,
}: Readonly<TmdbMatchPickerProps>) {
  const [query, setQuery] = useState(defaultQuery);
  const [hits, setHits] = useState<TmdbSearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();

  function onSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setError(null);
    startSearch(async () => {
      const res = await searchTmdbAction(kind, query);
      if ("error" in res) {
        setError(res.error);
        setHits(null);
      } else {
        setHits(res.hits);
      }
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded bg-black/20 p-3">
      <form onSubmit={onSearch} className="flex gap-2">
        <input
          className={INPUT_CLASS}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${kind === "movie" ? "movies" : "TV"} on TMDB, or paste an id / URL`}
          aria-label="TMDB search"
        />
        <button
          type="submit"
          className={BUTTON_CLASS}
          disabled={searching || applying || !query.trim()}
        >
          {searching ? "Searching…" : "Search TMDB"}
        </button>
      </form>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {hits && hits.length === 0 && <p className="text-sm text-muted">No TMDB results.</p>}

      {hits && hits.length > 0 && (
        <ul className="flex max-h-80 flex-col divide-y divide-white/10 overflow-auto rounded bg-black/30">
          {hits.map((h) => {
            const poster = tmdbImage(h.posterPath);
            const label = `${h.title}${h.year ? ` (${h.year})` : ""}`;
            return (
              <li key={h.id} className="flex items-start gap-3 p-2">
                <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded bg-white/10">
                  {poster ? (
                    <Image src={poster} alt="" fill sizes="44px" className="object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-[9px] text-muted">
                      No art
                    </span>
                  )}
                </div>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{label}</span>
                    {h.voteAverage ? (
                      <span className="shrink-0 text-xs text-muted">★ {h.voteAverage.toFixed(1)}</span>
                    ) : null}
                  </span>
                  {h.overview && (
                    <span className="mt-0.5 line-clamp-2 block text-xs text-muted">{h.overview}</span>
                  )}
                </span>
                <button
                  type="button"
                  className={BUTTON_CLASS}
                  disabled={applying}
                  onClick={() => onApply(h.id, label)}
                >
                  {applying ? "Applying…" : "Use this"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
