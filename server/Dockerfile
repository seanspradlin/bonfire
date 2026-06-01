# syntax=docker/dockerfile:1

# Build context is the repo root (see docker-compose.yml) so the Bun workspace
# lockfile and both package manifests are available for a reproducible install.

# ---------------------------------------------------------------------------
# Build stage — install all deps, bundle the server, then prune to prod deps.
# ---------------------------------------------------------------------------
FROM oven/bun:1.3.12 AS build
WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json bun.lock ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN bun install --frozen-lockfile --ignore-scripts

# Bundle the server entrypoint and the standalone migration runner.
COPY server/ server/
RUN cd server && bun build src/index.ts src/migrate.ts --target=bun --outdir=dist

# Drop dev dependencies (drizzle-kit, biome, typescript, …) for a slim runtime.
RUN bun install --production --frozen-lockfile --ignore-scripts

# ---------------------------------------------------------------------------
# Runtime stage — minimal image running the bundled server.
# ---------------------------------------------------------------------------
FROM oven/bun:1.3.12-slim AS runtime

# Copy the whole pruned workspace: hoisted (and any nested) prod node_modules,
# the bundled output (server/dist), and the SQL files needed by dist/migrate.js.
COPY --from=build /app /app
WORKDIR /app/server

EXPOSE 3000

# `migrate` overrides this in compose; the server is the default command.
CMD ["bun", "dist/index.js"]
