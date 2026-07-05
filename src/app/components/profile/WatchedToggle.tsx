"use client";

import { useState, useTransition } from "react";

import { setWatchCompleted } from "@/app/actions/progress";

interface WatchedToggleProps {
  playableId: string;
  initialCompleted: boolean;
  /** "button" = full pill (detail pages); "compact" = small icon (cards/rows). */
  variant?: "button" | "compact";
}

export default function WatchedToggle({
  playableId,
  initialCompleted,
  variant = "button",
}: Readonly<WatchedToggleProps>) {
  const [completed, setCompleted] = useState(initialCompleted);
  const [pending, startTransition] = useTransition();

  function onClick(e: React.MouseEvent) {
    e.preventDefault(); // don't trigger a parent link
    e.stopPropagation();
    const next = !completed;
    setCompleted(next); // optimistic
    startTransition(async () => {
      const result = await setWatchCompleted(playableId, next);
      setCompleted(result);
    });
  }

  if (variant === "compact") {
    const label = completed ? "Mark unwatched" : "Mark as watched";
    return (
      <span className="group/watched relative inline-flex">
        <button
          type="button"
          onClick={onClick}
          disabled={pending}
          aria-pressed={completed}
          aria-label={label}
          className={`flex h-7 w-7 items-center justify-center rounded-full text-sm backdrop-blur transition ${
            completed
              ? "bg-foreground text-background"
              : "bg-black/60 text-white hover:bg-black/80"
          } disabled:opacity-60`}
        >
          ✓
        </button>
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded bg-black/90 px-2 py-1 text-xs text-white opacity-0 transition group-hover/watched:opacity-100"
        >
          {label}
        </span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={completed}
      className="inline-flex items-center gap-2 rounded bg-white/20 px-6 py-2.5 font-semibold text-foreground backdrop-blur transition hover:bg-white/30 disabled:opacity-70"
    >
      <span aria-hidden>✓</span>
      {completed ? "Watched" : "Mark as watched"}
    </button>
  );
}
