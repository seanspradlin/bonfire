DROP INDEX "wiki_pages_slug_unique";--> statement-breakpoint
ALTER TABLE "wiki_pages" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD PRIMARY KEY ("slug");