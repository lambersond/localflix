"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import WatchedToggle from "@/app/components/profile/WatchedToggle";

import ProgressBar from "./ProgressBar";

export interface VersionOption {
  versionId: number;
  label: string;
  /** `m<id>` or `m<id>.v<fileId>` for this version. */
  playableId: string;
  state: "none" | "in_progress" | "completed";
  fraction: number;
  remainingMinutes: number | null;
  completed: boolean;
}

const PRIMARY_BTN =
  "inline-flex items-center gap-2 rounded bg-foreground px-8 py-2.5 font-semibold text-background transition hover:bg-foreground/80";
const SECONDARY_BTN =
  "inline-flex items-center gap-2 rounded bg-white/20 px-6 py-2.5 font-semibold text-foreground backdrop-blur transition hover:bg-white/30";

/**
 * The movie play controls, version-aware. When a title has more than one file
 * (e.g. 1080p / 4K / Unrated) it shows a picker; choosing a version re-points
 * Play/Continue/Restart and the watched toggle at that file, each of which keeps
 * its own resume position.
 */
export default function VersionPicker({
  options,
  defaultVersionId,
  children,
}: Readonly<{ options: VersionOption[]; defaultVersionId: number; children?: ReactNode }>) {
  const [selectedId, setSelectedId] = useState(defaultVersionId);
  const sel = options.find((o) => o.versionId === selectedId) ?? options[0];
  if (!sel) return null;

  return (
    <div className="flex flex-col gap-3">
      {options.length > 1 && (
        <label className="flex w-fit items-center gap-2 text-sm text-muted">
          Version
          <select
            value={sel.versionId}
            onChange={(e) => setSelectedId(Number(e.target.value))}
            className="cursor-pointer rounded bg-black/40 px-3 py-1.5 text-sm text-foreground outline-none ring-1 ring-white/15 focus:ring-white/40"
          >
            {options.map((o) => (
              <option key={o.versionId} value={o.versionId}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="flex flex-wrap gap-3">
        {sel.state === "in_progress" ? (
          <>
            <Link href={`/watch/${sel.playableId}`} className={PRIMARY_BTN}>
              <span aria-hidden>▶</span> Continue
            </Link>
            <Link href={`/watch/${sel.playableId}?restart=1`} className={SECONDARY_BTN}>
              <span aria-hidden>↻</span> Restart
            </Link>
          </>
        ) : sel.state === "completed" ? (
          <Link href={`/watch/${sel.playableId}?restart=1`} className={PRIMARY_BTN}>
            <span aria-hidden>↻</span> Restart
          </Link>
        ) : (
          <Link href={`/watch/${sel.playableId}`} className={PRIMARY_BTN}>
            <span aria-hidden>▶</span> Play
          </Link>
        )}
        {children}
        <WatchedToggle
          key={sel.playableId}
          playableId={sel.playableId}
          initialCompleted={sel.completed}
        />
      </div>

      {sel.state === "in_progress" && (
        <div className="flex max-w-md items-center gap-3">
          <ProgressBar fraction={sel.fraction} className="w-40 overflow-hidden rounded-full" />
          {sel.remainingMinutes !== null ? (
            <span className="text-sm text-muted">{sel.remainingMinutes} min left</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
