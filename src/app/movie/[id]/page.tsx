import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import CastRow from "@/app/components/common/CastRow";
import ProgressBar from "@/app/components/common/ProgressBar";
import WatchedToggle from "@/app/components/profile/WatchedToggle";
import WatchlistButton from "@/app/components/profile/WatchlistButton";
import { getMovieDetail, getWatchProgress, isInWatchlist, moviePlayState } from "@/db/queries";
import { formatRuntime, releaseYear, toPlayableId } from "@/lib/media";
import { getActiveProfileId } from "@/lib/profile";
import { tmdbImage } from "@/lib/tmdb";

export const dynamic = "force-dynamic";

export default async function MoviePage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  const { id } = await params;
  const movieId = Number(id);
  if (!Number.isInteger(movieId) || movieId <= 0) notFound();

  const movie = getMovieDetail(movieId);
  if (!movie) notFound();

  const profileId = await getActiveProfileId();
  const inList = profileId ? isInWatchlist(profileId, "movie", movie.id) : false;
  const progress = profileId
    ? getWatchProgress(profileId, { kind: "movie", numericId: movie.id })
    : null;
  const completed = !!progress?.completed;
  const play = moviePlayState(progress, movie.runtimeMinutes);

  const backdrop = tmdbImage(movie.backdropPath);
  const poster = tmdbImage(movie.posterPath);
  const year = releaseYear(movie.releaseDate);
  const runtime = formatRuntime(movie.runtimeMinutes);
  const playableId = toPlayableId("movie", movie.id);

  return (
    <main className="flex flex-col">
      <div className="relative h-[50vw] max-h-[70vh] min-h-[360px] w-full">
        {backdrop ? (
          <Image src={backdrop} alt="" fill priority sizes="100vw" className="object-cover" />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-neutral-800 to-black" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
      </div>

      <div className="relative z-10 -mt-40 flex flex-col gap-6 px-4 pb-8 sm:px-8 md:flex-row md:items-end">
        {poster ? (
          <Image
            src={poster}
            alt={movie.title}
            width={220}
            height={330}
            className="hidden shrink-0 rounded-lg shadow-2xl md:block"
          />
        ) : null}

        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-extrabold sm:text-5xl">{movie.title}</h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
            {year ? <span>{year}</span> : null}
            {movie.certification ? (
              <span className="rounded border border-muted/60 px-1.5 py-0.5 text-xs font-medium">
                {movie.certification}
              </span>
            ) : null}
            {runtime ? <span>{runtime}</span> : null}
            {movie.genres.map((g) => (
              <span key={g.id} className="rounded-full bg-surface px-3 py-1">
                {g.name}
              </span>
            ))}
          </div>
          {movie.overview ? (
            <p className="max-w-2xl text-foreground/90">{movie.overview}</p>
          ) : null}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-3">
              {play.state === "in_progress" ? (
                <>
                  <Link
                    href={`/watch/${playableId}`}
                    className="inline-flex items-center gap-2 rounded bg-foreground px-8 py-2.5 font-semibold text-background transition hover:bg-foreground/80"
                  >
                    <span aria-hidden>▶</span> Continue
                  </Link>
                  <Link
                    href={`/watch/${playableId}?restart=1`}
                    className="inline-flex items-center gap-2 rounded bg-white/20 px-6 py-2.5 font-semibold text-foreground backdrop-blur transition hover:bg-white/30"
                  >
                    <span aria-hidden>↻</span> Restart
                  </Link>
                </>
              ) : play.state === "completed" ? (
                <Link
                  href={`/watch/${playableId}?restart=1`}
                  className="inline-flex items-center gap-2 rounded bg-foreground px-8 py-2.5 font-semibold text-background transition hover:bg-foreground/80"
                >
                  <span aria-hidden>↻</span> Restart
                </Link>
              ) : (
                <Link
                  href={`/watch/${playableId}`}
                  className="inline-flex items-center gap-2 rounded bg-foreground px-8 py-2.5 font-semibold text-background transition hover:bg-foreground/80"
                >
                  <span aria-hidden>▶</span> Play
                </Link>
              )}
              <WatchlistButton mediaType="movie" mediaId={movie.id} initialInList={inList} />
              <WatchedToggle playableId={playableId} initialCompleted={completed} />
            </div>
            {play.state === "in_progress" ? (
              <div className="flex max-w-md items-center gap-3">
                <ProgressBar
                  fraction={play.fraction}
                  className="w-40 overflow-hidden rounded-full"
                />
                {play.remainingMinutes !== null ? (
                  <span className="text-sm text-muted">{play.remainingMinutes} min left</span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="px-4 pb-16 sm:px-8">
        <CastRow cast={movie.cast} />
      </div>
    </main>
  );
}
