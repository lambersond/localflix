import Link from "next/link";

import InfiniteGrid from "@/app/components/common/InfiniteGrid";
import { getShowsPage, PAGE_SIZE } from "@/db/queries";

export const dynamic = "force-dynamic";

export default function ShowsPage() {
  const first = getShowsPage(null, PAGE_SIZE);

  return (
    <main className="flex flex-col gap-6 px-4 pb-16 pt-20 sm:pt-24 sm:px-8">
      <h1 className="text-2xl font-bold">TV Shows</h1>
      {first.items.length === 0 ? (
        <p className="text-muted">
          No shows yet. Add some in{" "}
          <code className="rounded bg-surface px-1.5 py-0.5 text-sm">
            src/scripts/library.config.ts
          </code>{" "}
          and run{" "}
          <code className="rounded bg-surface px-1.5 py-0.5 text-sm">
            npm run ingest
          </code>
          , or{" "}
          <Link href="/" className="text-accent hover:underline">
            go back home
          </Link>
          .
        </p>
      ) : (
        <InfiniteGrid kind="shows" initial={first} />
      )}
    </main>
  );
}
