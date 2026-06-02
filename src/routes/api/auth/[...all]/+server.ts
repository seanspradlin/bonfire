import { auth } from '$lib/server/auth';
import type { RequestHandler } from './$types';

/** Delegate all Better Auth requests to the Better Auth handler. */
export const GET: RequestHandler = ({ request }) => auth.handler(request);
export const POST: RequestHandler = ({ request }) => auth.handler(request);
