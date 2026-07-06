import Link from "next/link";

import type { Profile } from "@/db/schema";

import ProfileSwitcher from "../profile/ProfileSwitcher";
import MobileMenu from "./MobileMenu";
import SearchBar from "./SearchBar";

const links = [
  { href: "/", label: "Home" },
  { href: "/movies", label: "Movies" },
  { href: "/shows", label: "TV Shows" },
  { href: "/my-list", label: "My List" },
];

interface NavbarProps {
  activeProfile: Profile;
  profiles: Profile[];
}

export default function Navbar({ activeProfile, profiles }: Readonly<NavbarProps>) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 bg-gradient-to-b from-black/90 to-transparent">
      <nav className="mx-auto flex max-w-[1800px] items-center gap-3 px-4 py-3 sm:gap-8 sm:px-8 sm:py-4">
        <Link
          href="/"
          className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl"
        >
          Local<span className="text-accent">Flix</span>
        </Link>
        <div className="hidden items-center gap-5 text-sm text-muted sm:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="transition hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {/* Inline on desktop; on mobile these live inside the hamburger menu. */}
          <div className="hidden sm:block">
            <SearchBar />
          </div>
          <div className="hidden sm:block">
            <ProfileSwitcher activeProfile={activeProfile} profiles={profiles} />
          </div>
          <MobileMenu links={links} activeProfile={activeProfile} profiles={profiles} />
        </div>
      </nav>
    </header>
  );
}
