import { Hono } from "hono";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import {
	type AuthUser,
	createAuthRouter,
	createAuthSessionMiddleware,
	type SessionData,
	seedInitialAdminUser,
} from "@/modules/auth";
import { createChatRouter } from "@/modules/chat";
import {
	createEmbeddingProvider,
	createRerankProvider,
} from "@/modules/embedding";
import { createHealthRouter } from "@/modules/health";
import { createInvitationsRouter } from "@/modules/invitations";
import { createMcpRouter } from "@/modules/mcp";
import { PgDocumentRepository } from "@/modules/repository";
import { createUploadRouter } from "@/modules/upload";
import { createUsersRouter } from "@/modules/users";
import { createVisionProvider } from "@/modules/vision";

// ---------------------------------------------------------------------------
// Bootstrap — construct shared singletons once
// ---------------------------------------------------------------------------

const repo = new PgDocumentRepository();
const embedder = createEmbeddingProvider();
const vision = createVisionProvider();
const reranker = createRerankProvider();

// ---------------------------------------------------------------------------
// HTTP server — mount route modules
// ---------------------------------------------------------------------------

const app = new Hono<{
	Variables: {
		user: AuthUser | null;
		session: SessionData | null;
	};
}>();

const clientUrl = process.env.CLIENT_URL ?? "http://localhost:5173";

// CORS — must be first so preflight requests get the right headers before any
// other middleware or route handler runs.
app.use(
	"*",
	cors({
		origin: [clientUrl],
		credentials: true,
		allowHeaders: [
			"Content-Type",
			"Authorization",
			"x-api-key",
			"mcp-session-id",
		],
		exposeHeaders: ["mcp-session-id"],
	}),
);

// CSRF — skip /mcp (uses header auth, not cookies) and /auth/* (Better Auth
// manages its own trusted-origin validation for those routes).
// Use exact match or trailing-slash prefix to avoid matching unrelated paths
// like `/mcpbogus` or `/authzservice`.
app.use("*", async (c, next) => {
	const path = c.req.path;
	if (
		path === "/mcp" ||
		path.startsWith("/mcp/") ||
		path.startsWith("/auth/")
	) {
		return next();
	}
	return csrf({ origin: [clientUrl] })(c, next);
});

app.use("*", createAuthSessionMiddleware());

app.route("/", createHealthRouter());
app.route("/", createAuthRouter());
app.route("/", createUsersRouter());
app.route("/", createInvitationsRouter());
app.route("/", createMcpRouter({ repo, embedder, vision, reranker }));
app.route("/", createUploadRouter({ repo, embedder, vision }));
app.route("/", createChatRouter({ repo, embedder, reranker }));

await seedInitialAdminUser();

export default app;
