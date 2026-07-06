import Image from "next/image";
import Link from "next/link";

import type { CardItem } from "@/db/queries";
import { tmdbImage } from "@/lib/tmdb-image";

import { CARD_W } from "./card-metrics";

/**
 * Presentational poster card. Intentionally hook-free and lightweight so a grid
 * can render many of them cheaply; the hover preview is handled by a single
 * delegated CardHoverLayer that reads the `data-*` attributes below.
 */
export default function MediaCard({ item }: Readonly<{ item: CardItem }>) {
  const poster = tmdbImage(item.posterPath);

  return (
    <Link
      href={`/${item.mediaType}/${item.id}`}
      data-card
      data-media-type={item.mediaType}
      data-id={item.id}
      data-poster={poster ?? ""}
      style={{ width: CARD_W }}
      className="group relative block shrink-0 overflow-hidden rounded-md bg-surface transition duration-200 hover:z-10 hover:scale-[1.05] hover:shadow-xl hover:shadow-black/60"
    >
      <div className="relative aspect-[2/3] w-full">
        {poster ? (
          <Image
            src={poster}
            alt={item.title}
            fill
            sizes="160px"
            className="object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-700 to-neutral-900 p-3 text-center text-sm font-semibold text-foreground">
            {item.title}
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2 pt-6 opacity-0 transition group-hover:opacity-100">
        <p className="truncate text-xs font-medium text-foreground">{item.title}</p>
      </div>
    </Link>
  );
}
