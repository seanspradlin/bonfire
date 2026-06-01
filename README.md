# Bonfire - Tribal Knowledge Collector

Bonfire is a tool for organizing your team's documentation into a single place for retrieval via MCP server.
Its primary function is to connect to your AI tooling and give tools to store markdown documentation,
which gets chunked through a [RAG pipeline](https://aws.amazon.com/what-is/retrieval-augmented-generation/).

Then, when you are creating plans or asking for broad end-to-end implementation details, it can provide
context to your harness that may not be easily inferred working within a single microservice repo.

It isn't limited to markdown files, though. If provided an Anthropic API key as well for vision processing,
it can parse images and PDF files as well. This is useful if you have a team member who takes hand-written
notes or need to capture a whiteboard session.

There is an optional dependency on Cohere's API as well for reranking to ensure you are getting the most
relevant documentation to your task.

## Why Bonfire?

My team was facing challenges working across our codebase. We are a small team who moves fast across
a ton of different projects, and as a consequence we had a lot of tribal knowledge passed amongst us in
order to get things shipped fast.

If you find yourself in a situation like us, where someone has a quick README file somewhere that explains
how to kick off a migration for a database that was a part of a quick one-shot POC made during
a codejam but made its way into production and became a critical tool for one person to perform their functions,
then you might find it useful.

## How are you using it?

My workflow involves using skills that instruct my harness to fetch context from my Bonfire server when generating
plans, then to create documentation describing implementation changes when submitting a pull request.

When working on a very large feature, I will store the initial plan and update that plan over the course of its
implementation. Then, when I am working across multiple repositories, I am able to reference the original plan
and retrieve only the relevant information to the piece that I am actively working on rather than polluting
context with unrelated information.

## What else can it do?

I adapted [Andrej Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) idea
to generate wiki pages about specific topics by stitching together documentation with links to the original sources,
which is usually various issue descriptions, pull request conversations, and commit message bodies. It should be
routinely pruned to ensure information is accurate and includes links back to associated topics. This has been
particularly useful when covering broad, cross-cutting topics.

There is a chat feature on the landing page to just query the knowledge base directly without using associated
tooling.

## Sounds good, what does it need to get running?

A lot. I'm working on getting this consolidated, but the gist is:

1. OpenAI API Key - Used for generating embeddings
2. Anthropic API Key (Optional) - Used for PDF/image upload parsing
3. Cohere API Key (Optional) - Used for reranking results
4. Postgres with pgvector - Vector database
5. Resend API Key - Email provider for sending user invitations, password recovery, etc.
6. S3 (Optional) - Used to store binary artifacts when using PDF and image uploads to return the source document on demand

## Setup and running

Bonfire is a [Bun](https://bun.sh) workspaces monorepo with two packages: `server` (the Hono/MCP backend)
and `client` (the SvelteKit frontend). You'll need [Bun](https://bun.sh) and [Docker](https://www.docker.com)
(for Postgres + pgvector) installed.

1. **Install dependencies**

   ```bash
   bun install
   ```

2. **Start Postgres + pgvector**

   ```bash
   docker compose up -d
   ```

   This brings up a `pgvector` container listening on `localhost:5432` with the default
   `bonfire`/`bonfire` credentials used below.

3. **Configure environment**

   ```bash
   cp server/.env.example server/.env
   ```

   At minimum set `OPENAI_API_KEY`. The defaults in `.env.example` already point `DATABASE_URL`
   at the Docker container. See the file for the optional Anthropic, Cohere, Resend, and S3 keys,
   and set `SEED_ADMIN_PASSWORD` if you want an initial admin user seeded on first run.

4. **Apply the database schema**

   ```bash
   bun run --cwd server db:push
   ```

5. **Run in development**

   ```bash
   bun run dev
   ```

   This starts the server on [http://localhost:3000](http://localhost:3000) and the client on
   [http://localhost:5173](http://localhost:5173) with hot reload.

### Production build

```bash
bun run build   # build both packages
bun run start   # run the built server + client
```

### Useful commands

The lint, typecheck, and database scripts live in the `server` workspace, so run them with `--cwd server`:

```bash
bun run --cwd server check      # Biome lint + format check
bun run --cwd server typecheck  # tsc --noEmit
bun run --cwd server db:generate # generate Drizzle migrations
bun run --cwd server db:migrate  # apply migrations
bun run --cwd server db:studio   # open Drizzle Studio
```
