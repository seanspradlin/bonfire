import { describe, expect, it } from "bun:test";
import {
	deduplicateByBestSimilarity,
	formatSearchResult,
} from "@/modules/mcp/searchResults";
import type { SearchResult } from "@/modules/repository";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(
	overrides: Partial<SearchResult> & Pick<SearchResult, "id" | "similarity">,
): SearchResult {
	return {
		title: "Test Document",
		content: "Some content.",
		tags: [],
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		date: null,
		parentId: null,
		userId: null,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// formatSearchResult
// ---------------------------------------------------------------------------

describe("formatSearchResult", () => {
	it("rounds similarity to 3 decimal places", () => {
		const result = makeResult({ id: "doc1", similarity: 0.98765432 });
		expect(formatSearchResult(result).similarity).toBe(0.988);
	});

	it("preserves the title for a top-level document (parentId is null)", () => {
		const result = makeResult({
			id: "doc1",
			similarity: 0.9,
			title: "My Doc [1/3]",
			parentId: null,
		});
		expect(formatSearchResult(result).title).toBe("My Doc [1/3]");
	});

	it("strips the [i/N] chunk suffix from a chunk document (parentId is set)", () => {
		const result = makeResult({
			id: "doc1:chunk:0000",
			similarity: 0.9,
			title: "My Doc [2/5]",
			parentId: "doc1",
		});
		expect(formatSearchResult(result).title).toBe("My Doc");
	});

	it("does not strip if the title does not end with the chunk pattern", () => {
		const result = makeResult({
			id: "doc1:chunk:0000",
			similarity: 0.9,
			title: "No Suffix Here",
			parentId: "doc1",
		});
		expect(formatSearchResult(result).title).toBe("No Suffix Here");
	});

	it("passes through all other fields unchanged", () => {
		const result = makeResult({
			id: "doc1",
			similarity: 0.5,
			tags: ["a", "b"],
			content: "Hello",
			parentId: null,
		});
		const formatted = formatSearchResult(result);
		expect(formatted.id).toBe("doc1");
		expect(formatted.tags).toEqual(["a", "b"]);
		expect(formatted.content).toBe("Hello");
		expect(formatted.parentId).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// deduplicateByBestSimilarity
// ---------------------------------------------------------------------------

describe("deduplicateByBestSimilarity", () => {
	it("returns an empty array when all input lists are empty", () => {
		expect(deduplicateByBestSimilarity([], 5)).toEqual([]);
		expect(deduplicateByBestSimilarity([[]], 5)).toEqual([]);
	});

	it("deduplicates results that appear in multiple lists, keeping the highest similarity", () => {
		const doc1Low = makeResult({ id: "doc1", similarity: 0.5 });
		const doc1High = makeResult({ id: "doc1", similarity: 0.9 });
		const doc2 = makeResult({ id: "doc2", similarity: 0.7 });

		const merged = deduplicateByBestSimilarity(
			[[doc1Low, doc2], [doc1High]],
			10,
		);

		const ids = merged.map((r) => r.id);
		expect(ids.filter((id) => id === "doc1")).toHaveLength(1);

		const doc1Result = merged.find((r) => r.id === "doc1");
		expect(doc1Result?.similarity).toBe(0.9);
	});

	it("returns results sorted by similarity descending", () => {
		const results = [
			makeResult({ id: "a", similarity: 0.3 }),
			makeResult({ id: "b", similarity: 0.9 }),
			makeResult({ id: "c", similarity: 0.6 }),
		];

		const merged = deduplicateByBestSimilarity([results], 10);
		const similarities = merged.map((r) => r.similarity);
		expect(similarities).toEqual([0.9, 0.6, 0.3]);
	});

	it("truncates to the specified limit", () => {
		const results = Array.from({ length: 10 }, (_, i) =>
			makeResult({ id: `doc${i}`, similarity: i / 10 }),
		);
		const merged = deduplicateByBestSimilarity([results], 3);
		expect(merged).toHaveLength(3);
	});

	it("handles a single result list with no duplicates", () => {
		const results = [
			makeResult({ id: "x", similarity: 0.8 }),
			makeResult({ id: "y", similarity: 0.6 }),
		];
		const merged = deduplicateByBestSimilarity([results], 10);
		expect(merged).toHaveLength(2);
	});
});
