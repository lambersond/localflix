# syntax=docker/dockerfile:1

# ── deps: install node_modules (better-sqlite3 compiles for linux here) ───────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ── builder: produce the standalone server bundle ────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── runner: minimal image with system ffmpeg ─────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/data/media.sqlite \
    MEDIA_DIR=/media \
    IMAGE_DIR=/data/images \
    FFMPEG_PATH=/usr/bin/ffmpeg

# System ffmpeg used by the transcode job + CLI.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# Standalone server, static assets, public dir, and migrations (run at startup).
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle

# Mount points: /data (sqlite), /data/images (cached artwork — can be its own
# bind-mount / disk), and /media (your library, NAS bind-mount).
RUN mkdir -p /data /data/images /media ./public/avatars

VOLUME ["/data", "/data/images", "/media"]
EXPOSE 3000

# Report health to Container Manager. slim has no curl, so use Node's global
# fetch; allow a generous start period for first-boot migrations + index seed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# instrumentation.ts runs migrations + starts the 3 AM scan scheduler on boot.
CMD ["node", "server.js"]
