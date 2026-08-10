import Image from "next/image";
import { notFound } from "next/navigation";

import CastRow from "@/app/components/common/CastRow";
import KeywordChips from "@/app/components/common/KeywordChips";
import MediaRow from "@/app/components/common/MediaRow";
import RecordInfo from "@/app/components/common/RecordInfo";
import ReportButton from "@/app/components/common/ReportButton";
import Rating from "@/app/components/common/Rating";
import VersionPicker, {
  type VersionOption,
} from "@/app/components/common/VersionPicker";
import VideoGallery from "@/app/components/common/VideoGallery";
import WatchlistButton from "@/app/components/profile/WatchlistButton";
import {
  getLatestMovieProgress,
  getMovieDetail,
  getMovieVersions,
  getRelated,
  getWatchProgress,
  isInWatchlist,
  moviePlayState,
} from "@/db/queries";
import { formatRuntime, releaseYear, toPlayableId } from "@/lib/media";
import { getActiveProfile, getActiveProfileId, getContentRules } from "@/lib/profile";
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

  // Null for a title this profile isn't allowed to see, so parental controls
  // land on the same 404 as a title that doesn't exist.
  const rules = await getContentRules();
  const movie = getMovieDetail(movieId, rules);
  if (!movie) notFound();

  const profileId = await getActiveProfileId();
  const inList = profileId ? isInWatchlist(profileId, "movie", movie.id) : false;
  const related = getRelated("movie", movie.id, rules);

  // One playable option per file version; the hero + picker default to whichever
  // version was played most recently (else the primary).
  const versions = getMovieVersions(movie.id);
  const latest = profileId ? getLatestMovieProgress(profileId, movie.id) : null;
  const defaultVersionId = versions.some((v) => v.versionId === latest?.versionId)
    ? (latest?.versionId ?? 0)
    : 0;
  const versionOptions: VersionOption[] = versions.map((v) => {
    const prog = profileId
      ? getWatchProgress(profileId, { kind: "movie", numericId: movie.id, versionId: v.versionId })
      : null;
    const st = moviePlayState(prog, movie.runtimeMinutes);
    return {
      versionId: v.versionId,
      label: v.label,
      playableId: toPlayableId("movie", movie.id, v.versionId),
      state: st.state,
      fraction: st.fraction,
      remainingMinutes: st.remainingMinutes,
      completed: !!prog?.completed,
    };
  });

  // Built only when the flag is on, so an ordinary viewer never serializes the
  // file paths into the RSC payload. `isKids` is re-checked here rather than
  // trusted from the write path, so the two flags can't both take effect.
  const viewer = await getActiveProfile();
  const showRecordInfo = viewer?.isAdmin === 1 && viewer.isKids !== 1;
  const recordFiles = showRecordInfo
    ? versions.map((v) => ({ label: v.label, path: v.filePath }))
    : [];

  const backdrop = tmdbImage(movie.backdropPath);
  const poster = tmdbImage(movie.posterPath);
  const year = releaseYear(movie.releaseDate);
  const runtime = formatRuntime(movie.runtimeMinutes);

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
            <Rating voteAverage={movie.voteAverage} voteCount={movie.voteCount} />
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
            <VersionPicker options={versionOptions} defaultVersionId={defaultVersionId}>
              <WatchlistButton mediaType="movie" mediaId={movie.id} initialInList={inList} />
            </VersionPicker>
            <ReportButton mediaType="movie" mediaId={movie.id} />
            {showRecordInfo ? (
              <RecordInfo mediaType="movie" tmdbId={movie.tmdbId} files={recordFiles} />
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-8 px-4 sm:px-8">
        <VideoGallery videos={movie.videos} title={movie.title} />
        <CastRow cast={movie.cast} />
        <KeywordChips keywords={movie.keywords} />
      </div>

      {/* MediaRow brings its own px-4/sm:px-8 gutter, so it sits outside the
          padded block rather than nesting inside it. */}
      <div className="pb-16 pt-8">
        <MediaRow title="More Like This" items={related} />
      </div>
    </main>
  );
}
