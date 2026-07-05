import Image from "next/image";

import type { CastMember } from "@/db/queries";
import { tmdbImage } from "@/lib/tmdb";

export default function CastRow({ cast }: Readonly<{ cast: CastMember[] }>) {
  if (cast.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Cast</h2>
      <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
        {cast.map((person) => {
          const photo = tmdbImage(person.profilePath);
          return (
            <div key={person.id} className="w-24 shrink-0 text-center">
              <div className="relative mb-2 aspect-[2/3] w-24 overflow-hidden rounded-lg bg-surface">
                {photo ? (
                  <Image
                    src={photo}
                    alt={person.name}
                    fill
                    sizes="96px"
                    className="object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-2xl text-muted">
                    👤
                  </div>
                )}
              </div>
              <p className="text-xs leading-tight text-foreground/90">{person.name}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
