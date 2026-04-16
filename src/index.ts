import { Hono } from "hono";
import { createEmbeddingProvider } from "./embeddings.ts";
import { createMcpHandler } from "./mcp.ts";
import { SqliteDocumentRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const repo = new SqliteDocumentRepository();
const embedder = createEmbeddingProvider();
const mcpHandler = createMcpHandler(repo, embedder);

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const app = new Hono();

/** MCP Streamable HTTP endpoint — handles all MCP protocol traffic */
app.all("/mcp", (c) => mcpHandler(c.req.raw));

/** Health check */
app.get("/health", (c) =>
	c.json({ status: "ok", service: "bonfire" }),
);

export default app;
