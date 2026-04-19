import Anthropic from "@anthropic-ai/sdk";
import { Hono } from "hono";
import { z } from "zod";
import { createEmbeddingProvider } from "./embeddings";
import { createMcpHandler } from "./mcp";
import { createPdfProvider } from "./pdf";
import { SqliteDocumentRepository } from "./repository";
import { createVisionProvider } from "./vision";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const repo = new SqliteDocumentRepository();
const embedder = createEmbeddingProvider();
const vision = createVisionProvider();
const pdfProvider = createPdfProvider();
const mcpHandler = createMcpHandler({ repo, embedder, vision, pdfProvider });

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const app = new Hono();

const isoDatetime = z.string().datetime();

/**
 * Parse and validate an optional ISO 8601 datetime from a FormData field.
 * Returns the normalized UTC string, undefined if absent, or null if invalid.
 */
function parseOptionalDate(formData: FormData): string | undefined | null {
	const raw = formData.get("date");
	if (!raw) return undefined;
	const result = isoDatetime.safeParse(String(raw));
	if (!result.success) return null;
	return new Date(result.data).toISOString();
}

/** MCP Streamable HTTP endpoint — handles all MCP protocol traffic */
app.all("/mcp", (c) => mcpHandler(c.req.raw));

/** Health check */
app.get("/health", (c) => c.json({ status: "ok", service: "bonfire" }));

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
 *   date     (optional) — ISO 8601 timestamp for when the work occurred
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

	const mediaType = file.type as
		| "image/jpeg"
		| "image/png"
		| "image/gif"
		| "image/webp";
	const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
	if (!allowed.includes(mediaType)) {
		return c.json(
			{
				error: `Unsupported media type: ${mediaType}. Must be one of: ${allowed.join(", ")}`,
			},
			415,
		);
	}

	const tagsRaw = formData.get("tags");
	const tags = tagsRaw
		? String(tagsRaw)
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean)
		: undefined;
	const contextRaw = formData.get("context");
	const context = contextRaw ? String(contextRaw) : undefined;
	const titleRaw = formData.get("title");
	const titleOverride = titleRaw ? String(titleRaw) : undefined;
	const idRaw = formData.get("id");
	const id = idRaw ? String(idRaw) : undefined;
	const date = parseOptionalDate(formData);
	if (date === null) {
		return c.json(
			{ error: "Invalid date: must be a valid ISO 8601 timestamp" },
			400,
		);
	}

	const arrayBuffer = await file.arrayBuffer();
	const base64Data = Buffer.from(arrayBuffer).toString("base64");

	const result = await vision.analyzeImage(
		{ data: base64Data, mediaType },
		{ title: titleOverride, context },
	);
	const resolvedTitle = titleOverride ?? result.title;
	const resolvedTags = tags ?? result.tags;
	const embedding = await embedder.embed(
		`${resolvedTitle}\n\n${result.content}`,
	);
	const doc = await repo.upsert({
		id,
		title: resolvedTitle,
		content: result.content,
		tags: resolvedTags,
		date,
		embedding,
	});

	return c.json(
		{
			id: doc.id,
			title: doc.title,
			tags: doc.tags,
			date: doc.date,
			createdAt: doc.createdAt,
			updatedAt: doc.updatedAt,
		},
		201,
	);
});

/**
 * PDF upload endpoint — accepts multipart/form-data, runs PDF analysis,
 * and stores the result as a knowledge base document.
 *
 * Fields:
 *   file     (required) — PDF file
 *   tags     (optional) — comma-separated list of tags
 *   context  (optional) — hint to guide content extraction
 *   title    (optional) — override the auto-generated title
 *   id       (optional) — document ID to upsert into
 *   date     (optional) — ISO 8601 timestamp for when the work occurred
 */
app.post("/upload/pdf", async (c) => {
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

	if (file.type !== "application/pdf") {
		return c.json(
			{
				error: `Unsupported media type: ${file.type}. Must be application/pdf`,
			},
			415,
		);
	}

	const MAX_PDF_BYTES = 32 * 1024 * 1024; // 32 MB
	if (file.size > MAX_PDF_BYTES) {
		return c.json({ error: "File too large. Maximum size is 32 MB." }, 413);
	}

	const tagsRaw = formData.get("tags");
	const tags = tagsRaw
		? String(tagsRaw)
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean)
		: undefined;
	const contextRaw = formData.get("context");
	const context = contextRaw ? String(contextRaw) : undefined;
	const titleRaw = formData.get("title");
	const titleOverride = titleRaw ? String(titleRaw) : undefined;
	const idRaw = formData.get("id");
	const id = idRaw ? String(idRaw) : undefined;
	const date = parseOptionalDate(formData);
	if (date === null) {
		return c.json(
			{ error: "Invalid date: must be a valid ISO 8601 timestamp" },
			400,
		);
	}

	const arrayBuffer = await file.arrayBuffer();
	const base64Data = Buffer.from(arrayBuffer).toString("base64");

	let result: Awaited<ReturnType<typeof pdfProvider.analyzePdf>>;
	try {
		result = await pdfProvider.analyzePdf(
			{ data: base64Data },
			{ title: titleOverride, context },
		);
	} catch (err) {
		if (
			err instanceof Anthropic.BadRequestError &&
			String(err.message).includes("prompt is too long")
		) {
			return c.json(
				{
					error:
						"PDF is too large to process. Try a smaller or fewer-page document.",
				},
				413,
			);
		}
		throw err;
	}
	const resolvedTitle = titleOverride ?? result.title;
	const resolvedTags = tags ?? result.tags;
	const embedding = await embedder.embed(
		`${resolvedTitle}\n\n${result.content}`,
	);
	const doc = await repo.upsert({
		id,
		title: resolvedTitle,
		content: result.content,
		tags: resolvedTags,
		date,
		embedding,
	});

	return c.json(
		{
			id: doc.id,
			title: doc.title,
			tags: doc.tags,
			date: doc.date,
			createdAt: doc.createdAt,
			updatedAt: doc.updatedAt,
		},
		201,
	);
});

export default app;
