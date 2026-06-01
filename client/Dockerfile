# syntax=docker/dockerfile:1

# Build context is the repo root (see docker-compose.yml) so the Bun workspace
# lockfile and both package manifests are available for a reproducible install.

# ---------------------------------------------------------------------------
# Build stage — install all deps, build the SvelteKit app, prune to prod deps.
# ---------------------------------------------------------------------------
FROM oven/bun:1.3.12 AS build
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json bun.lock ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN bun install --frozen-lockfile --ignore-scripts

# Build the adapter-node output (client/build).
COPY client/ client/
RUN cd client && bun run build

# Drop dev dependencies (vite, svelte-kit, playwright, …) for a slim runtime.
RUN bun install --production --frozen-lockfile --ignore-scripts

# ---------------------------------------------------------------------------
# Runtime stage — minimal image running the adapter-node server.
# ---------------------------------------------------------------------------
FROM oven/bun:1.3.12-slim AS runtime

ENV HOST=0.0.0.0
ENV PORT=3001

# Copy the whole pruned workspace so adapter-node can resolve its (possibly
# nested) prod dependencies at runtime.
COPY --from=build /app /app
WORKDIR /app/client

EXPOSE 3001

CMD ["bun", "build/index.js"]
