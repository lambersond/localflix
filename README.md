## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Media library

Point the app at a folder of video files (set `MEDIA_DIR`, default `./media`). Movies live at
the top level; TV shows live under `shows/` or `tv/`, one folder per show, with `SxxEyy` (or
`1x02`) in each episode filename. Metadata is pulled from TMDB — set a v4 read token in
`.env.local`:

```bash
TMDB_API_TOKEN=...   # https://www.themoviedb.org/settings/api
```

### Scanning

```bash
npm run scan          # walk MEDIA_DIR, match titles on TMDB, populate the library
npm run scan -- --new # only ingest files not already in the library (skips TMDB for the rest)
```

By default the scan ingests every video, including formats browsers can't play natively (e.g.
`.avi`, `.mkv`). Toggle this on the **/admin** page ("Include non-playable files when scanning"),
or force-skip from the CLI with `npm run scan -- --skip-non-playable`.

**Incremental scans.** `--new` (or the **/admin** "Only new files" checkbox) skips every file already in
the library, so fixing a handful of titles doesn't re-query thousands on TMDB. New titles still join the
home rows, search index, and browse pages.

**Scan logs.** Each scan (and transcode/artwork run) writes a full, timestamped log to `LOG_DIR`
(default `./data/logs`, e.g. `scan-2026-07-16T09-30-00-000Z.log`) so failures that scroll past the live
panel can be reviewed afterwards. Failed lookups are logged as `✗ NO TMDB MATCH`, `✗ TMDB ERROR`,
`✗ NO SxxEyy`, or `✗ FILE MISSING`, with a per-run summary at the end.

### Transcoding for playback

Browsers can't decode AVI/MKV, so non-playable files must be converted to MP4 (H.264/AAC). Two ways:

```bash
# Prep mode — operate directly on a folder, before/independent of the DB:
npm run transcode -- --dir /path/to/media [--delete-original] [--dry-run]

# DB mode — convert everything already in the library and repoint it:
npm run transcode [-- --delete-original]
```

`--dry-run` (prep mode) lists what would be converted without doing it. Conversion is idempotent —
an existing sibling `.mp4` is reused. The conversion can also be triggered from the **/admin** page.

## Casting to a TV

On the watch screen, a **Cast** button appears when a Google Cast device (Chromecast / Google TV) is on the
network. Casting **sends the file to the device**, which decodes it directly — the page's play/pause/seek then
control the TV, and progress still resumes where you left off. This avoids Chrome's fallback of mirroring the
whole tab (a live re-encode on your computer), which is what stops "due to poor quality" when the machine can't
keep up.

Two things to know:

- **Open the app by its LAN address** (e.g. `http://192.168.1.50:3000`), not `localhost` — the Chromecast has
  to fetch the video from your server, and it can't reach `localhost`. The player shows a hint if you're on
  `localhost`.
- The device still has to be able to **decode the file**. Chromecast handles H.264/AAC MP4 up to 1080p natively;
  4K or HEVC/H.265 may fail — convert those with the **Convert** tool (below) first. Works from desktop/Android
  Chrome; iOS Safari has no Google Cast.

## Admin page

`/admin` (no auth — intended for a trusted LAN) lets you:

- **Scan now** — run a TMDB scan on demand; shows the last run and the next scheduled run.
- **Convert all** — transcode non-playable files to MP4, optionally deleting the originals.
- **Cache artwork now** — download all referenced artwork to local disk (see below).
- Toggles for **Include non-playable files** and **Download artwork during scan**.

A daily scan runs automatically at **03:00 local time** (`SCAN_AT_HOUR`, set `off` to disable). Set
`SCAN_ON_STARTUP=true` to also scan when the server boots.

## Offline artwork

Posters, backdrops, cast photos, and stills are served from `/tmdb-img/...`, which reads from a
local cache (`IMAGE_DIR`) and only falls back to TMDB on a miss. A scan pre-downloads everything
(toggle: **Download artwork during scan**), so once scanned the app shows artwork with no internet —
ideal for a NAS. Cache on demand from the admin page or with `npm run scan` (use `npm run scan --
--no-artwork` to skip). `IMAGE_DIR` is its own volume so it can live on a larger disk.

## Self-hosting with Docker

A prebuilt image is published on Docker Hub — no need to build it yourself:

**[hub.docker.com/r/lambersond/personal-media-host](https://hub.docker.com/r/lambersond/personal-media-host)**

```bash
docker pull lambersond/personal-media-host

docker run -d --name media-host -p 3000:3000 \
  -e TMDB_API_TOKEN=... \
  -v /nas/media:/media \                       # your library (symlinks are followed)
  -v $(pwd)/data:/data \                       # sqlite db
  -v /nas/artwork:/data/images \               # cached artwork (own disk; or omit to keep under /data)
  -v $(pwd)/data/avatars:/app/public/avatars \ # persist uploaded profile avatars
  lambersond/personal-media-host
```

The image bundles a standalone server and system `ffmpeg`. Migrations run automatically on startup
(`src/instrumentation.ts`), so a fresh volume is set up on first boot.

### Tags

| Tag           | Meaning                                                     |
| ------------- | ----------------------------------------------------------- |
| `latest`      | Most recent release. Fine for a home server.                 |
| `1`, `1.2`    | Floating major / minor — picks up patches automatically.     |
| `1.2.0`       | Exact release. Pin this if you want reproducible deploys.    |
| `sha-<commit>`| The exact commit an image was built from.                    |

> **Architecture:** images are published for **linux/amd64** only. On an arm64 host (Apple Silicon,
> Raspberry Pi) Docker will either refuse to run it or fall back to slow emulation — pass
> `--platform linux/amd64` to emulate, or build natively from source (below).

### Building from source instead

```bash
docker build -t personal-media-host .
```

Then run it exactly as above, substituting `personal-media-host` for the image name.

### Environment variables

| Variable           | Default               | Purpose                                            |
| ------------------ | --------------------- | -------------------------------------------------- |
| `TMDB_API_TOKEN`   | —                     | TMDB v4 read token (required for scanning).        |
| `MEDIA_DIR`        | `/media` (Docker)     | Root folder scanned for media.                     |
| `DATABASE_PATH`    | `/data/media.sqlite`  | SQLite database file.                              |
| `IMAGE_DIR`        | `/data/images`        | Local artwork cache (its own volume; point anywhere). |
| `LOG_DIR`          | `/data/logs`          | Timestamped per-run scan/transcode/artwork logs.   |
| `FFMPEG_PATH`      | `/usr/bin/ffmpeg`     | ffmpeg binary (falls back to `ffmpeg-static`).     |
| `SCAN_AT_HOUR`     | `3`                   | Hour (0–23, local) of the daily scan; `off` to disable. |
| `SCAN_ON_STARTUP`  | `false`               | Also scan once when the server starts.             |
