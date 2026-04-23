---
name: Theme system architecture
description: How the Tailwind v4 CSS-variable theme system works in this project — no tk prop, data-theme switching, layout.css tokens
type: project
---

Theme uses Tailwind v4 with CSS custom properties defined in `src/routes/layout.css`. Three themes: `light_ember`, `light_clean`, `dark_pro`.

**Why:** Replaced the old `ThemeTokens`/`toCssVars` inline-style system to eliminate prop-drilling a `tk` object through every component.

**How to apply:**

- All theme tokens are CSS custom properties on `[data-theme]` selectors in `layout.css`
- The `@theme inline` block maps them to `--color-*` so Tailwind generates utilities: `bg-bg`, `bg-bg-card`, `text-text-muted`, `border-border`, `text-accent`, `text-danger`, `text-success`, `text-sidebar-text`, etc.
- `src/routes/+layout.svelte` sets `data-theme` on the root div based on the `tweaks` store
- Components use Tailwind classes only — no `tk` prop, no `getTokens` import
- For per-instance dynamic colors (role colors in Avatar/RoleBadge), set `--role-color` inline and use `text-[var(--role-color)]` / `bg-[color-mix(in_oklch,var(--role-color)_18%,transparent)]`
- `$lib/theme.ts` now only exports `BRAND` constants
- Shadows use arbitrary values: `shadow-[var(--shadow)]`, `shadow-[var(--shadow-card)]`
