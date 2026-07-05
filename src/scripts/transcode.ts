import Database from "better-sqlite3";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/better-sqlite3";

import { runDbTranscode, transcodeFolder } from "../lib/transcode-core";
import * as schema from "../db/schema";

config({ path: [".env.local", ".env"] });

const DATABASE_PATH = process.env.DATABASE_PATH ?? "./media.sqlite";
const sqlite = new Database(DATABASE_PATH);
sqlite.pragma("foreign_keys = ON");
const db = drizzle(sqlite, { schema });

const log = (line: string) => console.log(line);

/** Read a flag value: `--dir foo` or `--dir=foo`. */
function flagValue(name: string): string | undefined {
  const argv = process.argv;
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  return undefined;
}

async function main() {
  const dir = flagValue("dir");
  const deleteOriginals = process.argv.includes("--delete-original");
  const dryRun = process.argv.includes("--dry-run");

  if (dir) {
    // Folder/prep mode: filesystem only, no DB.
    await transcodeFolder(dir, { deleteOriginals, dryRun }, log);
  } else {
    // DB mode: transcode non-playable library rows and repoint them.
    if (dryRun) {
      console.warn("--dry-run only applies to --dir (folder) mode; ignoring.");
    }
    await runDbTranscode(db, { deleteOriginals }, log);
  }

  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  sqlite.close();
  process.exit(1);
});
