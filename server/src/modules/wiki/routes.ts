import { Hono } from "hono";
import { requireAuth } from "@/modules/auth";
import type { DocumentRepository } from "@/modules/repository";
import type { WikiPageRepository } from "@/modules/wiki/repository";

export function createWikiRouter(deps: {
	wikiRepo: WikiPageRepository;
	repo: DocumentRepository;
}) {
	const { wikiRepo, repo } = deps;
	const router = new Hono();

	router.get("/wiki-pages", async (c) => {
		const authUser = requireAuth(c);
		if (authUser instanceof Response) return authUser;

		const pages = await wikiRepo.list();

		pages.sort(
			(a, b) =>
				new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
		);

		return c.json({ wikiPages: pages });
	});

	router.get("/wiki-pages/:slug", async (c) => {
		const authUser = requireAuth(c);
		if (authUser instanceof Response) return authUser;

		const slug = c.req.param("slug");
		const page = await wikiRepo.getBySlug(slug);

		if (!page) {
			return c.json({ error: "Not found" }, 404);
		}

		const titleMap = await repo.getTitlesByIds(page.sourceDocumentIds);
		const sourceDocuments = page.sourceDocumentIds
			.filter((id) => id in titleMap)
			.map((id) => ({ id, title: titleMap[id] }));

		return c.json({ wikiPage: page, sourceDocuments });
	});

	return router;
}
