"use client";

import { useState, useTransition } from "react";

import { toggleWatchlist } from "@/app/actions/watchlist";

interface WatchlistButtonProps {
  mediaType: "movie" | "show";
  mediaId: number;
  initialInList: boolean;
  /** "full" = labeled pill (detail pages); "compact" = round icon (preview popover). */
  variant?: "full" | "compact";
}

export default function WatchlistButton({
  mediaType,
  mediaId,
  initialInList,
  variant = "full",
}: Readonly<WatchlistButtonProps>) {
  const [inList, setInList] = useState(initialInList);
  const [pending, startTransition] = useTransition();

  function onClick() {
    setInList((v) => !v); // optimistic
    startTransition(async () => {
      const result = await toggleWatchlist(mediaType, mediaId);
      setInList(result);
    });
  }

  if (variant === "compact") {
    const label = inList ? "Remove from My List" : "Add to My List";
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        aria-pressed={inList}
        aria-label={label}
        title={label}
        className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-lg transition disabled:opacity-60 ${
          inList
            ? "border-white bg-foreground text-background"
            : "border-white/40 bg-black/40 text-white hover:border-white"
        }`}
      >
        <span aria-hidden>{inList ? "✓" : "+"}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      aria-pressed={inList}
      className="inline-flex items-center gap-2 rounded bg-white/20 px-6 py-2.5 font-semibold text-foreground backdrop-blur transition hover:bg-white/30 disabled:opacity-70"
    >
      <span aria-hidden>{inList ? "✓" : "+"}</span>
      {inList ? "My List" : "Add to My List"}
    </button>
  );
}
