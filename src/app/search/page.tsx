import InfiniteGrid from "@/app/components/common/InfiniteGrid";
import { searchLibraryPage, PAGE_SIZE } from "@/db/queries";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{ q?: string }>;
}>) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const first = query
    ? searchLibraryPage(query, null, PAGE_SIZE)
    : { items: [], nextCursor: null };

  return (
    <main className="flex flex-col gap-6 px-4 pb-16 pt-24 sm:px-8">
      <h1 className="text-2xl font-bold">
        {query ? (
          <>
            Results for{" "}
            <span className="text-muted">&ldquo;{query}&rdquo;</span>
          </>
        ) : (
          "Search"
        )}
      </h1>

      {query && first.items.length === 0 ? (
        <p className="text-muted">No titles match your search.</p>
      ) : (
        <InfiniteGrid key={query} kind="search" query={query} initial={first} />
      )}
    </main>
  );
}
