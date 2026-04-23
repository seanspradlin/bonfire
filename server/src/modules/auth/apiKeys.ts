import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { apiKey, db } from "@/modules/db";

/**
 * Generate a secure random API key.
 * Format: bf_<32 random hex chars>
 */
export function generateApiKey(): string {
	const randomPart = randomBytes(16).toString("hex");
	return `bf_${randomPart}`;
}

/**
 * Hash an API key using SHA-256.
 */
export async function hashApiKey(key: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(key);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Build the masked display string from a stored hint.
 * Hint format: first 4 + last 4 chars of the random part (8 chars total).
 * Display: "bf_<first4>••••••••••••••••••••••••<last4>"
 */
export function maskApiKey(keyHint: string): string {
	if (keyHint.length < 8) return `bf_${"•".repeat(32)}`;
	const head = keyHint.slice(0, 4);
	const tail = keyHint.slice(4);
	return `bf_${head}${"•".repeat(24)}${tail}`;
}

/**
 * Create a new API key for a user.
 * Returns the plaintext key (shown to the user once) and the masked display string.
 */
export async function createApiKey(
	userId: string,
	name: string,
): Promise<{ id: string; key: string; masked: string }> {
	const key = generateApiKey();
	const keyHash = await hashApiKey(key);
	const keyHint = key.slice(3, 7) + key.slice(-4); // first 4 + last 4 of the random part
	const now = Date.now();

	const [row] = await db
		.insert(apiKey)
		.values({
			id: crypto.randomUUID(),
			userId,
			keyHash,
			name,
			keyHint,
			lastUsedAt: null,
			expiresAt: null,
			createdAt: new Date(now),
			updatedAt: new Date(now),
		})
		.returning({ id: apiKey.id });

	return { id: row.id, key, masked: maskApiKey(keyHint) };
}

/**
 * Authenticate a user by API key.
 * Returns the user ID if valid, null otherwise.
 * Updates both lastUsedAt and updatedAt so updatedAt can serve as "last used" in the UI.
 */
export async function authenticateApiKey(key: string): Promise<string | null> {
	const keyHash = await hashApiKey(key);

	const [row] = await db
		.select({
			id: apiKey.id,
			userId: apiKey.userId,
			expiresAt: apiKey.expiresAt,
		})
		.from(apiKey)
		.where(eq(apiKey.keyHash, keyHash))
		.limit(1);

	if (!row) return null;

	if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
		return null;
	}

	const now = new Date();
	await db
		.update(apiKey)
		.set({ lastUsedAt: now, updatedAt: now })
		.where(eq(apiKey.id, row.id));

	return row.userId;
}

/**
 * List all API keys for a user.
 * Returns masked display strings — plaintext keys are never retrievable after creation.
 */
export async function listApiKeys(userId: string) {
	const rows = await db
		.select({
			id: apiKey.id,
			name: apiKey.name,
			keyHint: apiKey.keyHint,
			expiresAt: apiKey.expiresAt,
			createdAt: apiKey.createdAt,
			updatedAt: apiKey.updatedAt,
		})
		.from(apiKey)
		.where(eq(apiKey.userId, userId));

	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		masked: maskApiKey(row.keyHint),
		createdAt: row.createdAt,
		lastUsed: row.updatedAt,
		expiresAt: row.expiresAt,
	}));
}

/**
 * Delete an API key by ID, scoped to the owning user to prevent cross-user deletion.
 *
 * The ownership constraint is enforced in the WHERE clause — checking ownership
 * after the DELETE would allow another user to destroy rows by guessing UUIDs.
 */
export async function deleteApiKey(
	keyId: string,
	userId: string,
): Promise<boolean> {
	const result = await db
		.delete(apiKey)
		.where(and(eq(apiKey.id, keyId), eq(apiKey.userId, userId)))
		.returning({ id: apiKey.id });

	return result.length > 0;
}
