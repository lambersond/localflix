import Image from "next/image";
import Link from "next/link";

import type { ResumeCardItem } from "@/db/queries";
import { tmdbImage } from "@/lib/tmdb";

import WatchedToggle from "../profile/WatchedToggle";
import ProgressBar from "./ProgressBar";

export default function ResumeCard({ item }: { item: ResumeCardItem }) {
  const img = tmdbImage(item.imagePath);

  return (
    <Link
      href={`/watch/${item.playableId}`}
      className="group relative block w-[240px] shrink-0 overflow-hidden rounded-md bg-surface transition duration-200 hover:z-10 hover:scale-[1.05] hover:shadow-xl hover:shadow-black/60"
    >
      <div className="relative aspect-video w-full">
        {img ? (
          <Image src={img} alt={item.title} fill sizes="240px" className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-neutral-700 to-neutral-900 p-3 text-center text-sm font-semibold">
            {item.title}
          </div>
        )}

        <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition group-hover:opacity-100">
          <span className="text-4xl drop-shadow" aria-hidden>
            ▶
          </span>
        </div>

        <div className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100">
          <WatchedToggle
            playableId={item.playableId}
            initialCompleted={false}
            variant="compact"
            tooltipSide="bottom"
          />
        </div>

        <ProgressBar
          fraction={item.progressFraction}
          className="absolute inset-x-0 bottom-0"
        />
      </div>

      <div className="p-2">
        <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
        {item.label ? <p className="text-xs text-muted">{item.label}</p> : null}
      </div>
    </Link>
  );
}
