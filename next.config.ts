import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) for the Docker image.
  output: "standalone",
  // better-sqlite3 is a native module; opt it out of Server Component bundling
  // so Next uses a native require at runtime.
  serverExternalPackages: ["better-sqlite3"],
  // ffmpeg comes from the system package (apt) in Docker via FFMPEG_PATH, so the
  // bundled ffmpeg-static binary is dead weight in the standalone trace.
  outputFileTracingExcludes: {
    "/*": [
      "node_modules/ffmpeg-static/ffmpeg",
      "node_modules/ffmpeg-static/ffmpeg.exe",
    ],
  },
  experimental: {
    // Avatar uploads run through a Server Action; default body limit is 1MB.
    // Raise it above the 5MB avatar cap so oversize files hit our friendly
    // validation instead of this raw error.
    serverActions: {
      bodySizeLimit: "8mb",
    },
  },
  images: {
    // TMDB artwork is hot-linked from its CDN and loaded via next/image.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "image.tmdb.org",
        pathname: "/t/p/**",
      },
    ],
  },
};

export default nextConfig;
