"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { selectProfileAction } from "@/app/actions/profile";
import type { Profile } from "@/db/schema";

import ProfileAvatar from "../profile/ProfileAvatar";

interface NavLink {
  href: string;
  label: string;
}

interface MobileMenuProps {
  links: NavLink[];
  activeProfile: Profile;
  profiles: Profile[];
}

/**
 * Small-screen nav (`< sm`): a hamburger that opens a full-screen panel holding
 * everything the desktop top bar shows inline — the browse links, a link to the
 * search page, and the account/profile switcher — in divider-separated sections.
 * Rendered through a portal so it escapes the header's stacking context. Hidden
 * at `sm` and up, where the Navbar's inline controls take over.
 */
export default function MobileMenu({
  links,
  activeProfile,
  profiles,
}: Readonly<MobileMenuProps>) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  // While open: Escape closes, body scroll is locked, and resizing up to `sm`
  // (where the inline nav takes over) closes it so scroll isn't left locked.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const mq = window.matchMedia("(min-width: 640px)");
    const onMq = () => {
      if (mq.matches) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    mq.addEventListener("change", onMq);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onMq);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const others = profiles.filter((p) => p.id !== activeProfile.id);

  return (
    <div className="sm:hidden">
      <button
        type="button"
        aria-label="Open menu"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="flex h-10 w-10 items-center justify-center rounded-md text-foreground transition hover:bg-white/10"
      >
        <span aria-hidden className="text-2xl leading-none">
          ☰
        </span>
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-background sm:hidden">
              {/* Top row: brand + close */}
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <span className="text-xl font-extrabold tracking-tight text-foreground">
                  Local<span className="text-accent">Flix</span>
                </span>
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={close}
                  className="flex h-10 w-10 items-center justify-center rounded-md text-foreground transition hover:bg-white/10"
                >
                  <span aria-hidden className="text-2xl leading-none">
                    ✕
                  </span>
                </button>
              </div>

              {/* Browse */}
              <nav className="flex flex-col px-2 py-2">
                {links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={close}
                    className="rounded-md px-4 py-3 text-lg text-foreground transition hover:bg-white/10"
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>

              {/* Search → the /search page (its top input auto-focuses) */}
              <div className="border-t border-white/10 px-2 py-2">
                <Link
                  href="/search"
                  onClick={close}
                  className="flex items-center gap-3 rounded-md px-4 py-3 text-lg text-foreground transition hover:bg-white/10"
                >
                  <span aria-hidden>🔍</span> Search
                </Link>
              </div>

              {/* Account */}
              <div className="border-t border-white/10 px-4 py-4">
                <p className="px-1 pb-1 text-xs uppercase tracking-wide text-muted">
                  Account
                </p>
                <div className="flex items-center gap-3 px-1 py-2">
                  <ProfileAvatar profile={activeProfile} size={40} />
                  <span className="font-medium">{activeProfile.name}</span>
                </div>

                {others.length > 0 ? (
                  <div className="mt-1 flex flex-col">
                    {others.map((profile) => (
                      <form key={profile.id} action={selectProfileAction}>
                        <input type="hidden" name="profileId" value={profile.id} />
                        <button
                          type="submit"
                          onClick={close}
                          className="flex w-full items-center gap-3 rounded-md px-1 py-2 text-left transition hover:bg-white/10"
                        >
                          <ProfileAvatar profile={profile} size={28} />
                          <span className="truncate text-muted">
                            Switch to {profile.name}
                          </span>
                        </button>
                      </form>
                    ))}
                  </div>
                ) : null}

                <Link
                  href="/profiles"
                  onClick={close}
                  className="mt-2 block rounded-md px-1 py-2 text-muted transition hover:text-foreground"
                >
                  Manage profiles
                </Link>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
