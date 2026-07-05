"use client";

import { useRef } from "react";

import type { ResumeCardItem } from "@/db/queries";

import ResumeCard from "./ResumeCard";

interface ResumeRowProps {
  title: string;
  items: ResumeCardItem[];
}

export default function ResumeRow({ title, items }: ResumeRowProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);

  function scrollBy(direction: 1 | -1) {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  }

  if (items.length === 0) return null;

  return (
    <section className="group/row relative">
      <h2 className="mb-2 px-4 text-lg font-semibold text-foreground sm:px-8">{title}</h2>
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
            <ResumeCard key={item.playableId} item={item} />
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
    </section>
  );
}
