import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { Readable } from "node:stream";

import {
  DEFAULT_LAZY_SIZE,
  ensureImage,
  localFileFor,
  tmdbCdnUrl,
} from "@/lib/images";

// Reads/writes local files; never the Edge runtime. Long-cache immutable assets.
export const runtime = "nodejs";

const CONTENT_TYPE: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function serve(file: string, size: number): Response {
  const stream = Readable.toWeb(
    createReadStream(file),
  ) as unknown as ReadableStream<Uint8Array>;
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": CONTENT_TYPE[extname(file).toLowerCase()] ?? "image/jpeg",
      "Content-Length": String(size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

export async function GET(
  _request: Request,
  ctx: RouteContext<"/tmdb-img/[...path]">,
) {
  const { path } = await ctx.params;
  const tmdbPath = (Array.isArray(path) ? path.join("/") : path) ?? "";

  const file = localFileFor(tmdbPath);
  if (!file) return new Response("Bad request", { status: 400 });

  // Disk-first: serve the cached copy.
  try {
    const info = await stat(file);
    if (info.isFile()) return serve(file, info.size);
  } catch {
    // not cached yet — fall through to lazy fetch
  }

  // Miss: download from TMDB, cache, and serve. On failure, redirect to the CDN
  // so images still work when online even if the local write fails.
  try {
    await ensureImage(tmdbPath, DEFAULT_LAZY_SIZE);
    const info = await stat(file);
    return serve(file, info.size);
  } catch {
    return Response.redirect(tmdbCdnUrl(tmdbPath, DEFAULT_LAZY_SIZE), 302);
  }
}
