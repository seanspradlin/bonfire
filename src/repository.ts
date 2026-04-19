/**
 * DocumentRepository — the abstraction layer between MCP tools and the database.
 *
 * All MCP tools interact only with this interface. To add a PostgreSQL backend:
 *   1. Implement `DocumentRepository` in a new `PgDocumentRepository` class
 *   2. Use pgvector's `<=>` operator for native cosine similarity in `search()`
 *      instead of the in-JS computation used here
 *   3. Wire it up in index.ts based on DATABASE_DRIVER env var
 */

import { randomUUID } from "node:crypto";
import { eq, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { EMBEDDING_DIMENSIONS } from "./embeddings";
import { documents } from "./schema";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface Document {
	id: string;
	title: string;
	content: string;
	tags: string[];
	createdAt: string;
	updatedAt: string;
	date: string | null;
	parentId: string | null;
}

export interface SearchResult extends Document {
	/** Cosine similarity in [0, 1]. Higher = more relevant. */
	similarity: number;
}

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface DocumentRepository {
	/**
	 * Insert or update a document. Pass `id` to update an existing document,
	 * omit it to create a new one.
	 */
	upsert(params: {
		id?: string;
		title: string;
		content: string;
		tags?: string[];
		date?: string;
		parentId?: string;
		embedding?: number[];
	}): Promise<Document>;

	/** Delete all chunks belonging to a parent document. */
	deleteChunksByParentId(parentId: string): Promise<void>;

	/**
	 * Atomically replace a document and all its chunks in a single transaction.
	 * Deletes stale chunks, upserts the parent, then upserts each chunk.
	 * Use this instead of separate upsert/deleteChunksByParentId calls to avoid
	 * a window where the document is partially visible to concurrent readers.
	 */
	atomicIngest(params: {
		parent: {
			id: string;
			title: string;
			content: string;
			tags?: string[];
			date?: string;
			embedding?: number[];
		};
		chunks: Array<{
			id: string;
			title: string;
			content: string;
			tags?: string[];
			date?: string;
			parentId: string;
			embedding: number[];
		}>;
	}): Promise<Document>;

	/**
	 * Return the top `limit` documents ranked by cosine similarity to the
	 * provided query embedding, optionally filtered to a specific tag or
	 * time range (ISO 8601 strings compared against the document's `date` field,
	 * falling back to `createdAt` when `date` is unset).
	 */
	search(params: {
		embedding: number[];
		limit?: number;
		tag?: string;
		since?: string;
		before?: string;
	}): Promise<SearchResult[]>;

	/** Retrieve a single document by ID. Returns null if not found. */
	getById(id: string): Promise<Document | null>;

	/**
	 * List top-level documents (parentId IS NULL) optionally filtered by tag.
	 * Chunks are excluded — use getById to retrieve them via their parent.
	 */
	list(params?: { tag?: string }): Promise<Document[]>;

	/** Delete a document by ID. Returns true if a row was deleted. */
	delete(id: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Serialisation helpers
// ---------------------------------------------------------------------------

function embeddingToBuffer(embedding: number[]): Buffer {
	const buf = Buffer.allocUnsafe(embedding.length * 4);
	for (let i = 0; i < embedding.length; i++) {
		buf.writeFloatLE(embedding[i], i * 4);
	}
	return buf;
}

function bufferToEmbedding(buf: Buffer | Uint8Array | null): number[] | null {
	if (!buf) return null;
	const view = buf instanceof Buffer ? buf : Buffer.from(buf);
	// Skip rows encoded with a different model/dimension rather than throwing —
	// a single mismatched row should not fail the entire search request. The
	// caller's `if (!rowEmbedding) continue` guard will skip it. Re-ingesting
	// the document fixes the mismatch.
	if (view.byteLength !== EMBEDDING_DIMENSIONS * 4) return null;
	const result: number[] = new Array(view.byteLength / 4);
	for (let i = 0; i < result.length; i++) {
		result[i] = view.readFloatLE(i * 4);
	}
	return result;
}

function rowToDocument(row: {
	id: string;
	title: string;
	content: string;
	tags: string;
	createdAt: string;
	updatedAt: string;
	date: string | null;
	parentId: string | null;
}): Document {
	return {
		id: row.id,
		title: row.title,
		content: row.content,
		tags: JSON.parse(row.tags) as string[],
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		date: row.date,
		parentId: row.parentId,
	};
}

function cosineSimilarity(a: number[], b: number[]): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// SQLite implementation
// ---------------------------------------------------------------------------

export class SqliteDocumentRepository implements DocumentRepository {
	async upsert(params: {
		id?: string;
		title: string;
		content: string;
		tags?: string[];
		date?: string;
		parentId?: string;
		embedding?: number[];
	}): Promise<Document> {
		const now = new Date().toISOString();
		const id = params.id ?? randomUUID();
		const tagsJson = JSON.stringify(params.tags ?? []);
		const embeddingBuf = params.embedding
			? embeddingToBuffer(params.embedding)
			: null;

		const [row] = await db
			.insert(documents)
			.values({
				id,
				title: params.title,
				content: params.content,
				tags: tagsJson,
				embedding: embeddingBuf,
				createdAt: now,
				updatedAt: now,
				date: params.date ?? null,
				parentId: params.parentId ?? null,
			})
			.onConflictDoUpdate({
				target: documents.id,
				set: {
					title: params.title,
					content: params.content,
					tags: tagsJson,
					embedding: embeddingBuf,
					updatedAt: now,
					// Preserve existing date when caller omits it on update
					date:
						params.date !== undefined ? params.date : sql`${documents.date}`,
					parentId:
						params.parentId !== undefined
							? params.parentId
							: sql`${documents.parentId}`,
				},
			})
			.returning({
				createdAt: documents.createdAt,
				date: documents.date,
				parentId: documents.parentId,
			});

		return {
			id,
			title: params.title,
			content: params.content,
			tags: params.tags ?? [],
			createdAt: row.createdAt,
			updatedAt: now,
			date: row.date,
			parentId: row.parentId,
		};
	}

	async deleteChunksByParentId(parentId: string): Promise<void> {
		await db.delete(documents).where(eq(documents.parentId, parentId));
	}

	async atomicIngest(params: {
		parent: {
			id: string;
			title: string;
			content: string;
			tags?: string[];
			date?: string;
			embedding?: number[];
		};
		chunks: Array<{
			id: string;
			title: string;
			content: string;
			tags?: string[];
			date?: string;
			parentId: string;
			embedding: number[];
		}>;
	}): Promise<Document> {
		return db.transaction(async (tx) => {
			const now = new Date().toISOString();
			const tagsJson = JSON.stringify(params.parent.tags ?? []);
			const parentEmbBuf = params.parent.embedding
				? embeddingToBuffer(params.parent.embedding)
				: null;

			await tx
				.delete(documents)
				.where(eq(documents.parentId, params.parent.id));

			const [parentRow] = await tx
				.insert(documents)
				.values({
					id: params.parent.id,
					title: params.parent.title,
					content: params.parent.content,
					tags: tagsJson,
					embedding: parentEmbBuf,
					createdAt: now,
					updatedAt: now,
					date: params.parent.date ?? null,
					parentId: null,
				})
				.onConflictDoUpdate({
					target: documents.id,
					set: {
						title: params.parent.title,
						content: params.parent.content,
						tags: tagsJson,
						embedding: parentEmbBuf,
						updatedAt: now,
						date:
							params.parent.date !== undefined
								? params.parent.date
								: sql`${documents.date}`,
						parentId: null,
					},
				})
				.returning({ createdAt: documents.createdAt, date: documents.date });

			for (const chunk of params.chunks) {
				const chunkTagsJson = JSON.stringify(chunk.tags ?? []);
				const chunkEmbBuf = embeddingToBuffer(chunk.embedding);
				await tx
					.insert(documents)
					.values({
						id: chunk.id,
						title: chunk.title,
						content: chunk.content,
						tags: chunkTagsJson,
						embedding: chunkEmbBuf,
						createdAt: now,
						updatedAt: now,
						date: chunk.date ?? null,
						parentId: chunk.parentId,
					})
					.onConflictDoUpdate({
						target: documents.id,
						set: {
							title: chunk.title,
							content: chunk.content,
							tags: chunkTagsJson,
							embedding: chunkEmbBuf,
							updatedAt: now,
							date:
								chunk.date !== undefined ? chunk.date : sql`${documents.date}`,
							parentId: chunk.parentId,
						},
					});
			}

			return {
				id: params.parent.id,
				title: params.parent.title,
				content: params.parent.content,
				tags: params.parent.tags ?? [],
				createdAt: parentRow.createdAt,
				updatedAt: now,
				date: parentRow.date,
				parentId: null,
			};
		});
	}

	async search(params: {
		embedding: number[];
		limit?: number;
		tag?: string;
		since?: string;
		before?: string;
	}): Promise<SearchResult[]> {
		const limit = params.limit ?? 5;

		// Fetch all rows that have embeddings. For large collections, replace this
		// with pgvector's ORDER BY embedding <=> $1 LIMIT $2 in the pg implementation.
		const rows = await db
			.select({
				id: documents.id,
				title: documents.title,
				content: documents.content,
				tags: documents.tags,
				embedding: documents.embedding,
				createdAt: documents.createdAt,
				updatedAt: documents.updatedAt,
				date: documents.date,
				parentId: documents.parentId,
			})
			.from(documents)
			.where(sql`${documents.embedding} IS NOT NULL`);

		const results: SearchResult[] = [];
		const sinceMs = params.since ? Date.parse(params.since) : undefined;
		const beforeMs = params.before ? Date.parse(params.before) : undefined;

		for (const row of rows) {
			if (params.tag) {
				const tags = JSON.parse(row.tags) as string[];
				if (!tags.includes(params.tag)) continue;
			}

			if (sinceMs !== undefined || beforeMs !== undefined) {
				const rowMs = Date.parse(row.date ?? row.createdAt);
				if (sinceMs !== undefined && rowMs < sinceMs) continue;
				if (beforeMs !== undefined && rowMs >= beforeMs) continue;
			}

			const rowEmbedding = bufferToEmbedding(row.embedding as Buffer | null);
			if (!rowEmbedding) continue;

			const similarity = cosineSimilarity(params.embedding, rowEmbedding);
			results.push({ ...rowToDocument(row), similarity });
		}

		return results.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
	}

	async getById(id: string): Promise<Document | null> {
		const rows = await db
			.select({
				id: documents.id,
				title: documents.title,
				content: documents.content,
				tags: documents.tags,
				createdAt: documents.createdAt,
				updatedAt: documents.updatedAt,
				date: documents.date,
				parentId: documents.parentId,
			})
			.from(documents)
			.where(eq(documents.id, id))
			.limit(1);

		if (!rows[0]) return null;

		// The parent row stores the canonical full content set at ingest time.
		// Chunks exist only for search (each has an embedding); we do not
		// reassemble from them here, which avoids duplicated heading prefixes
		// and join-separator whitespace drift.
		return rowToDocument(rows[0]);
	}

	async list(params?: { tag?: string }): Promise<Document[]> {
		const rows = await db
			.select({
				id: documents.id,
				title: documents.title,
				content: documents.content,
				tags: documents.tags,
				createdAt: documents.createdAt,
				updatedAt: documents.updatedAt,
				date: documents.date,
				parentId: documents.parentId,
			})
			.from(documents)
			.where(isNull(documents.parentId));

		const docs = rows.map(rowToDocument);

		if (params?.tag) {
			return docs.filter((d) => d.tags.includes(params.tag as string));
		}

		return docs;
	}

	async delete(id: string): Promise<boolean> {
		return db.transaction(async (tx) => {
			await tx.delete(documents).where(eq(documents.parentId, id));
			const result = await tx
				.delete(documents)
				.where(eq(documents.id, id))
				.returning({ id: documents.id });
			return result.length > 0;
		});
	}
}
