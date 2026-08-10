"use client";

import { useState } from "react";

/** One playable file behind a record — the primary, or a movie's extra version. */
export interface RecordFile {
  label: string;
  path: string;
}

export interface RecordEpisode {
  /** The record's own slot, which is what its filename says. */
  season: number;
  episode: number;
  name: string | null;
  fileName: string;
  /** Set when an operator pointed this record at a different TMDB episode. */
  linked: { season: number; episode: number } | null;
}

export interface RecordInfoProps {
  mediaType: "movie" | "show";
  tmdbId: number;
  files: RecordFile[];
  /** Shows only. Omitted entirely for movies. */
  episodes?: RecordEpisode[];
}

const TMDB_BASE = "https://www.themoviedb.org";
const LINK_CLASS = "text-foreground/90 underline underline-offset-2 hover:text-foreground";
const LABEL_CLASS = "text-[11px] font-semibold uppercase tracking-wide text-muted";

function slot(season: number, episode: number): string {
  return `S${season}:E${episode}`;
}

/**
 * What a library record is actually bound to: its TMDB entry and the file(s) it
 * plays. Rendered only for a profile with the "Show record details" flag.
 *
 * The point is to make a bad mapping self-evident without opening /admin —
 * seeing the TMDB title next to the filename is the whole diagnostic, e.g. a row
 * reading "The Train Job" over a file called `S01E01 - Serenity.mp4`.
 */
export default function RecordInfo({
  mediaType,
  tmdbId,
  files,
  episodes,
}: Readonly<RecordInfoProps>) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-sm text-muted underline-offset-2 transition hover:text-foreground hover:underline"
      >
        ⓘ Record details
      </button>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-3 rounded-lg bg-surface/50 p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <p className="font-medium text-foreground">What this record points to</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="shrink-0 text-xs text-muted underline-offset-2 hover:text-foreground hover:underline"
        >
          Hide
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <p className={LABEL_CLASS}>TMDB entry</p>
        <p className="text-foreground/90">
          <span className="font-mono">{tmdbId}</span>{" "}
          <a
            href={`${TMDB_BASE}/${mediaType === "movie" ? "movie" : "tv"}/${tmdbId}`}
            target="_blank"
            rel="noreferrer"
            className={LINK_CLASS}
          >
            open ↗
          </a>
          {mediaType === "movie" ? (
            <>
              {" · "}
              {/* A movie re-matched with the admin "Match to TV" tool stores a TV
                  id here, and nothing records which kind it is — so offer both
                  rather than guess and land on a 404. */}
              <a
                href={`${TMDB_BASE}/tv/${tmdbId}`}
                target="_blank"
                rel="noreferrer"
                className={LINK_CLASS}
              >
                as TV ↗
              </a>
            </>
          ) : null}
        </p>
      </div>

      {files.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className={LABEL_CLASS}>{files.length > 1 ? "Files" : "File"}</p>
          <ul className="flex flex-col gap-0.5">
            {files.map((f) => (
              <li key={f.path} className="flex flex-wrap items-baseline gap-2">
                {files.length > 1 ? (
                  <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                    {f.label}
                  </span>
                ) : null}
                <span className="min-w-0 break-all font-mono text-[11px] text-foreground/80">
                  {f.path}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {episodes && episodes.length > 0 ? (
        <div className="flex flex-col gap-1">
          <p className={LABEL_CLASS}>Episodes ({episodes.length})</p>
          <ul className="flex max-h-96 flex-col divide-y divide-white/10 overflow-auto rounded bg-black/20">
            {episodes.map((ep) => {
              // Link to wherever the metadata actually comes from, so the URL is
              // the one the admin episode picker accepts.
              const source = ep.linked ?? { season: ep.season, episode: ep.episode };
              return (
                <li
                  key={`${ep.season}-${ep.episode}`}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 p-2"
                >
                  <a
                    href={`${TMDB_BASE}/tv/${tmdbId}/season/${source.season}/episode/${source.episode}`}
                    target="_blank"
                    rel="noreferrer"
                    className={`shrink-0 font-mono text-[11px] ${LINK_CLASS}`}
                  >
                    {slot(ep.season, ep.episode)}
                  </a>
                  <span className="text-xs text-foreground/90">
                    {ep.name ?? "— no metadata —"}
                  </span>
                  {ep.linked ? (
                    <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                      linked {slot(ep.linked.season, ep.linked.episode)}
                    </span>
                  ) : null}
                  <span className="w-full break-all font-mono text-[11px] text-muted/70">
                    {ep.fileName}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <p className="text-xs text-muted">
        Wrong title or wrong file? Use <span className="text-foreground">⚑ Report incorrect</span> —
        an admin can re-match it from /admin.
      </p>
    </div>
  );
}
