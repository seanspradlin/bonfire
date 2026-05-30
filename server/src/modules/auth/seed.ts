import { eq } from "drizzle-orm";
import { auth } from "@/modules/auth/auth";
import { db, user } from "@/modules/db";

const SEEDED_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@example.com";
const SEEDED_NAME = process.env.SEED_ADMIN_NAME ?? "Admin";
const SEEDED_USERNAME = process.env.SEED_ADMIN_USERNAME ?? "admin";

async function getSeedUserByEmail(email: string) {
	const rows = await db
		.select({ id: user.id, role: user.role })
		.from(user)
		.where(eq(user.email, email))
		.limit(1);
	return rows[0] ?? null;
}

async function ensureAdminRole(userId: string) {
	await db.update(user).set({ role: "admin" }).where(eq(user.id, userId));
}

/**
 * Idempotently ensures the initial admin user exists for local development.
 * Skipped entirely in production or when SEED_ADMIN_PASSWORD is not set.
 */
export async function seedInitialAdminUser(): Promise<void> {
	// Never seed in production — admin users must be created through proper channels.
	if (process.env.NODE_ENV === "production") return;

	const seedPassword = process.env.SEED_ADMIN_PASSWORD;
	if (!seedPassword) {
		console.warn("Skipping admin seed: SEED_ADMIN_PASSWORD not set");
		return;
	}

	try {
		let seededUser = await getSeedUserByEmail(SEEDED_EMAIL);
		if (!seededUser) {
			await auth.api.signUpEmail({
				body: {
					email: SEEDED_EMAIL,
					password: seedPassword,
					name: SEEDED_NAME,
					username: SEEDED_USERNAME,
				},
			});
			seededUser = await getSeedUserByEmail(SEEDED_EMAIL);
		}

		if (seededUser && seededUser.role !== "admin") {
			await ensureAdminRole(seededUser.id);
		}
	} catch (error) {
		console.warn("[auth] Failed to seed initial admin user.", error);
	}
}
