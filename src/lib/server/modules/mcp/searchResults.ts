/**
 * Helpers for formatting and deduplicating semantic search results.
 *
 * Extracted from the MCP tool handlers so that the presentation and merge
 * logic can be tested independently from the MCP protocol machinery.
 */

import type { RerankProvider } from '@/modules/embedding';
import type { RepoRef, SearchResult } from '@/modules/repository';

// ---------------------------------------------------------------------------
// Reranking
// ---------------------------------------------------------------------------

/**
 * Re-score a candidate set using a cross-encoder and return the top-N results.
 *
 * Falls back to the vector-ranked top-N if the reranker call fails, so a
 * Cohere outage or rate-limit doesn't hard-fail the search request.
 *
 * Title is included in the reranker input alongside content because chunk
 * titles carry heading-path context that improves relevance scoring.
 */
export async function applyReranking(
	reranker: RerankProvider,
	query: string,
	candidates: SearchResult[],
	topN: number
): Promise<SearchResult[]> {
	try {
		const ranked = await reranker.rerank({
			query,
			documents: candidates.map((r) => ({
				id: r.id,
				content: `${r.title}\n\n${r.content}`
			})),
			topN
		});
		return ranked.map(({ id, relevanceScore }) => {
			const doc = candidates.find((r) => r.id === id);
			if (!doc) throw new Error(`Reranker returned unknown id: ${id}`);
			return { ...doc, similarity: relevanceScore };
		});
	} catch (err) {
		console.error('[rerank] failed, falling back to vector ranking:', err);
		return candidates.slice(0, topN);
	}
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Shape of a search result as returned to MCP callers.
 * Similarity is rounded to 3 decimal places to keep JSON compact.
 */
export interface FormattedSearchResult {
	id: string;
	parentId: string | null;
	title: string;
	tags: string[];
	/** Git repositories the document references (descriptive metadata only). */
	repos: RepoRef[];
	similarity: number;
	content: string;
	/** Pre-signed URL for the original uploaded artifact, or null if unavailable. */
	artifactUrl: string | null;
}

/**
 * Convert a raw repository SearchResult into the shape exposed to MCP clients.
 *
 * Chunk titles carry a ` [i/N]` suffix (e.g. "My Doc [2/5]") that is
 * meaningful internally but noisy in tool output. We strip it from chunk
 * results (identified by a non-null `parentId`) while leaving top-level
 * document titles untouched — those may legitimately contain that pattern.
 *
 * Similarity is rounded to 3 decimal places so the JSON output stays compact
 * without sacrificing useful precision.
 *
 * The `artifactUrl` parameter must be pre-computed by the caller — this
 * function is kept synchronous to avoid async complexity in the mapping step.
 *
 * @param result - Raw search result from the document repository.
 * @param artifactUrl - Pre-signed URL for the original artifact, or null.
 * @returns A leaner object suitable for JSON serialisation in MCP responses.
 */
export function formatSearchResult(
	result: SearchResult,
	artifactUrl: string | null
): FormattedSearchResult {
	const title = result.parentId ? result.title.replace(/ \[\d+\/\d+\]$/, '') : result.title;

	return {
		id: result.id,
		parentId: result.parentId,
		title,
		tags: result.tags,
		repos: result.repos,
		similarity: Math.round(result.similarity * 1000) / 1000,
		content: result.content,
		artifactUrl
	};
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

/**
 * Merge multiple search-result lists into one, keeping only the highest
 * similarity score when the same document appears in more than one list.
 *
 * Used by `query_knowledge_base` which fans out to several parallel queries
 * and needs to reconcile their overlapping result sets before ranking.
 *
 * The returned array is sorted by similarity descending and truncated to
 * `limit` entries.
 *
 * @param resultLists - One array of SearchResult per query that was executed.
 * @param limit - Maximum number of results to return after merging.
 * @returns Deduplicated, sorted, and truncated result list.
 */
export function deduplicateByBestSimilarity(
	resultLists: SearchResult[][],
	limit: number
): SearchResult[] {
	const best = new Map<string, SearchResult>();

	for (const results of resultLists) {
		for (const doc of results) {
			const existing = best.get(doc.id);
			if (!existing || doc.similarity > existing.similarity) {
				best.set(doc.id, doc);
			}
		}
	}

	return Array.from(best.values())
		.sort((a, b) => b.similarity - a.similarity)
		.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Repository resolution (find_repositories)
// ---------------------------------------------------------------------------

/** A document that contributed one or more repo references, after normalization. */
export interface RepoSourceDocument {
	id: string;
	title: string;
	repos: RepoRef[];
}

/** A repo reference annotated with the documents that referenced it. */
export interface ResolvedRepoRef extends RepoRef {
	sources: Array<{ id: string; title: string }>;
}

/**
 * Compute the deduplicated union of repo references across a set of source
 * documents, annotating each with the documents that referenced it.
 *
 * Deduplication is by `url`. When the same url appears in multiple documents
 * (or multiple times within one), `paths` and `sources` are merged and
 * de-duplicated; the first non-empty `ref`/`note` seen wins (later documents
 * may describe the same repo with no ref/note, which we don't want to lose).
 *
 * Source documents are expected to already be normalized to the parent level
 * (parent id + clean title), since search results are chunk rows.
 *
 * This is a pure function so it can be unit-tested without a database.
 */
export function mergeRepoRefs(documents: RepoSourceDocument[]): ResolvedRepoRef[] {
	const byUrl = new Map<string, ResolvedRepoRef>();
	// Track which (url → source id) pairs we've recorded to avoid duplicate sources.
	const seenSources = new Map<string, Set<string>>();

	for (const doc of documents) {
		for (const repo of doc.repos) {
			if (!repo.url) continue;

			let resolved = byUrl.get(repo.url);
			if (!resolved) {
				resolved = { url: repo.url, paths: [], sources: [] };
				byUrl.set(repo.url, resolved);
				seenSources.set(repo.url, new Set());
			}

			// Merge paths (dedup).
			if (repo.paths) {
				for (const p of repo.paths) {
					if (!resolved.paths!.includes(p)) resolved.paths!.push(p);
				}
			}

			// First non-empty ref/note wins.
			if (repo.ref && !resolved.ref) resolved.ref = repo.ref;
			if (repo.note && !resolved.note) resolved.note = repo.note;

			// Record the source document once per url.
			const sourceIds = seenSources.get(repo.url)!;
			if (!sourceIds.has(doc.id)) {
				sourceIds.add(doc.id);
				resolved.sources.push({ id: doc.id, title: doc.title });
			}
		}
	}

	// Drop the empty paths array when nothing was collected, to keep output clean.
	return Array.from(byUrl.values()).map((r) => {
		if (r.paths && r.paths.length === 0) {
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { paths: _omit, ...rest } = r;
			return rest;
		}
		return r;
	});
}
