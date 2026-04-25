# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bonfire is an MCP (Model Context Protocol) server that provides a team knowledge base with semantic search. It exposes five MCP tools (`add_document`, `search_documents`, `get_document`, `list_documents`, `delete_document`) over a Streamable HTTP transport. The HTTP layer is a Hono server. A SvelteKit frontend provides a web UI for managing documents, users, and settings.

## Monorepo Structure

This is a Bun workspaces monorepo with two packages.

```
bonfire/
  package.json          # workspace coordinator (workspaces: ["client", "server"])
  docker-compose.yml    # local Postgres + pgvector container
  Caddyfile             # reverse proxy config for production
  server/               # @bonfire/server — Hono/MCP backend
    src/
      index.ts          # Hono app bootstrap
      modules/          # feature modules (see Architecture below)
    drizzle/            # generated migration files
    drizzle.config.ts
    package.json
    tsconfig.json
    biome.json
  client/               # SvelteKit frontend
    src/
      routes/
      lib/
    package.json
    svelte.config.js    # adapter-node
    vite.config.ts      # API proxy → :3000
    biome.json
```

Tooling (Biome, TypeScript) is **per-package only** — there is no root-level `biome.json` or `tsconfig.json`.

## Commands

All commands run from the repo root and proxy to the appropriate workspace.

```bash
bun run dev          # hot-reload dev server (both server + client)
bun run build        # production build
bun run start        # production server
bun run check        # lint + format check via Biome
bun run check:fix    # auto-fix lint/format issues
bun run typecheck    # tsc --noEmit

bun run db:generate  # generate Drizzle migration files
bun run db:migrate   # apply migrations
bun run db:push      # push schema directly (dev shortcut)
bun run db:studio    # open Drizzle Studio
```

To run a command directly within a workspace: `bun run --cwd server <script>`

No test suite is configured yet.

## Local Dev Setup

```bash
docker-compose up -d      # start Postgres+pgvector at localhost:5432
cp server/.env.example server/.env  # fill in OPENAI_API_KEY
bun run db:push           # apply schema
bun run dev               # server :3000, client :5173
```

## Architecture

### Server modules (`server/src/modules/`)

```
auth/
  auth.ts          # better-auth config (email/password, username plugin, admin plugin)
  routes.ts        # /auth/* endpoints
  apiKeys.ts       # API key CRUD (SHA-256 hashed, bf_ prefix)
  middleware.ts    # session middleware
  seed.ts          # initial admin seed

db/
  db.ts            # Drizzle + node-postgres pool (20 max conns, 30s idle timeout)
  schema.ts        # all Drizzle table definitions
  index.ts

embedding/
  embeddings.ts    # EmbeddingProvider interface + OpenAIEmbeddingProvider
  chunker.ts       # markdown chunking (heading context + token overlap)
  index.ts

repository/
  repository.ts    # DocumentRepository interface + PgDocumentRepository

ingestion/
  ingestion.ts     # orchestrates chunking → batch embed → atomicIngest()

mcp/
  tools.ts         # MCP tool registrations
  routes.ts        # /mcp endpoint + per-session transport management
  searchResults.ts # result formatting

chat/             # chat endpoints (uses knowledge search as tool)
vision/           # vision AI provider
upload/           # file upload handlers
invitations/      # team invite flow
users/            # user management
health/           # /health endpoint
shared/
  parseAiJsonResponse.ts
```

### Data flow

MCP tool call → `mcp/tools.ts` → `repository.ts` (storage) + `embeddings.ts` (vectors) → PostgreSQL via Drizzle ORM.

Document ingestion pipeline: markdown input → `chunker.ts` (split on headers, ~512 token chunks with ~128 token overlap) → batch embed via OpenAI → `atomicIngest()` transaction (delete stale chunks, upsert parent, insert chunks with `parentId` foreign key).

### Session management

Each MCP client gets its own `WebStandardStreamableHTTPServerTransport` instance keyed by `mcp-session-id` header. Sessions share the same repo and embedder singletons. Auth is via Better Auth session cookie **or** API key (`Authorization: Bearer bf_...`).

### Semantic search

Embeddings are stored in a pgvector `vector(1536)` column. Similarity is computed in Postgres via the `<=>` cosine operator, with an HNSW index for scale.

### Schema highlights

- **documents**: `id` (UUID or `parentId:chunk:NNNN`), `title`, `content`, `tags` (JSONB), `embedding` (vector 1536), `parentId`, `date`, `userId`
- **auth tables**: `user`, `session`, `account`, `verification`
- **apiKey**: MCP client tokens (hashed, last-used tracking)
- **invitations**: team member invite flow

### Client (`client/src/`)

- `routes/(app)/+layout.svelte` — auth-guarded shell with sidebar; redirects to `/login` if not logged in
- `lib/auth-client.ts` — better-auth client pointed at `/api/auth`
- `lib/stores.ts` — persisted localStorage stores (`loggedIn`, `tweaks`)
- `lib/theme.ts` — theme color constants; Tailwind v4 CSS-based config (`@theme` block, no `tailwind.config.js`)

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | Yes | Embeddings via `text-embedding-3-small` (1536 dims) |
| `DATABASE_URL` | Yes | Postgres connection string (see `server/.env.example`) |

Local dev default: `postgresql://bonfire:bonfire@localhost:5432/bonfire` (matches `docker-compose.yml`).

## Tooling

- **Runtime:** Bun
- **Linter/Formatter:** Biome — tabs, double quotes for JS (no ESLint/Prettier on server; client uses Biome + Prettier)
- **ORM:** Drizzle Kit + Drizzle ORM
- **Validation:** Zod (MCP tool schemas)
- **Auth:** better-auth with Drizzle adapter
- **Path alias:** `@/*` → `src/*` in server TypeScript
