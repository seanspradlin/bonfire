import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { Context } from "hono";
import { Hono } from "hono";
import { requireAuth } from "@/modules/auth";
import type { EmbeddingProvider } from "@/modules/embedding";
import { ingestDocument } from "@/modules/ingestion";
import type { Document, DocumentRepository } from "@/modules/repository";
import type { StorageProvider } from "@/modules/storage";
import { createPdfProvider } from "@/modules/upload/pdf";
import {
	ALLOWED_IMAGE_MEDIA_TYPES,
	ALLOWED_TEXT_MEDIA_TYPES,
	isAllowedImageMediaType,
	isAllowedTextMediaType,
	parseOptionalDate,
	parseOptionalId,
	parseOptionalString,
	parseOptionalTags,
} from "@/modules/upload/uploadForm";
import type { VisionProvider } from "@/modules/vision";

interface UploadDeps {
	repo: DocumentRepository;
	embedder: EmbeddingProvider;
	vision: VisionProvider;
	storage: StorageProvider | null;
}

// ---------------------------------------------------------------------------
// Artifact upload helper
// ---------------------------------------------------------------------------

/**
 * Upload a file to S3/Lightsail storage as a best-effort operation.
 * Returns the storage key on success, or undefined if storage is unavailable
 * or the upload fails (so ingestion always continues regardless).
 */
async function uploadArtifact(
	storage: StorageProvider | null,
	docId: string,
	file: File,
	data: Buffer,
): Promise<string | undefined> {
	if (!storage) return undefined;
	const key = `artifacts/${docId}/${basename(file.name)}`;
	try {
		await storage.upload(key, data, file.type);
		return key;
	} catch (err) {
		console.error("[storage] artifact upload failed, continuing without it", {
			docId,
			key,
			error: err,
		});
		return undefined;
	}
}

/**
 * Best-effort artifact cleanup — called when ingestion fails after a successful
 * upload so we don't leave orphaned objects in S3 with no document row referencing them.
 */
async function deleteArtifact(
	storage: StorageProvider | null,
	key: string | undefined,
): Promise<void> {
	if (!storage || !key) return;
	try {
		await storage.delete(key);
	} catch (err) {
		console.error("[storage] orphaned artifact could not be deleted", {
			key,
			error: err,
		});
	}
}

// ---------------------------------------------------------------------------
// Shared upload helpers
// ---------------------------------------------------------------------------

/**
 * Common FormData fields shared by both image and PDF upload endpoints.
 */
interface ParsedUploadFields {
	tags: string[] | undefined;
	context: string | undefined;
	titleOverride: string | undefined;
	id: string | undefined;
	date: string | undefined;
}

/**
 * Parse and validate common optional fields from multipart/form-data.
 * Returns validated fields or an error response to send immediately.
 *
 * This extraction eliminates ~25 lines of duplicated validation logic
 * from each upload handler.
 */
function parseUploadFields(formData: FormData): ParsedUploadFields | Response {
	const tags = parseOptionalTags(formData);
	const context = parseOptionalString(formData, "context");
	const titleOverride = parseOptionalString(formData, "title");

	const id = parseOptionalId(formData);
	if (id === null) {
		return Response.json(
			{
				error: "Invalid id: must not contain the reserved ':chunk:' namespace",
			},
			{ status: 400 },
		);
	}

	const date = parseOptionalDate(formData);
	if (date === null) {
		return Response.json(
			{ error: "Invalid date: must be a valid ISO 8601 timestamp" },
			{ status: 400 },
		);
	}

	return { tags, context, titleOverride, id, date };
}

/**
 * Build the standard success response returned by both upload endpoints.
 * Extracts only the metadata fields clients need — full document content
 * is accessible via get_document if needed.
 */
function buildUploadResponse(doc: Document, c: Context) {
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
}

/**
 * Factory that builds the upload router with all required providers injected.
 * Both endpoints share the same ingestion pipeline — they differ only in how
 * they extract content from the uploaded file.
 */
export function createUploadRouter({
	repo,
	embedder,
	vision,
	storage,
}: UploadDeps) {
	const router = new Hono();
	const pdfProvider = createPdfProvider();

	const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

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
	router.post("/upload/image", async (c) => {
		const authUser = requireAuth(c);
		if (authUser instanceof Response) return authUser;

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

		if (!isAllowedImageMediaType(file.type)) {
			return c.json(
				{
					error: `Unsupported media type: ${file.type}. Must be one of: ${ALLOWED_IMAGE_MEDIA_TYPES.join(", ")}`,
				},
				415,
			);
		}

		if (file.size > MAX_IMAGE_BYTES) {
			return c.json({ error: "File too large. Maximum size is 10 MB." }, 413);
		}

		const fields = parseUploadFields(formData);
		if (fields instanceof Response) return fields;

		// Pre-generate the doc ID so the S3 key and the document row share the same ID.
		const docId = fields.id ?? randomUUID();

		const arrayBuffer = await file.arrayBuffer();
		const fileBuffer = Buffer.from(arrayBuffer);
		const base64Data = fileBuffer.toString("base64");

		// Analyze first so a failed AI call never leaves an orphaned S3 object.
		const result = await vision.analyzeImage(
			{ data: base64Data, mediaType: file.type },
			{ title: fields.titleOverride, context: fields.context },
		);
		const artifactKey = await uploadArtifact(storage, docId, file, fileBuffer);

		const doc = await ingestDocument(
			{
				id: docId,
				title: fields.titleOverride ?? result.title,
				content: result.content,
				tags: fields.tags ?? result.tags,
				date: fields.date,
				userId: authUser.id,
				artifactKey,
			},
			repo,
			embedder,
		);

		return buildUploadResponse(doc, c);
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
	router.post("/upload/pdf", async (c) => {
		const authUser = requireAuth(c);
		if (authUser instanceof Response) return authUser;

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

		const fields = parseUploadFields(formData);
		if (fields instanceof Response) return fields;

		// Pre-generate the doc ID so the S3 key and the document row share the same ID.
		const docId = fields.id ?? randomUUID();

		const arrayBuffer = await file.arrayBuffer();
		const fileBuffer = Buffer.from(arrayBuffer);
		const base64Data = fileBuffer.toString("base64");

		// Analyze first so a failed AI call never leaves an orphaned S3 object.
		let analysisResult: Awaited<ReturnType<typeof pdfProvider.analyzePdf>>;
		try {
			analysisResult = await pdfProvider.analyzePdf(
				{ data: base64Data },
				{ title: fields.titleOverride, context: fields.context },
			);
		} catch (err) {
			// Classify by status code (400) first — that is a stable, structured
			// field. We further narrow to "prompt is too long" via err.message because
			// the Anthropic SDK does not expose a machine-readable sub-code for this
			// case (the `type` field is always "invalid_request_error" for all 400s).
			// This message check is brittle; if the SDK changes the wording, this
			// branch silently stops matching and the error re-throws to the 500 handler.
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
		const artifactKey = await uploadArtifact(storage, docId, file, fileBuffer);

		const doc = await ingestDocument(
			{
				id: docId,
				title: fields.titleOverride ?? analysisResult.title,
				content: analysisResult.content,
				tags: fields.tags ?? analysisResult.tags,
				date: fields.date,
				userId: authUser.id,
				artifactKey,
			},
			repo,
			embedder,
		);

		return buildUploadResponse(doc, c);
	});

	/**
	 * Text upload endpoint — accepts multipart/form-data with a plain-text or
	 * markdown file, ingests the content directly (no AI extraction step needed),
	 * and stores the result as a knowledge base document.
	 *
	 * Fields:
	 *   file     (required) — .txt or .md file (text/plain, text/markdown, text/x-markdown)
	 *   tags     (optional) — comma-separated list of tags
	 *   context  (optional) — hint included in the document for search context
	 *   title    (optional) — override the filename-derived title
	 *   id       (optional) — document ID to upsert into
	 *   date     (optional) — ISO 8601 timestamp for when the work occurred
	 */
	router.post("/upload/text", async (c) => {
		const authUser = requireAuth(c);
		if (authUser instanceof Response) return authUser;

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

		if (!isAllowedTextMediaType(file.type)) {
			const essence = file.type.split(";")[0].trim();
			return c.json(
				{
					error: `Unsupported media type: ${essence}. Must be one of: ${ALLOWED_TEXT_MEDIA_TYPES.join(", ")}`,
				},
				415,
			);
		}

		const MAX_TEXT_BYTES = 10 * 1024 * 1024; // 10 MB
		if (file.size > MAX_TEXT_BYTES) {
			return c.json({ error: "File too large. Maximum size is 10 MB." }, 413);
		}

		// Sniff the first 16 bytes for null bytes — a reliable indicator of binary
		// content mislabeled as text/plain. Valid UTF-8 never contains 0x00.
		const sniffBuffer = await file.slice(0, 16).arrayBuffer();
		const sniffBytes = new Uint8Array(sniffBuffer);
		if (sniffBytes.some((b) => b === 0x00)) {
			return c.json(
				{ error: "File appears to be binary content, not plain text." },
				415,
			);
		}

		const fields = parseUploadFields(formData);
		if (fields instanceof Response) return fields;

		// Pre-generate the doc ID so the S3 key and the document row share the same ID.
		const docId = fields.id ?? randomUUID();

		const arrayBuffer = await file.arrayBuffer();
		const fileBuffer = Buffer.from(arrayBuffer);
		const content = new TextDecoder().decode(fileBuffer);

		// Derive a readable title from the filename when not overridden.
		const stemTitle = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
		const title = fields.titleOverride ?? stemTitle;

		const artifactKey = await uploadArtifact(storage, docId, file, fileBuffer);

		let doc: Document;
		try {
			doc = await ingestDocument(
				{
					id: docId,
					title,
					content,
					tags: fields.tags,
					date: fields.date,
					userId: authUser.id,
					artifactKey,
				},
				repo,
				embedder,
			);
		} catch (err) {
			await deleteArtifact(storage, artifactKey);
			throw err;
		}

		return buildUploadResponse(doc, c);
	});

	return router;
}
