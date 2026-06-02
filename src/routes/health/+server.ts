import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Health check — confirms the service is up */
export const GET: RequestHandler = () => json({ status: 'ok', service: 'bonfire' });
