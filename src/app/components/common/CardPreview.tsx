"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

import type { CardPreview as CardPreviewData } from "@/db/queries";
import { tmdbImage } from "@/lib/tmdb-image";

import WatchlistButton from "../profile/WatchlistButton";

const CARD_W = 320; // expanded width
const IMG_H = 180; // expanded image height (16:9 at CARD_W)
const INFO_H = 160; // fixed info-panel height
const CARD_H = IMG_H + INFO_H; // expanded total height
const MARGIN = 8;
const EXPAND_MS = 300;
const SHRINK_MS = 600;

interface CardPreviewProps {
  anchor: DOMRect;
  data: CardPreviewData | null;
  /** The thumbnail's poster URL, shown immediately and crossfaded to the backdrop. */
  poster: string | null;
  /** Detail-page link — clicking the preview's artwork/title navigates here. */
  href: string;
  /** true = expanded; flip to false to shrink back into the thumbnail. */
  open: boolean;
  /** Called once the shrink animation finishes so the parent can unmount. */
  onClosed: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
  imgHeight: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * The card's geometry in each state. Collapsed == the thumbnail's exact rect with
 * the image filling it (portrait); expanded == the wide preview with a landscape
 * image and the info panel below. Animating between them makes the image reshape
 * and push the info panel down (and out, via the card's overflow clip).
 */
function boxFor(anchor: DOMRect, expanded: boolean): Box {
  if (!expanded) {
    return {
      left: anchor.left,
      top: anchor.top,
      width: anchor.width,
      height: anchor.height,
      imgHeight: anchor.height, // image fills the thumbnail; info is pushed out
    };
  }
  return {
    left: clamp(anchor.left + anchor.width / 2 - CARD_W / 2, MARGIN, window.innerWidth - CARD_W - MARGIN),
    top: clamp(anchor.top + anchor.height / 2 - CARD_H / 2, MARGIN, window.innerHeight - CARD_H - MARGIN),
    width: CARD_W,
    height: CARD_H,
    imgHeight: IMG_H,
  };
}

export default function CardPreview({
  anchor,
  data,
  poster,
  href,
  open,
  onClosed,
  onPointerEnter,
  onPointerLeave,
}: Readonly<CardPreviewProps>) {
  const [expanded, setExpanded] = useState(false);
  // Keep the very first paint (sitting on the thumbnail) instant; only the
  // grow/shrink between states should animate.
  const [transitionOn, setTransitionOn] = useState(false);

  // Grow on open / shrink on close, then notify the parent to unmount once the
  // shrink has finished.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setTransitionOn(true);
      setExpanded(open);
    });
    if (open) return () => cancelAnimationFrame(raf);
    const timer = setTimeout(onClosed, SHRINK_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [open, onClosed]);

  if (typeof document === "undefined") return null;

  const box = boxFor(anchor, expanded);
  const durationMs = expanded ? EXPAND_MS : SHRINK_MS;
  const ease = `${durationMs}ms ease-out`;
  const backdrop = data ? tmdbImage(data.backdropPath ?? data.posterPath) : null;
  const posterImg = poster ?? (data ? tmdbImage(data.posterPath) : null);

  const cardStyle: CSSProperties = {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
    transition: transitionOn
      ? `left ${ease}, top ${ease}, width ${ease}, height ${ease}`
      : "none",
  };

  return createPortal(
    <div
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      style={cardStyle}
      className="fixed z-50 overflow-hidden rounded-lg bg-surface shadow-2xl ring-1 ring-white/10"
    >
      <Link
        href={href}
        aria-label={data ? `View ${data.title}` : "View details"}
        className="relative block w-full overflow-hidden bg-black/40"
        style={{ height: box.imgHeight, transition: transitionOn ? `height ${ease}` : "none" }}
      >
        {backdrop ? (
          <Image src={backdrop} alt="" fill sizes="320px" className="object-cover" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-neutral-700 to-neutral-900" />
        )}
        {/* Poster matches the thumbnail at rest, then crossfades to the backdrop. */}
        {posterImg ? (
          <Image
            src={posterImg}
            alt=""
            fill
            sizes="320px"
            className="object-cover"
            style={{
              opacity: expanded ? 0 : 1,
              transition: transitionOn ? `opacity ${ease}` : "none",
            }}
          />
        ) : null}
      </Link>

      <div className="flex flex-col gap-2 overflow-hidden p-3" style={{ height: INFO_H }}>
        {data ? (
          <>
            <div className="flex items-center gap-2">
              {data.playableId ? (
                <Link
                  href={`/watch/${data.playableId}`}
                  aria-label={`Play ${data.title}`}
                  title={`Play ${data.title}`}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-background transition hover:bg-foreground/80"
                >
                  <span aria-hidden>▶</span>
                </Link>
              ) : null}
              <WatchlistButton
                mediaType={data.mediaType}
                mediaId={data.id}
                initialInList={data.inList}
                variant="compact"
              />
            </div>

            <Link
              href={href}
              className="truncate text-sm font-semibold text-foreground hover:underline"
            >
              {data.title}
            </Link>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
              {data.certification ? (
                <span className="rounded border border-muted/60 px-1.5 py-0.5 font-medium">
                  {data.certification}
                </span>
              ) : null}
              {data.runtime ? <span>{data.runtime}</span> : null}
            </div>

            {data.genres.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {data.genres.map((g) => (
                  <span
                    key={g.id}
                    className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-foreground/90"
                  >
                    {g.name}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex animate-pulse flex-col gap-2">
            <div className="h-9 w-20 rounded-full bg-white/10" />
            <div className="h-4 w-2/3 rounded bg-white/10" />
            <div className="h-3 w-1/2 rounded bg-white/10" />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
