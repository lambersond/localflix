"use client";

import { useCallback, useEffect, useState, useTransition } from "react";

import {
  addMovieVersionAction,
  getMovieVersionsAction,
  listMovieVersionCandidatesAction,
  removeMovieVersionAction,
  setPrimaryVersionAction,
} from "@/app/actions/admin";
import type { MovieVersion } from "@/db/queries";
import type { VersionCandidate } from "@/lib/retag";

const BTN =
  "shrink-0 rounded px-2 py-1 text-xs font-medium text-muted ring-1 ring-white/20 transition hover:bg-white/5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";
const INPUT =
  "w-24 min-w-0 rounded bg-black/40 px-2 py-1 text-xs outline-none ring-1 ring-white/15 focus:ring-white/40";
const CHIP =
  "shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted";

/** Admin editor for a movie's file versions: list / add / remove / set-default. */
export default function MovieVersionsEditor({ movieId }: Readonly<{ movieId: number }>) {
  const [versions, setVersions] = useState<MovieVersion[] | null>(null);
  const [candidates, setCandidates] = useState<VersionCandidate[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    const [v, c] = await Promise.all([
      getMovieVersionsAction(movieId),
      listMovieVersionCandidatesAction(movieId),
    ]);
    setVersions(v);
    setCandidates(c);
    setLabels(Object.fromEntries(c.map((f) => [f.path, f.suggestedLabel])));
  }, [movieId]);

  useEffect(() => {
    startTransition(async () => {
      await load();
    });
  }, [load]);

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    startTransition(async () => {
      const r = await action();
      setMessage(r.message);
      if (r.ok) await load();
    });
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded bg-black/20 p-3">
      {message && <p className="text-xs text-muted">{message}</p>}

      <p className="text-xs font-medium text-foreground">Versions</p>
      <ul className="flex flex-col gap-1">
        {(versions ?? []).map((v) => (
          <li key={v.versionId} className="flex items-center gap-2">
            <span className={CHIP}>{v.versionId === 0 ? "Default" : v.label}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted/70">
              {v.filePath}
            </span>
            {v.versionId !== 0 && (
              <>
                <button
                  type="button"
                  className={BTN}
                  disabled={pending}
                  onClick={() => run(() => setPrimaryVersionAction({ movieId, versionId: v.versionId }))}
                >
                  Make default
                </button>
                <button
                  type="button"
                  className={BTN}
                  disabled={pending}
                  onClick={() => run(() => removeMovieVersionAction(v.versionId))}
                >
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-1 text-xs font-medium text-foreground">Add a version</p>
      {candidates.length === 0 ? (
        <p className="text-xs text-muted">No untracked video files in this movie&apos;s folder.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {candidates.map((f) => (
            <li key={f.path} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/80">
                {f.path.split("/").pop()}
              </span>
              <input
                className={INPUT}
                value={labels[f.path] ?? ""}
                onChange={(e) => setLabels((p) => ({ ...p, [f.path]: e.target.value }))}
                aria-label="Version label"
              />
              <button
                type="button"
                className={BTN}
                disabled={pending}
                onClick={() =>
                  run(() =>
                    addMovieVersionAction({ movieId, filePath: f.path, label: labels[f.path] ?? "" }),
                  )
                }
              >
                Add
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
