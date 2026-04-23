import { describe, expect, it } from "bun:test";
import { parseAiJsonResponse } from "@/shared/parseAiJsonResponse";

describe("parseAiJsonResponse", () => {
	it("parses a plain JSON object string", () => {
		const result = parseAiJsonResponse(
			'{"title": "hello", "content": "world"}',
		);
		expect(result).toEqual({ title: "hello", content: "world" });
	});

	it("strips a markdown json code fence before parsing", () => {
		const wrapped = '```json\n{"title": "fenced"}\n```';
		expect(parseAiJsonResponse(wrapped)).toEqual({ title: "fenced" });
	});

	it("strips a bare markdown code fence before parsing", () => {
		const wrapped = '```\n{"title": "bare fence"}\n```';
		expect(parseAiJsonResponse(wrapped)).toEqual({ title: "bare fence" });
	});

	it("returns null for invalid JSON", () => {
		expect(parseAiJsonResponse("not json at all")).toBeNull();
	});

	it("returns null for a JSON array (not an object)", () => {
		expect(parseAiJsonResponse("[1, 2, 3]")).toBeNull();
	});

	it("returns null for a JSON primitive string", () => {
		expect(parseAiJsonResponse('"just a string"')).toBeNull();
	});

	it("returns null for a JSON null literal", () => {
		expect(parseAiJsonResponse("null")).toBeNull();
	});

	it("returns null for a JSON number", () => {
		expect(parseAiJsonResponse("42")).toBeNull();
	});

	it("returns an empty object for an empty JSON object", () => {
		expect(parseAiJsonResponse("{}")).toEqual({});
	});

	it("handles nested objects and arrays in values", () => {
		const input = '{"tags": ["a", "b"], "meta": {"count": 3}}';
		expect(parseAiJsonResponse(input)).toEqual({
			tags: ["a", "b"],
			meta: { count: 3 },
		});
	});
});
