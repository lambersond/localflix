"use client";

import { useActionState } from "react";

import { updateProfileAction, type ProfileFormState } from "@/app/actions/profile";
import type { Profile } from "@/db/schema";
import { AVATAR_HINT } from "@/lib/avatar";

const initialState: ProfileFormState = {};

export default function EditProfileForm({ profile }: Readonly<{ profile: Profile }>) {
  const [state, action, pending] = useActionState(updateProfileAction, initialState);

  return (
    <form
      action={action}
      className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
    >
      <input type="hidden" name="profileId" value={profile.id} />
      <input
        name="name"
        required
        maxLength={40}
        defaultValue={profile.name}
        className="min-w-0 flex-1 rounded bg-black/40 px-3 py-2 text-sm outline-none ring-1 ring-white/15 focus:ring-white/40"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-white/10 px-3 py-2 text-sm font-medium transition hover:bg-white/20 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save"}
      </button>
      <label className="flex w-full items-center gap-2 text-xs text-muted">
        <input
          type="file"
          name="avatar"
          accept="image/jpeg,image/png,image/webp"
          className="min-w-0 file:mr-2 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-foreground hover:file:bg-white/20"
        />
        <span className="whitespace-nowrap">{AVATAR_HINT}</span>
      </label>
      {state.error ? <p className="w-full text-xs text-accent">{state.error}</p> : null}
    </form>
  );
}
