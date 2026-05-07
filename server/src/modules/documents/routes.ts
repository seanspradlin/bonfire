import { Hono } from "hono";
import { z } from "zod";
import { isAdmin, requireAuth } from "@/modules/auth";
import type { EmbeddingProvider } from "@/modules/embedding";
import { ingestDocument } from "@/modules/ingestion";
import type { Document, DocumentRepository } from "@/modules/repository";

const titlesSchema = z.object({
	ids: z.array(z.string()).min(1).max(100),
});

const updateSchema = z.object({
	title: z.string().optional(),
	content: z.string().optional(),
	tags: z
		.array(z.string())
		.transform((arr) => arr.map((t) => t.trim()).filter(Boolean))
		.optional(),
	date: z.string().optional(),
});

function canEdit(user: { role?: string | string[] | null }): boolean {
	const roles = Array.isArray(user.role)
		? user.role
		: typeof user.role === "string"
			? user.role.split(",").map((r) => r.trim())
			: [];
	return roles.some((r) => r === "admin" || r === "editor");
}

export function createDocumentsRouter(deps: {
	repo: DocumentRepository;
	embedder: EmbeddingProvider;
}) {
	const { repo, embedder } = deps;
	const router = new Hono();

	router.get("/documents", async (c) => {
		const authUser = requireAuth(c);
		if (authUser instanceof Response) return authUser;
		if (!canEdit(authUser)) return c.json({ error: "Forbidden" }, 403);

		const docs = await repo.list(
			isAdmin(authUser) ? undefined : { userId: authUser.id },
		);

		docs.sort(
			(a, b) =>
				new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
		);

		return c.json({ documents: docs });
	});

	router.post("/documents/titles", async (c) => {
		const authUser = requireAuth(c);
		if (authUser instanceof Response) return authUser;
		if (!canEdit(authUser)) return c.json({ error: "Forbidden" }, 403);

		let raw: unknown;
		try {
			raw = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}

		const parsed = titlesSchema.safeParse(raw);
		if (!parsed.success) {
			return c.json(
				{ error: parsed.error.issues[0]?.message ?? "Invalid body" },
				400,
			);
		}

		const titles = await repo.getTitlesByIds(parsed.data.ids);
		return c.json({ titles });
	});

	router.get("/documents/:id", async (c) => {
		const authUser = requireAuth(c);
		if (authUser instanceof Response) return authUser;
		if (!canEdit(authUser)) return c.json({ error: "Forbidden" }, 403);

		const id = c.req.param("id");
		const doc = await repo.getById(id);

		if (!doc || doc.parentId !== null) {
			return c.json({ error: "Not found" }, 404);
		}

		if (!isAdmin(authUser) && doc.userId !== authUser.id) {
			return c.json({ error: "Forbidden" }, 403);
		}

		return c.json({ document: doc });
	});

	router.put("/documents/:id", async (c) => {
		const authUser = requireAuth(c);
		if (authUser instanceof Response) return authUser;

		const id = c.req.param("id");
		const existing = await repo.getById(id);

		if (!existing || existing.parentId !== null) {
			return c.json({ error: "Not found" }, 404);
		}

		if (!isAdmin(authUser) && existing.userId !== authUser.id) {
			return c.json({ error: "Forbidden" }, 403);
		}

		if (!canEdit(authUser)) {
			return c.json({ error: "Forbidden" }, 403);
		}

		let raw: unknown;
		try {
			raw = await c.req.json();
		} catch {
			return c.json({ error: "Invalid JSON body" }, 400);
		}

		const parsed = updateSchema.safeParse(raw);
		if (!parsed.success) {
			return c.json(
				{ error: parsed.error.issues[0]?.message ?? "Invalid body" },
				400,
			);
		}
		const body = parsed.data;

		const title = body.title?.trim();
		const content = body.content?.trim();

		if (!title) return c.json({ error: "title is required" }, 400);
		if (!content) return c.json({ error: "content is required" }, 400);

		const doc: Document = await ingestDocument(
			{
				id,
				title,
				content,
				tags: body.tags ?? existing.tags,
				date: body.date ?? existing.date ?? undefined,
				userId: existing.userId ?? undefined,
			},
			repo,
			embedder,
		);

		return c.json({ document: doc });
	});

	router.delete("/documents/:id", async (c) => {
		const authUser = requireAuth(c);
		if (authUser instanceof Response) return authUser;

		const id = c.req.param("id");
		const existing = await repo.getById(id);

		if (!existing || existing.parentId !== null) {
			return c.json({ error: "Not found" }, 404);
		}

		if (!isAdmin(authUser) && existing.userId !== authUser.id) {
			return c.json({ error: "Forbidden" }, 403);
		}

		if (!canEdit(authUser)) {
			return c.json({ error: "Forbidden" }, 403);
		}

		const deleted = await repo.delete(id);
		if (!deleted) {
			return c.json({ error: "Not found" }, 404);
		}

		return new Response(null, { status: 204 });
	});

	return router;
}
