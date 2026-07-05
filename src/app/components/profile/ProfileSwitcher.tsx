"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { selectProfileAction } from "@/app/actions/profile";
import type { Profile } from "@/db/schema";

import ProfileAvatar from "./ProfileAvatar";

interface ProfileSwitcherProps {
  activeProfile: Profile;
  profiles: Profile[];
}

export default function ProfileSwitcher({
  activeProfile,
  profiles,
}: Readonly<ProfileSwitcherProps>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const others = profiles.filter((p) => p.id !== activeProfile.id);

  return (
    <div ref={ref} className="relative ml-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md p-0.5 outline-none ring-white/40 focus-visible:ring-2"
      >
        <ProfileAvatar profile={activeProfile} size={32} />
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-52 rounded-md bg-surface p-2 shadow-2xl ring-1 ring-white/10">
          <p className="px-2 py-1 text-xs uppercase tracking-wide text-muted">
            Switch profile
          </p>
          {others.map((profile) => (
            <form key={profile.id} action={selectProfileAction}>
              <input type="hidden" name="profileId" value={profile.id} />
              <button
                type="submit"
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition hover:bg-white/10"
              >
                <ProfileAvatar profile={profile} size={24} />
                <span className="truncate">{profile.name}</span>
              </button>
            </form>
          ))}
          {others.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted">No other profiles</p>
          ) : null}
          <Link
            href="/profiles"
            onClick={() => setOpen(false)}
            className="mt-1 block rounded px-2 py-1.5 text-sm text-muted transition hover:bg-white/10 hover:text-foreground"
          >
            Manage profiles
          </Link>
        </div>
      ) : null}
    </div>
  );
}
