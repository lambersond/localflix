import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import CastRow from "@/app/components/common/CastRow";
import KeywordChips from "@/app/components/common/KeywordChips";
import MediaRow from "@/app/components/common/MediaRow";
import ProgressBar from "@/app/components/common/ProgressBar";
import Rating from "@/app/components/common/Rating";
import VideoGallery from "@/app/components/common/VideoGallery";
import WatchedToggle from "@/app/components/profile/WatchedToggle";
import WatchlistButton from "@/app/components/profile/WatchlistButton";
import { getRelated, getShowDetail, getShowResume, isInWatchlist } from "@/db/queries";
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
  const resume = getShowResume(profileId ?? 0, show.id);
  const showState = resume.allWatched ? "watched" : resume.started ? "started" : "none";

  let episodesSummary: string | null = null;
  if (resume.totalEpisodes > 0) {
    if (resume.allWatched) {
      episodesSummary = `Watched · ${resume.watchedCount}/${resume.totalEpisodes} episodes`;
    } else if (resume.started) {
      const upNext = resume.resumeLabel ? `Up next: ${resume.resumeLabel} · ` : "";
      episodesSummary = `${upNext}${resume.watchedCount}/${resume.totalEpisodes} episodes`;
    } else {
      episodesSummary = `${resume.totalEpisodes} episodes`;
    }
  }

  const backdrop = tmdbImage(show.backdropPath);
  const year = releaseYear(show.firstAirDate);
  const related = getRelated("show", show.id);

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
            <Rating voteAverage={show.voteAverage} voteCount={show.voteCount} />
            {show.genres.map((g) => (
              <span key={g.id} className="rounded-full bg-surface px-3 py-1">
                {g.name}
              </span>
            ))}
          </div>
          {show.overview ? (
            <p className="max-w-xl text-sm text-foreground/90">{show.overview}</p>
          ) : null}
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              {resume.firstPlayableId ? (
                showState === "watched" ? (
                  <Link
                    href={`/watch/${resume.firstPlayableId}?restart=1`}
                    className="inline-flex items-center gap-2 rounded bg-foreground px-8 py-2.5 font-semibold text-background transition hover:bg-foreground/80"
                  >
                    <span aria-hidden>↻</span> Restart
                  </Link>
                ) : showState === "started" ? (
                  <>
                    <Link
                      href={`/watch/${resume.resumePlayableId ?? resume.firstPlayableId}`}
                      className="inline-flex items-center gap-2 rounded bg-foreground px-8 py-2.5 font-semibold text-background transition hover:bg-foreground/80"
                    >
                      <span aria-hidden>▶</span> Continue
                    </Link>
                    <Link
                      href={`/watch/${resume.firstPlayableId}?restart=1`}
                      className="inline-flex items-center gap-2 rounded bg-white/20 px-6 py-2.5 font-semibold text-foreground backdrop-blur transition hover:bg-white/30"
                    >
                      <span aria-hidden>↻</span> Restart
                    </Link>
                  </>
                ) : (
                  <Link
                    href={`/watch/${resume.firstPlayableId}`}
                    className="inline-flex items-center gap-2 rounded bg-foreground px-8 py-2.5 font-semibold text-background transition hover:bg-foreground/80"
                  >
                    <span aria-hidden>▶</span> Play
                  </Link>
                )
              ) : null}
              <WatchlistButton mediaType="show" mediaId={show.id} initialInList={inList} />
            </div>
            {episodesSummary ? (
              <p className="text-sm text-muted">{episodesSummary}</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-8 px-4 py-10 sm:px-8">
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
                  const epProg = resume.episodeProgress.get(ep.id);
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
                          {epProg && !epProg.completed ? (
                            <ProgressBar
                              fraction={epProg.fraction}
                              className="absolute inset-x-0 bottom-0"
                            />
                          ) : null}
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
                            initialCompleted={epProg?.completed ?? false}
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

        <VideoGallery videos={show.videos} title={show.name} />
        <CastRow cast={show.cast} />
        <KeywordChips keywords={show.keywords} />
      </div>

      {/* MediaRow brings its own px-4/sm:px-8 gutter, so it sits outside the
          padded body block rather than nesting inside it. */}
      <div className="pb-16">
        <MediaRow title="More Like This" items={related} />
      </div>
    </main>
  );
}
