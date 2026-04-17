import { Hono } from "hono";
import { createEmbeddingProvider } from "./embeddings";
import { createMcpHandler } from "./mcp";
import { SqliteDocumentRepository } from "./repository";

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
