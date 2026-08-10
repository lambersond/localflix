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
(`./data/logs` locally, `/data/logs` in Docker — e.g. `scan-2026-07-16T09-30-00-000Z.log`) so failures that scroll past the live
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

## Profiles & parental controls

Each viewer picks a profile from the "Who's watching?" screen; profiles keep their own watch progress and
My List. On **Manage profiles** any profile can be marked a **Kids profile**, which limits it to the content
ratings and genres you choose:

- **Allowed ratings** — pick from the US movie scale (`G`, `PG`, `PG-13`, `R`, `NC-17`) and the US TV scale
  (`TV-Y` … `TV-MA`). New kids profiles start at `G`/`PG` and `TV-Y`–`TV-PG`.
- **Allow unrated titles** — off by default for kids. This covers anything TMDB has no rating for, *and* any
  rating outside the lists above, so an unfamiliar rating is hidden rather than let through.
- **Blocked genres** — hide whole genres regardless of rating. Nothing is blocked by default.

Blocked titles are gone from every surface — home rows, Recently Added, Continue Watching, My List, browse,
search, "More Like This", and hover previews — and a direct link to one (`/movie/123`, `/watch/m123`, or the
stream URL itself) returns a plain 404. `/admin` is unavailable while a kids profile is active.

### Show record details

Any grown-up profile can tick **Show record details** on **Manage profiles**. Movie and show pages then carry
an **ⓘ Record details** control next to *Report incorrect*, listing what the record is actually bound to: its
TMDB id (linked), the file(s) it plays, and for a show every episode with its filename and any manual TMDB
link. Seeing the TMDB title beside the filename is what makes a bad mapping obvious — a row reading
*"The Train Job"* over `S01E01 - Serenity.mp4` is wrong at a glance. Report it from the same page and re-match
it in [/admin](#admin-page).

It's display-only: it doesn't grant access to anything (`/admin` is reachable by any grown-up profile either
way), and a kids profile can neither hold the flag nor set it.

**There is no PIN.** Like the rest of the app this trusts everyone on your LAN, so anyone at the device can
switch back to a grown-up profile from the profile menu. Parental controls decide what a kids profile *can
reach*, not who may use which profile.

## Admin page

`/admin` (no auth — intended for a trusted LAN) lets you:

- **Scan now** — run a TMDB scan on demand; shows the last run and the next scheduled run.
- **Convert all** — transcode non-playable files to MP4, optionally deleting the originals.
- **Cache artwork now** — download all referenced artwork to local disk (see below).
- **Fix metadata → Episodes** — point individual episodes at the right TMDB entry (see below).
- Toggles for **Include non-playable files** and **Download artwork during scan**.

### Fixing episode metadata

An episode's metadata is looked up by the number in its filename, which goes wrong more often than you'd
expect: a library ripped in **DVD/production order** doesn't line up with TMDB's **broadcast order**, episodes
that never aired are usually filed under **Specials (season 0)**, and a pilot named `S01E00` has no TMDB episode
0 to match at all — so the row comes out blank.

In **Fix metadata**, search the show and click **Episodes**. Each record can be pointed at any TMDB episode,
*in any season*, by picking from the list or pasting a link like
`themoviedb.org/tv/1437/season/1/episode/11`. **Suggest matches** does the whole show at once by comparing
filenames to episode titles across every season (it tolerates typos — `Bushwacked` still finds `Bushwhacked`);
proposals are shown for review and nothing is written until you apply them.

A link only changes where the metadata comes from. The record keeps its number, its place in the season list,
and its watch progress, and later scans refresh it from the episode you linked instead of overwriting your fix.

A show file with **no `SxxEyy`** in its name is skipped by the scan entirely and shows up under **Untracked
files** as *No SxxEyy*; **Link to episode** there gives it a record without renaming the file on disk.

A daily scan runs automatically at **03:00 local time** (`SCAN_AT_HOUR`, set `off` to disable). Set
`SCAN_ON_STARTUP=true` to also scan when the server boots.

## Offline artwork

Posters, backdrops, cast photos, and stills are served from `/tmdb-img/...`, which reads from a
local cache (`IMAGE_DIR`) and only falls back to TMDB on a miss. A scan pre-downloads everything
(toggle: **Download artwork during scan**), so once scanned the app shows artwork with no internet —
ideal for a NAS. Cache on demand from the admin page or with `npm run scan` (use `npm run scan --
--no-artwork` to skip). `IMAGE_DIR` sits under `/data` by default; bind-mount it separately if you want the
cache on a larger disk.

## Self-hosting with Docker

A prebuilt image is published on Docker Hub — no need to build it yourself:

**[hub.docker.com/r/lambersond/personal-media-host](https://hub.docker.com/r/lambersond/personal-media-host)**

```bash
docker pull lambersond/personal-media-host

docker run -d --name media-host -p 3000:3000 \
  -e TMDB_API_TOKEN=... \
  -v /nas/media:/media \   # your library (symlinks are followed)
  -v $(pwd)/data:/data \   # ALL app state: sqlite db, artwork, avatars, job logs
  lambersond/personal-media-host
```

**Two mounts are all you need.** Everything the app writes lives under `/data` — `media.sqlite` (+ WAL),
`images/` (cached artwork), `avatars/` (uploaded profile pictures) and `logs/` (per-run job logs) — so that
single mount persists the lot. To keep artwork on a different (larger) disk, add
`-v /nas/artwork:/data/images`, or point `IMAGE_DIR` anywhere you like.

On boot the container prints the absolute paths it resolved, e.g.
`[instrumentation] paths: db=/data/media.sqlite media=/media images=/data/images avatars=/data/avatars logs=/data/logs`.
If any of those points inside `/app` instead of a mount, that env var isn't reaching the container.

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

Defaults differ between the Docker image (which sets absolute paths) and a bare `npm start`, where they are
relative to the working directory.

| Variable           | Docker default        | `npm` default     | Purpose                                       |
| ------------------ | --------------------- | ----------------- | --------------------------------------------- |
| `TMDB_API_TOKEN`   | —                     | —                 | TMDB v4 read token (required for scanning).   |
| `MEDIA_DIR`        | `/media`              | `./media`         | Root folder scanned for media.                |
| `DATABASE_PATH`    | `/data/media.sqlite`  | `./media.sqlite`  | SQLite database file.                         |
| `IMAGE_DIR`        | `/data/images`        | `./data/images`   | Local artwork cache; point it anywhere.       |
| `AVATAR_DIR`       | `/data/avatars`       | `./data/avatars`  | Uploaded profile pictures.                    |
| `LOG_DIR`          | `/data/logs`          | `./data/logs`     | Timestamped per-run scan/transcode/artwork logs. |
| `FFMPEG_PATH`      | `/usr/bin/ffmpeg`     | `ffmpeg-static`   | ffmpeg binary.                                |
| `SCAN_AT_HOUR`     | `3`                   | `3`               | Hour (0–23, local) of the daily scan; `off` to disable. |
| `SCAN_ON_STARTUP`  | `false`               | `false`           | Also scan once when the server starts.        |
