"use server";

import {
  getMoviesPage,
  getShowsPage,
  searchLibraryPage,
  type GridKind,
  type PageResult,
} from "@/db/queries";
import { getContentRules } from "@/lib/profile";

/** Fetch the next page for an infinite-scroll grid (movies / shows / search). */
export async function loadGridPage(
  kind: GridKind,
  cursor: string | null,
  query?: string,
): Promise<PageResult> {
  // Re-read the rules here rather than trusting the client: this action is the
  // pagination path for all three grids and is callable directly.
  const rules = await getContentRules();
  switch (kind) {
    case "movies":
      return getMoviesPage(cursor, rules);
    case "shows":
      return getShowsPage(cursor, rules);
    case "search":
      return searchLibraryPage(query ?? "", cursor, rules);
  }
}
