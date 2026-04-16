/**
 * Database connection.
 *
 * To migrate to PostgreSQL:
 *   1. Replace `bun:sqlite` + `drizzle-orm/bun-sqlite` with `pg` + `drizzle-orm/node-postgres`
 *   2. Update drizzle.config.ts dialect to "postgresql"
 *   3. Swap the schema file (see schema.ts for column migration notes)
 */

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";

const url = process.env.DATABASE_URL ?? "data/bonfire.db";
const sqlite = new Database(url);

// Enable WAL mode for better concurrent read performance
sqlite.exec("PRAGMA journal_mode = WAL;");

export const db = drizzle(sqlite, { schema });
