"use client";

import { useEffect, useRef, useState } from "react";

import type { CardItem } from "@/db/queries";

import CardHoverLayer from "./CardHoverLayer";
import MediaCard from "./MediaCard";
import { CARD_GAP, CARD_W, OVERSCAN_ROWS, ROW_H } from "./card-metrics";

interface VirtualGridProps {
  items: CardItem[];
  /** Called when the user nears the end (for infinite scroll). */
  onEndReached?: () => void;
}

const cardKey = (item: CardItem) => `${item.mediaType}-${item.id}`;

/**
 * Windowed grid: only the rows near the viewport are mounted, so the DOM /
 * component count stays bounded no matter how far you scroll. Rows have a fixed
 * height (uniform poster cards), which makes the windowing math exact.
 */
export default function VirtualGrid({ items, onEndReached }: Readonly<VirtualGridProps>) {
  const ref = useRef<HTMLDivElement>(null);
  // Render a plain grid for SSR / first paint, then switch to windowed after
  // mount (avoids a hydration mismatch and keeps initial cards in the HTML).
  const [windowed, setWindowed] = useState(false);
  const [cols, setCols] = useState(0);
  const [range, setRange] = useState({ start: 0, end: 0 });

  useEffect(() => {
    const id = requestAnimationFrame(() => setWindowed(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Column count from the container width.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () =>
      setCols(Math.max(1, Math.floor((el.clientWidth + CARD_GAP) / (CARD_W + CARD_GAP))));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowCount = cols > 0 ? Math.ceil(items.length / cols) : 0;

  // Visible row range from the window scroll position.
  useEffect(() => {
    if (!windowed || cols === 0) return;
    const compute = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const first = Math.floor((window.scrollY - top) / ROW_H) - OVERSCAN_ROWS;
      const last = Math.ceil((window.scrollY + window.innerHeight - top) / ROW_H) + OVERSCAN_ROWS;
      setRange({ start: Math.max(0, first), end: Math.min(rowCount, Math.max(0, last)) });
    };
    compute();
    window.addEventListener("scroll", compute, { passive: true });
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute);
      window.removeEventListener("resize", compute);
    };
  }, [windowed, cols, rowCount]);

  // Infinite-scroll trigger: within two rows of the end.
  useEffect(() => {
    if (windowed && rowCount > 0 && range.end >= rowCount - 2) onEndReached?.();
  }, [windowed, range.end, rowCount, onEndReached]);

  // Plain grid (SSR + first client render, or before measurement).
  if (!windowed || cols === 0) {
    return (
      <>
        <div
          ref={ref}
          className="flex flex-wrap justify-center gap-3 sm:justify-start"
        >
          {items.map((item) => (
            <MediaCard key={cardKey(item)} item={item} />
          ))}
        </div>
        <CardHoverLayer containerRef={ref} />
      </>
    );
  }

  const rows = [];
  for (let r = range.start; r < range.end; r++) {
    const slice = items.slice(r * cols, r * cols + cols);
    rows.push(
      <div
        key={r}
        style={{ position: "absolute", top: r * ROW_H, left: 0, right: 0, gap: CARD_GAP }}
        className="flex justify-center sm:justify-start"
      >
        {slice.map((item) => (
          <MediaCard key={cardKey(item)} item={item} />
        ))}
      </div>,
    );
  }

  return (
    <>
      <div ref={ref} style={{ position: "relative", height: rowCount * ROW_H }}>
        {rows}
      </div>
      <CardHoverLayer containerRef={ref} />
    </>
  );
}
