# Plan: Associate knowledge-base documents with git repositories

> Draft plan for later refinement. Tracks the feature request: let documents point at the
> git repositories they describe, so chat/MCP agents can inspect the actual source code.

## Context

When a user asks Bonfire's chat (or an external MCP client like ChatGPT) how to implement
or debug something, Bonfire returns relevant documents but no pointer to **where the code
actually lives**. The agent has prose but can't inspect the source, so answers and bug
reports are imprecise.

The fix is to let a document declare the git repositories (and specific paths) it relates to,
and to **return those references as metadata** through every search/read tool. Bonfire never
reads, clones, or proxies source code — it only tells the caller _which_ repos/paths are
relevant. The caller's own harness (which already has a GitHub MCP server attached) does the
actual code reading.

- **Caller's harness (ChatGPT + GitHub MCP + Bonfire MCP):** Bonfire returns the repo
  references in its responses; the harness's GitHub MCP does the cloning/code reading.
- **Internal Bonfire chat:** surfaces the repo references in its answers so the user sees
  which repositories/paths to inspect. It does **not** gain any ability to read code.

### Security constraint (why metadata-only)

Bonfire is deliberately **not** wired to read the codebase. If the chat client or Bonfire
server were ever compromised, an attacker still could not pivot through Bonfire into the
source repositories — Bonfire holds no repo credentials and has no code-fetching tool. Code
access stays entirely on the caller's side, gated by the caller's own GitHub credentials.

Scope: structured repo metadata on documents + surfaced through tools + a resolver tool +
prompt guidance. Server-side cloning and any Bonfire→GitHub integration are **out of scope**.

## The `repos` field

Add a structured JSONB column `repos` to `documents`, mirroring how `tags` already works
(propagated to chunks, filterable, surfaced in tool output). Shape:

```ts
export interface RepoRef {
	url: string; // "https://github.com/org/repo" or "org/repo"
	paths?: string[]; // relevant files/dirs within the repo, e.g. ["src/auth/guards.ts"]
	ref?: string; // optional branch/tag/commit
	note?: string; // optional: why this repo is relevant to the doc
}
```

A document like _"Adding permissions to an endpoint"_ can then declare it touches three repos
with the specific files involved.

## Implementation

Treat `repos` everywhere `tags` is already handled. Like `tags`, it is propagated onto chunks
during ingestion so that search results (which are chunk rows) carry it.

### 1. Schema + migration

- `src/lib/server/db/schema.ts`: add `repos: jsonb('repos').notNull().$type<RepoRef[]>().default([])`
  to the `documents` table (define/export `RepoRef` here or in `repository.ts`).
- Generate migration: `yarn db:generate`, then apply with `yarn db:push` (dev) / `yarn db:migrate`.
  Column has a default, so existing rows backfill to `[]` automatically.

### 2. Repository layer — `src/lib/server/modules/repository/repository.ts`

- Add `repos: RepoRef[]` to the `Document` interface and `rowToDocument()`.
- Add optional `repos?: RepoRef[]` to `upsert()`, `atomicIngest()` **parent and chunk** params
  (follow the existing `tags` handling exactly, including the `onConflictDoUpdate` set clause).
- Add `documents.repos` to the select projection in `search()`, `getById()`, and `list()`.

### 3. Ingestion — `src/lib/server/modules/ingestion/ingestion.ts`

- Add `repos?: RepoRef[]` to the `ingestDocument` params.
- Pass it to the `atomicIngest` parent, and onto each chunk (next to the existing
  `tags: params.tags` line) so chunk search results carry repos.

### 4. Surface in search output — `src/lib/server/modules/mcp/searchResults.ts`

- Add `repos: RepoRef[]` to `FormattedSearchResult` and populate it in `formatSearchResult()`
  from `result.repos`. This single change surfaces repos in **both** MCP and chat
  `search_documents` / `query_knowledge_base` results (both call `formatSearchResult`).

### 5. MCP tools — `src/lib/server/modules/mcp/tools.ts`

- **`add_document`**: add a `repos` Zod input (array of `{ url, paths?, ref?, note? }`) and pass
  it into `ingestDocument`. `url` required; rest optional.
- **`list_documents`**: include `repos` in the per-doc summary object.
- **`get_document`**: already spreads `...docFields`, so `repos` flows through automatically once
  it's on `Document`.
- **New tool `find_repositories`** (read-only, no auth gate, like the other search tools):
  input `{ question: string, extra_queries?: string[], tag?, limit? }`. Runs the same semantic
  search as `query_knowledge_base`, then returns the **deduplicated union of repos** across the
  matching documents, each annotated with the source documents that referenced it:
  ```jsonc
  [{ "url": "...", "paths": [...], "ref": "...", "note": "...",
     "sources": [{ "id": "...", "title": "..." }] }]
  ```
  This is the explicit "topic → repos/paths" resolver the external harness calls before
  handing off to GitHub MCP. Dedupe by `url`, merging `paths`/`sources`.

### 6. Chat agent — `src/lib/server/modules/chat/tools.ts` + `src/routes/api/chat/+server.ts`

- `CHAT_TOOLS`: add the `find_repositories` tool definition (Anthropic `Tool` shape) and add a
  `case 'find_repositories'` to `runChatTool` reusing the MCP resolver logic. This tool queries
  Bonfire's own knowledge base only — it returns repo _metadata_, never code.
- Include `repos` alongside `id`/`title`/`similarity` in `wrapDocumentsInTags` output so the chat
  model can cite repositories.
- `SYSTEM_PROMPT` (in `+server.ts`): add a line telling the assistant that documents may
  reference git repositories, and to **surface the relevant repos/paths** when the user is asking
  how to implement, change, or debug code — so the user (or their harness) can go read the source
  themselves. The assistant must not claim to have read repository contents; it only points to
  them.

### 7. REST + UI write path

- `src/routes/api/documents/[id]/+server.ts`: add `repos` to `updateSchema` and pass to
  `ingestDocument` (default to `existing.repos`).
- `src/lib/types/document.ts`: add `repos: RepoRef[]` to the client `Document` type (define a
  client-side `RepoRef` mirror).
- `src/lib/EditDocumentModal.svelte` (+ the `handleSaveEdit` payload in
  `src/routes/(app)/documents/[id]/+page.svelte`): add a repos editor next to the tags input.
  Minimal first pass: a textarea of `owner/repo` lines (optionally `owner/repo | path1,path2`),
  parsed into `RepoRef[]`. Render the repo list on the document view page near the tags chips.

## Non-goals (explicitly out of scope)

- **Bonfire does not read, clone, or proxy source code.** No `git clone`, no Bonfire→GitHub MCP
  client, no server-side GitHub credentials. Code reading is the responsibility of the caller's
  harness, using the caller's own GitHub access. This is a deliberate security boundary: a
  compromised chat client or Bonfire server must not become a path into the source repositories.
- The `repos` field is descriptive metadata authored alongside the document; Bonfire does not
  validate that the repos/paths exist or fetch anything from them.

## Verification

1. **Migration**: `yarn db:push`; confirm the `repos` column exists (`yarn db:studio`).
2. **Type/lint**: `yarn run check` and `yarn lint`.
3. **Unit tests** (`yarn test:unit`):
   - Extend `src/lib/server/modules/mcp/searchResults.test.ts` to assert `formatSearchResult`
     includes `repos` (incl. empty-array default).
   - Add a test for the `find_repositories` dedup/merge helper (dedupe by `url`, merge `paths` +
     `sources`). Factor the merge into a pure helper so it's testable without a DB.
4. **MCP end-to-end** (dev server): call `add_document` with a `repos` array, then
   `search_documents` / `query_knowledge_base` and confirm `repos` appears in results; call
   `find_repositories` with a related question and confirm the deduplicated repo list returns.
5. **Chat UI**: ask a "how do I implement X" question for a doc that has repos; confirm the
   assistant surfaces the repositories/paths. Edit a document in the UI, set repos, save, reload.
