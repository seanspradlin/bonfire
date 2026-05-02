export type { AuthSession } from "@/modules/auth/auth";
export { baseURL, getSessionFromHeaders } from "@/modules/auth/auth";
export {
	type AuthUser,
	createAuthSessionMiddleware,
	isAdmin,
	requireAuth,
	type SessionData,
} from "@/modules/auth/middleware";
export { createAuthRouter } from "@/modules/auth/routes";
export { seedInitialAdminUser } from "@/modules/auth/seed";
