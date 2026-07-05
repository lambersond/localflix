/**
 * Your media library. Edit this file to point the app at your own video files,
 * then run `npm run ingest`.
 *
 * For each entry, supply EITHER a `tmdbId` (most reliable) OR a `searchTitle`
 * (the ingest script resolves it to the top TMDB match and logs which it used).
 * Find a tmdbId in the URL of a title's TMDB page, e.g.
 * https://www.themoviedb.org/movie/10378 -> 10378.
 */

export interface MovieEntry {
  type: "movie";
  filePath: string;
  tmdbId?: number;
  searchTitle?: string;
}

export interface ShowEntry {
  type: "show";
  tmdbId?: number;
  searchTitle?: string;
  episodes: { season: number; episode: number; filePath: string }[];
}

export type LibraryEntry = MovieEntry | ShowEntry;

/** Reference an entry from a collection by its tmdbId. */
export interface CollectionConfig {
  slug: string;
  title: string;
  kind: "hero" | "row";
  sortOrder?: number;
  items: { type: "movie" | "show"; tmdbId: number }[];
}

export const library: LibraryEntry[] = [
  // {
  //   type: "movie",
  //   filePath: "/absolute/path/to/Some Movie (2021).mp4",
  //   tmdbId: 10378,
  // },
  // {
  //   type: "show",
  //   searchTitle: "Some Show",
  //   episodes: [
  //     { season: 1, episode: 1, filePath: "/path/S01E01.mp4" },
  //     { season: 1, episode: 2, filePath: "/path/S01E02.mp4" },
  //   ],
  // },
];

export const collections: CollectionConfig[] = [
  // {
  //   slug: "featured",
  //   title: "Featured",
  //   kind: "hero",
  //   items: [{ type: "movie", tmdbId: 10378 }],
  // },
  // {
  //   slug: "my-movies",
  //   title: "My Movies",
  //   kind: "row",
  //   sortOrder: 1,
  //   items: [{ type: "movie", tmdbId: 10378 }],
  // },
];
