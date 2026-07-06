import Image from "next/image";
import Link from "next/link";

import type { HeroData } from "@/db/queries";
import { tmdbImage } from "@/lib/tmdb";

export default function HeroBanner({ hero }: { hero: HeroData }) {
  const backdrop = tmdbImage(hero.backdropPath);
  const detailHref = `/${hero.mediaType}/${hero.id}`;

  return (
    <section className="relative h-[56vw] max-h-[80vh] min-h-[420px] w-full">
      {backdrop ? (
        <Image
          src={backdrop}
          alt={hero.title}
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      ) : (
        <div className="h-full w-full bg-gradient-to-br from-neutral-800 via-neutral-900 to-black" />
      )}

      {/* Readability gradients */}
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-background to-transparent" />

      {/* Bottom padding must stay ahead of the rows' -mt overlap (48px mobile /
          80px sm+) at every width, so use fixed steps rather than a width-based
          percentage (which collapses on narrow/mid screens and lets the rows
          bleed into the buttons). */}
      <div className="absolute inset-0 flex flex-col justify-end gap-4 px-4 pb-20 sm:px-8 sm:pb-28 md:max-w-2xl lg:pb-32">
        <h1 className="text-3xl font-extrabold drop-shadow-lg sm:text-5xl">
          {hero.title}
        </h1>
        {hero.overview ? (
          <p className="line-clamp-3 max-w-xl text-sm text-foreground/90 drop-shadow sm:text-base">
            {hero.overview}
          </p>
        ) : null}
        <div className="flex gap-3">
          {hero.playableId ? (
            <Link
              href={`/watch/${hero.playableId}`}
              className="flex items-center gap-2 rounded bg-foreground px-6 py-2 font-semibold text-background transition hover:bg-foreground/80"
            >
              <span aria-hidden>▶</span> Play
            </Link>
          ) : null}
          <Link
            href={detailHref}
            className="flex items-center gap-2 rounded bg-white/20 px-6 py-2 font-semibold text-foreground backdrop-blur transition hover:bg-white/30"
          >
            <span aria-hidden>ⓘ</span> More Info
          </Link>
        </div>
      </div>
    </section>
  );
}
