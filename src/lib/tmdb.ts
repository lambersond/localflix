/**
 * Minimal TMDB (The Movie DB) v3 client using a v4 bearer token.
 * Only the fields we consume are typed.
 */

// Re-export the client-safe image helpers so existing server imports of
// `@/lib/tmdb` keep working.
export { tmdbImage } from "./tmdb-image";

const BASE = "https://api.themoviedb.org/3";

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbCollectionRef {
  id: number;
  name: string;
  poster_path: string | null;
  backdrop_path: string | null;
}

export interface TmdbMovieDetails {
  id: number;
  title: string;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string | null;
  runtime: number | null;
  belongs_to_collection: TmdbCollectionRef | null;
  genres: TmdbGenre[];
}

export interface TmdbShowDetails {
  id: number;
  name: string;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string | null;
  genres: TmdbGenre[];
}

export interface TmdbEpisode {
  episode_number: number;
  name: string | null;
  overview: string | null;
  still_path: string | null;
  runtime: number | null;
  air_date: string | null;
}

export interface TmdbSeasonDetails {
  season_number: number;
  name: string | null;
  overview: string | null;
  poster_path: string | null;
  episodes: TmdbEpisode[];
}

interface TmdbSearchResult {
  id: number;
}

interface TmdbSearchResponse {
  results: TmdbSearchResult[];
}

export interface TmdbCastMember {
  id: number;
  name: string;
  profile_path: string | null;
  order?: number;
}

interface TmdbCreditsResponse {
  cast: TmdbCastMember[];
}

function token(): string {
  const value = process.env.TMDB_API_TOKEN;
  if (!value) {
    throw new Error(
      "TMDB_API_TOKEN is not set. Add your TMDB v4 read access token to .env.local.",
    );
  }
  return value;
}

async function tmdbFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token()}`,
      accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`TMDB ${res.status} for ${path}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export async function searchMovie(
  query: string,
  year?: number,
): Promise<number | null> {
  const params = new URLSearchParams({ query });
  if (year) params.set("year", String(year));
  const data = await tmdbFetch<TmdbSearchResponse>(
    `/search/movie?${params.toString()}`,
  );
  return data.results[0]?.id ?? null;
}

export async function searchTv(query: string): Promise<number | null> {
  const data = await tmdbFetch<TmdbSearchResponse>(
    `/search/tv?query=${encodeURIComponent(query)}`,
  );
  return data.results[0]?.id ?? null;
}

export function getMovieDetails(tmdbId: number): Promise<TmdbMovieDetails> {
  return tmdbFetch<TmdbMovieDetails>(`/movie/${tmdbId}`);
}

export function getShowDetails(tmdbId: number): Promise<TmdbShowDetails> {
  return tmdbFetch<TmdbShowDetails>(`/tv/${tmdbId}`);
}

export function getSeasonDetails(
  tmdbId: number,
  seasonNumber: number,
): Promise<TmdbSeasonDetails> {
  return tmdbFetch<TmdbSeasonDetails>(`/tv/${tmdbId}/season/${seasonNumber}`);
}

export async function getMovieCast(tmdbId: number): Promise<TmdbCastMember[]> {
  const data = await tmdbFetch<TmdbCreditsResponse>(`/movie/${tmdbId}/credits`);
  return data.cast;
}

export async function getShowCast(tmdbId: number): Promise<TmdbCastMember[]> {
  const data = await tmdbFetch<TmdbCreditsResponse>(`/tv/${tmdbId}/credits`);
  return data.cast;
}

interface TmdbReleaseDatesResponse {
  results: {
    iso_3166_1: string;
    release_dates: { certification: string }[];
  }[];
}

interface TmdbContentRatingsResponse {
  results: { iso_3166_1: string; rating: string }[];
}

/** Movie content rating (e.g. "PG-13", "R") for a region, or null. */
export async function getMovieCertification(
  tmdbId: number,
  region = "US",
): Promise<string | null> {
  const data = await tmdbFetch<TmdbReleaseDatesResponse>(
    `/movie/${tmdbId}/release_dates`,
  );
  const entry = data.results.find((r) => r.iso_3166_1 === region);
  const cert = entry?.release_dates
    .map((d) => d.certification)
    .find((c) => c && c.trim() !== "");
  return cert?.trim() ?? null;
}

/** TV content rating (e.g. "TV-MA", "TV-14") for a region, or null. */
export async function getShowCertification(
  tmdbId: number,
  region = "US",
): Promise<string | null> {
  const data = await tmdbFetch<TmdbContentRatingsResponse>(
    `/tv/${tmdbId}/content_ratings`,
  );
  const entry = data.results.find((r) => r.iso_3166_1 === region);
  return entry?.rating?.trim() || null;
}

