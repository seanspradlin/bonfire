import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { json } from '@sveltejs/kit';
import { canEdit, canModifyResource, requireAuth } from '$lib/server/modules/auth/guards';
import { repo, embedder, storage } from '$lib/server/deps';
import { ingestDocument } from '$lib/server/modules/ingestion';
import {
	ALLOWED_TEXT_MEDIA_TYPES,
	isAllowedTextMediaType,
	parseOptionalDate,
	parseOptionalId,
	parseOptionalString,
	parseOptionalTags,
	uploadRateLimiter
} from '$lib/server/modules/upload/uploadForm';
import type { RequestHandler } from './$types';

const MAX_TEXT_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Upload a plain-text or markdown file and store as a knowledge base document.
 *
 * Fields: file (required), tags, context, title, id, date
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const authUser = requireAuth(locals);

	// Only editors and admins may write to the knowledge base.
	if (!canEdit(authUser)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	if (uploadRateLimiter.isLimited(authUser.id)) {
		return json({ error: 'Too many uploads — try again in a minute' }, { status: 429 });
	}

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

	if (!isAllowedTextMediaType(file.type)) {
		const essence = file.type.split(';')[0].trim();
		return json(
			{
				error: `Unsupported media type: ${essence}. Must be one of: ${ALLOWED_TEXT_MEDIA_TYPES.join(', ')}`
			},
			{ status: 415 }
		);
	}

	if (file.size > MAX_TEXT_BYTES) {
		return json({ error: 'File too large. Maximum size is 10 MB.' }, { status: 413 });
	}

	// Sniff the first 16 bytes for null bytes — a reliable indicator of binary
	// content mislabeled as text/plain. Valid UTF-8 never contains 0x00.
	const sniffBuffer = await file.slice(0, 16).arrayBuffer();
	const sniffBytes = new Uint8Array(sniffBuffer);
	if (sniffBytes.some((b) => b === 0x00)) {
		return json({ error: 'File appears to be binary content, not plain text.' }, { status: 415 });
	}

	const tags = parseOptionalTags(formData);
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

	// If targeting an existing document by id, enforce ownership before writing
	// (editors may only overwrite their own docs; admins any).
	if (id) {
		const existing = await repo.getById(id);
		if (existing && !canModifyResource(authUser, existing.userId)) {
			return json({ error: 'Forbidden' }, { status: 403 });
		}
	}

	const docId = id ?? randomUUID();

	const arrayBuffer = await file.arrayBuffer();
	const fileBuffer = Buffer.from(arrayBuffer);
	const content = new TextDecoder().decode(fileBuffer);

	// Derive a readable title from the filename when not overridden.
	const stemTitle = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
	const title = titleOverride ?? stemTitle;

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

	let doc: Awaited<ReturnType<typeof ingestDocument>>;
	try {
		doc = await ingestDocument(
			{
				id: docId,
				title,
				content,
				tags,
				date: date ?? undefined,
				userId: authUser.id,
				artifactKey
			},
			repo,
			embedder
		);
	} catch (err) {
		// Best-effort cleanup of the orphaned S3 object.
		if (storage && artifactKey) {
			storage.delete(artifactKey).catch((e) => {
				console.error('[storage] orphaned artifact could not be deleted', {
					key: artifactKey,
					error: e
				});
			});
		}
		throw err;
	}

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
