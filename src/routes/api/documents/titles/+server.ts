import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { canEdit, requireAuth } from '$lib/server/modules/auth/guards';
import { repo } from '$lib/server/deps';
import type { RequestHandler } from './$types';

const titlesSchema = z.object({
	ids: z.array(z.string()).min(1).max(100)
});

/** Batch-fetch document titles by ID. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const authUser = requireAuth(locals);
	if (!canEdit(authUser)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const parsed = titlesSchema.safeParse(raw);
	if (!parsed.success) {
		return json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, { status: 400 });
	}

	const titles = await repo.getTitlesByIds(parsed.data.ids);
	return json({ titles });
};
