# Bonfire

Bonfire is an MCP (Model Context Protocol) server that provides a team knowledge
base with semantic search. It exposes MCP tools (`add_document`,
`search_documents`, `get_document`, `list_documents`, `delete_document`, plus
wiki tools) over a Streamable HTTP transport, backed by a Hono server, with a
SvelteKit web UI for managing documents, users, and settings.

## Run with Docker (quickstart)

The fastest way to try Bonfire. You only need Docker and an OpenAI API key.

```bash
git clone https://github.com/seanspradlin/bonfire.git
cd bonfire
cp .env.example .env        # then set OPENAI_API_KEY
docker compose up           # add --build after pulling new changes
```

This brings up the full stack:

| Service   | Role                                              |
| --------- | ------------------------------------------------- |
| `db`      | Postgres + pgvector (data persists in a volume)   |
| `migrate` | one-shot — applies Drizzle migrations, then exits |
| `server`  | Hono / MCP backend                                |
| `client`  | SvelteKit web UI (adapter-node)                   |
| `caddy`   | reverse proxy — the single entry point            |

Migrations run automatically before the server starts. Once everything is up:

- **Web UI:** http://localhost:8080
- **MCP endpoint:** http://localhost:8080/mcp

On first boot an initial admin user is seeded. With the defaults you can log in
with username `admin` / password `changeme123` (override via the `SEED_ADMIN_*`
variables — see below).

To stop the stack: `docker compose down`. Add `-v` to also wipe the database
volume.

### Environment variables

Only `OPENAI_API_KEY` is required. Everything else has a container default in
`docker-compose.yml`; set any of these in your root `.env` to override.

**Required**

| Variable         | Purpose                                    |
| ---------------- | ------------------------------------------ |
| `OPENAI_API_KEY` | Document embeddings (`text-embedding-3-small`) |

**Defaults you may want to change**

| Variable              | Default                                 | Purpose                                  |
| --------------------- | --------------------------------------- | ---------------------------------------- |
| `BETTER_AUTH_URL`     | `http://localhost:8080`                 | Public base URL (auth issuer / CSRF)     |
| `CLIENT_URL`          | `http://localhost:8080`                 | Public web UI origin                     |
| `BETTER_AUTH_SECRET`  | `bonfire-development-secret-change-me`  | **Change this for any real deployment**  |
| `SEED_ADMIN_PASSWORD` | `changeme123`                           | Initial admin password (non-prod only)   |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_USERNAME` / `SEED_ADMIN_NAME` | `admin@example.com` / `admin` / `Admin` | Initial admin identity |

**Optional integrations** (leave blank to disable): `ANTHROPIC_API_KEY` (image
analysis), `RESEND_API_KEY` + `EMAIL_FROM` (email), `COHERE_API_KEY`
(reranking), and `AWS_BUCKET` / `AWS_REGION` /
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `ARTIFACT_URL_TTL_SECONDS`
(artifact storage).

### Notes

- The Bun version in the images is pinned to match local dev.
- pgvector data persists in the named `db` volume across restarts.
- The Docker path is additive — the host-based `bun run dev` workflow below is
  unchanged.
- **Already used host dev on this machine?** The Docker stack applies schema via
  Drizzle **migrations**, while host dev uses `bun run db:push` (which doesn't
  record migration history). Both share the same `db` volume, so if you
  previously ran `bun run db:push`, the first `docker compose up` will fail at
  the `migrate` step against the already-pushed schema. Reset the volume first
  with `docker compose down -v` (this wipes local DB data).

## Host development

For active development with hot reload:

```bash
docker compose up -d db                  # just Postgres + pgvector
cp server/.env.example server/.env       # set OPENAI_API_KEY
bun install
bun run db:push                          # apply schema
bun run dev                              # server :3000, client :5173
```

See [CLAUDE.md](./CLAUDE.md) for architecture details and the full command list.
