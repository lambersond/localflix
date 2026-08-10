"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import {
  applyEpisodeLinksAction,
  linkEpisodeAction,
  listShowEpisodesAction,
  suggestEpisodeLinksAction,
  unlinkEpisodeAction,
} from "@/app/actions/admin";
import type { ShowEpisodeAdminView } from "@/db/queries";
import type { EpisodeSuggestion } from "@/lib/episode-link";

import TmdbEpisodePicker from "./TmdbEpisodePicker";

const BTN =
  "shrink-0 rounded px-2 py-1 text-xs font-medium text-muted ring-1 ring-white/20 transition hover:bg-white/5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY_BTN =
  "shrink-0 rounded bg-accent px-3 py-1 text-xs font-semibold text-white transition hover:bg-accent/80 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";
const CHIP =
  "shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted";

function slot(seasonNumber: number, episodeNumber: number): string {
  return `S${seasonNumber}:E${episodeNumber}`;
}

/**
 * Admin editor for a show's episode ↔ TMDB links. An episode's metadata is
 * normally looked up by the number in its filename, which fails for a library in
 * DVD order or a pilot filed as S01E00; here the operator can point any record
 * at a specific TMDB episode, including one in another season (Specials).
 *
 * A link never moves the record — its slot, id and watch progress are untouched.
 */
export default function ShowEpisodesEditor({ showId }: Readonly<{ showId: number }>) {
  const [view, setView] = useState<ShowEpisodeAdminView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [openPicker, setOpenPicker] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const [suggestions, setSuggestions] = useState<EpisodeSuggestion[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    setView(await listShowEpisodesAction(showId));
  }, [showId]);

  useEffect(() => {
    startTransition(async () => {
      await load();
    });
  }, [load]);

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const r = await action();
      setMessage(r.message);
      if (r.ok) {
        setOpenPicker(null);
        setSuggestions(null);
        await load();
      }
    });
  }

  function onSuggest() {
    setMessage(null);
    startTransition(async () => {
      const found = await suggestEpisodeLinksAction(showId);
      setSuggestions(found);
      // Pre-check every proposal; the operator unchecks what's wrong. Nothing is
      // written until Apply, so a bad heuristic can't damage the library.
      setChecked(new Set(found.filter((s) => s.proposal).map((s) => s.episodeId)));
    });
  }

  function onApplySuggestions() {
    const links = (suggestions ?? [])
      .filter((s) => s.proposal && checked.has(s.episodeId))
      .map((s) => ({
        episodeId: s.episodeId,
        seasonNumber: s.proposal!.seasonNumber,
        episodeNumber: s.proposal!.episodeNumber,
      }));
    run(() => applyEpisodeLinksAction(links));
  }

  function toggle(episodeId: number, on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(episodeId);
      else next.delete(episodeId);
      return next;
    });
  }

  if (!view) {
    return (
      <div className="mt-2 rounded bg-black/20 p-3 text-xs text-muted">
        {pending ? "Loading episodes…" : "No episode records for this show."}
      </div>
    );
  }

  const proposalCount = (suggestions ?? []).filter((s) => s.proposal).length;

  return (
    <div className="mt-2 flex flex-col gap-2 rounded bg-black/20 p-3">
      {message && <p className="text-xs text-muted">{message}</p>}

      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs font-medium text-foreground">
          Episodes ({view.episodes.length})
        </p>
        <button type="button" className={BTN} disabled={pending} onClick={onSuggest}>
          Suggest matches
        </button>
      </div>

      {suggestions && (
        <div className="flex flex-col gap-2 rounded bg-black/30 p-2">
          {proposalCount === 0 ? (
            <p className="text-xs text-muted">
              Nothing to change — every record already matches, or no filename was close enough
              to a TMDB episode title.
            </p>
          ) : (
            <>
              <p className="text-xs text-muted">
                {proposalCount} proposed change(s). Review, then apply — nothing is written until
                you do.
              </p>
              <ul className="flex max-h-72 flex-col gap-1 overflow-auto">
                {suggestions.map((s) => (
                  <li key={s.episodeId} className="flex items-start gap-2 text-[11px]">
                    {s.proposal ? (
                      <input
                        type="checkbox"
                        className="mt-0.5 shrink-0"
                        checked={checked.has(s.episodeId)}
                        onChange={(e) => toggle(s.episodeId, e.target.checked)}
                        aria-label={`Link ${slot(s.seasonNumber, s.episodeNumber)}`}
                      />
                    ) : (
                      <span className="w-3 shrink-0" />
                    )}
                    <span className={CHIP}>{slot(s.seasonNumber, s.episodeNumber)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-muted/70">{s.fileName}</span>
                      {s.proposal ? (
                        <span className="block text-foreground/90">
                          → {slot(s.proposal.seasonNumber, s.proposal.episodeNumber)}{" "}
                          {s.proposal.name ?? "(untitled)"}{" "}
                          <span className="text-muted/60">
                            ({Math.round(s.proposal.score * 100)}%)
                          </span>
                        </span>
                      ) : (
                        <span className="block text-muted/70">{s.note}</span>
                      )}
                      {s.proposal && s.note && (
                        <span className="block text-yellow-400/90">{s.note}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <div>
                <button
                  type="button"
                  className={PRIMARY_BTN}
                  disabled={pending || checked.size === 0}
                  onClick={onApplySuggestions}
                >
                  Apply {checked.size} link(s)
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <ul className="flex flex-col gap-1">
        {view.episodes.map((ep) => {
          const linked = ep.sourceSeason != null && ep.sourceEpisode != null;
          return (
            <li key={ep.id} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className={CHIP}>{slot(ep.seasonNumber, ep.episodeNumber)}</span>
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-xs ${
                      ep.name ? "text-foreground" : "text-yellow-400/90"
                    }`}
                  >
                    {ep.name ?? "— no metadata —"}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-muted/70">
                    {ep.filePath.split("/").pop()}
                  </span>
                </span>
                {linked && (
                  <span className={CHIP}>
                    linked {slot(ep.sourceSeason!, ep.sourceEpisode!)}
                  </span>
                )}
                <button
                  type="button"
                  className={BTN}
                  disabled={pending}
                  onClick={() => setOpenPicker(openPicker === ep.id ? null : ep.id)}
                >
                  {openPicker === ep.id ? "Cancel" : "Link"}
                </button>
                {linked && (
                  <button
                    type="button"
                    className={BTN}
                    disabled={pending}
                    onClick={() => run(() => unlinkEpisodeAction(ep.id))}
                  >
                    Unlink
                  </button>
                )}
              </div>
              {openPicker === ep.id && (
                <TmdbEpisodePicker
                  tmdbShowId={view.tmdbShowId}
                  defaultSeason={ep.sourceSeason ?? ep.seasonNumber}
                  applying={pending}
                  onApply={(seasonNumber, episodeNumber) =>
                    run(() => linkEpisodeAction({ episodeId: ep.id, seasonNumber, episodeNumber }))
                  }
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
