"use client";

import Link from "next/link";
import { useRef } from "react";

import type { CardItem } from "@/db/queries";

import CardHoverLayer from "./CardHoverLayer";
import MediaCard from "./MediaCard";

interface MediaRowProps {
  title: string;
  items: CardItem[];
  /** Optional link to a full page of this row's content. */
  seeAllHref?: string;
}

export default function MediaRow({ title, items, seeAllHref }: Readonly<MediaRowProps>) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  function scrollBy(direction: 1 | -1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  }

  if (items.length === 0) return null;

  return (
    <section className="group/row relative">
      <div className="mb-2 flex items-baseline justify-between px-4 sm:px-8">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        {seeAllHref ? (
          <Link
            href={seeAllHref}
            className="text-sm text-muted transition hover:text-foreground"
          >
            See all ›
          </Link>
        ) : null}
      </div>
      <div className="relative">
        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scrollBy(-1)}
          className="absolute left-0 top-0 z-10 hidden h-full w-12 items-center justify-center bg-black/40 text-2xl text-white opacity-0 transition hover:bg-black/60 group-hover/row:opacity-100 sm:flex"
        >
          ‹
        </button>
        <div
          ref={scrollerRef}
          className="no-scrollbar flex gap-2 overflow-x-auto scroll-smooth px-4 sm:px-8"
        >
          {items.map((item) => (
            <MediaCard key={`${item.mediaType}-${item.id}`} item={item} />
          ))}
        </div>
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scrollBy(1)}
          className="absolute right-0 top-0 z-10 hidden h-full w-12 items-center justify-center bg-black/40 text-2xl text-white opacity-0 transition hover:bg-black/60 group-hover/row:opacity-100 sm:flex"
        >
          ›
        </button>
      </div>
      <CardHoverLayer containerRef={scrollerRef} />
    </section>
  );
}
