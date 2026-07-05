"use server";

import {
  getMoviesPage,
  getShowsPage,
  searchLibraryPage,
  type GridKind,
  type PageResult,
} from "@/db/queries";

/** Fetch the next page for an infinite-scroll grid (movies / shows / search). */
export async function loadGridPage(
  kind: GridKind,
  cursor: string | null,
  query?: string,
): Promise<PageResult> {
  switch (kind) {
    case "movies":
      return getMoviesPage(cursor);
    case "shows":
      return getShowsPage(cursor);
    case "search":
      return searchLibraryPage(query ?? "", cursor);
  }
}
