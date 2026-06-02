import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { canEdit, canModifyResource, isAdmin, requireAuth } from '$lib/server/modules/auth/guards';
import { repo, embedder } from '$lib/server/deps';
import { ingestDocument } from '$lib/server/modules/ingestion';
import type { RequestHandler } from './$types';

const updateSchema = z.object({
	title: z.string().optional(),
	content: z.string().optional(),
	tags: z
		.array(z.string())
		.transform((arr) => arr.map((t) => t.trim()).filter(Boolean))
		.optional(),
	date: z.string().optional()
});

/** Retrieve a single document by ID. */
export const GET: RequestHandler = async ({ params, locals }) => {
	const authUser = requireAuth(locals);
	if (!canEdit(authUser)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const doc = await repo.getById(params.id);
	if (!doc || doc.parentId !== null) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	if (!isAdmin(authUser) && doc.userId !== authUser.id) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	return json({ document: doc });
};

/** Update an existing document. */
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const authUser = requireAuth(locals);

	const existing = await repo.getById(params.id);
	if (!existing || existing.parentId !== null) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	// Editors may update only their own documents; admins may update any.
	if (!canModifyResource(authUser, existing.userId)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const parsed = updateSchema.safeParse(raw);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 });
	}
	const body = parsed.data;

	const title = body.title?.trim();
	const content = body.content?.trim();

	if (!title) return json({ error: 'title is required' }, { status: 400 });
	if (!content) return json({ error: 'content is required' }, { status: 400 });

	const doc = await ingestDocument(
		{
			id: params.id,
			title,
			content,
			tags: body.tags ?? existing.tags,
			date: body.date ?? existing.date ?? undefined,
			userId: existing.userId ?? undefined
		},
		repo,
		embedder
	);

	return json({ document: doc });
};

/** Delete a document and all its chunks. */
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const authUser = requireAuth(locals);

	const existing = await repo.getById(params.id);
	if (!existing || existing.parentId !== null) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	// Editors may delete only their own documents; admins may delete any.
	if (!canModifyResource(authUser, existing.userId)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const deleted = await repo.delete(params.id);
	if (!deleted) {
		return json({ error: 'Not found' }, { status: 404 });
	}

	return new Response(null, { status: 204 });
};
