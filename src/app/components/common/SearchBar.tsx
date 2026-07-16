"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const DEBOUNCE_MS = 200;

interface SearchBarProps {
  /** "bar" = compact navbar pill (default); "page" = full-width field for /search. */
  variant?: "bar" | "page";
  autoFocus?: boolean;
  initialQuery?: string;
}

export default function SearchBar({
  variant = "bar",
  autoFocus = false,
  initialQuery = "",
}: Readonly<SearchBarProps> = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(initialQuery);

  // Read the current path without making it an effect dependency: the bar lives
  // in the persistent navbar, so if `pathname` drove the effect, navigating away
  // from /search (e.g. clicking a result) would re-fire it and push us back to
  // /search while the input still holds the query. Navigation must be driven by
  // typing (`value`) only.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  // Debounce: 200ms after typing stops, show the filtered grid page.
  useEffect(() => {
    const handle = setTimeout(() => {
      const q = value.trim();
      const onSearch = pathnameRef.current === "/search";
      const currentQ = onSearch
        ? new URLSearchParams(window.location.search).get("q")?.trim() ?? ""
        : null;
      if (onSearch) {
        // Already on the grid page — update results without stacking history,
        // but skip a no-op replace (e.g. this field mounting with its query).
        if (q !== currentQ) {
          router.replace(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
        }
      } else if (q) {
        router.push(`/search?q=${encodeURIComponent(q)}`);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [value, router]);

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const q = value.trim();
    if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  const page = variant === "page";

  return (
    <form onSubmit={onSubmit} className={page ? "w-full" : undefined}>
      <label
        className={`flex items-center gap-2 rounded-full bg-black/50 px-3 py-2 ring-1 ring-white/20 focus-within:ring-white/50${
          page ? " w-full" : ""
        }`}
      >
        <span aria-hidden className="text-muted">
          🔍
        </span>
        <input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus={autoFocus}
          placeholder="Title, actor, or genre…"
          aria-label="Search by title, actor, or genre"
          className={
            page
              ? "w-full bg-transparent text-base text-foreground outline-none placeholder:text-muted"
              : "w-32 bg-transparent text-sm text-foreground outline-none placeholder:text-muted sm:w-44 sm:focus:w-64"
          }
        />
      </label>
    </form>
  );
}
