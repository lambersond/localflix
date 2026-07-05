/**
 * Runs once when a Next.js server instance starts. We only need the Node side
 * (SQLite + ffmpeg), so guard against the Edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
