"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import {
  assignUntrackedMatchAction,
  findBrokenLinksAction,
  findUntrackedFilesAction,
  listOpenReportsAction,
  matchMovieToTvAction,
  rematchTitleAction,
  removeBrokenLinksAction,
  resolveReportAction,
  searchLibraryTitlesAction,
  setAutoScanEnabledAction,
  setCacheArtworkOnScanAction,
  setIncludeNonPlayableAction,
  triggerArtworkAction,
  triggerScanAction,
  triggerTranscodeAction,
} from "@/app/actions/admin";
import type { BrokenLink, LibraryMatch, OpenReport } from "@/db/queries";
import { tmdbImage } from "@/lib/tmdb-image";
import type { UntrackedFile, UntrackedReason, UntrackedResult } from "@/lib/untracked";

import MovieVersionsEditor from "./MovieVersionsEditor";
import TmdbMatchPicker from "./TmdbMatchPicker";

const UNTRACKED_LABEL: Record<UntrackedReason, string> = {
  "no-match": "No match",
  "non-playable": "Non-playable",
  "no-episode-number": "No SxxEyy",
};

const BUTTON_CLASS =
  "rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent/80 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_BUTTON_CLASS =
  "shrink-0 rounded px-2 py-1 text-xs font-medium text-muted ring-1 ring-white/20 transition hover:bg-white/5 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50";
const INPUT_CLASS =
  "w-full min-w-0 rounded bg-black/40 px-3 py-2 text-sm outline-none ring-1 ring-white/15 focus:ring-white/40";
const CHECKBOX_LABEL_CLASS = "flex items-center gap-2 text-sm text-muted cursor-pointer";
const CHIP_CLASS =
  "shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted";

/** Seed the TMDB search box from a file/folder name (client-side, best-effort). */
function fileStem(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  return base
    .replace(/\.[^.]+$/, "")
    .replace(/[._]+/g, " ")
    .trim();
}

/** A movie title guess: the stem cut before the first release year (unless it leads). */
function movieGuess(path: string): string {
  const stem = fileStem(path);
  const m = /\b(?:19|20)\d{2}\b/.exec(stem);
  return (m && m.index > 0 ? stem.slice(0, m.index) : stem).trim();
}

/** A show name guess: the folder directly under shows/ or tv/. */
function showGuess(path: string): string {
  const parts = path.split(/[/\\]/);
  const i = parts.findIndex((p) => p.toLowerCase() === "shows" || p.toLowerCase() === "tv");
  return i >= 0 && parts[i + 1] ? parts[i + 1] : fileStem(path);
}

interface JobRunRow {
  id: number;
  kind: string;
  status: "running" | "success" | "error";
  startedAt: string | null;
  finishedAt: string | null;
  summary: string | null;
}

interface CurrentJob {
  kind: "scan" | "transcode" | "artwork";
  status: "running" | "success" | "error";
  startedAt: string;
  finishedAt: string | null;
  log: string[];
  summary: string | null;
}

export interface AdminStatus {
  current: CurrentJob | null;
  lastScan: JobRunRow | null;
  lastTranscode: JobRunRow | null;
  lastArtwork: JobRunRow | null;
  nonPlayable: number;
  includeNonPlayable: boolean;
  artwork: { referenced: number; cached: number };
  cacheArtworkOnScan: boolean;
  autoScanEnabled: boolean;
  libraryTotal: number;
  nextScanAt: number | null;
  openReports: number;
}

const KIND_LABEL: Record<"scan" | "transcode" | "artwork", string> = {
  scan: "Scan",
  transcode: "Convert",
  artwork: "Artwork",
};

function fmt(ts: string | number | null): string {
  if (ts === null) return "never";
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? "never" : d.toLocaleString();
}

function LastRun({ label, run }: Readonly<{ label: string; run: JobRunRow | null }>) {
  if (!run) return <p className="text-sm text-muted">{label}: never run</p>;
  const color =
    run.status === "success"
      ? "text-green-400"
      : run.status === "error"
        ? "text-accent"
        : "text-yellow-400";
  return (
    <p className="text-sm text-muted">
      {label}: {fmt(run.finishedAt ?? run.startedAt)} —{" "}
      <span className={color}>{run.status}</span>
      {run.summary ? ` (${run.summary})` : ""}
    </p>
  );
}

export default function AdminPanel({ initial }: Readonly<{ initial: AdminStatus }>) {
  const [status, setStatus] = useState<AdminStatus>(initial);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [deleteOriginals, setDeleteOriginals] = useState(false);
  const [scanOnlyNew, setScanOnlyNew] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  // Broken-links review flow: null = not yet checked, [] = checked & all present.
  const [broken, setBroken] = useState<BrokenLink[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const brokenKey = (b: BrokenLink) => `${b.kind}-${b.id}`;

  // Untracked-files diagnostic: null = not yet checked.
  const [untracked, setUntracked] = useState<UntrackedResult | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/status", { cache: "no-store" });
      if (res.ok) setStatus(await res.json());
    } catch {
      // transient; next tick retries
    }
  }, []);

  const running = status.current?.status === "running";

  useEffect(() => {
    // Poll faster while a job runs, slower when idle.
    const interval = setInterval(refresh, running ? 2000 : 8000);
    return () => clearInterval(interval);
  }, [refresh, running]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [status.current?.log]);

  function run(action: () => Promise<{ started: boolean; message: string }>) {
    startTransition(async () => {
      const result = await action();
      setMessage(result.message);
      await refresh();
    });
  }

  function onToggleInclude(value: boolean) {
    setStatus((s) => ({ ...s, includeNonPlayable: value })); // optimistic
    startTransition(async () => {
      await setIncludeNonPlayableAction(value);
      await refresh();
    });
  }

  function onToggleArtwork(value: boolean) {
    setStatus((s) => ({ ...s, cacheArtworkOnScan: value })); // optimistic
    startTransition(async () => {
      await setCacheArtworkOnScanAction(value);
      await refresh();
    });
  }

  function onToggleAutoScan(value: boolean) {
    setStatus((s) => ({ ...s, autoScanEnabled: value })); // optimistic
    startTransition(async () => {
      await setAutoScanEnabledAction(value);
      await refresh();
    });
  }

  function onFindBroken() {
    startTransition(async () => {
      const found = await findBrokenLinksAction();
      setBroken(found);
      setSelected(new Set(found.map(brokenKey))); // default: all selected
    });
  }

  function onFindUntracked() {
    startTransition(async () => {
      setUntracked(await findUntrackedFilesAction());
    });
  }

  function toggleOne(key: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked && broken ? new Set(broken.map(brokenKey)) : new Set());
  }

  function onRemoveSelected() {
    if (!broken) return;
    const items = broken
      .filter((b) => selected.has(brokenKey(b)))
      .map((b) => ({ kind: b.kind, id: b.id }));
    if (items.length === 0) return;
    if (!window.confirm(`Remove ${items.length} selected item(s)? This can't be undone.`)) {
      return;
    }
    startTransition(async () => {
      const r = await removeBrokenLinksAction(items);
      const parts = [
        r.removedMovies > 0 ? `${r.removedMovies} movie(s)` : null,
        r.removedEpisodes > 0 ? `${r.removedEpisodes} episode(s)` : null,
        r.prunedShows > 0 ? `${r.prunedShows} empty show(s)` : null,
        r.prunedSeasons > 0 ? `${r.prunedSeasons} empty season(s)` : null,
      ].filter(Boolean);
      const removed = parts.length > 0 ? `Removed ${parts.join(", ")}.` : "Nothing removed.";
      const skipped =
        r.skippedReappeared > 0
          ? ` ${r.skippedReappeared} item(s) skipped — their file reappeared.`
          : "";
      setMessage(removed + skipped);
      setBroken(null);
      setSelected(new Set());
      await refresh();
    });
  }

  // Manual TMDB re-matching (untracked "assign" + tracked "re-match").
  const [applying, setApplying] = useState(false);
  const [matchPath, setMatchPath] = useState<string | null>(null); // open untracked picker
  // Per-row result of an untracked "Use this" apply, shown inline by the picker.
  const [assignResult, setAssignResult] = useState<{
    path: string;
    ok: boolean;
    message: string;
  } | null>(null);
  const [libQuery, setLibQuery] = useState("");
  const [libResults, setLibResults] = useState<LibraryMatch[] | null>(null);
  const [libSearching, startLibSearch] = useTransition();
  const [fixKey, setFixKey] = useState<string | null>(null); // open re-match picker
  const [tvKey, setTvKey] = useState<string | null>(null); // open match-to-TV picker
  const [versionsKey, setVersionsKey] = useState<string | null>(null); // open versions editor
  const libKey = (m: LibraryMatch) => `${m.kind}-${m.id}`;
  const [reports, setReports] = useState<OpenReport[] | null>(null);

  function onAssignUntracked(file: UntrackedFile, tmdbId: number) {
    setApplying(true);
    setAssignResult(null);
    startTransition(async () => {
      const res = await assignUntrackedMatchAction({
        path: file.path,
        area: file.area,
        tmdbId,
      });
      setApplying(false);
      setMessage(res.message);
      setAssignResult({ path: file.path, ok: res.ok, message: res.message });
      if (res.ok) {
        setMatchPath(null);
        setUntracked(await findUntrackedFilesAction()); // drop the now-tracked file
        await refresh();
      }
    });
  }

  function onSearchLibrary(event: React.FormEvent) {
    event.preventDefault();
    if (!libQuery.trim()) return;
    startLibSearch(async () => {
      setLibResults(await searchLibraryTitlesAction(libQuery));
    });
  }

  function onRematch(match: LibraryMatch, tmdbId: number, label: string) {
    if (
      !window.confirm(
        `Replace metadata for "${match.title}" with "${label}"? This removes the current record — including watch progress — and re-imports as the chosen title.`,
      )
    ) {
      return;
    }
    setApplying(true);
    startTransition(async () => {
      const res = await rematchTitleAction({ kind: match.kind, id: match.id, tmdbId });
      setApplying(false);
      setMessage(res.message);
      if (res.ok) {
        setFixKey(null);
        setLibResults(await searchLibraryTitlesAction(libQuery)); // reflect the new title
        await refresh();
      }
    });
  }

  function onMatchToTv(match: LibraryMatch, tmdbTvId: number, label: string) {
    if (
      !window.confirm(
        `Replace this movie's metadata with the TV entry "${label}"? It stays one playable item and keeps your watch progress.`,
      )
    ) {
      return;
    }
    setApplying(true);
    startTransition(async () => {
      const res = await matchMovieToTvAction({ movieId: match.id, tmdbTvId });
      setApplying(false);
      setMessage(res.message);
      if (res.ok) {
        setTvKey(null);
        setLibResults(await searchLibraryTitlesAction(libQuery));
        await refresh();
      }
    });
  }

  function onViewReports() {
    startTransition(async () => {
      setReports(await listOpenReportsAction());
    });
  }

  function onResolveReport(id: number) {
    startTransition(async () => {
      await resolveReportAction(id);
      setReports((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
      await refresh();
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {message && (
        <p className="rounded bg-surface/70 px-4 py-2 text-sm text-foreground">{message}</p>
      )}

      {/* Library scan */}
      <section className="flex flex-col gap-3 rounded-lg bg-surface/50 p-5">
        <h2 className="text-lg font-semibold">Library scan</h2>
        <LastRun label="Last scan" run={status.lastScan} />
        <p className="text-sm text-muted">
          Next scheduled scan: {status.nextScanAt ? fmt(status.nextScanAt) : "disabled"}
        </p>
        <label className={CHECKBOX_LABEL_CLASS}>
          <input
            type="checkbox"
            className="cursor-pointer"
            checked={status.autoScanEnabled}
            onChange={(e) => onToggleAutoScan(e.target.checked)}
          />
          Run automatic daily scans
        </label>
        <label className={CHECKBOX_LABEL_CLASS}>
          <input
            type="checkbox"
            className="cursor-pointer"
            checked={scanOnlyNew}
            onChange={(e) => setScanOnlyNew(e.target.checked)}
          />
          Only new files (skip titles already in the library)
        </label>
        <div>
          <button
            type="button"
            disabled={pending || running}
            onClick={() => run(() => triggerScanAction(scanOnlyNew))}
            className={BUTTON_CLASS}
          >
            Scan now
          </button>
        </div>
      </section>

      {/* Transcode / convert */}
      <section className="flex flex-col gap-3 rounded-lg bg-surface/50 p-5">
        <h2 className="text-lg font-semibold">Convert for playback</h2>
        <p className="text-sm text-muted">
          {status.nonPlayable === 0
            ? "All library files are browser-playable."
            : `${status.nonPlayable} file(s) need converting to MP4.`}
        </p>
        <LastRun label="Last convert" run={status.lastTranscode} />
        <label className={CHECKBOX_LABEL_CLASS}>
          <input
            type="checkbox"
            className="cursor-pointer"
            checked={deleteOriginals}
            onChange={(e) => setDeleteOriginals(e.target.checked)}
          />
          Delete originals after a successful convert
        </label>
        <div>
          <button
            type="button"
            disabled={pending || running || status.nonPlayable === 0}
            onClick={() => run(() => triggerTranscodeAction(deleteOriginals))}
            className={BUTTON_CLASS}
          >
            Convert all
          </button>
        </div>
      </section>

      {/* Artwork (offline) */}
      <section className="flex flex-col gap-3 rounded-lg bg-surface/50 p-5">
        <h2 className="text-lg font-semibold">Artwork (offline)</h2>
        <p className="text-sm text-muted">
          {status.artwork.cached >= status.artwork.referenced
            ? `All ${status.artwork.referenced} artwork file(s) cached locally.`
            : `${status.artwork.cached} / ${status.artwork.referenced} artwork file(s) cached locally.`}
        </p>
        <LastRun label="Last cache" run={status.lastArtwork} />
        <label className={CHECKBOX_LABEL_CLASS}>
          <input
            type="checkbox"
            className="cursor-pointer"
            checked={status.cacheArtworkOnScan}
            onChange={(e) => onToggleArtwork(e.target.checked)}
          />
          Download artwork during scan
        </label>
        <div>
          <button
            type="button"
            disabled={pending || running || status.artwork.cached >= status.artwork.referenced}
            onClick={() => run(triggerArtworkAction)}
            className={BUTTON_CLASS}
          >
            Cache artwork now
          </button>
        </div>
      </section>

      {/* Settings */}
      <section className="flex flex-col gap-3 rounded-lg bg-surface/50 p-5">
        <h2 className="text-lg font-semibold">Settings</h2>
        <label className="flex items-center gap-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="cursor-pointer"
            checked={status.includeNonPlayable}
            onChange={(e) => onToggleInclude(e.target.checked)}
          />
          <span>
            Include non-playable files when scanning
            <span className="block text-xs text-muted">
              When off, files browsers can&apos;t play natively are skipped during a scan.
            </span>
          </span>
        </label>
      </section>

      {/* Broken media links */}
      <section className="flex flex-col gap-3 rounded-lg bg-surface/50 p-5">
        <h2 className="text-lg font-semibold">Broken media links</h2>
        <p className="text-sm text-muted">
          Find library entries whose file is missing from disk, then remove the ones you choose.
        </p>
        <div>
          <button
            type="button"
            disabled={pending || running}
            onClick={onFindBroken}
            className={BUTTON_CLASS}
          >
            Find broken links
          </button>
        </div>

        {broken !== null && broken.length === 0 && (
          <p className="text-sm text-green-400">No broken links — every file is present.</p>
        )}

        {broken !== null && broken.length > 0 && (
          <div className="flex flex-col gap-3">
            {status.libraryTotal > 0 && broken.length >= status.libraryTotal && (
              <p className="rounded bg-yellow-500/10 px-3 py-2 text-sm text-yellow-400">
                Every library file is unreachable — is the media share mounted? Removing now would
                clear the whole library.
              </p>
            )}

            <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
              <input
                type="checkbox"
                className="cursor-pointer"
                checked={selected.size === broken.length}
                onChange={(e) => toggleAll(e.target.checked)}
              />
              Select all ({broken.length})
            </label>

            <ul className="flex flex-col divide-y divide-white/10 overflow-hidden rounded bg-black/30">
              {broken.map((b) => {
                const key = brokenKey(b);
                return (
                  <li key={key}>
                    <label className="flex cursor-pointer items-start gap-3 p-3 transition hover:bg-white/5">
                      <input
                        type="checkbox"
                        className="mt-1 cursor-pointer"
                        checked={selected.has(key)}
                        onChange={(e) => toggleOne(key, e.target.checked)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                            {b.kind}
                          </span>
                          <span className="truncate text-sm font-medium text-foreground">
                            {b.title}
                          </span>
                        </span>
                        {b.subtitle && (
                          <span className="block text-xs text-muted">{b.subtitle}</span>
                        )}
                        <span className="block truncate font-mono text-[11px] text-muted/70">
                          {b.filePath}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <div>
              <button
                type="button"
                disabled={pending || running || selected.size === 0}
                onClick={onRemoveSelected}
                className={BUTTON_CLASS}
              >
                Remove selected ({selected.size})
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Untracked files (on disk, no DB record) */}
      <section className="flex flex-col gap-3 rounded-lg bg-surface/50 p-5">
        <h2 className="text-lg font-semibold">Untracked files</h2>
        <p className="text-sm text-muted">
          Find video files under MEDIA_DIR that have no library record — titles that failed to import.
        </p>
        <div>
          <button
            type="button"
            disabled={pending || running}
            onClick={onFindUntracked}
            className={BUTTON_CLASS}
          >
            Find untracked files
          </button>
        </div>

        {untracked !== null && untracked.discovered === 0 && (
          <p className="rounded bg-yellow-500/10 px-3 py-2 text-sm text-yellow-400">
            No media files found under MEDIA_DIR — is the share mounted?
          </p>
        )}

        {untracked !== null && untracked.discovered > 0 && untracked.files.length === 0 && (
          <p className="text-sm text-green-400">Every media file is tracked.</p>
        )}

        {untracked !== null && untracked.files.length > 0 && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              {untracked.files.length} untracked file(s). Fix filenames or transcode, then run{" "}
              <span className="font-medium text-foreground">Scan now</span> with{" "}
              <span className="font-medium text-foreground">Only new files</span> checked.
            </p>
            <ul className="flex max-h-96 flex-col divide-y divide-white/10 overflow-auto rounded bg-black/30">
              {untracked.files.map((u) => (
                <li key={u.path} className="flex flex-col gap-2 p-3">
                  <div className="flex items-start gap-3">
                    <span className={CHIP_CLASS}>{UNTRACKED_LABEL[u.reason]}</span>
                    <span className="min-w-0 flex-1 break-all font-mono text-[11px] text-foreground/80">
                      {u.path}
                    </span>
                    {u.reason === "no-match" && (
                      <button
                        type="button"
                        className={SECONDARY_BUTTON_CLASS}
                        disabled={applying}
                        onClick={() => {
                          setMatchPath(matchPath === u.path ? null : u.path);
                          setAssignResult(null);
                        }}
                      >
                        {matchPath === u.path ? "Cancel" : "Find match"}
                      </button>
                    )}
                  </div>
                  {matchPath === u.path && (
                    <TmdbMatchPicker
                      kind={u.area}
                      defaultQuery={u.area === "show" ? showGuess(u.path) : movieGuess(u.path)}
                      applying={applying}
                      onApply={(tmdbId) => onAssignUntracked(u, tmdbId)}
                    />
                  )}
                  {assignResult?.path === u.path && !assignResult.ok && (
                    <p className="text-sm text-accent">{assignResult.message}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Fix metadata (re-match a tracked title to the correct TMDB entry) */}
      <section className="flex flex-col gap-3 rounded-lg bg-surface/50 p-5">
        <h2 className="text-lg font-semibold">Fix metadata</h2>
        <p className="text-sm text-muted">
          Search your library for a title with the wrong metadata, then re-match it to the correct
          TMDB entry.
        </p>
        <form onSubmit={onSearchLibrary} className="flex gap-2">
          <input
            className={INPUT_CLASS}
            value={libQuery}
            onChange={(e) => setLibQuery(e.target.value)}
            placeholder="Search your library by title…"
            aria-label="Library title search"
          />
          <button
            type="submit"
            className={BUTTON_CLASS}
            disabled={libSearching || !libQuery.trim()}
          >
            {libSearching ? "Searching…" : "Search library"}
          </button>
        </form>

        {libResults !== null && libResults.length === 0 && (
          <p className="text-sm text-muted">No tracked titles match.</p>
        )}

        {libResults && libResults.length > 0 && (
          <ul className="flex flex-col divide-y divide-white/10 overflow-hidden rounded bg-black/30">
            {libResults.map((m) => {
              const key = libKey(m);
              const poster = tmdbImage(m.posterPath);
              return (
                <li key={key} className="flex flex-col gap-2 p-3">
                  <div className="flex items-start gap-3">
                    <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded bg-white/10">
                      {poster && (
                        <Image src={poster} alt="" fill sizes="44px" className="object-cover" />
                      )}
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={CHIP_CLASS}>{m.kind}</span>
                        <span className="truncate text-sm font-medium text-foreground">
                          {m.title}
                          {m.year ? ` (${m.year})` : ""}
                        </span>
                      </span>
                      {m.filePath && (
                        <span className="mt-0.5 block truncate font-mono text-[11px] text-muted/70">
                          {m.filePath}
                        </span>
                      )}
                    </span>
                    <div className="flex shrink-0 gap-2">
                      {m.kind === "movie" && (
                        <button
                          type="button"
                          className={SECONDARY_BUTTON_CLASS}
                          disabled={applying}
                          onClick={() => {
                            setTvKey(tvKey === key ? null : key);
                            setFixKey(null);
                            setVersionsKey(null);
                          }}
                          title="Pull metadata from a TMDB TV entry, keeping it one item"
                        >
                          {tvKey === key ? "Cancel" : "Match to TV"}
                        </button>
                      )}
                      {m.kind === "movie" && (
                        <button
                          type="button"
                          className={SECONDARY_BUTTON_CLASS}
                          disabled={applying}
                          onClick={() => {
                            setVersionsKey(versionsKey === key ? null : key);
                            setFixKey(null);
                            setTvKey(null);
                          }}
                          title="Manage multiple files (resolutions / cuts) for this movie"
                        >
                          {versionsKey === key ? "Cancel" : "Versions"}
                        </button>
                      )}
                      <button
                        type="button"
                        className={SECONDARY_BUTTON_CLASS}
                        disabled={applying}
                        onClick={() => {
                          setFixKey(fixKey === key ? null : key);
                          setTvKey(null);
                          setVersionsKey(null);
                        }}
                      >
                        {fixKey === key ? "Cancel" : "Re-match"}
                      </button>
                    </div>
                  </div>
                  {fixKey === key && (
                    <TmdbMatchPicker
                      kind={m.kind}
                      defaultQuery={m.title}
                      applying={applying}
                      onApply={(tmdbId, label) => onRematch(m, tmdbId, label)}
                    />
                  )}
                  {tvKey === key && (
                    <TmdbMatchPicker
                      kind="show"
                      defaultQuery={m.title}
                      applying={applying}
                      onApply={(tmdbTvId, label) => onMatchToTv(m, tmdbTvId, label)}
                    />
                  )}
                  {versionsKey === key && <MovieVersionsEditor movieId={m.id} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Reported items (viewer-flagged incorrect metadata) */}
      <section className="flex flex-col gap-3 rounded-lg bg-surface/50 p-5">
        <h2 className="text-lg font-semibold">
          Reported items{status.openReports > 0 ? ` (${status.openReports})` : ""}
        </h2>
        <p className="text-sm text-muted">
          Titles viewers flagged as incorrect. Fix one with &quot;Match to TV&quot; / &quot;Re-match&quot;
          above, then resolve it.
        </p>
        <div>
          <button
            type="button"
            disabled={pending || running}
            onClick={onViewReports}
            className={BUTTON_CLASS}
          >
            View reports
          </button>
        </div>

        {reports !== null && reports.length === 0 && (
          <p className="text-sm text-green-400">No open reports.</p>
        )}

        {reports !== null && reports.length > 0 && (
          <ul className="flex flex-col divide-y divide-white/10 overflow-hidden rounded bg-black/30">
            {reports.map((r) => (
              <li key={r.id} className="flex items-start gap-3 p-3">
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={CHIP_CLASS}>{r.mediaType}</span>
                    <span className="truncate text-sm font-medium text-foreground">{r.title}</span>
                  </span>
                  {r.note && <span className="mt-0.5 block text-xs text-muted">{r.note}</span>}
                  <span className="mt-0.5 block text-[11px] text-muted/70">{fmt(r.createdAt)}</span>
                </span>
                <button
                  type="button"
                  className={SECONDARY_BUTTON_CLASS}
                  disabled={pending}
                  onClick={() => onResolveReport(r.id)}
                >
                  Resolve
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Live job status */}
      {status.current && (
        <section className="flex flex-col gap-2 rounded-lg bg-surface/50 p-5">
          <h2 className="text-lg font-semibold">
            {KIND_LABEL[status.current.kind]} —{" "}
            <span className={running ? "text-yellow-400" : "text-green-400"}>
              {status.current.status}
            </span>
          </h2>
          <p className="text-xs text-muted">started {fmt(status.current.startedAt)}</p>
          {status.current.log.length > 0 && (
            <pre
              ref={logRef}
              className="max-h-64 overflow-auto rounded bg-black/60 p-3 text-xs text-muted"
            >
              {status.current.log.join("\n")}
            </pre>
          )}
        </section>
      )}
    </div>
  );
}
