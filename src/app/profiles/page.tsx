import { deleteProfileAction } from "@/app/actions/profile";
import { listProfiles } from "@/db/queries";

import CreateProfileForm from "../components/profile/CreateProfileForm";
import EditProfileForm from "../components/profile/EditProfileForm";
import ProfileAvatar from "../components/profile/ProfileAvatar";

export const dynamic = "force-dynamic";

export default function ProfilesPage() {
  const profiles = listProfiles();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-16 pt-24 sm:px-8">
      <h1 className="text-2xl font-bold">Manage profiles</h1>

      <div className="flex flex-col gap-4">
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className="flex flex-col gap-4 rounded-lg bg-surface/50 p-4 sm:flex-row sm:items-start"
          >
            <ProfileAvatar profile={profile} size={64} />
            <EditProfileForm profile={profile} />
            <form action={deleteProfileAction}>
              <input type="hidden" name="profileId" value={profile.id} />
              <button
                type="submit"
                className="rounded px-3 py-2 text-sm font-medium text-accent transition hover:bg-accent/10"
              >
                Delete
              </button>
            </form>
          </div>
        ))}
      </div>

      <CreateProfileForm />
    </main>
  );
}
