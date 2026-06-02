---
name: client-formatter
description: The consolidated bonfire SvelteKit app uses Prettier (not Biome) for formatting
metadata:
  type: feedback
---

Format files in `/home/sean/bonfire/bonfire/` with `yarn format` (which runs Prettier). The server modules within the same app use TypeScript but the overall project toolchain for the SvelteKit app is Prettier + ESLint.

**Why:** The SvelteKit client always used Prettier. Even after consolidation, the config is Prettier + eslint-plugin-svelte.
**How to apply:** After editing any `.svelte`, `.ts`, or `.css` file in `/home/sean/bonfire/bonfire/src/`, run `cd /home/sean/bonfire/bonfire && yarn format` to format and `yarn lint` to lint-check.
