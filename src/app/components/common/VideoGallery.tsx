"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { VideoItem } from "@/db/queries";

interface VideoGalleryProps {
  videos: VideoItem[];
  title: string;
}

/**
 * A title's trailers, teasers, clips and other extras. Tiles are thumbnails
 * hotlinked from YouTube; clicking one expands it into a centered player. Only
 * the YouTube id is ever stored — the video itself streams from YouTube, and the
 * iframe isn't mounted until a tile is actually clicked.
 */
export default function VideoGallery({ videos, title }: Readonly<VideoGalleryProps>) {
  const [selected, setSelected] = useState<VideoItem | null>(null);

  const close = () => setSelected(null);

  // While open: Escape closes and body scroll is locked. The scale-in entrance is
  // pure CSS (see globals.css) — the overlay mounts fresh on each open.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [selected]);

  if (videos.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Videos</h2>

      <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
        {videos.map((video) => (
          <button
            key={video.id}
            type="button"
            onClick={() => setSelected(video)}
            className="group w-[240px] shrink-0 text-left transition duration-200 hover:z-10 hover:scale-[1.03]"
          >
            <div className="relative aspect-video w-full overflow-hidden rounded-md bg-surface">
              <Image
                src={`https://i.ytimg.com/vi/${video.youtubeKey}/mqdefault.jpg`}
                alt=""
                fill
                sizes="240px"
                className="object-cover"
              />
              <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition group-hover:opacity-100">
                <span className="text-4xl drop-shadow" aria-hidden>
                  ▶
                </span>
              </div>
              <span className="absolute left-1.5 top-1.5 rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">
                {video.type}
              </span>
            </div>
            <p className="mt-1.5 line-clamp-2 text-xs text-foreground/90">{video.name}</p>
          </button>
        ))}
      </div>

      {selected && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
              {/* The backdrop is itself the dismiss target, so clicking anywhere
                  outside the player closes — no event-propagation juggling. */}
              <button
                type="button"
                aria-label="Close video"
                onClick={close}
                className="animate-fade-in absolute inset-0 h-full w-full cursor-default bg-black/90"
              />

              <div className="animate-expand-in relative z-10 w-full max-w-5xl">
                <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black shadow-2xl">
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${selected.youtubeKey}?autoplay=1&rel=0`}
                    title={`${title} — ${selected.name}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="absolute inset-0 h-full w-full border-0"
                  />
                </div>
                <p className="mt-2 text-sm text-muted">
                  <span className="uppercase tracking-wide">{selected.type}</span> ·{" "}
                  {selected.name}
                </p>
              </div>

              <button
                type="button"
                aria-label="Close video"
                onClick={close}
                className="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-md text-white transition hover:bg-white/10"
              >
                <span aria-hidden className="text-2xl leading-none">
                  ✕
                </span>
              </button>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}
