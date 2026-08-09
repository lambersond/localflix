import { deleteProfileAction } from "@/app/actions/profile";
import { listGenres, listProfiles } from "@/db/queries";
import { getActiveProfile } from "@/lib/profile";

import CreateProfileForm from "../components/profile/CreateProfileForm";
import EditProfileForm from "../components/profile/EditProfileForm";
import ParentalControlsForm from "../components/profile/ParentalControlsForm";
import ProfileAvatar from "../components/profile/ProfileAvatar";

export const dynamic = "force-dynamic";

export default async function ProfilesPage() {
  const profiles = listProfiles();
  const genres = listGenres();
  // A restricted profile doesn't get to edit anyone's controls — including its
  // own. `updateParentalControlsAction` enforces the same rule server-side.
  const canManageControls = (await getActiveProfile())?.isKids !== 1;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-16 pt-20 sm:pt-24 sm:px-8">
      <h1 className="text-2xl font-bold">Manage profiles</h1>

      <div className="flex flex-col gap-4">
        {profiles.map((profile) => (
          <div
            key={profile.id}
            className="flex flex-col gap-4 rounded-lg bg-surface/50 p-4"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
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
            {canManageControls ? (
              <ParentalControlsForm profile={profile} genres={genres} />
            ) : null}
          </div>
        ))}
      </div>

      <CreateProfileForm showKidsOption={canManageControls} />
    </main>
  );
}
