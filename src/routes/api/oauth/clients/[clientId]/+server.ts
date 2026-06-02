import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { oauthClient } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

/** Return the display name for an OAuth client by clientId (public endpoint). */
export const GET: RequestHandler = async ({ params }) => {
	const [client] = await db
		.select({ name: oauthClient.name })
		.from(oauthClient)
		.where(eq(oauthClient.clientId, params.clientId))
		.limit(1);

	if (!client) {
		error(404, { message: 'Not found' });
	}

	return json({ name: client.name });
};
