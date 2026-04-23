import { Hono } from "hono";

export function createHealthRouter() {
	const router = new Hono();

	/** Health check — confirms the service is up */
	router.get("/health", (c) => c.json({ status: "ok", service: "bonfire" }));

	return router;
}
