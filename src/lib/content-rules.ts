import type { Profile } from "@/db/schema";

/**
 * Parental controls. A profile marked `isKids` only sees titles whose content
 * rating is in its allowed set and whose genres it isn't blocked from.
 *
 * This module is pure (no DB, no `next/headers`) so the settings UI can import
 * the vocabulary. `getContentRules()` in `@/lib/profile` resolves the active
 * profile into a `ContentRules`; `@/db/queries` turns one into SQL.
 */

export interface RatingOption {
  /** The exact string stored in `movies.certification` / `shows.certification`. */
  code: string;
  label: string;
  /** Which scale it belongs to — the two are disjoint, so the UI groups them. */
  scale: "movie" | "tv";
  description: string;
}

/**
 * The US ratings TMDB reports, in increasing maturity within each scale.
 * `getMovieCertification` / `getShowCertification` (`@/lib/tmdb`) fetch the US
 * region, so these are the codes that actually land in the database.
 */
export const RATING_OPTIONS: RatingOption[] = [
  { code: "G", label: "G", scale: "movie", description: "All ages" },
  { code: "PG", label: "PG", scale: "movie", description: "Parental guidance" },
  { code: "PG-13", label: "PG-13", scale: "movie", description: "Over 13" },
  { code: "R", label: "R", scale: "movie", description: "Restricted" },
  { code: "NC-17", label: "NC-17", scale: "movie", description: "Adults only" },
  { code: "TV-Y", label: "TV-Y", scale: "tv", description: "All children" },
  { code: "TV-Y7", label: "TV-Y7", scale: "tv", description: "Ages 7+" },
  { code: "TV-G", label: "TV-G", scale: "tv", description: "All ages" },
  { code: "TV-PG", label: "TV-PG", scale: "tv", description: "Parental guidance" },
  { code: "TV-14", label: "TV-14", scale: "tv", description: "Ages 14+" },
  { code: "TV-MA", label: "TV-MA", scale: "tv", description: "Mature audiences" },
];

/** Every code above, for the "is this rating one we recognize?" test. */
export const KNOWN_RATING_CODES: string[] = RATING_OPTIONS.map((r) => r.code);

/**
 * What a brand-new kids profile allows: everything up to and including PG /
 * TV-PG. PG-13, R, NC-17, TV-14 and TV-MA are excluded, and so is anything
 * unrated (see `allowUnrated`).
 */
export const KIDS_DEFAULT_CERTIFICATIONS: string[] = [
  "G",
  "PG",
  "TV-Y",
  "TV-Y7",
  "TV-G",
  "TV-PG",
];

export interface ContentRules {
  /** False ⇒ the whole library is visible and the other fields are ignored. */
  restricted: boolean;
  allowedCertifications: string[];
  /** Whether titles with no rating — or one we don't recognize — are visible. */
  allowUnrated: boolean;
  blockedGenreIds: number[];
}

/** An adult / parent profile: no filtering at all. */
export const UNRESTRICTED_RULES: ContentRules = {
  restricted: false,
  allowedCertifications: [],
  allowUnrated: true,
  blockedGenreIds: [],
};

/**
 * The rules for a profile. A missing profile (no cookie yet) is unrestricted —
 * the root layout shows the "Who's watching?" gate in that case anyway, so
 * there is no content to leak.
 */
export function rulesForProfile(profile: Profile | null | undefined): ContentRules {
  if (!profile || profile.isKids !== 1) return UNRESTRICTED_RULES;
  return {
    restricted: true,
    allowedCertifications: profile.allowedCertifications ?? [],
    allowUnrated: profile.allowUnrated === 1,
    blockedGenreIds: profile.blockedGenreIds ?? [],
  };
}

/**
 * Whether a stored certification is visible under `rules`.
 *
 * "Unrated" is defined by exclusion rather than by a literal: TMDB emits `NR`,
 * `UR`, `Unrated`, `""` and region-specific strings besides plain nulls, so
 * anything outside `KNOWN_RATING_CODES` falls into the unrated bucket instead
 * of slipping through unfiltered.
 */
export function isCertificationAllowed(
  rules: ContentRules,
  certification: string | null | undefined,
): boolean {
  if (!rules.restricted) return true;
  const code = certification?.trim() ?? "";
  if (code !== "" && KNOWN_RATING_CODES.includes(code)) {
    return rules.allowedCertifications.includes(code);
  }
  return rules.allowUnrated;
}

/** Whether a title's genre ids clear `rules`. */
export function areGenresAllowed(rules: ContentRules, genreIds: number[]): boolean {
  if (!rules.restricted || rules.blockedGenreIds.length === 0) return true;
  return !genreIds.some((id) => rules.blockedGenreIds.includes(id));
}

/** Drop anything that isn't a rating we know — the form is not the authority. */
export function sanitizeCertifications(codes: readonly string[]): string[] {
  return codes.filter((code) => KNOWN_RATING_CODES.includes(code));
}

/**
 * A restricted profile needs *some* way to see content. Allowing no ratings and
 * no unrated titles would leave an empty library, which reads as a broken app
 * rather than as a setting.
 */
export function isUsableAllowance(
  allowedCertifications: readonly string[],
  allowUnrated: boolean,
): boolean {
  return allowedCertifications.length > 0 || allowUnrated;
}
