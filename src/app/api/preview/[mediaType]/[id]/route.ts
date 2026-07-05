import { NextResponse } from "next/server";

import { getCardPreview } from "@/db/queries";
import { getActiveProfileId } from "@/lib/profile";

// Reads the active profile cookie (for watchlist state), so never cache.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/preview/[mediaType]/[id]">,
) {
  const { mediaType, id } = await ctx.params;
  if (mediaType !== "movie" && mediaType !== "show") {
    return new Response("Not found", { status: 404 });
  }
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    return new Response("Not found", { status: 404 });
  }

  const profileId = await getActiveProfileId();
  const preview = getCardPreview(mediaType, numericId, profileId);
  if (!preview) return new Response("Not found", { status: 404 });

  return NextResponse.json(preview);
}
