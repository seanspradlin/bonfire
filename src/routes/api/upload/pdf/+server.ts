import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/modules/auth/guards';
import { repo, embedder, storage } from '$lib/server/deps';
import { ingestDocument } from '$lib/server/modules/ingestion';
import { createPdfProvider } from '$lib/server/modules/upload/pdf';
import {
	parseOptionalDate,
	parseOptionalId,
	parseOptionalString,
	parseOptionalTags
} from '$lib/server/modules/upload/uploadForm';
import type { RequestHandler } from './$types';

const MAX_PDF_BYTES = 32 * 1024 * 1024; // 32 MB
const pdfProvider = createPdfProvider();

/**
 * Upload a PDF, run AI content extraction, and store as a knowledge base document.
 *
 * Fields: file (required), tags, context, title, id, date
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const authUser = requireAuth(locals);

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return json({ error: 'Expected multipart/form-data' }, { status: 400 });
	}

	const file = formData.get('file');
	if (!(file instanceof File)) {
		return json({ error: 'Missing required field: file' }, { status: 400 });
	}

	if (file.type !== 'application/pdf') {
		return json(
			{ error: `Unsupported media type: ${file.type}. Must be application/pdf` },
			{ status: 415 }
		);
	}

	if (file.size > MAX_PDF_BYTES) {
		return json({ error: 'File too large. Maximum size is 32 MB.' }, { status: 413 });
	}

	const tags = parseOptionalTags(formData);
	const context = parseOptionalString(formData, 'context');
	const titleOverride = parseOptionalString(formData, 'title');

	const id = parseOptionalId(formData);
	if (id === null) {
		return json(
			{ error: "Invalid id: must not contain the reserved ':chunk:' namespace" },
			{ status: 400 }
		);
	}

	const date = parseOptionalDate(formData);
	if (date === null) {
		return json({ error: 'Invalid date: must be a valid ISO 8601 timestamp' }, { status: 400 });
	}

	const docId = id ?? randomUUID();

	const arrayBuffer = await file.arrayBuffer();
	const fileBuffer = Buffer.from(arrayBuffer);
	const base64Data = fileBuffer.toString('base64');

	// Analyze first so a failed AI call never leaves an orphaned S3 object.
	let analysisResult: Awaited<ReturnType<typeof pdfProvider.analyzePdf>>;
	try {
		analysisResult = await pdfProvider.analyzePdf(
			{ data: base64Data },
			{ title: titleOverride, context }
		);
	} catch (err) {
		// Classify by status code (400) first — that is a stable, structured field.
		// We further narrow to "prompt is too long" via err.message because the
		// Anthropic SDK does not expose a machine-readable sub-code for this case.
		if (
			err instanceof Anthropic.BadRequestError &&
			String(err.message).includes('prompt is too long')
		) {
			return json(
				{ error: 'PDF is too large to process. Try a smaller or fewer-page document.' },
				{ status: 413 }
			);
		}
		throw err;
	}

	// Upload artifact to S3 if storage is configured.
	let artifactKey: string | undefined;
	if (storage) {
		const key = `artifacts/${docId}/${basename(file.name)}`;
		try {
			await storage.upload(key, fileBuffer, file.type);
			artifactKey = key;
		} catch (err) {
			console.error('[storage] artifact upload failed, continuing without it', {
				docId,
				key,
				error: err
			});
		}
	}

	const doc = await ingestDocument(
		{
			id: docId,
			title: titleOverride ?? analysisResult.title,
			content: analysisResult.content,
			tags: tags ?? analysisResult.tags,
			date: date ?? undefined,
			userId: authUser.id,
			artifactKey
		},
		repo,
		embedder
	);

	return json(
		{
			id: doc.id,
			title: doc.title,
			tags: doc.tags,
			date: doc.date,
			createdAt: doc.createdAt,
			updatedAt: doc.updatedAt
		},
		{ status: 201 }
	);
};
