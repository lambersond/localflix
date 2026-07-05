import Image from "next/image";

import type { Profile } from "@/db/schema";

interface ProfileAvatarProps {
  profile: Pick<Profile, "name" | "avatarPath">;
  size?: number;
}

export default function ProfileAvatar({ profile, size = 40 }: Readonly<ProfileAvatarProps>) {
  const dimensions = { width: size, height: size };

  if (profile.avatarPath) {
    return (
      <Image
        src={profile.avatarPath}
        alt={profile.name}
        width={size}
        height={size}
        unoptimized
        style={dimensions}
        className="rounded-md object-cover"
      />
    );
  }

  const initial = profile.name.trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      style={dimensions}
      className="flex items-center justify-center rounded-md bg-surface font-semibold text-foreground"
    >
      {initial}
    </div>
  );
}
