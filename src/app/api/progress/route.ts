import { recordProgress } from "@/db/queries";
import { parsePlayableId } from "@/lib/media";
import { getActiveProfileId } from "@/lib/profile";

// Needs the Node runtime (native sqlite). Fire-and-forget beacon target.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const profileId = await getActiveProfileId();
  if (profileId === null) return new Response(null, { status: 204 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(null, { status: 204 });
  }

  const { playableId, position, duration } = (body ?? {}) as {
    playableId?: string;
    position?: number;
    duration?: number;
  };

  const parsed = typeof playableId === "string" ? parsePlayableId(playableId) : null;
  if (!parsed || typeof position !== "number" || !Number.isFinite(position)) {
    return new Response(null, { status: 204 });
  }

  recordProgress(
    profileId,
    parsed.kind,
    parsed.numericId,
    Math.max(0, position),
    typeof duration === "number" && Number.isFinite(duration) ? duration : null,
    parsed.versionId,
  );

  return new Response(null, { status: 204 });
}
