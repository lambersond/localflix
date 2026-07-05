import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";

import { localAvatarFile } from "@/lib/avatar-store";

// Serves uploaded avatars from disk at request time. Next.js does NOT serve
// files added to public/ after startup, so uploaded avatars must go through a
// route handler. Reads the filesystem → Node runtime only.
export const runtime = "nodejs";

const CONTENT_TYPE: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function GET(
  _request: Request,
  ctx: RouteContext<"/avatars/[file]">,
) {
  const { file } = await ctx.params;
  const path = localAvatarFile(file);
  if (!path) return new Response("Bad request", { status: 400 });

  try {
    const info = await stat(path);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    const stream = Readable.toWeb(
      createReadStream(path),
    ) as unknown as ReadableStream<Uint8Array>;
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": CONTENT_TYPE[extname(path).toLowerCase()] ?? "application/octet-stream",
        "Content-Length": String(info.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
