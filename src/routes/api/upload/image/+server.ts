import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { json } from '@sveltejs/kit';
import { requireAuth } from '$lib/server/modules/auth/guards';
import { repo, embedder, vision, storage } from '$lib/server/deps';
import { ingestDocument } from '$lib/server/modules/ingestion';
import {
	ALLOWED_IMAGE_MEDIA_TYPES,
	isAllowedImageMediaType,
	parseOptionalDate,
	parseOptionalId,
	parseOptionalString,
	parseOptionalTags
} from '$lib/server/modules/upload/uploadForm';
import type { RequestHandler } from './$types';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Upload an image, run vision analysis, and store as a knowledge base document.
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

	if (!isAllowedImageMediaType(file.type)) {
		return json(
			{
				error: `Unsupported media type: ${file.type}. Must be one of: ${ALLOWED_IMAGE_MEDIA_TYPES.join(', ')}`
			},
			{ status: 415 }
		);
	}

	if (file.size > MAX_IMAGE_BYTES) {
		return json({ error: 'File too large. Maximum size is 10 MB.' }, { status: 413 });
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
	const result = await vision.analyzeImage(
		{ data: base64Data, mediaType: file.type },
		{ title: titleOverride, context }
	);

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
			title: titleOverride ?? result.title,
			content: result.content,
			tags: tags ?? result.tags,
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
