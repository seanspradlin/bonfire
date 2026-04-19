/**
 * SQLite schema for Bonfire knowledge base.
 *
 * Migration path to PostgreSQL + pgvector:
 *   - Replace `sqliteTable` → `pgTable`
 *   - Replace `blob("embedding")` → `vector("embedding", { dimensions: 1536 })`
 *     using drizzle-orm/pg-core and the pgvector extension
 *   - Replace `text("tags")` (JSON string) → `jsonb("tags")`
 *   - Replace `text` timestamps → `timestamp` columns
 *   - Add GIN index on tags and HNSW/IVFFlat index on embedding
 */

import { blob, index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable(
	"documents",
	{
		id: text("id").primaryKey(),
		title: text("title").notNull(),
		content: text("content").notNull(),
		/** JSON-encoded string[]. In PostgreSQL, replace with jsonb(). */
		tags: text("tags").notNull().default("[]"),
		/**
		 * Float32Array serialized as a Buffer (little-endian IEEE 754).
		 * In PostgreSQL + pgvector, replace with vector(1536) and use
		 * the <=> operator for cosine distance queries.
		 */
		embedding: blob("embedding"),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
		/** Caller-supplied ISO 8601 date representing when the work occurred (e.g. PR merge date). */
		date: text("date"),
		/** Non-null for chunk documents — references the parent document's id. */
		parentId: text("parent_id"),
	},
	(t) => [index("documents_parent_id_idx").on(t.parentId)],
);

export type DocumentRow = typeof documents.$inferSelect;
