"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import {
  setCacheArtworkOnScanAction,
  setIncludeNonPlayableAction,
  triggerArtworkAction,
  triggerScanAction,
  triggerTranscodeAction,
} from "@/app/actions/admin";

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
  nextScanAt: number | null;
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
  const logRef = useRef<HTMLPreElement>(null);

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
        <div>
          <button
            type="button"
            disabled={pending || running}
            onClick={() => run(triggerScanAction)}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent/80 disabled:opacity-50"
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
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
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
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent/80 disabled:opacity-50"
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
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
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
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:bg-accent/80 disabled:opacity-50"
          >
            Cache artwork now
          </button>
        </div>
      </section>

      {/* Settings */}
      <section className="flex flex-col gap-3 rounded-lg bg-surface/50 p-5">
        <h2 className="text-lg font-semibold">Settings</h2>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
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
