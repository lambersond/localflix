"use client";

import { useState, useTransition } from "react";

import { submitReportAction } from "@/app/actions/reports";

interface ReportButtonProps {
  mediaType: "movie" | "show";
  mediaId: number;
}

/** Detail-page affordance to flag a title as the wrong metadata (optional note). */
export default function ReportButton({ mediaType, mediaId }: Readonly<ReportButtonProps>) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (done) {
    return (
      <p className="text-sm text-green-400">✓ Reported — thanks, an admin will take a look.</p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-sm text-muted underline-offset-2 transition hover:text-foreground hover:underline"
      >
        ⚑ Report incorrect
      </button>
    );
  }

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await submitReportAction(mediaType, mediaId, note);
      if (res.ok) setDone(true);
      else setError(res.message);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-2 rounded-lg bg-surface/50 p-3">
      <p className="text-sm font-medium text-foreground">Report this as the wrong title</p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={500}
        placeholder="What's actually here? (optional)"
        aria-label="What's actually here (optional)"
        className="w-full rounded bg-black/40 px-3 py-2 text-sm outline-none ring-1 ring-white/15 focus:ring-white/40"
      />
      {error && <p className="text-sm text-accent">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-accent px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-accent/80 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Submitting…" : "Submit report"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="rounded px-4 py-1.5 text-sm text-muted ring-1 ring-white/20 transition hover:bg-white/5"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
