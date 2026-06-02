import { handleMcpRequest } from '$lib/server/modules/mcp/server';
import { repo, embedder, vision, reranker, storage, wikiRepo } from '$lib/server/deps';
import type { RequestHandler } from './$types';

const deps = { repo, embedder, vision, reranker, storage, wikiRepo };

/** MCP Streamable HTTP endpoint — handles all MCP protocol traffic. */
export const GET: RequestHandler = ({ request }) => handleMcpRequest(request, deps);
export const POST: RequestHandler = ({ request }) => handleMcpRequest(request, deps);
export const DELETE: RequestHandler = ({ request }) => handleMcpRequest(request, deps);
