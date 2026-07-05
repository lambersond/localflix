import Link from "next/link";

import HeroBanner from "./components/common/HeroBanner";
import MediaRow from "./components/common/MediaRow";
import ResumeRow from "./components/common/ResumeRow";
import {
  getContinueWatching,
  getHero,
  getMyList,
  getRecentlyAdded,
  getRows,
  getUpNext,
} from "@/db/queries";
import { getActiveProfileId } from "@/lib/profile";

// Read the local library on every request so freshly-ingested content appears
// without a rebuild.
export const dynamic = "force-dynamic";

export default async function Home() {
  const profileId = await getActiveProfileId();
  const hero = getHero();
  const recentlyAdded = getRecentlyAdded();
  const rows = getRows();
  const continueWatching = profileId ? getContinueWatching(profileId) : [];
  const upNext = profileId ? getUpNext(profileId) : [];
  const myList = profileId ? getMyList(profileId, 25) : [];

  if (!hero && rows.length === 0 && recentlyAdded.length === 0) {
    return <EmptyLibrary />;
  }

  return (
    <main className="flex flex-col">
      {hero ? <HeroBanner hero={hero} /> : <div className="h-20" />}
      <div className="relative z-10 -mt-12 flex flex-col gap-8 pb-16 sm:-mt-20">
        <ResumeRow title="Continue Watching" items={continueWatching} />
        <ResumeRow title="Up Next" items={upNext} />
        <MediaRow title="Recently Added" items={recentlyAdded} />
        {rows.map((row) => (
          <MediaRow
            key={row.slug}
            title={row.title}
            items={row.items}
            seeAllHref={row.seeAllHref}
          />
        ))}
        <MediaRow title="My List" items={myList} seeAllHref={myList.length > 0 ? "/my-list" : undefined} />
      </div>
    </main>
  );
}

function EmptyLibrary() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-3xl font-bold">Your library is empty</h1>
      <p className="max-w-md text-muted">
        Seed the sample title with{" "}
        <code className="rounded bg-surface px-1.5 py-0.5 text-sm">npm run seed:sample</code>
        , or add your own files in{" "}
        <code className="rounded bg-surface px-1.5 py-0.5 text-sm">
          src/scripts/library.config.ts
        </code>{" "}
        and run{" "}
        <code className="rounded bg-surface px-1.5 py-0.5 text-sm">npm run ingest</code>.
      </p>
      <Link href="/" className="text-accent hover:underline">
        Refresh
      </Link>
    </main>
  );
}
