/**
 * Application-wide singletons.
 *
 * Constructed once at module load so all route handlers share the same
 * database connection pool, embedding client, and storage client rather than
 * creating new instances per request.
 *
 * Import individual singletons from this file:
 *   import { repo, embedder } from '$lib/server/deps';
 */

import { createEmbeddingProvider, createRerankProvider } from '@/modules/embedding';
import { PgDocumentRepository } from '@/modules/repository';
import { createStorageProvider } from '@/modules/storage';
import { createVisionProvider } from '@/modules/vision';
import { PgWikiPageRepository } from '@/modules/wiki';

export const repo = new PgDocumentRepository();
export const wikiRepo = new PgWikiPageRepository();
export const embedder = createEmbeddingProvider();
export const vision = createVisionProvider();
export const reranker = createRerankProvider();
export const storage = createStorageProvider();
