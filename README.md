# Bonfire

Bonfire is an MCP server to store and retrieve your team's tribal knowledge.

Pull request text, issue descriptions, org files, hand-written notes - you name it. Just chuck it
in there. Connect your AI tooling to it to search your team's knowledge base when gathering
context for your implementations.

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

| Variable         | Purpose                                        |
| ---------------- | ---------------------------------------------- |
| `OPENAI_API_KEY` | Document embeddings (`text-embedding-3-small`) |

**Defaults you may want to change**

| Variable                                                       | Default                                 | Purpose                                 |
| -------------------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| `BETTER_AUTH_URL`                                              | `http://localhost:8080`                 | Public base URL (auth issuer / CSRF)    |
| `CLIENT_URL`                                                   | `http://localhost:8080`                 | Public web UI origin                    |
| `BETTER_AUTH_SECRET`                                           | `bonfire-development-secret-change-me`  | **Change this for any real deployment** |
| `SEED_ADMIN_PASSWORD`                                          | `changeme123`                           | Initial admin password (non-prod only)  |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_USERNAME` / `SEED_ADMIN_NAME` | `admin@example.com` / `admin` / `Admin` | Initial admin identity                  |

**Optional integrations** (leave blank to disable): `ANTHROPIC_API_KEY` (image
analysis), `RESEND_API_KEY` + `EMAIL_FROM` (email), `COHERE_API_KEY`
(reranking), and `AWS_BUCKET` / `AWS_REGION` /
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `ARTIFACT_URL_TTL_SECONDS`
(artifact storage).

## Host development

For active development with hot reload:

```bash
docker compose up -d db                  # just Postgres + pgvector
cp server/.env.example server/.env
bun install
bun run db:push                          # apply schema
bun run dev                              # server :3000, client :5173
```

See [CLAUDE.md](./CLAUDE.md) for architecture details and the full command list.
