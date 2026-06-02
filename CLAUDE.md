# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Bonfire is a team knowledge base with semantic search, delivered as a single [SvelteKit](https://svelte.dev/docs/kit) app (Node adapter) that serves both the web UI and the backend from one origin. It exposes MCP (Model Context Protocol) tools over a Streamable HTTP transport at `/mcp`, a REST API under `/api/*`, and a Svelte web UI for managing documents, users, wiki pages, and settings.

There is no separate backend service — all server logic runs inside SvelteKit `+server.ts` route handlers and `hooks.server.ts`, with shared modules under `src/lib/server/`.

## Structure

```
bonfire/                  (repo root)
  compose.yaml            # local Postgres + pgvector container
  drizzle/                # generated migration files
  drizzle.config.ts
  svelte.config.js        # adapter-node; alias "@" → ./src/lib/server
  vite.config.ts          # Vitest projects (client + server)
  eslint.config.js / .prettierrc
  src/
    app.d.ts              # App.Locals.user / .session types
    hooks.server.ts       # session→locals, svelteKitHandler, .well-known OAuth metadata, admin seed
    lib/
      auth-client.ts      # better-auth Svelte client (basePath /api/auth)
      <components>.svelte  stores.ts  theme.ts  types/  utils/
      server/
        auth.ts           # better-auth config (username, admin, jwt, oauthProvider); exports baseURL
        deps.ts           # constructs shared singletons (repo, embedder, vision, reranker, storage, wikiRepo)
        db/               # db.ts (node-postgres Pool), schema.ts (all tables), index.ts
        modules/          # ported feature modules (see Architecture)
    routes/
      (app)/              # auth-guarded UI: chat, documents, upload, wiki, dashboard, settings, account
      login/ consent/ accept-invite/ forgot-password/ reset-password/
      api/                # REST + auth endpoints (see Endpoints)
      mcp/+server.ts      # MCP Streamable HTTP (GET/POST/DELETE → handleMcpRequest)
      health/+server.ts
```

## Commands

All commands run from the repo root with **Yarn** (Classic).

```bash
yarn dev          # hot-reload dev server (http://localhost:5173)
yarn build        # production build (adapter-node → ./build)
node build        # run production server
yarn run check    # svelte-kit sync + svelte-check  (note: `yarn check` is Yarn's own command — use `yarn run check`)
yarn lint         # ESLint + Prettier check
yarn format       # Prettier write
yarn test:unit    # Vitest

yarn db:push      # push schema directly (dev shortcut)
yarn db:generate  # generate Drizzle migration files
yarn db:migrate   # apply migrations
yarn db:studio    # open Drizzle Studio
yarn db:start     # docker compose up (Postgres + pgvector)
```

## Architecture

### Server modules (`src/lib/server/modules/`)

Feature modules ported from the former Hono backend. Route handlers in `src/routes/api/**` and `src/routes/mcp` are thin adapters that pull singletons from `src/lib/server/deps.ts` and call into these:

```
auth/      guards.ts (requireAuth/isAdmin/canEdit on event.locals), seed.ts
embedding/ embeddings.ts (OpenAIEmbeddingProvider), chunker.ts, reranker.ts
repository/ PgDocumentRepository
ingestion/ chunking → batch embed → atomicIngest()
wiki/      PgWikiPageRepository
mcp/       tools.ts (MCP tool registrations), server.ts (session manager + JWT verify + handleMcpRequest), searchResults.ts
chat/      chat tool definitions + execution
vision/    Anthropic vision provider
upload/    uploadForm.ts, pdf.ts
storage/   S3 storage provider
email/     Resend client
shared/    parseAiJsonResponse.ts
```

### Endpoints

- **Auth** (`src/routes/api/auth/[...all]/+server.ts`): GET/POST delegate to `auth.handler(request)`. Better Auth `basePath` is `/api/auth`. Custom: `api/auth/password`, `api/oauth/clients/[clientId]`.
- **REST** under `/api/*`: `documents` (+ `[id]`, `titles`), `users` (+ `me`, `[id]`, `[id]/role`), `wiki-pages` (+ `[slug]`), `invitations` (+ `[token]`, `[token]/accept`), `upload/{image,pdf,text}`, `chat` (SSE stream).
- **MCP** at `/mcp`: GET/POST/DELETE → `handleMcpRequest(request)`.
- **OAuth discovery**: `/.well-known/{oauth-authorization-server,oauth-protected-resource,openid-configuration}` are served from `hooks.server.ts` (SvelteKit ignores dot-prefixed route dirs).

### Data flow

MCP tool call → `mcp/tools.ts` → `repository.ts` (storage) + `embeddings.ts` (vectors) → PostgreSQL via Drizzle ORM. Ingestion: markdown → `chunker.ts` (split on headers, ~512-token chunks, ~128-token overlap) → batch embed via OpenAI → `atomicIngest()` transaction (delete stale chunks, upsert parent, insert chunks with `parentId` FK).

### Auth & sessions

Better Auth is wired the official SvelteKit way: `hooks.server.ts` calls `auth.api.getSession()` and populates `event.locals.user` / `event.locals.session`, then runs `svelteKitHandler({ event, resolve, auth, building })`. The `sveltekitCookies` plugin is last in the plugin array. Route guards (`requireAuth`/`isAdmin`) read `event.locals` and throw `error(401/403)`.

MCP clients authenticate via OAuth/JWT (Bearer). `baseURL` (exported from `auth.ts`, derived from `ORIGIN`) drives the JWT issuer (`${baseURL}/api/auth`), JWKS (`${baseURL}/api/auth/jwks`), and audience (`${baseURL}/mcp`). Each client gets its own `WebStandardStreamableHTTPServerTransport` keyed by `mcp-session-id`; idle sessions are reaped by a sweeper. CSRF relies on SvelteKit's built-in `csrf.checkOrigin` (JSON/Bearer MCP traffic is exempt; same-origin form/multipart passes).

### Semantic search

Embeddings live in a pgvector `vector(1536)` column. Similarity is computed in Postgres via the `<=>` cosine operator with an HNSW index. The query vector is bound as a parameter cast `::vector` (driver-agnostic; works under node-postgres).

### Schema highlights (`src/lib/server/db/schema.ts`)

- **documents**: `id` (UUID or `parentId:chunk:NNNN`), `title`, `content`, `tags` (JSONB), `embedding` (vector 1536), `parentId`, `date`, `userId`, `artifactKey` (nullable S3 key)
- **wikiPages**: generated wiki content
- **auth tables**: `user`, `session`, `account`, `verification`
- **oauth tables**: `jwks`, `oauthClient`, `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`
- **invitations**: team member invite flow

### Client (`src/lib/`, `src/routes/`)

- `routes/(app)/+layout.svelte` + `+layout.server.ts` — auth-guarded shell; the load function reads `event.locals.user` and redirects to `/login` if absent.
- `lib/auth-client.ts` — better-auth Svelte client (`basePath: '/api/auth'`, admin + oauthProvider client plugins).
- `lib/stores.ts` — persisted localStorage stores. `lib/theme.ts` — theme constants; Tailwind v4 CSS config (`@theme`, no `tailwind.config.js`).

## Environment Variables

See `.env.example` for the full annotated list. Required: `DATABASE_URL`, `ORIGIN`, `BETTER_AUTH_SECRET`, `OPENAI_API_KEY`. Optional: `ANTHROPIC_API_KEY` (PDF/image), `COHERE_API_KEY` (reranking), `RESEND_API_KEY`/`EMAIL_FROM` (email), `CLIENT_URL`, `AWS_*` + `ARTIFACT_URL_TTL_SECONDS` (S3 artifacts), `SEED_ADMIN_*` (initial admin). Server code reads env via `$env/dynamic/private`; AWS credentials use the default AWS SDK chain.

## Tooling

- **Runtime:** Node (adapter-node); **package manager:** Yarn Classic
- **Linter/Formatter:** ESLint + Prettier (tabs; run `yarn format`)
- **ORM:** Drizzle Kit + Drizzle ORM over node-postgres (`pg` Pool, 20 max conns, 30s idle, graceful drain)
- **Validation:** Zod (MCP tool schemas)
- **Auth:** better-auth (Drizzle adapter) + `@better-auth/oauth-provider`
- **Tests:** Vitest (`vite.config.ts` defines `client` browser + `server` node projects)
- **Path alias:** `@` → `./src/lib/server`; `$lib` → `./src/lib`
