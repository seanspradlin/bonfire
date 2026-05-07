CREATE TABLE "wiki_pages" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536),
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"user_id" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_pages_slug_unique" ON "wiki_pages" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "wiki_pages_user_id_idx" ON "wiki_pages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wiki_pages_embedding_hnsw_idx" ON "wiki_pages" USING hnsw ("embedding" vector_cosine_ops);