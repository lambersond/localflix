import path from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { db } from "@/db";
import { AVATAR_DIR } from "@/lib/avatar-store";
import { IMAGE_DIR } from "@/lib/images";
import { LOG_DIR } from "@/lib/logs";
import { startScheduler } from "@/lib/scheduler";
import { ensureSearchIndex, reindexSearch, searchIndexCount } from "@/lib/search-index";

// Report where this process will actually read and write, resolved to absolute
// paths. A path that unexpectedly starts with the working directory instead of
// a mount point (e.g. /app/data/logs rather than /data/logs) means an env var
// isn't reaching the container — otherwise a silent, hard-to-spot failure.
// Values come from the modules that own them, so this can't drift from reality.
console.log(
  "[instrumentation] paths: " +
    [
      `db=${path.resolve(process.env.DATABASE_PATH ?? "./media.sqlite")}`,
      `media=${path.resolve(process.env.MEDIA_DIR ?? "./media")}`,
      `images=${path.resolve(IMAGE_DIR)}`,
      `avatars=${path.resolve(AVATAR_DIR)}`,
      `logs=${path.resolve(LOG_DIR)}`,
    ].join(" "),
);

// Apply pending migrations at startup. In Docker the standalone server can't run
// drizzle-kit, so this is how the schema is created/updated on first boot. The
// `drizzle/` folder is copied into the image (see Dockerfile).
try {
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  console.log("[instrumentation] migrations applied");
} catch (err) {
  console.error("[instrumentation] migration failed:", err);
}

// Make sure the FTS5 search index exists, and seed it once if the library has
// content but the index is empty (e.g. first boot after this feature ships,
// before the next scan rebuilds it).
try {
  ensureSearchIndex(db);
  const movieCount =
    (db.$client.prepare("SELECT count(*) AS n FROM movies").get() as { n: number } | undefined)?.n ??
    0;
  if (movieCount > 0 && searchIndexCount(db) === 0) {
    reindexSearch(db, (line) => console.log(`[instrumentation]${line}`));
  }
} catch (err) {
  console.error("[instrumentation] search index init failed:", err);
}

startScheduler();
