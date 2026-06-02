/**
 * Helpers for formatting and deduplicating semantic search results.
 *
 * Extracted from the MCP tool handlers so that the presentation and merge
 * logic can be tested independently from the MCP protocol machinery.
 */

import type { RerankProvider } from '@/modules/embedding';
import type { SearchResult } from '@/modules/repository';

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
