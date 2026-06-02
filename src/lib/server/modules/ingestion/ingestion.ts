import { randomUUID } from 'node:crypto';
import type { EmbeddingProvider } from '@/modules/embedding';
import { applyChunkOverlap, CHUNK_OVERLAP_TOKENS, chunkMarkdown } from '@/modules/embedding';
import type { Document, DocumentRepository } from '@/modules/repository';

/**
 * Upsert a document with automatic chunking. Documents exceeding
 * CHUNK_TARGET_TOKENS are split into chunks; each chunk is embedded and
 * stored with a parentId reference. Short documents are stored as-is.
 * Both paths go through atomicIngest so the write is always transactional.
 * Returns the parent document.
 *
 * Stored chunk content is the normalized text of each chunk (separator
 * whitespace may differ from the original document). The parent row stores
 * the canonical full content; getById returns that directly. Chunks exist
 * only for semantic search — heading context and overlap are applied to
 * embedding inputs only, not to stored content.
 */
export async function ingestDocument(
	params: {
		id?: string;
		title: string;
		content: string;
		tags?: string[];
		date?: string;
		userId?: string;
		/** S3/Lightsail storage key for the original uploaded file, if any. */
		artifactKey?: string;
	},
	repo: DocumentRepository,
	embedder: EmbeddingProvider
): Promise<Document> {
	const chunks = chunkMarkdown(params.content);
	const needsChunking = chunks.length > 1;

	const parentId = params.id ?? randomUUID();

	if (!needsChunking) {
		// Pre-compute embedding before touching the DB so the transaction is short.
		const embedding = await embedder.embed(`${params.title}\n\n${params.content}`);
		// atomicIngest handles the delete-stale-chunks + upsert atomically,
		// which prevents a reader from seeing stale chunks during the update.
		return repo.atomicIngest({
			parent: { ...params, id: parentId, embedding },
			chunks: []
		});
	}

	// Build embedding inputs: apply heading context and overlap to the text sent
	// to the model, but store only the clean content so reassembly is lossless.
	const cleanContents = chunks.map((c) => c.content);
	const contextualTexts = chunks.map((c) =>
		c.headingContext ? `${c.headingContext}\n\n${c.content}` : c.content
	);
	const overlappedTexts = applyChunkOverlap(contextualTexts, CHUNK_OVERLAP_TOKENS);
	const embeddingInputs = overlappedTexts.map((text) => `${params.title}\n\n${text}`);

	// Batch all embedding calls into a single API request — faster and cheaper
	// than N individual round trips.
	const embeddings = await embedder.embedBatch(embeddingInputs);

	// Atomically delete stale chunks, upsert the parent, and insert all new chunks
	// in a single transaction so readers never see a partial state.
	// Stable, zero-padded chunk IDs ensure correct reassembly order via sort-by-id.
	return repo.atomicIngest({
		parent: { ...params, id: parentId },
		chunks: cleanContents.map((content, i) => ({
			id: `${parentId}:chunk:${String(i).padStart(4, '0')}`,
			title: `${params.title} [${i + 1}/${cleanContents.length}]`,
			content,
			tags: params.tags,
			date: params.date,
			parentId,
			embedding: embeddings[i],
			userId: params.userId
		}))
	});
}
