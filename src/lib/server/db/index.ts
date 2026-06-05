import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { building } from '$app/environment';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

function resolveDatabaseUrl() {
	const databaseUrl = env.DATABASE_URL?.trim();
	if (databaseUrl) return databaseUrl;
	if (building) return 'postgres://build:build@127.0.0.1:5432/build';
	throw new Error('DATABASE_URL is not set');
}

// Explicit pool config: 20 max connections, reclaim idle connections after 30 s.
// This prevents connection exhaustion under concurrent MCP sessions.
const pool = new Pool({
	connectionString: resolveDatabaseUrl(),
	max: 20,
	idleTimeoutMillis: 30_000
});

// Drain the pool gracefully on shutdown so in-flight queries can finish.
const shutdown = async () => {
	try {
		await pool.end();
	} catch (err) {
		console.error('pool.end failed', err);
	}
	process.exit(0);
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

export const db = drizzle(pool, { schema });
export { pool };
