"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import ProgressBar from "./ProgressBar";

export interface SeasonNavItem {
  /**
   * `seasons.id` (the DB primary key) — the anchor is `season-${id}`.
   * Season *numbers* are sparse (a show can have only seasons 3 and 7), so they
   * are never used for identity or ordering here.
   */
  id: number;
  label: string;
  episodeCount: number;
  watchedCount: number;
}

/** How long the page must be scroll-quiet before the spy takes the highlight back. */
const SETTLE_MS = 140;
/** Hard cap, so a scroll that never lands can't freeze the highlight forever. */
const MAX_PIN_MS = 1200;
/** Only used if a section's computed scroll-margin-top can't be read. */
const FALLBACK_OFFSET = 128;

/**
 * Which season is "current", given each section's viewport-relative top.
 *
 * The last section whose top has crossed the line wins, clamped to the first so
 * that sitting above every section still highlights something. `atBottom` forces
 * the last season: once the document runs out of scroll, a final short section
 * can never reach the line on its own.
 *
 * Exported so the rule can be tested without a browser.
 */
export function activeSeasonIndex(
  tops: readonly number[],
  line: number,
  atBottom: boolean,
): number {
  if (tops.length === 0) return -1;
  if (atBottom) return tops.length - 1;
  let idx = 0;
  for (let i = 0; i < tops.length; i += 1) {
    if (tops[i] <= line) idx = i;
  }
  return idx;
}

/**
 * A table of contents for a show's seasons: click to jump, and the season you
 * are currently scrolled to stays highlighted.
 *
 * The episodes themselves stay server-rendered — this component never receives
 * them. It finds each season's `<section>` by DOM id, which is the whole reason
 * the episode list can remain a server component.
 */
export default function SeasonNav({
  seasons,
}: Readonly<{ seasons: SeasonNavItem[] }>) {
  // Derived purely from props, so the server HTML and the first client render
  // match exactly; the scroll-derived value only lands later, in an effect.
  const [activeId, setActiveId] = useState<number | null>(() => seasons[0]?.id ?? null);

  const mobileRef = useRef<HTMLUListElement>(null);
  const desktopRef = useRef<HTMLUListElement>(null);

  /** Set while a click-driven scroll is in flight; suppresses the spy. */
  const pinnedRef = useRef<number | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offsetRef = useRef(FALLBACK_OFFSET);
  const computeRef = useRef<() => void>(() => {});

  const clearTimers = useCallback(() => {
    if (settleRef.current) clearTimeout(settleRef.current);
    if (capRef.current) clearTimeout(capRef.current);
    settleRef.current = null;
    capRef.current = null;
  }, []);

  const unpin = useCallback(() => {
    clearTimers();
    pinnedRef.current = null;
    computeRef.current();
  }, [clearTimers]);

  const armSettle = useCallback(() => {
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = setTimeout(unpin, SETTLE_MS);
  }, [unpin]);

  // A primitive dep: `seasons` is a fresh array on every re-render, and marking
  // an episode watched revalidates the whole route — keying on the id list means
  // the listeners attach once instead of on every toggle click.
  const idsKey = seasons.map((s) => s.id).join(",");

  useEffect(() => {
    const ids = idsKey ? idsKey.split(",").map(Number) : [];
    if (ids.length === 0) return;

    // The spy's threshold line and the jump offset must be the same number, and
    // that number is responsive. Read it back out of the section's Tailwind
    // `scroll-mt-*` so there is exactly one source of truth.
    const measureOffset = () => {
      const first = document.getElementById(`season-${ids[0]}`);
      const value = first ? Number.parseFloat(getComputedStyle(first).scrollMarginTop) : NaN;
      offsetRef.current = Number.isFinite(value) && value > 0 ? value : FALLBACK_OFFSET;
    };

    const compute = () => {
      if (pinnedRef.current !== null) return; // a click owns the highlight
      const tops = ids.map((id) => {
        const el = document.getElementById(`season-${id}`);
        // A missing element can never be "current": park it below the line.
        return el ? el.getBoundingClientRect().top : Number.POSITIVE_INFINITY;
      });
      const doc = document.documentElement;
      const atBottom = window.scrollY + window.innerHeight >= doc.scrollHeight - 2;
      const idx = activeSeasonIndex(tops, offsetRef.current + 1, atBottom);
      if (idx >= 0) setActiveId(ids[idx]);
    };
    computeRef.current = compute;

    let frame = 0;
    const onScroll = () => {
      if (pinnedRef.current !== null) {
        armSettle(); // still animating — push the settle deadline out
        return;
      }
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        compute();
      });
    };
    const onResize = () => {
      measureOffset();
      onScroll();
    };

    measureOffset();
    compute();
    // A `#season-N` fragment jump or scroll restoration can land after paint.
    const raf = requestAnimationFrame(compute);

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [idsKey, armSettle]);

  // If the user grabs the page mid-animation, hand the highlight straight back.
  // Deliberately not `keydown`: Enter activates the link, which would unpin
  // instantly and cause exactly the flicker the pin exists to prevent.
  useEffect(() => {
    const takeOver = () => {
      if (pinnedRef.current !== null) unpin();
    };
    window.addEventListener("wheel", takeOver, { passive: true });
    window.addEventListener("touchstart", takeOver, { passive: true });
    return () => {
      window.removeEventListener("wheel", takeOver);
      window.removeEventListener("touchstart", takeOver);
    };
  }, [unpin]);

  useEffect(() => () => clearTimers(), [clearTimers]);

  // A stale id can't survive a rescan that dropped a season.
  const current = seasons.some((s) => s.id === activeId)
    ? activeId
    : (seasons[0]?.id ?? null);

  // Keep the highlighted row visible in a long rail / wide strip. `scrollBy` —
  // not `scrollIntoView`, which can scroll ancestors (including the window) and
  // fight the page animation.
  useEffect(() => {
    if (current === null) return;
    const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? "instant"
      : "smooth";
    for (const list of [mobileRef.current, desktopRef.current]) {
      // clientWidth is 0 for whichever copy is display:none at this breakpoint.
      if (!list || list.clientWidth === 0) continue;
      const target = list.querySelector<HTMLElement>(`[data-season-id="${current}"]`);
      if (!target) continue;
      const c = list.getBoundingClientRect();
      const t = target.getBoundingClientRect();
      if (list.scrollWidth > list.clientWidth) {
        if (t.left < c.left + 16) list.scrollBy({ left: t.left - c.left - 16, behavior });
        else if (t.right > c.right - 16)
          list.scrollBy({ left: t.right - c.right + 16, behavior });
      }
      if (list.scrollHeight > list.clientHeight) {
        if (t.top < c.top + 8) list.scrollBy({ top: t.top - c.top - 8, behavior });
        else if (t.bottom > c.bottom - 8)
          list.scrollBy({ top: t.bottom - c.bottom + 8, behavior });
      }
    }
  }, [current]);

  const onJump = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, id: number) => {
      // Let the browser own new-tab / new-window clicks.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = document.getElementById(`season-${id}`);
      if (!target) return; // fall through to the native anchor
      e.preventDefault(); // no history entry, no router involvement

      pinnedRef.current = id;
      setActiveId(id);
      armSettle();
      if (capRef.current) clearTimeout(capRef.current);
      capRef.current = setTimeout(unpin, MAX_PIN_MS);

      const behavior: ScrollBehavior = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches
        ? "instant"
        : "smooth";

      // Focus first: if a browser ignores preventScroll, the scrollIntoView
      // below still wins. `block: "start"` honours the section's scroll-mt, so
      // this lands exactly where a no-JS `#hash` jump would.
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior, block: "start" });
    },
    [armSettle, unpin],
  );

  if (seasons.length === 0) return null;

  return (
    <>
      {/* Mobile: a sticky chip strip under the navbar. Negative margins cancel
          the page gutter for a full-bleed background; the inner list re-adds it
          as scroller padding (the same shape as MediaRow). */}
      <nav
        aria-label="Seasons"
        className="sticky top-16 z-30 -mx-4 border-b border-white/10 bg-background/95 py-3 backdrop-blur sm:top-[4.5rem] sm:-mx-8 md:hidden"
      >
        <ul
          ref={mobileRef}
          className="no-scrollbar flex gap-2 overflow-x-auto overscroll-x-contain px-4 sm:px-8"
        >
          {seasons.map((season) => {
            const active = season.id === current;
            return (
              <li key={season.id} className="shrink-0">
                <a
                  href={`#season-${season.id}`}
                  data-season-id={season.id}
                  aria-current={active ? "location" : undefined}
                  onClick={(e) => onJump(e, season.id)}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-xs transition ${
                    active
                      ? "bg-foreground text-background"
                      : "bg-white/10 text-foreground/80 hover:bg-white/20"
                  }`}
                >
                  <span className="max-w-40 truncate font-medium">{season.label}</span>
                  <span className={active ? "text-background/60" : "text-muted"}>
                    {season.watchedCount}/{season.episodeCount}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Desktop: a sticky rail. `md:self-start` is required — a flex item
          defaults to align-self:stretch, which leaves sticky no travel at all. */}
      <nav
        aria-label="Seasons"
        className="hidden md:sticky md:top-24 md:block md:max-h-[calc(100vh-8rem)] md:w-56 md:shrink-0 md:self-start md:overflow-y-auto lg:w-64"
      >
        <ul ref={desktopRef} className="flex flex-col gap-1">
          {seasons.map((season) => {
            const active = season.id === current;
            // 0/0 is NaN, and ProgressBar's `fraction <= 0` test is false for
            // NaN — which would render width: NaN%.
            const fraction =
              season.episodeCount > 0 ? season.watchedCount / season.episodeCount : 0;
            return (
              <li key={season.id}>
                <a
                  href={`#season-${season.id}`}
                  data-season-id={season.id}
                  title={season.label}
                  aria-current={active ? "location" : undefined}
                  onClick={(e) => onJump(e, season.id)}
                  className={`flex flex-col gap-1.5 rounded-md border-l-2 px-3 py-2 transition ${
                    active
                      ? "border-accent bg-white/10 text-foreground"
                      : "border-transparent text-muted hover:bg-white/5 hover:text-foreground"
                  }`}
                >
                  <span className="truncate text-sm font-medium">{season.label}</span>
                  <span className="text-xs text-muted">
                    {season.episodeCount}{" "}
                    {season.episodeCount === 1 ? "episode" : "episodes"}
                    {season.watchedCount > 0 ? ` · ${season.watchedCount} watched` : ""}
                  </span>
                  {/* Fixed-height slot: ProgressBar renders nothing at 0, which
                      would otherwise make unwatched rows shorter. */}
                  <span className="block h-1">
                    <ProgressBar fraction={fraction} className="w-full rounded-full" />
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
