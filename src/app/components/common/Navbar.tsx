import Link from "next/link";

import type { Profile } from "@/db/schema";

import ProfileSwitcher from "../profile/ProfileSwitcher";
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
      <nav className="mx-auto flex max-w-[1800px] items-center gap-8 px-4 py-4 sm:px-8">
        <Link
          href="/"
          className="text-2xl font-extrabold tracking-tight text-accent"
        >
          MEDIA<span className="text-foreground">HOST</span>
        </Link>
        <div className="flex items-center gap-5 text-sm text-muted">
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
        <SearchBar />
        <ProfileSwitcher activeProfile={activeProfile} profiles={profiles} />
      </nav>
    </header>
  );
}
