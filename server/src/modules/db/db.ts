import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const url =
	process.env.DATABASE_URL ??
	"postgresql://bonfire:bonfire@localhost:5432/bonfire";

// Explicit pool config: 20 max connections, reclaim idle connections after 30 s.
// This prevents connection exhaustion under concurrent MCP sessions.
const pool = new Pool({
	connectionString: url,
	max: 20,
	idleTimeoutMillis: 30_000,
});

// Drain the pool gracefully on shutdown so in-flight queries can finish and
// the database doesn't see abrupt disconnects. Use `.once` to avoid double-
// registration on hot reload (Bun re-executes this module on each reload).
const shutdown = async () => {
	try {
		await pool.end();
	} catch (err) {
		console.error("pool.end failed", err);
	}
	process.exit(0);
};
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

export const db = drizzle(pool, { schema });
