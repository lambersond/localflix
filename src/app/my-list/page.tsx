import Link from "next/link";

import MediaGrid from "@/app/components/common/MediaGrid";
import { getMyList } from "@/db/queries";
import { getActiveProfileId } from "@/lib/profile";

export const dynamic = "force-dynamic";

export default async function MyListPage() {
  const profileId = await getActiveProfileId();
  const items = profileId ? getMyList(profileId) : [];

  return (
    <main className="flex flex-col gap-6 px-4 pb-16 pt-24 sm:px-8">
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
    </main>
  );
}
