# Publishing the image and getting it onto the NAS

End-to-end path from source → Docker Hub → running on the Synology DS425+.
For the detailed NAS container config and caveats, see **[DEPLOY.md](DEPLOY.md)**.

There are two ways to publish. **CI (Path A) is recommended** — it builds on a
native x86-64 runner, so there's no local emulation and the result is fast and
reproducible. Use manual (Path B) only for a one-off from your laptop.

---

## Path A — Publish via GitHub Actions (recommended)

Workflow: [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml).

### One-time setup
1. **Docker Hub access token:** Docker Hub → *Account Settings → Personal access
   tokens → Generate new token* (Read/Write). Copy it.
2. **In the GitHub repo → Settings → Secrets and variables → Actions:**
   - **Variables** tab → New variable: `DOCKERHUB_USERNAME` = your Docker Hub username.
   - **Secrets** tab → New secret: `DOCKERHUB_TOKEN` = the token from step 1.
3. Make sure the repo `personal-media-host` exists on Docker Hub (or let the first
   push create it — set it to Public/Private as you like).

### Publish
- **Push to `main`** → publishes `:latest` and `:sha-<short>`.
- **Push a version tag** → also publishes semver tags:
  ```bash
  git tag v1.0.0 && git push origin v1.0.0    # -> :1.0.0, :1.0, :1, :latest
  ```
- **Manual:** Actions tab → *Publish Docker image* → *Run workflow*.

The job builds `linux/amd64` only (the DS425+ arch), preserves the `HEALTHCHECK`,
and pushes a standard Docker v2 manifest that Container Manager pulls cleanly.

---

## Path B — Publish manually (from an Apple-Silicon Mac)

The DS425+ is amd64 but the Mac is arm64, so you must cross-build. On
`podman machine`, **Rosetta 2** is the fast path (enabled by default). Verify it,
then build and push:

```bash
# one-time sanity check that amd64 runs:
podman run --rm --platform linux/amd64 docker.io/library/alpine uname -m   # -> x86_64

# build for the NAS arch (Docker manifest keeps the HEALTHCHECK)
podman build --format docker --platform linux/amd64 -t personal-media-host:latest .
podman inspect --format '{{.Os}}/{{.Architecture}}' personal-media-host:latest  # -> linux/amd64

# publish
podman login docker.io
podman tag personal-media-host:latest docker.io/<dockerhub-user>/personal-media-host:latest
podman push docker.io/<dockerhub-user>/personal-media-host:latest
```

> If `podman run --platform linux/amd64 …` fails with *Exec format error* or
> *segfault*, the VM's x86_64 binfmt is broken. Reset it: remove any
> `qemu-x86_64` handler and restart the machine so Rosetta takes over —
> `podman machine stop && podman machine start`.

---

## Getting it onto the NAS (DS425+ Container Manager)

Prereqs on the NAS: create the shared folders for the library and app data — see
[DEPLOY.md → Prepare NAS shared folders](DEPLOY.md).

### First deployment
1. **Container Manager → Project → Create.**
2. Upload [`compose.yaml`](compose.yaml) from this repo and edit it for your NAS:
   - `image:` → `docker.io/<dockerhub-user>/personal-media-host:latest`
   - the three `volumes:` host paths (`/media`, `/data`, avatars)
   - `TMDB_API_TOKEN` (your TMDB v4 read token)
   - `SCAN_ON_STARTUP: "true"` **for the first run** (then set back to `"false"`)
3. **Build/Start** the project. Container Manager pulls the image from Docker Hub
   and starts it.
4. Open `http://<nas-ip>:3000`. First boot applies DB migrations, builds the
   search index, and (with `SCAN_ON_STARTUP=true`) scans `/media`.

*(No-compose alternative: Image → pull `…/personal-media-host:latest`, then
Container → Create and set the same ports/volumes/env by hand.)*

### Updating to a new image
The database, artwork, and avatars live in mounted volumes, so they survive
updates — only the app code changes.
1. Publish a new image (Path A or B).
2. **Project:** Container Manager → your Project → **Build** (re-pulls `:latest`)
   and restart. **Standalone container:** *Image → pull* the new tag, then stop,
   delete, and recreate the container with the same settings (or use the
   *Reset/Clear & recreate* action).
3. Verify health: the container should report **healthy** (green) within ~40s,
   and `http://<nas-ip>:3000` should load.

### Verifying a deployment
- Container Manager shows the container **healthy** (the baked-in `HEALTHCHECK`).
- `http://<nas-ip>:3000` serves; `/movies`, `/shows`, and `/admin` load.
- The admin page (unauthenticated, **not** linked in the navbar) is at
  `http://<nas-ip>:3000/admin` — trigger scans/transcode/artwork and see the last
  scan time there.

> Pin a version tag (e.g. `:1.0.0`) instead of `:latest` in `compose.yaml` if you
> want deploys to be explicit and rollbacks trivial.
