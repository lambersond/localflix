"use client";

import { useActionState } from "react";

import { createProfileAction, type ProfileFormState } from "@/app/actions/profile";
import { AVATAR_HINT } from "@/lib/avatar";

const initialState: ProfileFormState = {};

export default function CreateProfileForm() {
  const [state, action, pending] = useActionState(createProfileAction, initialState);

  return (
    <form action={action} className="flex w-full max-w-sm flex-col gap-3 rounded-lg bg-surface/60 p-5">
      <h2 className="text-lg font-semibold">Add a profile</h2>
      <input
        name="name"
        required
        maxLength={40}
        placeholder="Name"
        className="rounded bg-black/40 px-3 py-2 text-sm outline-none ring-1 ring-white/15 focus:ring-white/40"
      />
      <label className="text-sm text-muted">
        Avatar (optional) — {AVATAR_HINT}
        <input
          type="file"
          name="avatar"
          accept="image/jpeg,image/png,image/webp"
          className="mt-1 block w-full text-sm text-muted file:mr-3 file:rounded file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-foreground hover:file:bg-white/20"
        />
      </label>
      {state.error ? <p className="text-sm text-accent">{state.error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-foreground px-4 py-2 font-semibold text-background transition hover:bg-foreground/80 disabled:opacity-60"
      >
        {pending ? "Creating…" : "Create profile"}
      </button>
    </form>
  );
}
