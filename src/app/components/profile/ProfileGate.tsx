import { selectProfileAction } from "@/app/actions/profile";
import type { Profile } from "@/db/schema";

import CreateProfileForm from "./CreateProfileForm";
import ProfileAvatar from "./ProfileAvatar";

export default function ProfileGate({ profiles }: Readonly<{ profiles: Profile[] }>) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-10 p-6">
      <h1 className="text-3xl font-semibold sm:text-5xl">Who&apos;s watching?</h1>

      {profiles.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-6">
          {profiles.map((profile) => (
            <form key={profile.id} action={selectProfileAction}>
              <input type="hidden" name="profileId" value={profile.id} />
              <button
                type="submit"
                className="group flex flex-col items-center gap-3 outline-none"
              >
                <span className="transition group-hover:scale-105 group-focus-visible:ring-2 group-focus-visible:ring-white/60">
                  <ProfileAvatar profile={profile} size={112} />
                </span>
                <span className="text-muted transition group-hover:text-foreground">
                  {profile.name}
                </span>
              </button>
            </form>
          ))}
        </div>
      ) : null}

      <CreateProfileForm />
    </main>
  );
}
