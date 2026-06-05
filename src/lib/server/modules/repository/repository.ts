import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { documents, type RepoRef } from '@/db/schema';

export type { RepoRef };

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface Document {
	id: string;
	title: string;
	content: string;
	tags: string[];
	/** Git repositories this document describes (descriptive metadata only). */
	repos: RepoRef[];
	createdAt: string;
	updatedAt: string;
	date: string | null;
	parentId: string | null;
	userId: string | null;
	/** S3/Lightsail storage key for the original uploaded file, if any. */
	artifactKey: string | null;
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
		repos?: RepoRef[];
		date?: string;
		parentId?: string;
		embedding?: number[];
		userId?: string;
		artifactKey?: string;
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
			repos?: RepoRef[];
			date?: string;
			embedding?: number[];
			userId?: string;
			artifactKey?: string;
		};
		chunks: Array<{
			id: string;
			title: string;
			content: string;
			tags?: string[];
			repos?: RepoRef[];
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
	 * Fetch titles for a batch of document IDs in a single query.
	 * Returns a map of id → title. IDs not found (deleted, chunks) are omitted.
	 */
	getTitlesByIds(ids: string[]): Promise<Record<string, string>>;

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
	repos: RepoRef[];
	createdAt: string;
	updatedAt: string;
	date: string | null;
	parentId: string | null;
	userId: string | null;
	artifactKey: string | null;
}): Document {
	return {
		id: row.id,
		title: row.title,
		content: row.content,
		tags: row.tags,
		repos: row.repos,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		date: row.date,
		parentId: row.parentId,
		userId: row.userId,
		artifactKey: row.artifactKey
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
		repos?: RepoRef[];
		date?: string;
		parentId?: string;
		embedding?: number[];
		userId?: string;
		artifactKey?: string;
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
				repos: params.repos ?? [],
				embedding: params.embedding ?? null,
				createdAt: now,
				updatedAt: now,
				date: params.date ?? null,
				parentId: params.parentId ?? null,
				userId: params.userId ?? null,
				artifactKey: params.artifactKey ?? null
			})
			.onConflictDoUpdate({
				target: documents.id,
				set: {
					title: params.title,
					content: params.content,
					tags: params.tags ?? [],
					repos: params.repos ?? [],
					embedding: params.embedding ?? null,
					updatedAt: now,
					date: params.date !== undefined ? params.date : sql`${documents.date}`,
					parentId: params.parentId !== undefined ? params.parentId : sql`${documents.parentId}`,
					userId: sql`${documents.userId}`,
					// Preserve the existing artifact key on conflict if not re-supplied.
					artifactKey:
						params.artifactKey !== undefined ? params.artifactKey : sql`${documents.artifactKey}`
				}
			})
			.returning({
				createdAt: documents.createdAt,
				date: documents.date,
				parentId: documents.parentId,
				artifactKey: documents.artifactKey
			});

		return {
			id,
			title: params.title,
			content: params.content,
			tags: params.tags ?? [],
			repos: params.repos ?? [],
			createdAt: row.createdAt,
			updatedAt: now,
			date: row.date,
			parentId: row.parentId,
			userId: params.userId ?? null,
			artifactKey: row.artifactKey
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
			repos?: RepoRef[];
			date?: string;
			embedding?: number[];
			userId?: string;
			artifactKey?: string;
		};
		chunks: Array<{
			id: string;
			title: string;
			content: string;
			tags?: string[];
			repos?: RepoRef[];
			date?: string;
			parentId: string;
			embedding: number[];
			userId?: string;
		}>;
	}): Promise<Document> {
		return db.transaction(async (tx) => {
			const now = new Date().toISOString();

			await tx.delete(documents).where(eq(documents.parentId, params.parent.id));

			const [parentRow] = await tx
				.insert(documents)
				.values({
					id: params.parent.id,
					title: params.parent.title,
					content: params.parent.content,
					tags: params.parent.tags ?? [],
					repos: params.parent.repos ?? [],
					embedding: params.parent.embedding ?? null,
					createdAt: now,
					updatedAt: now,
					date: params.parent.date ?? null,
					parentId: null,
					userId: params.parent.userId ?? null,
					artifactKey: params.parent.artifactKey ?? null
				})
				.onConflictDoUpdate({
					target: documents.id,
					set: {
						title: params.parent.title,
						content: params.parent.content,
						tags: params.parent.tags ?? [],
						repos: params.parent.repos ?? [],
						embedding: params.parent.embedding ?? null,
						updatedAt: now,
						date: params.parent.date !== undefined ? params.parent.date : sql`${documents.date}`,
						parentId: null,
						userId: sql`${documents.userId}`,
						// Preserve the existing artifact key on conflict if not re-supplied.
						artifactKey:
							params.parent.artifactKey !== undefined
								? params.parent.artifactKey
								: sql`${documents.artifactKey}`
					}
				})
				.returning({
					createdAt: documents.createdAt,
					date: documents.date,
					artifactKey: documents.artifactKey
				});

			for (const chunk of params.chunks) {
				await tx
					.insert(documents)
					.values({
						id: chunk.id,
						title: chunk.title,
						content: chunk.content,
						tags: chunk.tags ?? [],
						repos: chunk.repos ?? [],
						embedding: chunk.embedding,
						createdAt: now,
						updatedAt: now,
						date: chunk.date ?? null,
						parentId: chunk.parentId,
						userId: chunk.userId ?? null,
						artifactKey: null
					})
					.onConflictDoUpdate({
						target: documents.id,
						set: {
							title: chunk.title,
							content: chunk.content,
							tags: chunk.tags ?? [],
							repos: chunk.repos ?? [],
							embedding: chunk.embedding,
							updatedAt: now,
							date: chunk.date !== undefined ? chunk.date : sql`${documents.date}`,
							parentId: chunk.parentId,
							userId: sql`${documents.userId}`
						}
					});
			}

			return {
				id: params.parent.id,
				title: params.parent.title,
				content: params.parent.content,
				tags: params.parent.tags ?? [],
				repos: params.parent.repos ?? [],
				createdAt: parentRow.createdAt,
				updatedAt: now,
				date: parentRow.date,
				parentId: null,
				userId: params.parent.userId ?? null,
				artifactKey: parentRow.artifactKey
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
				repos: documents.repos,
				createdAt: documents.createdAt,
				updatedAt: documents.updatedAt,
				date: documents.date,
				parentId: documents.parentId,
				userId: documents.userId,
				artifactKey: documents.artifactKey,
				similarity: sql<number>`1 - (${documents.embedding} <=> ${queryVec})`
			})
			.from(documents)
			.where(
				and(
					sql`${documents.embedding} IS NOT NULL`,
					params.tag ? sql`${documents.tags} @> ${JSON.stringify([params.tag])}::jsonb` : undefined,
					params.since ? sql`${dateExpr} >= ${params.since}` : undefined,
					params.before ? sql`${dateExpr} < ${params.before}` : undefined
				)
			)
			.orderBy(sql`${documents.embedding} <=> ${queryVec}`)
			.limit(limit);

		return rows.map((row) => ({
			...rowToDocument(row),
			similarity: row.similarity
		}));
	}

	async getById(id: string): Promise<Document | null> {
		const rows = await db
			.select({
				id: documents.id,
				title: documents.title,
				content: documents.content,
				tags: documents.tags,
				repos: documents.repos,
				createdAt: documents.createdAt,
				updatedAt: documents.updatedAt,
				date: documents.date,
				parentId: documents.parentId,
				userId: documents.userId,
				artifactKey: documents.artifactKey
			})
			.from(documents)
			.where(eq(documents.id, id))
			.limit(1);

		if (!rows[0]) return null;
		return rowToDocument(rows[0]);
	}

	async getTitlesByIds(ids: string[]): Promise<Record<string, string>> {
		if (ids.length === 0) return {};

		const rows = await db
			.select({ id: documents.id, title: documents.title })
			.from(documents)
			.where(and(inArray(documents.id, ids), isNull(documents.parentId)));

		return Object.fromEntries(rows.map((r) => [r.id, r.title]));
	}

	async list(params?: { tag?: string; userId?: string }): Promise<Document[]> {
		const rows = await db
			.select({
				id: documents.id,
				title: documents.title,
				content: documents.content,
				tags: documents.tags,
				repos: documents.repos,
				createdAt: documents.createdAt,
				updatedAt: documents.updatedAt,
				date: documents.date,
				parentId: documents.parentId,
				userId: documents.userId,
				artifactKey: documents.artifactKey
			})
			.from(documents)
			.where(
				and(
					isNull(documents.parentId),
					params?.tag
						? sql`${documents.tags} @> ${JSON.stringify([params.tag])}::jsonb`
						: undefined,
					params?.userId ? eq(documents.userId, params.userId) : undefined
				)
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
