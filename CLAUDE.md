# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bonfire is an MCP (Model Context Protocol) server that provides a team knowledge base with semantic search. It exposes five MCP tools (`add_document`, `search_documents`, `get_document`, `list_documents`, `delete_document`) over a Streamable HTTP transport. The HTTP layer is a minimal Hono server (`/mcp` and `/health` endpoints).

## Commands

```bash
bun run dev          # hot-reload dev server
bun run start        # production server
bun run check        # lint + format check (Biome)
bun run check:fix    # auto-fix lint/format issues
bun run typecheck    # tsc --noEmit

bun run db:generate  # generate Drizzle migration files
bun run db:migrate   # apply migrations
bun run db:push      # push schema directly (dev shortcut)
bun run db:studio    # open Drizzle Studio
```

No test suite is configured yet.

## Architecture

```
src/index.ts       # Hono app bootstrap — wires repo + embedder into MCP handler
src/mcp.ts         # MCP tool definitions + per-session transport management
src/repository.ts  # DocumentRepository interface + SqliteDocumentRepository
src/embeddings.ts  # EmbeddingProvider interface + OpenAIEmbeddingProvider
src/db.ts          # Drizzle/SQLite connection (WAL mode)
src/schema.ts      # Drizzle table definition for `documents`
```

**Data flow:** MCP tool call → `mcp.ts` handler → `DocumentRepository` (for storage) + `EmbeddingProvider` (for vectors) → SQLite via Drizzle ORM.

**Session management:** Each MCP client gets its own `WebStandardStreamableHTTPServerTransport` instance keyed by `mcp-session-id` header. Sessions share the same repo and embedder singletons.

**Semantic search:** Embeddings are stored as raw `Float32Array` buffers (little-endian IEEE 754) in a SQLite blob column. Cosine similarity is computed in JS across all rows on every search — fine for small corpora, but see the migration notes below for scaling.

## Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes | — | Embeddings via `text-embedding-3-small` (1536 dims) |
| `DATABASE_URL` | No | `data/bonfire.db` | SQLite file path |

## PostgreSQL Migration Path

The codebase is annotated with migration hints throughout. Key steps:
1. `db.ts`: swap `bun:sqlite` + `drizzle-orm/bun-sqlite` for `pg` + `drizzle-orm/node-postgres`
2. `schema.ts`: `blob("embedding")` → `vector("embedding", { dimensions: 1536 })` (pgvector); `text("tags")` → `jsonb("tags")`
3. `repository.ts`: implement a `PgDocumentRepository` using pgvector's `<=>` cosine operator instead of in-JS similarity
4. `index.ts`: select implementation via `DATABASE_DRIVER` env var

## Tooling

- **Runtime:** Bun
- **Linter/Formatter:** Biome (no ESLint/Prettier)
- **ORM:** Drizzle Kit + Drizzle ORM
- **Validation:** Zod (used in MCP tool schemas)
