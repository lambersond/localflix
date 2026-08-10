# Deploying to a Synology DS425+ (Container Manager)

This runs the app as a single container on the NAS. The media library is an
**externally-managed CMS** — you add/organize files on the NAS share, and the
container scans it. Nothing about the library lives inside the container.

## 1. Build & publish the image (from a dev machine)

The DS425+ is **x86-64 (amd64)**. On an Apple-Silicon Mac, cross-build for that
arch (Rosetta makes this fast on `podman machine`):

```bash
# one-time: the podman VM must be able to run amd64. Rosetta is the fast path;
# it is enabled by default on Apple-Silicon machines. Verify:
podman run --rm --platform linux/amd64 docker.io/library/alpine uname -m   # -> x86_64

# build for the NAS arch
podman build --platform linux/amd64 -t personal-media-host:latest .

# publish (substitute your Docker Hub user)
podman login docker.io
podman tag personal-media-host:latest docker.io/<dockerhub-user>/personal-media-host:latest
podman push docker.io/<dockerhub-user>/personal-media-host:latest
```

> Image reports `linux/amd64`:
> `podman inspect --format '{{.Os}}/{{.Architecture}}' personal-media-host:latest`

## 2. Prepare NAS shared folders

| Purpose            | Example NAS path                                | Notes |
|--------------------|-------------------------------------------------|-------|
| Media library      | `/volume1/media`                                | The CMS share you manage. |
| App data (SQLite)  | `/volume1/docker/personal-media-host/data`      | **Must be local volume**, not SMB/NFS. |

Create them in **Control Panel → Shared Folder / File Station** if they don't
exist. The `data` folder holds `media.sqlite` (+ WAL) and the cached artwork.

## 3. Deploy in Container Manager

Easiest: **Project → Create**, upload `compose.yaml` from this repo, and edit the
`image`, host paths, and `TMDB_API_TOKEN` for your NAS. Container Manager pulls
the image from Docker Hub and starts it.

Manual alternative (**Image → pull from Docker Hub**, then **Container → Create**):
- **Port:** map host `3000` → container `3000` (change the host side to avoid conflicts).
- **Volumes:**
  - `/volume1/media` → `/media` (read-write)
  - `/volume1/docker/personal-media-host/data` → `/data` (read-write)
- **Environment:** `TMDB_API_TOKEN` (your TMDB v4 read token), `SCAN_AT_HOUR=3`,
  and `SCAN_ON_STARTUP=true` **for the first run** (set back to `false` after).

Open `http://<nas-ip>:3000`. On boot the container applies DB migrations, builds
the search index, and (with `SCAN_ON_STARTUP=true`) scans `/media`.

The **admin page is unauthenticated by design (LAN trust)** and not linked in the
navbar — reach it directly at `http://<nas-ip>:3000/admin` to trigger scans,
transcodes, and artwork caching, and to see the last scan time.

## Caveats (read before first scan)

- **Symlinks:** the scanner follows symlinks, but a symlink only resolves inside
  the container if its **target is also under `/media`**. If your library uses
  symlinks pointing elsewhere on the NAS, mount a **parent folder that contains
  both the links and their targets** as `/media` (or point links inside the tree).
- **`/data` must be local storage.** SQLite in WAL mode needs real file locking;
  do **not** put `/data` on an SMB/NFS network share (risk of corruption/locking
  errors). Only `/media` is the external share.
- **First run is empty.** The DB is created fresh; populate it with a scan
  (`SCAN_ON_STARTUP=true` or the admin page) — a valid `TMDB_API_TOKEN` is
  required for metadata + artwork.
- **One `/data` mount holds everything.** `media.sqlite` (+ WAL), cached artwork
  (`/data/images`), uploaded avatars (`/data/avatars`, served by the app's
  `/avatars` route) and per-run job logs (`/data/logs`) all live under it. No
  separate artwork, avatar, or log mount is needed.
- **Check the paths on boot.** The container logs a line like
  `[instrumentation] paths: db=/data/media.sqlite … logs=/data/logs`. Anything
  resolving under `/app` instead of `/data` means that env var isn't reaching
  the container.
- **Time zone:** `SCAN_AT_HOUR` is local time. If the daily scan fires at the
  wrong hour, set the container `TZ` env (e.g. `TZ=America/New_York`).

## Upgrading from an image built before this fix

Earlier images had two defects that kept data out of your `/data` mount:

- `VOLUME` listed `/data/images` **nested inside** `/data`. Docker honours that
  by mounting an *anonymous volume* over that subdirectory, so cached artwork
  went to `/var/lib/docker/volumes/<hash>/_data` and the NAS folder showed an
  empty `images/` directory (the shadowed mountpoint).
- `LOG_DIR` was never set in the image, so its relative default resolved to
  `/app/data/logs` inside the container — wiped on every recreate.

Both are fixed, but the old artwork is still in the anonymous volume. Recover it
over **SSH** (File Station can't browse `/volume1/@docker`), *before* deploying
the new image — the new container won't mount that volume at all.

```bash
# 1. Confirm the shadowing: a "volume" row with a 64-hex name at /data/images.
sudo docker inspect personal-media-host \
  --format '{{range .Mounts}}{{.Type}} {{.Name}} -> {{.Destination}}{{"\n"}}{{end}}'

# 2. Where that volume actually lives on disk.
sudo docker volume inspect <name-from-step-1> --format '{{.Mountpoint}}'

# 3. Stop the container, then copy the cache into your bind mount.
sudo docker stop personal-media-host
sudo cp -a <mountpoint>/. /volume1/docker/personal-media-host/data/images/
```

Deploy the new image, then confirm `data/images/` and `data/logs/` on the NAS
fill up while the container runs. Each earlier redeploy likely orphaned another
anonymous volume; list and reclaim them once you're happy:

```bash
sudo docker volume ls -qf dangling=true   # look before you delete
sudo docker volume prune
```

If the copy in step 3 turns out to be small or empty, the cache was being
re-fetched from TMDB all along (`/tmdb-img` falls back to the CDN on a miss, so
this is invisible in the UI) — skip it and run **Cache artwork now** from
`/admin` after redeploying.
