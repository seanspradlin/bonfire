import { Hono } from "hono";
import { createEmbeddingProvider } from "./embeddings";
import { createMcpHandler } from "./mcp";
import { SqliteDocumentRepository } from "./repository";
import { createVisionProvider } from "./vision";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const repo = new SqliteDocumentRepository();
const embedder = createEmbeddingProvider();
const vision = createVisionProvider();
const mcpHandler = createMcpHandler(repo, embedder, vision);

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

/**
 * Image upload endpoint — accepts multipart/form-data, runs vision analysis,
 * and stores the result as a knowledge base document.
 *
 * Fields:
 *   file     (required) — image file (JPEG, PNG, GIF, or WebP)
 *   tags     (optional) — comma-separated list of tags
 *   context  (optional) — hint to guide vision analysis
 *   title    (optional) — override the auto-generated title
 *   id       (optional) — document ID to upsert into
 */
app.post("/upload/image", async (c) => {
	let formData: FormData;
	try {
		formData = await c.req.formData();
	} catch {
		return c.json({ error: "Expected multipart/form-data" }, 400);
	}

	const file = formData.get("file");
	if (!(file instanceof File)) {
		return c.json({ error: "Missing required field: file" }, 400);
	}

	const mediaType = file.type as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
	const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
	if (!allowed.includes(mediaType)) {
		return c.json(
			{ error: `Unsupported media type: ${mediaType}. Must be one of: ${allowed.join(", ")}` },
			415,
		);
	}

	const tagsRaw = formData.get("tags");
	const tags = tagsRaw
		? String(tagsRaw).split(",").map((t) => t.trim()).filter(Boolean)
		: undefined;
	const context = formData.get("context") ? String(formData.get("context")) : undefined;
	const titleOverride = formData.get("title") ? String(formData.get("title")) : undefined;
	const id = formData.get("id") ? String(formData.get("id")) : undefined;

	const arrayBuffer = await file.arrayBuffer();
	const base64Data = Buffer.from(arrayBuffer).toString("base64");

	const result = await vision.analyzeImage({ data: base64Data, mediaType }, { title: titleOverride, context });
	const resolvedTitle = titleOverride ?? result.title;
	const resolvedTags = tags ?? result.tags;
	const embedding = await embedder.embed(`${resolvedTitle}\n\n${result.content}`);
	const doc = await repo.upsert({ id, title: resolvedTitle, content: result.content, tags: resolvedTags, embedding });

	return c.json({
		id: doc.id,
		title: doc.title,
		tags: doc.tags,
		createdAt: doc.createdAt,
		updatedAt: doc.updatedAt,
	}, 201);
});

export default app;
