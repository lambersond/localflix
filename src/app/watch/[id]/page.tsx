import { notFound } from "next/navigation";

import VideoPlayer from "@/app/components/common/VideoPlayer";
import { getWatchMeta, getWatchProgress } from "@/db/queries";
import { parsePlayableId } from "@/lib/media";
import { getActiveProfileId } from "@/lib/profile";

export default async function WatchPage({
  params,
}: Readonly<{
  params: Promise<{ id: string }>;
}>) {
  const { id } = await params;

  const parsed = parsePlayableId(id);
  if (!parsed) notFound();

  const meta = getWatchMeta(parsed);
  if (!meta) notFound();

  const profileId = await getActiveProfileId();
  const progress = profileId ? getWatchProgress(profileId, parsed) : null;
  const resumeSeconds = progress && !progress.completed ? progress.positionSeconds : 0;

  return (
    <VideoPlayer
      src={`/api/stream/${id}`}
      title={meta.title}
      backHref={meta.backHref}
      playableId={id}
      resumeSeconds={resumeSeconds}
    />
  );
}
