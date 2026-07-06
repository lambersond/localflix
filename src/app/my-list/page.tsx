import Link from "next/link";

import MediaGrid from "@/app/components/common/MediaGrid";
import ResumeRow from "@/app/components/common/ResumeRow";
import { getContinueWatching, getMyList, getWatchedItems } from "@/db/queries";
import { getActiveProfileId } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default async function MyListPage() {
  const profileId = await getActiveProfileId();
  const items = profileId ? getMyList(profileId) : [];
  const inProgress = profileId ? getContinueWatching(profileId) : [];
  const watched = profileId ? getWatchedItems(profileId) : [];

  return (
    // No horizontal padding on <main>: ResumeRow brings its own, and the grid
    // sections add theirs — so every section aligns to the same gutter.
    <main className="flex flex-col gap-8 pb-16 pt-20 sm:pt-24">
      <section className="flex flex-col gap-6 px-4 sm:px-8">
        <h1 className="text-2xl font-bold">My List</h1>
        {items.length === 0 ? (
          <p className="text-muted">
            Nothing here yet. Add titles with the{" "}
            <span className="font-medium text-foreground">+ Add to My List</span> button on a{" "}
            <Link href="/" className="text-accent hover:underline">
              movie or show
            </Link>
            .
          </p>
        ) : (
          <MediaGrid items={items} />
        )}
      </section>

      {inProgress.length > 0 ? (
        <ResumeRow title="Continue watching" items={inProgress} />
      ) : null}

      {watched.length > 0 ? (
        <section className="flex flex-col gap-6 px-4 sm:px-8">
          <h2 className="text-2xl font-bold">Watched</h2>
          <MediaGrid items={watched} />
        </section>
      ) : null}
    </main>
  );
}
