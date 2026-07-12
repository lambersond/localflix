import Link from "next/link";

interface KeywordChipsProps {
  keywords: { id: number; name: string }[];
}

/**
 * Keyword chips for a detail page. Keywords are indexed in the search index, so
 * each chip links to a search for that term.
 */
export default function KeywordChips({ keywords }: Readonly<KeywordChipsProps>) {
  if (keywords.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Keywords</h2>
      <div className="flex flex-wrap gap-2">
        {keywords.map((k) => (
          <Link
            key={k.id}
            href={`/search?q=${encodeURIComponent(k.name)}`}
            className="rounded-full bg-white/10 px-3 py-1 text-xs text-foreground/80 transition hover:bg-white/20 hover:text-foreground"
          >
            {k.name}
          </Link>
        ))}
      </div>
    </section>
  );
}
