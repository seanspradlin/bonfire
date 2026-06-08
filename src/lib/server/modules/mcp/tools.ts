import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { env } from '$env/dynamic/private';
import { canEdit, canModifyResource } from '@/modules/auth/guards';
import type { EmbeddingProvider, RerankProvider } from '@/modules/embedding';
import { ingestDocument } from '@/modules/ingestion';
import {
	applyReranking,
	deduplicateByBestSimilarity,
	formatSearchResult,
	mergeRepoRefs,
	type RepoSourceDocument,
	type ResolvedRepoRef
} from '@/modules/mcp/searchResults';
import type { DocumentRepository, SearchResult } from '@/modules/repository';
import type { StorageProvider } from '@/modules/storage';
import type { VisionProvider } from '@/modules/vision';
import type { WikiPageRepository } from '@/modules/wiki';

// ---------------------------------------------------------------------------
// Shared Zod schemas
// ---------------------------------------------------------------------------

/**
 * A reference from a document to a git repository it describes. Descriptive
 * metadata only — Bonfire never reads, clones, or fetches the referenced code.
 */
const repoRefSchema = z.object({
	url: z
		.string()
		.describe('Repository URL or shorthand, e.g. "https://github.com/org/repo" or "org/repo"'),
	paths: z
		.array(z.string())
		.optional()
		.describe(
			'Relevant files or directories within the repo. When documenting a commit or PR, ' +
				'list every changed file (e.g. ["src/auth/guards.ts", "src/routes/api/documents/+server.ts"]) ' +
				'so callers can fetch the exact source via their own GitHub tools.'
		),
	ref: z.string().optional().describe('Optional branch, tag, or commit'),
	note: z.string().optional().describe('Optional note on why this repo is relevant to the document')
});

// ---------------------------------------------------------------------------
// Shared dependency shape
// ---------------------------------------------------------------------------

export interface SharedDeps {
	repo: DocumentRepository;
	embedder: EmbeddingProvider;
	vision: VisionProvider;
	reranker: RerankProvider | null;
	storage: StorageProvider | null;
	wikiRepo: WikiPageRepository;
}

// ---------------------------------------------------------------------------
// Artifact URL resolution
// ---------------------------------------------------------------------------

/** TTL for pre-signed artifact URLs, in seconds (default: 1 hour). */
const _rawTtl = Number(env.ARTIFACT_URL_TTL_SECONDS);
const ARTIFACT_URL_TTL_SECONDS =
	Number.isFinite(_rawTtl) && _rawTtl > 0 && _rawTtl <= 604800 ? _rawTtl : 3600;

/**
 * Resolve pre-signed URLs for a batch of search results.
 * Results without an artifactKey resolve to null.
 * When `userId` is provided, URLs are only generated for documents owned by
 * that user — other users' artifacts remain readable as content but their
 * original files are not exposed via pre-signed links.
 * Individual failures are caught and logged — a bad URL on one result
 * should never block the entire response.
 */
export async function resolveArtifactUrls(
	results: SearchResult[],
	storage: StorageProvider | null,
	userId?: string
): Promise<(string | null)[]> {
	if (!storage) return results.map(() => null);

	return Promise.all(
		results.map(async (r) => {
			if (!r.artifactKey) return null;
			if (userId && r.userId && r.userId !== userId) return null;
			try {
				return await storage.getPresignedUrl(r.artifactKey, ARTIFACT_URL_TTL_SECONDS);
			} catch (err) {
				console.error('[storage] failed to generate pre-signed URL', {
					artifactKey: r.artifactKey,
					error: err
				});
				return null;
			}
		})
	);
}

// ---------------------------------------------------------------------------
// Repository resolution (find_repositories)
// ---------------------------------------------------------------------------

/**
 * Run a semantic search over the knowledge base and return the deduplicated
 * union of git repositories referenced by the matching documents, each
 * annotated with the source documents that referenced it.
 *
 * This is the "topic → repos/paths" resolver shared by the MCP `find_repositories`
 * tool and the chat agent. It returns repo *metadata* only — Bonfire never reads
 * or fetches the referenced source code.
 *
 * Search mirrors `query_knowledge_base`: it fans out across the question plus any
 * extra queries, deduplicates by best similarity, and optionally reranks. Chunk
 * results are normalized back to their parent document (parent id + clean title)
 * before the repo references are merged.
 */
export async function resolveRepositories(
	params: { question: string; extra_queries?: string[]; tag?: string; limit?: number },
	deps: {
		repo: DocumentRepository;
		embedder: EmbeddingProvider;
		reranker: RerankProvider | null;
	},
	signal?: AbortSignal
): Promise<ResolvedRepoRef[]> {
	const { repo, embedder, reranker } = deps;
	const finalLimit = params.limit ?? 8;
	const perQueryLimit = reranker ? 20 : Math.min(20, finalLimit + 2);

	const queries = [params.question, ...(params.extra_queries ?? [])].filter((q) => q.length > 0);
	if (queries.length === 0) return [];

	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
	const allResults = await Promise.all(
		queries.map(async (q) => {
			if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
			const embedding = await embedder.embed(q);
			return repo.search({ embedding, limit: perQueryLimit, tag: params.tag });
		})
	);

	const dedupLimit = reranker ? Math.min(finalLimit * 4, 40) : finalLimit;
	const merged = deduplicateByBestSimilarity(allResults, dedupLimit);

	if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
	const results =
		reranker && merged.length > 0
			? await applyReranking(reranker, params.question, merged, finalLimit)
			: merged.slice(0, finalLimit);

	// Normalize chunk results to parent-level source documents, deduped by id —
	// chunks of the same document carry identical repos, so keep the first seen.
	const byId = new Map<string, RepoSourceDocument>();
	for (const r of results) {
		const id = r.parentId ?? r.id;
		if (byId.has(id)) continue;
		const title = r.parentId ? r.title.replace(/ \[\d+\/\d+\]$/, '') : r.title;
		byId.set(id, { id, title, repos: r.repos });
	}

	return mergeRepoRefs(Array.from(byId.values()));
}

export interface ServerDeps extends SharedDeps {
	userId: string;
	/** The caller's role, resolved at session establishment. May be null. */
	userRole: string | null;
}

/** Standard MCP error result returned when the caller lacks permission. */
function forbiddenResult(action: string) {
	return {
		content: [
			{
				type: 'text' as const,
				text: `Forbidden: you do not have permission to ${action}. Editors may only modify their own content; admins may modify any.`
			}
		],
		isError: true
	};
}

// ---------------------------------------------------------------------------
// MCP server factory — registers all tools onto a new McpServer instance
// ---------------------------------------------------------------------------

export function createServer({
	repo,
	embedder,
	vision,
	reranker,
	storage,
	wikiRepo,
	userId,
	userRole
}: ServerDeps): McpServer {
	const server = new McpServer({
		name: 'bonfire',
		version: '0.1.0'
	});

	// The caller identity used for all write/delete authorization checks.
	const caller = { id: userId, role: userRole };

	// -------------------------------------------------------------------------
	// Tool: add_document
	// -------------------------------------------------------------------------

	server.registerTool(
		'add_document',
		{
			title: 'Add Document',
			description:
				'Add a new knowledge base document or update an existing one. ' +
				'Accepts markdown content. Provide `id` to update an existing document.',
			inputSchema: {
				title: z.string().describe('Short, descriptive title for the document'),
				content: z.string().describe('Full document content in markdown format'),
				tags: z
					.array(z.string())
					.optional()
					.describe("Tags for categorisation and filtering (e.g. ['marketing', 'hubspot'])"),
				repos: repoRefSchema
					.array()
					.optional()
					.describe(
						'Git repositories this document describes, so agents know where the relevant ' +
							'source code lives. Descriptive metadata only — Bonfire never reads the code. ' +
							'When documenting a code change, populate paths with the changed files — ' +
							'the caller uses these with their GitHub tools to read source.'
					),
				date: z.iso
					.datetime()
					.optional()
					.describe(
						'ISO 8601 date representing when the work occurred (e.g. PR merge date). ' +
							'Used for temporal filtering — independent of when this document was ingested.'
					),
				id: z
					.string()
					.refine(
						(v) => !v.includes(':chunk:'),
						"id must not contain the reserved ':chunk:' namespace"
					)
					.optional()
					.describe('Document ID — omit to create a new document')
			}
		},
		async ({ title, content, tags, repos, date, id }) => {
			// Authorize: creating new content requires editor/admin; overwriting an
			// existing document requires ownership (editor) or admin.
			if (!canEdit(caller)) return forbiddenResult('add documents');
			if (id) {
				const existing = await repo.getById(id);
				if (existing && !canModifyResource(caller, existing.userId)) {
					return forbiddenResult('overwrite this document');
				}
			}

			const doc = await ingestDocument(
				{ id, title, content, tags, repos, date, userId },
				repo,
				embedder
			);

			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify(
							{
								id: doc.id,
								title: doc.title,
								tags: doc.tags,
								repos: doc.repos,
								date: doc.date,
								createdAt: doc.createdAt,
								updatedAt: doc.updatedAt
							},
							null,
							2
						)
					}
				]
			};
		}
	);

	// -------------------------------------------------------------------------
	// Tool: search_documents
	// -------------------------------------------------------------------------

	server.registerTool(
		'search_documents',
		{
			title: 'Search Documents',
			description:
				'Search the knowledge base using natural language. Returns the most ' +
				'semantically relevant documents ranked by similarity score.',
			inputSchema: {
				query: z
					.string()
					.describe(
						"Natural language search query, e.g. 'How do I issue a refund for a gift card purchase?'"
					),
				limit: z
					.number()
					.int()
					.min(1)
					.max(20)
					.optional()
					.describe('Maximum number of results to return (default: 5)'),
				tag: z.string().optional().describe('Restrict results to documents with this tag'),
				since: z.iso
					.datetime()
					.optional()
					.describe(
						'ISO 8601 timestamp — only return documents whose date (or createdAt if date is unset) is at or after this time'
					),
				before: z.iso
					.datetime()
					.optional()
					.describe(
						'ISO 8601 timestamp — only return documents whose date (or createdAt if date is unset) is before this time'
					)
			}
		},
		async ({ query, limit, tag, since, before }) => {
			const finalLimit = limit ?? 5;
			const candidateLimit = reranker ? Math.min(finalLimit * 4, 40) : finalLimit;

			const embedding = await embedder.embed(query);
			const candidates = await repo.search({
				embedding,
				limit: candidateLimit,
				tag,
				since,
				before
			});

			const results =
				reranker && candidates.length > 0
					? await applyReranking(reranker, query, candidates, finalLimit)
					: candidates;

			if (results.length === 0) {
				return { content: [{ type: 'text', text: 'No matching documents found.' }] };
			}

			const artifactUrls = await resolveArtifactUrls(results, storage, userId);
			const formatted = results.map((r, i) => formatSearchResult(r, artifactUrls[i]));

			return {
				content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }]
			};
		}
	);

	// -------------------------------------------------------------------------
	// Tool: get_document
	// -------------------------------------------------------------------------

	server.registerTool(
		'get_document',
		{
			title: 'Get Document',
			description: 'Retrieve the full content of a document by its ID.',
			inputSchema: {
				id: z.string().describe('Document ID')
			}
		},
		async ({ id }) => {
			const doc = await repo.getById(id);

			if (!doc) {
				return {
					content: [{ type: 'text', text: `Document not found: ${id}` }],
					isError: true
				};
			}

			// Only generate a pre-signed URL if the caller owns the document.
			let artifactUrl: string | null = null;
			const callerOwnsDoc = !doc.userId || doc.userId === userId;
			if (doc.artifactKey && storage && callerOwnsDoc) {
				try {
					artifactUrl = await storage.getPresignedUrl(doc.artifactKey, ARTIFACT_URL_TTL_SECONDS);
				} catch (err) {
					console.error('[storage] failed to generate pre-signed URL', {
						artifactKey: doc.artifactKey,
						error: err
					});
				}
			}

			// Omit artifactKey from the response (internal storage detail).
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { artifactKey: _key, ...docFields } = doc;
			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify({ ...docFields, artifactUrl }, null, 2)
					}
				]
			};
		}
	);

	// -------------------------------------------------------------------------
	// Tool: list_documents
	// -------------------------------------------------------------------------

	server.registerTool(
		'list_documents',
		{
			title: 'List Documents',
			description: 'List all documents in the knowledge base. Optionally filter by tag.',
			inputSchema: {
				tag: z.string().optional().describe('Filter documents by this tag')
			}
		},
		async ({ tag }) => {
			const docs = await repo.list({ tag });

			if (docs.length === 0) {
				const msg = tag ? `No documents found with tag "${tag}".` : 'The knowledge base is empty.';
				return { content: [{ type: 'text', text: msg }] };
			}

			const summary = docs.map((d) => ({
				id: d.id,
				title: d.title,
				tags: d.tags,
				repos: d.repos,
				date: d.date,
				updatedAt: d.updatedAt
			}));

			return {
				content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }]
			};
		}
	);

	// -------------------------------------------------------------------------
	// Tool: query_knowledge_base
	// -------------------------------------------------------------------------

	server.registerTool(
		'query_knowledge_base',
		{
			title: 'Query Knowledge Base',
			description:
				'Answer a question by retrieving and synthesizing the most relevant documents ' +
				'from the knowledge base. Runs multiple semantic searches in parallel (using the ' +
				'question plus any extra queries you provide), deduplicates results, and returns ' +
				'the top documents ranked by relevance. Use this instead of search_documents when ' +
				'you need a comprehensive answer that may span several documents.',
			inputSchema: {
				question: z.string().describe('The question or topic to look up in the knowledge base'),
				extra_queries: z
					.array(z.string())
					.max(4)
					.optional()
					.describe(
						'Up to 4 additional search queries to broaden retrieval — useful when ' +
							'the question may be answered by documents using different terminology'
					),
				limit: z
					.number()
					.int()
					.min(1)
					.max(20)
					.optional()
					.describe('Maximum number of documents to return after merging (default: 8)'),
				tag: z.string().optional().describe('Restrict results to documents with this tag'),
				since: z.iso
					.datetime()
					.optional()
					.describe(
						'ISO 8601 timestamp — only return documents whose date (or createdAt if date is unset) is at or after this time'
					),
				before: z.iso
					.datetime()
					.optional()
					.describe(
						'ISO 8601 timestamp — only return documents whose date (or createdAt if date is unset) is before this time'
					)
			}
		},
		async ({ question, extra_queries, limit, tag, since, before }) => {
			const finalLimit = limit ?? 8;
			const perQueryLimit = reranker ? 20 : Math.min(20, finalLimit + 2);

			const queries = [question, ...(extra_queries ?? [])];
			const allResults = await Promise.all(
				queries.map(async (q) => {
					const embedding = await embedder.embed(q);
					return repo.search({ embedding, limit: perQueryLimit, tag, since, before });
				})
			);

			const dedupLimit = reranker ? Math.min(finalLimit * 4, 40) : finalLimit;
			const merged = deduplicateByBestSimilarity(allResults, dedupLimit);

			const results =
				reranker && merged.length > 0
					? await applyReranking(reranker, question, merged, finalLimit)
					: merged.slice(0, finalLimit);

			if (results.length === 0) {
				return { content: [{ type: 'text', text: 'No relevant documents found.' }] };
			}

			const artifactUrls = await resolveArtifactUrls(results, storage, userId);
			const formatted = results.map((r, i) => formatSearchResult(r, artifactUrls[i]));

			return {
				content: [{ type: 'text', text: JSON.stringify(formatted, null, 2) }]
			};
		}
	);

	// -------------------------------------------------------------------------
	// Tool: find_repositories
	// -------------------------------------------------------------------------

	server.registerTool(
		'find_repositories',
		{
			title: 'Find Repositories',
			description:
				'Given a topic or question, return the git repositories (and specific paths) ' +
				'that the most relevant knowledge base documents reference. Use this to find ' +
				'WHERE the relevant source code lives before reading it with your own GitHub ' +
				'tools — Bonfire returns repository metadata only and never reads, clones, or ' +
				'fetches source code itself. Returns a deduplicated list of repositories, each ' +
				'annotated with the documents that referenced it.',
			inputSchema: {
				question: z.string().describe('The topic or question to resolve to relevant repositories'),
				extra_queries: z
					.array(z.string())
					.max(4)
					.optional()
					.describe('Up to 4 additional search queries to broaden retrieval'),
				tag: z.string().optional().describe('Restrict the search to documents with this tag'),
				limit: z
					.number()
					.int()
					.min(1)
					.max(20)
					.optional()
					.describe('Maximum number of documents to consider when collecting repos (default: 8)')
			}
		},
		async ({ question, extra_queries, tag, limit }) => {
			const repos = await resolveRepositories(
				{ question, extra_queries, tag, limit },
				{ repo, embedder, reranker }
			);

			if (repos.length === 0) {
				return {
					content: [
						{
							type: 'text',
							text: 'No repositories found — the matching documents do not reference any git repositories.'
						}
					]
				};
			}

			return {
				content: [{ type: 'text', text: JSON.stringify(repos, null, 2) }]
			};
		}
	);

	// -------------------------------------------------------------------------
	// Tool: add_image
	// -------------------------------------------------------------------------

	server.registerTool(
		'add_image',
		{
			title: 'Add Image',
			description:
				'Analyze an image (photo of handwritten notes, whiteboard, diagram, etc.) ' +
				'and store the extracted content as a knowledge base document. ' +
				'The image is transcribed and described by an AI vision model before storage.',
			inputSchema: {
				image_data: z.string().describe('Base64-encoded image data (without the data URI prefix)'),
				media_type: z
					.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])
					.describe('MIME type of the image'),
				title: z
					.string()
					.optional()
					.describe('Title for the document — if omitted, one is generated from the image content'),
				tags: z
					.array(z.string())
					.optional()
					.describe(
						'Tags for categorisation — if omitted, tags are generated automatically ' +
							"from the image content and title (e.g. ['meeting-notes', 'q2-planning'])"
					),
				id: z
					.string()
					.refine(
						(v) => !v.includes(':chunk:'),
						"id must not contain the reserved ':chunk:' namespace"
					)
					.optional()
					.describe('Document ID — omit to create a new document'),
				context: z
					.string()
					.optional()
					.describe(
						'Optional hint about the image content to guide analysis ' +
							"(e.g. 'whiteboard from sprint planning meeting on 2026-04-17')"
					),
				date: z.iso
					.datetime()
					.optional()
					.describe(
						'ISO 8601 date representing when the work occurred. ' +
							'Used for temporal filtering — independent of when this document was ingested.'
					)
			}
		},
		async ({ image_data, media_type, title, tags, id, context, date }) => {
			// Authorize before the expensive vision call.
			if (!canEdit(caller)) return forbiddenResult('add images');
			if (id) {
				const existing = await repo.getById(id);
				if (existing && !canModifyResource(caller, existing.userId)) {
					return forbiddenResult('overwrite this document');
				}
			}

			const result = await vision.analyzeImage(
				{ data: image_data, mediaType: media_type },
				{ title, context }
			);

			const resolvedTitle = title ?? result.title;
			const resolvedTags = tags ?? result.tags;
			const doc = await ingestDocument(
				{
					id,
					title: resolvedTitle,
					content: result.content,
					tags: resolvedTags,
					date,
					userId
				},
				repo,
				embedder
			);

			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify(
							{
								id: doc.id,
								title: doc.title,
								tags: doc.tags,
								date: doc.date,
								createdAt: doc.createdAt,
								updatedAt: doc.updatedAt
							},
							null,
							2
						)
					}
				]
			};
		}
	);

	// -------------------------------------------------------------------------
	// Tool: delete_document
	// -------------------------------------------------------------------------

	server.registerTool(
		'delete_document',
		{
			title: 'Delete Document',
			description: 'Permanently delete a document from the knowledge base.',
			inputSchema: {
				id: z.string().describe('Document ID to delete')
			}
		},
		async ({ id }) => {
			const existing = await repo.getById(id);
			if (!existing || existing.parentId !== null) {
				return {
					content: [{ type: 'text', text: `Document not found: ${id}` }],
					isError: true
				};
			}

			// Editors may delete only their own documents; admins may delete any.
			if (!canModifyResource(caller, existing.userId)) {
				return forbiddenResult('delete this document');
			}

			const deleted = await repo.delete(id);
			if (!deleted) {
				return {
					content: [{ type: 'text', text: `Document not found: ${id}` }],
					isError: true
				};
			}

			return { content: [{ type: 'text', text: `Document ${id} deleted.` }] };
		}
	);

	// -------------------------------------------------------------------------
	// Tool: create_wiki_page
	// -------------------------------------------------------------------------

	server.registerTool(
		'create_wiki_page',
		{
			title: 'Create Wiki Page',
			description:
				'Create a new wiki page synthesized from source documents. ' +
				'Use this when no wiki page exists for the concept. ' +
				'Check with get_wiki_page first to confirm the slug is available.',
			inputSchema: {
				slug: z
					.string()
					.regex(
						/^[a-z0-9]+(?:-[a-z0-9]+)*$/,
						"Slug must be lowercase alphanumeric words separated by hyphens (e.g. 'team-onboarding')"
					)
					.describe("URL-safe identifier for the page (e.g. 'team-onboarding', 'api-rate-limits')"),
				title: z.string().describe('Human-readable title for the wiki page'),
				content: z.string().describe('Full wiki page content in markdown format'),
				tags: z.array(z.string()).optional().describe('Tags for categorisation and filtering'),
				source_document_ids: z
					.array(z.string())
					.optional()
					.describe('IDs of the source documents this wiki page was synthesized from')
			}
		},
		async ({ slug, title, content, tags, source_document_ids }) => {
			if (!canEdit(caller)) return forbiddenResult('create wiki pages');

			const existing = await wikiRepo.getBySlug(slug);
			if (existing) {
				return {
					content: [
						{
							type: 'text',
							text: `A wiki page already exists for slug "${slug}". Use update_wiki_page to modify it instead.`
						}
					],
					isError: true
				};
			}

			const embedding = await embedder.embed(content);
			const page = await wikiRepo.upsertBySlug({
				slug,
				title,
				content,
				tags,
				sourceDocumentIds: source_document_ids,
				embedding,
				userId
			});

			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify(
							{
								slug: page.slug,
								title: page.title,
								tags: page.tags,
								createdAt: page.createdAt,
								updatedAt: page.updatedAt
							},
							null,
							2
						)
					}
				]
			};
		}
	);

	// -------------------------------------------------------------------------
	// Tool: update_wiki_page
	// -------------------------------------------------------------------------

	server.registerTool(
		'update_wiki_page',
		{
			title: 'Update Wiki Page',
			description:
				'Update an existing wiki page. Use get_wiki_page first to read the current ' +
				'content before overwriting. Fails if the page does not exist — use ' +
				'create_wiki_page for new pages.',
			inputSchema: {
				slug: z.string().describe('Slug of the wiki page to update'),
				title: z
					.string()
					.optional()
					.describe('New title — if omitted, the existing title is preserved'),
				content: z.string().describe('New full wiki page content in markdown format'),
				tags: z
					.array(z.string())
					.optional()
					.describe('Updated tags — if omitted, existing tags are preserved'),
				source_document_ids: z.array(z.string()).optional().describe('Updated source document IDs')
			}
		},
		async ({ slug, title, content, tags, source_document_ids }) => {
			const existing = await wikiRepo.getBySlug(slug);
			if (!existing) {
				return {
					content: [
						{
							type: 'text',
							text: `No wiki page found for slug "${slug}". Use create_wiki_page to create a new page instead.`
						}
					],
					isError: true
				};
			}

			// Editors may update only their own wiki pages; admins may update any.
			if (!canModifyResource(caller, existing.userId)) {
				return forbiddenResult('update this wiki page');
			}

			const embedding = await embedder.embed(content);
			const page = await wikiRepo.upsertBySlug({
				slug,
				title: title ?? existing.title,
				content,
				tags: tags ?? existing.tags,
				sourceDocumentIds: source_document_ids ?? existing.sourceDocumentIds,
				embedding,
				userId
			});

			return {
				content: [
					{
						type: 'text',
						text: JSON.stringify(
							{
								slug: page.slug,
								title: page.title,
								tags: page.tags,
								updatedAt: page.updatedAt
							},
							null,
							2
						)
					}
				]
			};
		}
	);

	// -------------------------------------------------------------------------
	// Tool: delete_wiki_page
	// -------------------------------------------------------------------------

	server.registerTool(
		'delete_wiki_page',
		{
			title: 'Delete Wiki Page',
			description:
				'Permanently delete a wiki page by slug. Use during lint when a page is confirmed ' +
				'orphaned, superseded, or a duplicate. This cannot be undone.',
			inputSchema: {
				slug: z.string().describe('Slug of the wiki page to delete')
			}
		},
		async ({ slug }) => {
			const existing = await wikiRepo.getBySlug(slug);
			if (!existing) {
				return {
					content: [{ type: 'text', text: `No wiki page found for slug "${slug}".` }],
					isError: true
				};
			}

			// Editors may delete only their own wiki pages; admins may delete any.
			if (!canModifyResource(caller, existing.userId)) {
				return forbiddenResult('delete this wiki page');
			}

			const deleted = await wikiRepo.delete(slug);
			if (!deleted) {
				return {
					content: [{ type: 'text', text: `No wiki page found for slug "${slug}".` }],
					isError: true
				};
			}

			return {
				content: [{ type: 'text', text: `Wiki page "${slug}" has been permanently deleted.` }]
			};
		}
	);

	// -------------------------------------------------------------------------
	// Tool: get_wiki_page
	// -------------------------------------------------------------------------

	server.registerTool(
		'get_wiki_page',
		{
			title: 'Get Wiki Page',
			description:
				'Retrieve a wiki page by its slug. Returns null-like result when no page ' +
				'exists — use this to detect gaps before creating new pages or to read ' +
				'current content before updating.',
			inputSchema: {
				slug: z.string().describe('Slug of the wiki page to retrieve')
			}
		},
		async ({ slug }) => {
			const page = await wikiRepo.getBySlug(slug);

			if (!page) {
				return {
					content: [
						{
							type: 'text',
							text: `No wiki page found for slug "${slug}". Use create_wiki_page to synthesize one.`
						}
					]
				};
			}

			return {
				content: [{ type: 'text', text: JSON.stringify(page, null, 2) }]
			};
		}
	);

	// -------------------------------------------------------------------------
	// Tool: list_wiki_pages
	// -------------------------------------------------------------------------

	server.registerTool(
		'list_wiki_pages',
		{
			title: 'List Wiki Pages',
			description:
				'List all wiki pages, optionally filtered by tag. Use this to browse ' +
				'existing coverage and identify gaps before synthesizing new pages.',
			inputSchema: {
				tag: z.string().optional().describe('Filter wiki pages by this tag'),
				limit: z
					.number()
					.int()
					.min(1)
					.max(100)
					.optional()
					.describe('Maximum number of pages to return (default: all)'),
				offset: z
					.number()
					.int()
					.min(0)
					.optional()
					.describe('Number of pages to skip for pagination (default: 0)')
			}
		},
		async ({ tag, limit, offset }) => {
			const pages = await wikiRepo.list(
				tag || limit !== undefined || offset !== undefined ? { tag, limit, offset } : undefined
			);

			if (pages.length === 0) {
				return { content: [{ type: 'text', text: 'The wiki is empty.' }] };
			}

			const summary = pages.map((p) => ({
				slug: p.slug,
				title: p.title,
				tags: p.tags,
				updatedAt: p.updatedAt
			}));

			return {
				content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }]
			};
		}
	);

	// -------------------------------------------------------------------------
	// Tool: search_wiki
	// -------------------------------------------------------------------------

	server.registerTool(
		'search_wiki',
		{
			title: 'Search Wiki',
			description:
				'Search wiki pages by semantic similarity. Returns matching pages ranked by ' +
				'relevance. If no results, the concept likely has no wiki page yet — flag ' +
				'this gap to the user.',
			inputSchema: {
				query: z.string().describe('Natural language search query'),
				limit: z
					.number()
					.int()
					.min(1)
					.max(10)
					.optional()
					.describe('Maximum number of results to return (default: 5)'),
				tag: z.string().optional().describe('Restrict results to wiki pages with this tag')
			}
		},
		async ({ query, limit, tag }) => {
			const embedding = await embedder.embed(query);
			const results = await wikiRepo.search({ embedding, limit: limit ?? 5, tag });

			if (results.length === 0) {
				return {
					content: [
						{
							type: 'text',
							text:
								'No wiki pages found matching your query. The wiki may not yet cover ' +
								'this topic — consider using create_wiki_page to synthesize one.'
						}
					]
				};
			}

			const summary = results.map((r) => ({
				slug: r.slug,
				title: r.title,
				tags: r.tags,
				updatedAt: r.updatedAt,
				similarity: r.similarity
			}));

			return {
				content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }]
			};
		}
	);

	return server;
}
