import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import CastRow from "@/app/components/common/CastRow";
import WatchedToggle from "@/app/components/profile/WatchedToggle";
import WatchlistButton from "@/app/components/profile/WatchlistButton";
import { getCompletedEpisodeIds, getShowDetail, isInWatchlist } from "@/db/queries";
import { formatRuntime, releaseYear, toPlayableId } from "@/lib/media";
import { getActiveProfileId } from "@/lib/profile";
import { tmdbImage } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

export default async function ShowPage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  const { id } = await params;
  const showId = Number(id);
  if (!Number.isInteger(showId) || showId <= 0) notFound();

  const show = getShowDetail(showId);
  if (!show) notFound();

  const profileId = await getActiveProfileId();
  const inList = profileId ? isInWatchlist(profileId, "show", show.id) : false;
  const completedEpisodes = profileId
    ? getCompletedEpisodeIds(profileId, show.id)
    : new Set<number>();

  const backdrop = tmdbImage(show.backdropPath);
  const year = releaseYear(show.firstAirDate);

  return (
    <main className="flex flex-col">
      <div className="relative h-[50vw] max-h-[70vh] min-h-[360px] w-full">
        {backdrop ? (
          <Image src={backdrop} alt="" fill priority sizes="100vw" className="object-cover" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-neutral-800 to-black" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 px-4 pb-8 sm:px-8 md:max-w-2xl">
          <h1 className="text-3xl font-extrabold sm:text-5xl">{show.name}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
            {year ? <span>{year}</span> : null}
            {show.certification ? (
              <span className="rounded border border-muted/60 px-1.5 py-0.5 text-xs font-medium">
                {show.certification}
              </span>
            ) : null}
            {show.genres.map((g) => (
              <span key={g.id} className="rounded-full bg-surface px-3 py-1">
                {g.name}
              </span>
            ))}
          </div>
          {show.overview ? (
            <p className="max-w-xl text-sm text-foreground/90">{show.overview}</p>
          ) : null}
          <div>
            <WatchlistButton mediaType="show" mediaId={show.id} initialInList={inList} />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-8 px-4 py-10 sm:px-8">
        <CastRow cast={show.cast} />
        {show.seasons.length === 0 ? (
          <p className="text-muted">No episodes available yet.</p>
        ) : (
          show.seasons.map((season) => (
            <section key={season.id} className="flex flex-col gap-3">
              <h2 className="text-xl font-semibold">
                {season.name ?? `Season ${season.tmdbSeasonNumber}`}
              </h2>
              <ul className="flex flex-col divide-y divide-white/10 overflow-hidden rounded-lg bg-surface/50">
                {season.episodes.map((ep) => {
                  const still = tmdbImage(ep.stillPath);
                  const runtime = formatRuntime(ep.runtimeMinutes);
                  return (
                    <li key={ep.id}>
                      <Link
                        href={`/watch/${toPlayableId("episode", ep.id)}`}
                        className="flex items-center gap-4 p-3 transition hover:bg-white/5"
                      >
                        <span className="w-6 shrink-0 text-center text-lg font-semibold text-muted">
                          {ep.tmdbEpisodeNumber}
                        </span>
                        <div className="relative aspect-video w-32 shrink-0 overflow-hidden rounded bg-neutral-800">
                          {still ? (
                            <Image
                              src={still}
                              alt=""
                              fill
                              sizes="128px"
                              className="object-cover"
                            />
                          ) : null}
                          <span className="absolute inset-0 flex items-center justify-center text-2xl opacity-0 transition hover:opacity-100">
                            ▶
                          </span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <p className="truncate font-medium">
                              {ep.name ?? `Episode ${ep.tmdbEpisodeNumber}`}
                            </p>
                            {runtime ? (
                              <span className="shrink-0 text-xs text-muted">{runtime}</span>
                            ) : null}
                          </div>
                          {ep.overview ? (
                            <p className="line-clamp-2 text-sm text-muted">{ep.overview}</p>
                          ) : null}
                        </div>
                        <div className="shrink-0">
                          <WatchedToggle
                            playableId={toPlayableId("episode", ep.id)}
                            initialCompleted={completedEpisodes.has(ep.id)}
                            variant="compact"
                          />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </main>
  );
}
