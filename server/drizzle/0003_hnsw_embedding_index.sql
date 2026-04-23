CREATE INDEX IF NOT EXISTS "documents_embedding_hnsw_idx" ON "documents" USING hnsw ("embedding" vector_cosine_ops);
