"use client";

import { useActionState, useId, useState } from "react";

import {
  updateParentalControlsAction,
  type ProfileFormState,
} from "@/app/actions/profile";
import type { Profile } from "@/db/schema";
import { KIDS_DEFAULT_CERTIFICATIONS, RATING_OPTIONS } from "@/lib/content-rules";

const initialState: ProfileFormState = {};

const CHECKBOX_CLASS = "flex items-center gap-2 text-sm cursor-pointer";
const GROUP_LABEL_CLASS =
  "text-[11px] font-semibold uppercase tracking-wide text-muted";

/**
 * Per-profile parental controls, shown on /profiles under each profile.
 *
 * Only rendered for a grown-up viewer — the page omits it entirely when the
 * active profile is restricted, and the server action refuses that case too.
 */
export default function ParentalControlsForm({
  profile,
  genres,
}: Readonly<{
  profile: Profile;
  genres: { id: number; name: string }[];
}>) {
  const [state, action, pending] = useActionState(
    updateParentalControlsAction,
    initialState,
  );
  const [open, setOpen] = useState(false);
  const [isKids, setIsKids] = useState(profile.isKids === 1);
  const panelId = useId();

  // An existing kids profile keeps its saved allowance; a brand-new one that's
  // just been ticked starts from the defaults rather than "nothing allowed".
  const allowed = new Set(profile.allowedCertifications ?? KIDS_DEFAULT_CERTIFICATIONS);
  const blocked = new Set(profile.blockedGenreIds ?? []);

  const movieRatings = RATING_OPTIONS.filter((r) => r.scale === "movie");
  const tvRatings = RATING_OPTIONS.filter((r) => r.scale === "tv");

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="rounded px-2 py-1 text-xs font-medium text-muted ring-1 ring-white/20 transition hover:bg-white/5 cursor-pointer"
      >
        {open ? "Hide parental controls" : "Parental controls"}
        {profile.isKids === 1 ? " · Kids" : ""}
      </button>

      {open ? (
        <form id={panelId} action={action} className="mt-3 flex flex-col gap-4">
          <input type="hidden" name="profileId" value={profile.id} />

          <label className={CHECKBOX_CLASS}>
            <input
              type="checkbox"
              name="isKids"
              checked={isKids}
              onChange={(e) => setIsKids(e.target.checked)}
            />
            <span>
              Kids profile
              <span className="ml-2 text-xs text-muted">
                Limit this profile to the ratings and genres below
              </span>
            </span>
          </label>

          {/* Kept mounted but visually muted when off, so unticking "Kids
              profile" doesn't discard the settings the parent already chose. */}
          <fieldset
            disabled={!isKids}
            className={`flex flex-col gap-4 ${isKids ? "" : "opacity-40"}`}
          >
            <div className="flex flex-col gap-2">
              <p className={GROUP_LABEL_CLASS}>Allowed movie ratings</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {movieRatings.map((r) => (
                  <label key={r.code} className={CHECKBOX_CLASS}>
                    <input
                      type="checkbox"
                      name="certifications"
                      value={r.code}
                      defaultChecked={allowed.has(r.code)}
                    />
                    <span title={r.description}>{r.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <p className={GROUP_LABEL_CLASS}>Allowed TV ratings</p>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                {tvRatings.map((r) => (
                  <label key={r.code} className={CHECKBOX_CLASS}>
                    <input
                      type="checkbox"
                      name="certifications"
                      value={r.code}
                      defaultChecked={allowed.has(r.code)}
                    />
                    <span title={r.description}>{r.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <label className={CHECKBOX_CLASS}>
              <input
                type="checkbox"
                name="allowUnrated"
                defaultChecked={profile.allowUnrated === 1}
              />
              <span>
                Allow unrated titles
                <span className="ml-2 text-xs text-muted">
                  Anything with no rating from TMDB — off is the safer choice
                </span>
              </span>
            </label>

            <div className="flex flex-col gap-2">
              <p className={GROUP_LABEL_CLASS}>Blocked genres</p>
              {genres.length === 0 ? (
                <p className="text-xs text-muted">
                  No genres in the library yet — run a scan first.
                </p>
              ) : (
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {genres.map((g) => (
                    <label key={g.id} className={CHECKBOX_CLASS}>
                      <input
                        type="checkbox"
                        name="blockedGenres"
                        value={g.id}
                        defaultChecked={blocked.has(g.id)}
                      />
                      <span>{g.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </fieldset>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-white/10 px-3 py-2 text-sm font-medium transition hover:bg-white/20 disabled:opacity-60 cursor-pointer"
            >
              {pending ? "Saving…" : "Save controls"}
            </button>
            {state.error ? <p className="text-xs text-accent">{state.error}</p> : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
