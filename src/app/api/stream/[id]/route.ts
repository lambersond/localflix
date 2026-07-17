import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { getPlayableFile } from "@/db/queries";
import { mimeTypeForFile, parsePlayableId } from "@/lib/media";

// Needs the Node.js runtime (fs + native sqlite) and must never be cached —
// responses are Range-specific binary streams.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A Cast device fetches this URL directly and can reject media without CORS
// headers; allow any origin (LAN media server) and expose the range headers.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
};

interface ResolvedFile {
  filePath: string;
  fileSize: number;
  contentType: string;
}

/**
 * Resolve a playable id to an on-disk file. Re-stats at request time because
 * the file is the source of truth and may have changed since ingest.
 * Returns a Response (404) on any failure, or the resolved file.
 */
async function resolveFile(id: string): Promise<ResolvedFile | Response> {
  const parsed = parsePlayableId(id);
  if (!parsed) return new Response("Not found", { status: 404 });

  const record = getPlayableFile(parsed);
  if (!record) return new Response("Not found", { status: 404 });

  try {
    const info = await stat(record.filePath);
    if (!info.isFile()) return new Response("Not found", { status: 404 });
    return {
      filePath: record.filePath,
      fileSize: info.size,
      contentType: record.mimeType ?? mimeTypeForFile(record.filePath),
    };
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

interface ByteRange {
  start: number;
  end: number;
}

/** Parse a single-range `Range` header against the file size. */
function parseRange(header: string, fileSize: number): ByteRange | "invalid" {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";

  const [, rawStart, rawEnd] = match;
  let start: number;
  let end: number;

  if (rawStart === "" && rawEnd === "") return "invalid";

  if (rawStart === "") {
    // Suffix range: the last N bytes.
    const n = Number(rawEnd);
    if (n === 0) return "invalid";
    start = Math.max(fileSize - n, 0);
    end = fileSize - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? fileSize - 1 : Number(rawEnd);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end)) return "invalid";
  end = Math.min(end, fileSize - 1);
  if (start > end || start >= fileSize || start < 0) return "invalid";

  return { start, end };
}

/** Stream a byte range of a file as a Web ReadableStream, with abort cleanup. */
function streamFile(
  filePath: string,
  start: number,
  end: number,
  signal: AbortSignal,
): ReadableStream<Uint8Array> {
  const nodeStream = createReadStream(filePath, { start, end });

  const onAbort = () => nodeStream.destroy();
  if (signal.aborted) {
    nodeStream.destroy();
  } else {
    signal.addEventListener("abort", onAbort, { once: true });
  }
  nodeStream.on("close", () => signal.removeEventListener("abort", onAbort));

  return Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
}

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/stream/[id]">,
) {
  const { id } = await ctx.params;
  const resolved = await resolveFile(id);
  if (resolved instanceof Response) return resolved;

  const { filePath, fileSize, contentType } = resolved;
  const rangeHeader = request.headers.get("range");

  // No Range header: return the full file (200).
  if (!rangeHeader) {
    const body = streamFile(filePath, 0, fileSize - 1, request.signal);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        ...CORS_HEADERS,
      },
    });
  }

  const range = parseRange(rangeHeader, fileSize);
  if (range === "invalid") {
    return new Response("Range Not Satisfiable", {
      status: 416,
      headers: {
        "Content-Range": `bytes */${fileSize}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  const { start, end } = range;
  const chunkSize = end - start + 1;
  const body = streamFile(filePath, start, end, request.signal);

  return new Response(body, {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(chunkSize),
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
    },
  });
}

export async function HEAD(
  _request: Request,
  ctx: RouteContext<"/api/stream/[id]">,
) {
  const { id } = await ctx.params;
  const resolved = await resolveFile(id);
  if (resolved instanceof Response) return resolved;

  return new Response(null, {
    status: 200,
    headers: {
      "Content-Type": resolved.contentType,
      "Content-Length": String(resolved.fileSize),
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
    },
  });
}
