import path from "node:path";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { db } from "@/db";
import { startScheduler } from "@/lib/scheduler";
import { ensureSearchIndex, reindexSearch, searchIndexCount } from "@/lib/search-index";

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
