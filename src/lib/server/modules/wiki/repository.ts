import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { wikiPages } from '@/db/schema';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface WikiPage {
	slug: string;
	title: string;
	content: string;
	tags: string[];
	sourceDocumentIds: string[];
	createdAt: string;
	updatedAt: string;
	userId: string | null;
}

export interface WikiSearchResult extends WikiPage {
	/** Cosine similarity in [0, 1]. Higher = more relevant. */
	similarity: number;
}

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface WikiPageRepository {
	/**
	 * Insert or update a wiki page by its slug.
	 * On conflict, updates content fields but preserves createdAt and userId.
	 * Returns the persisted row.
	 */
	upsertBySlug(params: {
		slug: string;
		title: string;
		content: string;
		tags?: string[];
		sourceDocumentIds?: string[];
		embedding?: number[];
		userId?: string;
	}): Promise<WikiPage>;

	/** Retrieve a wiki page by slug. Returns null if not found. */
	getBySlug(slug: string): Promise<WikiPage | null>;

	/** List wiki pages, optionally filtered by tag and paginated. */
	list(params?: { tag?: string; limit?: number; offset?: number }): Promise<WikiPage[]>;

	/** Delete a wiki page by slug. Returns true if a row was deleted. */
	delete(slug: string): Promise<boolean>;

	/**
	 * Return the top `limit` wiki pages ranked by cosine similarity to the
	 * provided query embedding, optionally filtered to a specific tag.
	 * Only pages with a non-null embedding are considered.
	 */
	search(params: {
		embedding: number[];
		limit?: number;
		tag?: string;
	}): Promise<WikiSearchResult[]>;
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function rowToWikiPage(row: {
	slug: string;
	title: string;
	content: string;
	tags: string[];
	sourceDocumentIds: string[];
	createdAt: string;
	updatedAt: string;
	userId: string | null;
}): WikiPage {
	return {
		slug: row.slug,
		title: row.title,
		content: row.content,
		tags: row.tags,
		sourceDocumentIds: row.sourceDocumentIds,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		userId: row.userId
	};
}

// ---------------------------------------------------------------------------
// PostgreSQL implementation
// ---------------------------------------------------------------------------

export class PgWikiPageRepository implements WikiPageRepository {
	/**
	 * Upserts a wiki page by slug using INSERT ... ON CONFLICT (slug) DO UPDATE.
	 * Slug is the primary key, so the conflict target is the PK directly.
	 * On conflict, title/content/tags/sourceDocumentIds/embedding/updatedAt are
	 * refreshed, but createdAt and userId are preserved from the original row.
	 *
	 * pgvector equivalent for the query vector:
	 *   INSERT INTO wiki_pages (..., embedding) VALUES (..., '[...]'::vector)
	 *   ON CONFLICT (slug) DO UPDATE SET embedding = EXCLUDED.embedding, ...
	 */
	async upsertBySlug(params: {
		slug: string;
		title: string;
		content: string;
		tags?: string[];
		sourceDocumentIds?: string[];
		embedding?: number[];
		userId?: string;
	}): Promise<WikiPage> {
		const now = new Date().toISOString();

		const [row] = await db
			.insert(wikiPages)
			.values({
				slug: params.slug,
				title: params.title,
				content: params.content,
				tags: params.tags ?? [],
				sourceDocumentIds: params.sourceDocumentIds ?? [],
				embedding: params.embedding ?? null,
				createdAt: now,
				updatedAt: now,
				userId: params.userId ?? null
			})
			.onConflictDoUpdate({
				// Conflict target is the primary key (slug)
				target: wikiPages.slug,
				set: {
					title: params.title,
					content: params.content,
					tags: params.tags ?? [],
					sourceDocumentIds: params.sourceDocumentIds ?? [],
					embedding: params.embedding ?? null,
					updatedAt: now,
					// Preserve createdAt and userId from the original row on conflict
					createdAt: sql`${wikiPages.createdAt}`,
					userId: sql`${wikiPages.userId}`
				}
			})
			.returning({
				createdAt: wikiPages.createdAt,
				userId: wikiPages.userId
			});

		return {
			slug: params.slug,
			title: params.title,
			content: params.content,
			tags: params.tags ?? [],
			sourceDocumentIds: params.sourceDocumentIds ?? [],
			createdAt: row.createdAt,
			updatedAt: now,
			userId: row.userId
		};
	}

	async getBySlug(slug: string): Promise<WikiPage | null> {
		const rows = await db
			.select({
				slug: wikiPages.slug,
				title: wikiPages.title,
				content: wikiPages.content,
				tags: wikiPages.tags,
				sourceDocumentIds: wikiPages.sourceDocumentIds,
				createdAt: wikiPages.createdAt,
				updatedAt: wikiPages.updatedAt,
				userId: wikiPages.userId
			})
			.from(wikiPages)
			.where(eq(wikiPages.slug, slug))
			.limit(1);

		if (!rows[0]) return null;
		return rowToWikiPage(rows[0]);
	}

	async list(params?: { tag?: string; limit?: number; offset?: number }): Promise<WikiPage[]> {
		const query = db
			.select({
				slug: wikiPages.slug,
				title: wikiPages.title,
				content: wikiPages.content,
				tags: wikiPages.tags,
				sourceDocumentIds: wikiPages.sourceDocumentIds,
				createdAt: wikiPages.createdAt,
				updatedAt: wikiPages.updatedAt,
				userId: wikiPages.userId
			})
			.from(wikiPages)
			.where(
				params?.tag
					? // JSONB containment: tags column must contain the given tag as a JSON string
						sql`${wikiPages.tags} @> ${JSON.stringify([params.tag])}::jsonb`
					: undefined
			)
			.$dynamic();

		let q = query;
		if (params?.limit !== undefined) q = q.limit(params.limit);
		if (params?.offset !== undefined) q = q.offset(params.offset);

		const rows = await q;
		return rows.map(rowToWikiPage);
	}

	async delete(slug: string): Promise<boolean> {
		const result = await db
			.delete(wikiPages)
			.where(eq(wikiPages.slug, slug))
			.returning({ slug: wikiPages.slug });
		return result.length > 0;
	}

	/**
	 * Performs cosine similarity search over wiki page embeddings using the
	 * pgvector <=> operator. Only rows with a non-null embedding participate.
	 *
	 * pgvector equivalent:
	 *   SELECT *, 1 - (embedding <=> '[...]'::vector) AS similarity
	 *   FROM wiki_pages
	 *   WHERE embedding IS NOT NULL
	 *   ORDER BY embedding <=> '[...]'::vector
	 *   LIMIT n;
	 */
	async search(params: {
		embedding: number[];
		limit?: number;
		tag?: string;
	}): Promise<WikiSearchResult[]> {
		const limit = params.limit ?? 5;

		// Bind the embedding as a parameterised value cast to vector — safe,
		// avoids raw string interpolation, and compatible with the HNSW index.
		const queryVec = sql`${sql.param(JSON.stringify(params.embedding))}::vector`;

		const rows = await db
			.select({
				slug: wikiPages.slug,
				title: wikiPages.title,
				content: wikiPages.content,
				tags: wikiPages.tags,
				sourceDocumentIds: wikiPages.sourceDocumentIds,
				createdAt: wikiPages.createdAt,
				updatedAt: wikiPages.updatedAt,
				userId: wikiPages.userId,
				similarity: sql<number>`1 - (${wikiPages.embedding} <=> ${queryVec})`
			})
			.from(wikiPages)
			.where(
				and(
					sql`${wikiPages.embedding} IS NOT NULL`,
					params.tag ? sql`${wikiPages.tags} @> ${JSON.stringify([params.tag])}::jsonb` : undefined
				)
			)
			.orderBy(sql`${wikiPages.embedding} <=> ${queryVec}`)
			.limit(limit);

		return rows.map((row) => ({
			...rowToWikiPage(row),
			similarity: row.similarity
		}));
	}
}
