import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

const DATABASE_PATH = process.env.DATABASE_PATH ?? "./media.sqlite";

/**
 * Reuse a single connection across hot-reloads in development, otherwise each
 * reload opens a new file handle.
 */
const globalForDb = globalThis as unknown as {
  __sqlite?: Database.Database;
};

function createConnection(): Database.Database {
  const sqlite = new Database(DATABASE_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  return sqlite;
}

export const sqlite = globalForDb.__sqlite ?? createConnection();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__sqlite = sqlite;
}

export const db = drizzle(sqlite, { schema });
export { schema };
