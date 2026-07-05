"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { CardPreview as CardPreviewData } from "@/db/queries";

import CardPreview from "./CardPreview";

// Session cache so re-hovering a card shows its preview instantly.
const previewCache = new Map<string, CardPreviewData>();
const OPEN_DELAY = 200;
const CLOSE_DELAY = 120;

interface HoverState {
  anchor: DOMRect;
  poster: string | null;
  href: string;
}

/**
 * One hover-preview controller for a whole grid/row. Instead of every card
 * carrying its own timers/state, this attaches delegated pointer listeners to a
 * container and drives a single shared CardPreview, reading the hovered card's
 * `data-*` attributes. Keeps cards cheap even when there are thousands.
 */
export default function CardHoverLayer({
  containerRef,
}: Readonly<{ containerRef: RefObject<HTMLElement | null> }>) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CardPreviewData | null>(null);

  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentKey = useRef<string | null>(null);

  const clearOpen = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = null;
  };
  const clearClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  const requestClose = useCallback(() => setOpen(false), []);
  const handleClosed = useCallback(() => {
    setHover(null);
    setOpen(false);
    currentKey.current = null;
  }, []);
  const hardClose = useCallback(() => {
    clearOpen();
    clearClose();
    setHover(null);
    setOpen(false);
    currentKey.current = null;
  }, []);

  const fetchPreview = useCallback(async (mediaType: string, id: string, key: string) => {
    if (previewCache.has(key)) {
      setData(previewCache.get(key)!);
      return;
    }
    try {
      const res = await fetch(`/api/preview/${mediaType}/${id}`, { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as CardPreviewData;
        previewCache.set(key, json);
        setData(json);
      }
    } catch {
      // ignore — the card still navigates on click
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Pointer-only feature; on touch a tap just navigates.
    if (!window.matchMedia("(hover: hover)").matches) return;

    const onOver = (e: PointerEvent) => {
      const card = (e.target as Element | null)?.closest?.("[data-card]") as HTMLElement | null;
      if (!card || !container.contains(card)) return;
      clearClose();
      const key = `${card.dataset.mediaType}-${card.dataset.id}`;
      if (key === currentKey.current) return; // already hovering this card
      clearOpen();
      openTimer.current = setTimeout(() => {
        currentKey.current = key;
        setData(previewCache.get(key) ?? null);
        setHover({
          anchor: card.getBoundingClientRect(),
          poster: card.dataset.poster || null,
          href: `/${card.dataset.mediaType}/${card.dataset.id}`,
        });
        setOpen(true);
        void fetchPreview(card.dataset.mediaType ?? "", card.dataset.id ?? "", key);
      }, OPEN_DELAY);
    };

    const onOut = (e: PointerEvent) => {
      const related = e.relatedTarget as Node | null;
      // Moving to another card inside the container → let onOver switch; no close.
      if (related && container.contains(related) && (related as Element).closest?.("[data-card]")) {
        return;
      }
      // Anywhere else (gaps, outside, or the preview portal) → schedule close.
      // If it's the preview, its onPointerEnter cancels this.
      clearOpen();
      closeTimer.current = setTimeout(requestClose, CLOSE_DELAY);
    };

    container.addEventListener("pointerover", onOver);
    container.addEventListener("pointerout", onOut);
    return () => {
      container.removeEventListener("pointerover", onOver);
      container.removeEventListener("pointerout", onOut);
    };
  }, [containerRef, fetchPreview, requestClose]);

  // Close on scroll (anchor goes stale / card may unmount) or Escape.
  useEffect(() => {
    if (!hover) return;
    const onScroll = () => hardClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hardClose();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [hover, hardClose]);

  useEffect(() => () => {
    clearOpen();
    clearClose();
  }, []);

  if (!hover) return null;
  return (
    <CardPreview
      anchor={hover.anchor}
      data={data}
      poster={hover.poster}
      href={hover.href}
      open={open}
      onClosed={handleClosed}
      onPointerEnter={() => {
        clearClose();
        setOpen(true);
      }}
      onPointerLeave={() => {
        closeTimer.current = setTimeout(requestClose, CLOSE_DELAY);
      }}
    />
  );
}
