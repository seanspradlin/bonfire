---
name: bonfire-project-overview
description: Architecture and conventions for the consolidated Bonfire SvelteKit app at /home/sean/bonfire/bonfire
metadata:
  type: project
---

The Bonfire app was migrated from a bun monorepo (Hono server + SvelteKit client) into a single SvelteKit app at `/home/sean/bonfire/bonfire/`. The old monorepo packages remain at `/home/sean/bonfire/server/` and `/home/sean/bonfire/client/` but the active codebase is the consolidated one.

**Package manager**: yarn (yarn.lock present; do NOT use bun/npm in this directory)

**Auth guard**: `src/routes/(app)/+layout.server.ts` reads from `event.locals.user` (set by `hooks.server.ts` via better-auth). No self-fetch to `/api/auth/get-session`.

**Layout**: Root `+layout.svelte` applies `data-theme` attribute from the `tweaks` store (localStorage-persisted). Theme CSS vars are in `src/routes/layout.css`.

**Key lib files**: All shared components live in `src/lib/` (Avatar, Btn, Icon, IconBtn, Markdown, PageHeader, RoleBadge, StatusBadge, FilterPills, ConfirmDialog, ConfirmDeleteModal, EditDocumentModal, EditRoleModal). Types in `src/lib/types/`. Utils in `src/lib/utils/`.

**ESLint rule**: `svelte/no-navigation-without-resolve` is enforced. Use `resolve()` from `$app/paths` in all `goto()` calls. For dynamic query-string goto calls (e.g. tag filters), use `// eslint-disable-next-line` with a comment explaining the redirect is safe.

**Why:** Consolidated single SvelteKit deployment — final cutover from the bun monorepo pending human confirmation.
**How to apply:** When working in /home/sean/bonfire/bonfire/, use yarn; auth guard reads locals; all API routes are under src/routes/api/.
