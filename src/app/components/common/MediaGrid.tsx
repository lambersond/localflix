"use client";

import { useRef } from "react";

import type { CardItem } from "@/db/queries";

import CardHoverLayer from "./CardHoverLayer";
import MediaCard from "./MediaCard";

export default function MediaGrid({ items }: Readonly<{ items: CardItem[] }>) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={ref} className="flex flex-wrap justify-center gap-3 sm:justify-start">
        {items.map((item) => (
          <MediaCard key={`${item.mediaType}-${item.id}`} item={item} />
        ))}
      </div>
      <CardHoverLayer containerRef={ref} />
    </>
  );
}
