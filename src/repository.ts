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
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
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
		embedding: number[];
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

	/** List all documents, optionally filtered by tag. */
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
}): Document {
	return {
		id: row.id,
		title: row.title,
		content: row.content,
		tags: JSON.parse(row.tags) as string[],
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		date: row.date,
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
		embedding: number[];
	}): Promise<Document> {
		const now = new Date().toISOString();
		const id = params.id ?? randomUUID();
		const tagsJson = JSON.stringify(params.tags ?? []);
		const embeddingBuf = embeddingToBuffer(params.embedding);

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
				},
			})
			.returning({
				createdAt: documents.createdAt,
				date: documents.date,
			});

		return {
			id,
			title: params.title,
			content: params.content,
			tags: params.tags ?? [],
			createdAt: row.createdAt,
			updatedAt: now,
			date: row.date,
		};
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
			})
			.from(documents)
			.where(eq(documents.id, id))
			.limit(1);

		if (rows[0]) {
			return rowToDocument(rows[0]);
		}
		return null;
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
			})
			.from(documents);

		const docs = rows.map(rowToDocument);

		if (params?.tag) {
			return docs.filter((d) => d.tags.includes(params.tag as string));
		}

		return docs;
	}

	async delete(id: string): Promise<boolean> {
		const result = await db
			.delete(documents)
			.where(eq(documents.id, id))
			.returning({ id: documents.id });

		return result.length > 0;
	}
}
