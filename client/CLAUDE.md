# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun run dev          # dev server on :5173 (proxies /api → localhost:3000)
bun run build        # production build
bun run check        # svelte-check type-check
bun run lint         # prettier + eslint
bun run format       # prettier --write
bun run test         # vitest (all projects, single run)
bun run test:unit    # vitest in watch mode
```

Test files split into two Vitest projects:

- **client** (`*.svelte.{test,spec}.{js,ts}`): runs in Chromium via Playwright
- **server** (`*.{test,spec}.{js,ts}`, excluding svelte): runs in Node

## Architecture

SvelteKit app with `adapter-node`. Svelte 5 runes mode is enforced project-wide (`compilerOptions.runes`).

**Route structure:**

- `src/routes/(app)/` — authenticated shell (sidebar layout, auth guard in `+layout.svelte`)
- `src/routes/login/` — public login page
- `src/routes/+layout.svelte` — root layout; sets `data-theme` attribute for CSS variable switching

**Auth guard:** `(app)/+layout.svelte` checks `loggedIn` store in `onMount` and redirects to `/login` if false. Server-side load functions should call `await parent()` to chain this guard.

**API proxy:** Vite proxies `/api/*` to `http://localhost:3000` (strips `/api` prefix). All `fetch` calls in load functions and components use `/api/...` paths.

**Auth client:** `$lib/auth-client.ts` exports a `better-auth` client configured at `basePath: '/api/auth'`. Login calls `authClient.signIn.email(...)`.

## Theme System

All visual styling uses Tailwind v4 with CSS custom property tokens. Config is CSS-based (`@theme` in `src/routes/layout.css`) — there is no `tailwind.config.js`.

**How it works:**

- Theme tokens are defined as CSS custom properties on `[data-theme]` attribute selectors in `layout.css`
- The `@theme inline` block maps them to `--color-*` variables so Tailwind generates utilities automatically (e.g., `bg-bg-card`, `text-text-muted`, `border-border`)
- `src/routes/+layout.svelte` derives a `themeKey` (`'dark_pro'`, `'light_ember'`, `'light_clean'`) from the `tweaks` store and sets it as `data-theme` on the root div

**Components:** Use Tailwind utility classes directly — no `tk` prop, no inline styles for theme values. For per-instance dynamic colors (like role-based colors in `Avatar` and `RoleBadge`), set a CSS variable inline and reference it via Tailwind arbitrary value syntax:

```svelte
<div style="--role-color: {colorVar}" class="text-[var(--role-color)] bg-[color-mix(in_oklch,var(--role-color)_18%,transparent)]">
```

Three themes: `light_ember` (default), `light_clean`, `dark_pro`. Active theme/variant is persisted in `$lib/stores.ts` → `tweaks` store (`{ theme, variant }`).

`$lib/theme.ts` now only exports the `BRAND` color constants — `ThemeTokens`, `getTokens`, and `toCssVars` have been removed.

## Key Conventions

- **Persisted stores:** `$lib/stores.ts` wraps `writable` with `localStorage` sync. `loggedIn` and `tweaks` both use this pattern.
- **Icon system:** `$lib/Icon.svelte` renders inline SVG from a keyed `PATHS` record. Add new icons by extending that record.
- **User types:** `ApiUser` (raw API shape) vs `User` (display-ready, with formatted dates and derived fields) are defined in `$lib/types/user.ts`. Transform at the load-function boundary, never in components.
- **Linting:** Biome handles formatting (tabs, double quotes) and import organization. ESLint + Prettier handle Svelte-specific rules. Run `bun run format` then `bun run lint` before committing.
