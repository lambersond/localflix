"use client";

import { useCallback, useRef, useState } from "react";

import { loadGridPage } from "@/app/actions/library";
import type { CardItem, GridKind, PageResult } from "@/db/queries";

import VirtualGrid from "./VirtualGrid";

interface InfiniteGridProps {
  kind: GridKind;
  query?: string;
  initial: PageResult;
}

export default function InfiniteGrid({
  kind,
  query,
  initial,
}: Readonly<InfiniteGridProps>) {
  const [items, setItems] = useState<CardItem[]>(initial.items);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || cursor === null) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const page = await loadGridPage(kind, cursor, query);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [cursor, kind, query]);

  return (
    <div className="flex flex-col gap-4">
      <VirtualGrid items={items} onEndReached={cursor !== null ? loadMore : undefined} />
      {loading ? <div className="py-6 text-center text-sm text-muted">Loading…</div> : null}
    </div>
  );
}
