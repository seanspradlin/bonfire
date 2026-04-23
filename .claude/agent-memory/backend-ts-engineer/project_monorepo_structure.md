---
name: Monorepo structure
description: Bonfire is a Bun workspaces monorepo; server package lives in server/ with its own tooling config
type: project
---

Bonfire was restructured into a Bun workspaces monorepo in April 2026. The MCP/Hono server now lives in `server/` as the `@bonfire/server` package.

**Why:** Preparing to add a `ui/` workspace (frontend) alongside the existing backend. Each package is fully self-contained with its own `package.json`, `tsconfig.json`, and `biome.json` — no shared root tooling.

**Key structural facts:**
- Root `package.json` is a minimal workspace coordinator (`"workspaces": ["server"]`; `"ui"` added when that package is created)
- Root has NO `biome.json` or `tsconfig.json` — tooling is per-package only
- `server/src/db.ts` default DATABASE_URL is `"../data/bonfire.db"` (relative to `server/` CWD, resolves to repo-root `data/`)
- `server/drizzle.config.ts` also uses `"../data/bonfire.db"` as the default
- `server/biome.json` sets `"vcs": { "root": ".." }` so Biome finds the `.gitignore` at the repo root
- `server/package.json` includes `bun-types` as a direct devDependency alongside `@types/bun` — needed because `@types/bun` does a triple-slash reference to `bun-types` which must be resolvable as a standalone module in the workspace's node_modules
- All root scripts proxy to server: e.g., `bun run dev` → `bun run --cwd server dev`

**How to apply:** When adding new source files, place them in `server/src/`. When creating a new workspace package, add it to root `package.json` `workspaces` array and give it its own `biome.json` with `"vcs": { "root": ".." }`.
