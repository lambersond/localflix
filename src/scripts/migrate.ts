import Database from "better-sqlite3";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

config({ path: [".env.local", ".env"] });

const DATABASE_PATH = process.env.DATABASE_PATH ?? "./media.sqlite";

const sqlite = new Database(DATABASE_PATH);
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite);

migrate(db, { migrationsFolder: "./drizzle" });

console.log(`Migrations applied to ${DATABASE_PATH}`);
sqlite.close();
