/**
 * Standalone migration runner.
 *
 * Applies the generated Drizzle SQL migrations in `./drizzle` against the
 * database in `DATABASE_URL`. This uses the drizzle-orm migrator (a production
 * dependency) rather than `drizzle-kit` (a dev dependency) so it can run inside
 * the slim production container before the server starts accepting traffic.
 *
 * Run from the `server` directory: `bun src/migrate.ts` (or `bun dist/migrate.js`).
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const url =
	process.env.DATABASE_URL ??
	"postgresql://bonfire:bonfire@localhost:5432/bonfire";

const pool = new Pool({ connectionString: url });
const db = drizzle(pool);

try {
	await migrate(db, { migrationsFolder: "./drizzle" });
	console.log("[migrate] Migrations applied successfully.");
} catch (err) {
	console.error("[migrate] Migration failed:", err);
	process.exitCode = 1;
} finally {
	await pool.end();
}
