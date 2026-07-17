import { notFound } from "next/navigation";

import VideoPlayer from "@/app/components/common/VideoPlayer";
import { getWatchMeta, getWatchProgress } from "@/db/queries";
import { parsePlayableId } from "@/lib/media";
import { getActiveProfileId } from "@/lib/profile";
import { tmdbImage } from "@/lib/tmdb-image";

export default async function WatchPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{ restart?: string }>;
}>) {
  const { id } = await params;
  const { restart } = await searchParams;

  const parsed = parsePlayableId(id);
  if (!parsed) notFound();

  const meta = getWatchMeta(parsed);
  if (!meta) notFound();

  const profileId = await getActiveProfileId();
  const progress = profileId ? getWatchProgress(profileId, parsed) : null;
  // "Restart" (?restart=1) starts from the top regardless of saved progress.
  const resumeSeconds =
    restart || !progress || progress.completed ? 0 : progress.positionSeconds;

  return (
    <VideoPlayer
      src={`/api/stream/${id}`}
      title={meta.title}
      backHref={meta.backHref}
      playableId={id}
      resumeSeconds={resumeSeconds}
      castContentType={meta.mimeType ?? "video/mp4"}
      posterUrl={tmdbImage(meta.posterPath)}
    />
  );
}
