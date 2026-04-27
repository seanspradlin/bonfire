import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, documents } from "@/modules/db";

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
	userId: string | null;
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
		userId?: string;
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
			userId?: string;
		};
		chunks: Array<{
			id: string;
			title: string;
			content: string;
			tags?: string[];
			date?: string;
			parentId: string;
			embedding: number[];
			userId?: string;
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
	 * List top-level documents (parentId IS NULL) optionally filtered by tag
	 * and/or userId. Chunks are excluded — use getById to retrieve them via
	 * their parent.
	 */
	list(params?: { tag?: string; userId?: string }): Promise<Document[]>;

	/** Delete a document by ID. Returns true if a row was deleted. */
	delete(id: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function rowToDocument(row: {
	id: string;
	title: string;
	content: string;
	tags: string[];
	createdAt: string;
	updatedAt: string;
	date: string | null;
	parentId: string | null;
	userId: string | null;
}): Document {
	return {
		id: row.id,
		title: row.title,
		content: row.content,
		tags: row.tags,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		date: row.date,
		parentId: row.parentId,
		userId: row.userId,
	};
}

// ---------------------------------------------------------------------------
// PostgreSQL implementation
// ---------------------------------------------------------------------------

export class PgDocumentRepository implements DocumentRepository {
	async upsert(params: {
		id?: string;
		title: string;
		content: string;
		tags?: string[];
		date?: string;
		parentId?: string;
		embedding?: number[];
		userId?: string;
	}): Promise<Document> {
		const now = new Date().toISOString();
		const id = params.id ?? randomUUID();

		const [row] = await db
			.insert(documents)
			.values({
				id,
				title: params.title,
				content: params.content,
				tags: params.tags ?? [],
				embedding: params.embedding ?? null,
				createdAt: now,
				updatedAt: now,
				date: params.date ?? null,
				parentId: params.parentId ?? null,
				userId: params.userId ?? null,
			})
			.onConflictDoUpdate({
				target: documents.id,
				set: {
					title: params.title,
					content: params.content,
					tags: params.tags ?? [],
					embedding: params.embedding ?? null,
					updatedAt: now,
					date:
						params.date !== undefined ? params.date : sql`${documents.date}`,
					parentId:
						params.parentId !== undefined
							? params.parentId
							: sql`${documents.parentId}`,
					userId: sql`${documents.userId}`,
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
			userId: params.userId ?? null,
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
			userId?: string;
		};
		chunks: Array<{
			id: string;
			title: string;
			content: string;
			tags?: string[];
			date?: string;
			parentId: string;
			embedding: number[];
			userId?: string;
		}>;
	}): Promise<Document> {
		return db.transaction(async (tx) => {
			const now = new Date().toISOString();

			await tx
				.delete(documents)
				.where(eq(documents.parentId, params.parent.id));

			const [parentRow] = await tx
				.insert(documents)
				.values({
					id: params.parent.id,
					title: params.parent.title,
					content: params.parent.content,
					tags: params.parent.tags ?? [],
					embedding: params.parent.embedding ?? null,
					createdAt: now,
					updatedAt: now,
					date: params.parent.date ?? null,
					parentId: null,
					userId: params.parent.userId ?? null,
				})
				.onConflictDoUpdate({
					target: documents.id,
					set: {
						title: params.parent.title,
						content: params.parent.content,
						tags: params.parent.tags ?? [],
						embedding: params.parent.embedding ?? null,
						updatedAt: now,
						date:
							params.parent.date !== undefined
								? params.parent.date
								: sql`${documents.date}`,
						parentId: null,
						userId: sql`${documents.userId}`,
					},
				})
				.returning({ createdAt: documents.createdAt, date: documents.date });

			for (const chunk of params.chunks) {
				await tx
					.insert(documents)
					.values({
						id: chunk.id,
						title: chunk.title,
						content: chunk.content,
						tags: chunk.tags ?? [],
						embedding: chunk.embedding,
						createdAt: now,
						updatedAt: now,
						date: chunk.date ?? null,
						parentId: chunk.parentId,
						userId: chunk.userId ?? null,
					})
					.onConflictDoUpdate({
						target: documents.id,
						set: {
							title: chunk.title,
							content: chunk.content,
							tags: chunk.tags ?? [],
							embedding: chunk.embedding,
							updatedAt: now,
							date:
								chunk.date !== undefined ? chunk.date : sql`${documents.date}`,
							parentId: chunk.parentId,
							userId: sql`${documents.userId}`,
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
				userId: params.parent.userId ?? null,
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

		// Bind the embedding array as a parameterised value cast to vector.
		// Using sql.param avoids raw string interpolation and lets the pg driver
		// send it as a proper query parameter — safe and compatible with the HNSW index.
		const queryVec = sql`${sql.param(JSON.stringify(params.embedding))}::vector`;

		const dateExpr = sql`COALESCE(${documents.date}, ${documents.createdAt})`;

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
				userId: documents.userId,
				similarity: sql<number>`1 - (${documents.embedding} <=> ${queryVec})`,
			})
			.from(documents)
			.where(
				and(
					sql`${documents.embedding} IS NOT NULL`,
					params.tag
						? sql`${documents.tags} @> ${JSON.stringify([params.tag])}::jsonb`
						: undefined,
					params.since ? sql`${dateExpr} >= ${params.since}` : undefined,
					params.before ? sql`${dateExpr} < ${params.before}` : undefined,
				),
			)
			.orderBy(sql`${documents.embedding} <=> ${queryVec}`)
			.limit(limit);

		return rows.map((row) => ({
			...rowToDocument(row),
			similarity: row.similarity,
		}));
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
				userId: documents.userId,
			})
			.from(documents)
			.where(eq(documents.id, id))
			.limit(1);

		if (!rows[0]) return null;
		return rowToDocument(rows[0]);
	}

	async list(params?: { tag?: string; userId?: string }): Promise<Document[]> {
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
				userId: documents.userId,
			})
			.from(documents)
			.where(
				and(
					isNull(documents.parentId),
					params?.tag
						? sql`${documents.tags} @> ${JSON.stringify([params.tag])}::jsonb`
						: undefined,
					params?.userId
						? eq(documents.userId, params.userId)
						: undefined,
				),
			);

		return rows.map(rowToDocument);
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
