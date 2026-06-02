/**
 * Parse a JSON object from AI model response text.
 *
 * Claude and other LLMs occasionally wrap their JSON response in a markdown
 * code fence (```json ... ```) despite being instructed not to. This function
 * strips any such fencing before parsing, so callers do not need to handle
 * both formatted and bare JSON cases.
 *
 * Returns null when the text cannot be parsed as a JSON object — the caller
 * is responsible for falling back to a sensible default response rather than
 * surfacing a parse error to the end user.
 *
 * @param text - Raw text content from an AI model response block.
 * @returns Parsed object, or null if the text is not valid JSON or is not
 *          a JSON object (e.g. an array or primitive).
 */
export function parseAiJsonResponse(text: string): Record<string, unknown> | null {
	const stripped = text.replace(/^```(?:json)?\n?|\n?```$/g, '').trim();
	try {
		const parsed: unknown = JSON.parse(stripped);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			return null;
		}
		return parsed as Record<string, unknown>;
	} catch {
		return null;
	}
}
