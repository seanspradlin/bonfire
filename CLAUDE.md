# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bonfire is an MCP (Model Context Protocol) server that provides a team knowledge base with semantic search. It exposes five MCP tools (`add_document`, `search_documents`, `get_document`, `list_documents`, `delete_document`) over a Streamable HTTP transport. The HTTP layer is a minimal Hono server (`/mcp` and `/health` endpoints).

## Monorepo Structure

This is a Bun workspaces monorepo. All commands below can be run from the repo root and proxy to the relevant workspace.

```
bonfire/
  package.json          # workspace coordinator (workspaces: ["server"])
  server/               # @bonfire/server — Hono/MCP backend
    src/
    drizzle/
    drizzle.config.ts
    package.json
    tsconfig.json
    biome.json
```

Tooling (Biome, TypeScript) is **per-package only** — there is no root-level `biome.json` or `tsconfig.json`.

## Commands

All commands are run from the repo root and proxy to the appropriate workspace package.

```bash
bun run dev          # hot-reload dev server (server/)
bun run start        # production server (server/)
bun run check        # lint + format check via Biome (server/)
bun run check:fix    # auto-fix lint/format issues (server/)
bun run typecheck    # tsc --noEmit (server/)

bun run db:generate  # generate Drizzle migration files
bun run db:migrate   # apply migrations
bun run db:push      # push schema directly (dev shortcut)
bun run db:studio    # open Drizzle Studio
```

To run a command directly within a workspace: `bun run --cwd server <script>`

No test suite is configured yet.

## Architecture

```
server/src/index.ts       # Hono app bootstrap — wires repo + embedder into MCP handler
server/src/mcp.ts         # MCP tool definitions + per-session transport management
server/src/repository.ts  # DocumentRepository interface + PgDocumentRepository
server/src/embeddings.ts  # EmbeddingProvider interface + OpenAIEmbeddingProvider
server/src/db.ts          # Drizzle / node-postgres pool
server/src/schema.ts      # Drizzle table definition for `documents`
```

**Data flow:** MCP tool call → `mcp.ts` handler → `DocumentRepository` (for storage) + `EmbeddingProvider` (for vectors) → PostgreSQL via Drizzle ORM.

**Session management:** Each MCP client gets its own `WebStandardStreamableHTTPServerTransport` instance keyed by `mcp-session-id` header. Sessions share the same repo and embedder singletons.

**Semantic search:** Embeddings are stored in a pgvector `vector(1536)` column. Similarity is computed in Postgres via pgvector's `<=>` cosine operator, with an HNSW index for scale.

## Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes | — | Embeddings via `text-embedding-3-small` (1536 dims) |
| `DATABASE_URL` | Yes | — | Postgres connection string (see `server/.env.example`; local dev uses `docker-compose up` to start Postgres + pgvector) |

## Tooling

- **Runtime:** Bun
- **Linter/Formatter:** Biome (no ESLint/Prettier)
- **ORM:** Drizzle Kit + Drizzle ORM
- **Validation:** Zod (used in MCP tool schemas)
