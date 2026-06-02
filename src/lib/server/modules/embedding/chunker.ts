/**
 * Markdown-aware recursive text chunker.
 *
 * Splits content into chunks up to maxTokens (default 500) using a hierarchy
 * of separators: H1 → H2 → H3 → paragraph → line → sentence. Only subdivides
 * when a section exceeds maxTokens, preserving semantic hierarchy as long
 * as possible.
 *
 * Token count is estimated at ~4 characters per token. This is calibrated for
 * English prose and code — non-Latin or emoji-heavy content may undercount,
 * producing chunks that approach text-embedding-3-small's 8191-token limit.
 *
 * Each returned chunk carries a headingContext (the nearest enclosing section
 * heading, if the chunk was split away from it) for use in embedding inputs.
 * Stored content is never modified — heading context and overlap are applied
 * only at embedding time in ingestion.ts.
 */

export const CHUNK_TARGET_TOKENS = 500;

/** A bare heading under this many tokens is merged forward rather than emitted alone. */
const HEADING_ONLY_MAX_TOKENS = 30;

/** Default overlap between adjacent chunks, in tokens (~4 chars each). */
export const CHUNK_OVERLAP_TOKENS = 50;

export type ChunkWithContext = {
	/** Normalized content for storage — separator whitespace may differ from original. */
	content: string;
	/**
	 * Nearest enclosing section heading, when this chunk was split away from it.
	 * Prepend to the embedding input for retrieval signal.
	 * Null when the chunk already starts with a heading or has no enclosing heading.
	 */
	headingContext: string | null;
};

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

/** Returns true if text is a single bare heading line with no body content. */
function isHeadingOnly(text: string): boolean {
	const trimmed = text.trim();
	return (
		!/[\r\n]/.test(trimmed) &&
		/^#{1,6} \S/.test(trimmed) &&
		estimateTokens(trimmed) < HEADING_ONLY_MAX_TOKENS
	);
}

/**
 * Split text on a separator while preserving the separator in the resulting
 * segments. Headings stay attached to the following segment, but sentence
 * punctuation (". ") stays attached to the preceding sentence so stored
 * content is not mutated to start with punctuation.
 */
function splitKeepSeparator(text: string, separator: string): string[] {
	const parts = text.split(separator);
	if (parts.length <= 1) return parts;

	if (separator === '. ') {
		return parts.map((p, i) => (i < parts.length - 1 ? p + separator : p)).filter(Boolean);
	}
	return parts.map((p, i) => (i === 0 ? p : separator + p)).filter(Boolean);
}

/**
 * Merge a list of ChunkWithContext items into groups no larger than maxTokens,
 * combining consecutive small chunks greedily. A heading-only chunk is always
 * merged forward. When merging two chunks the earlier heading context is kept,
 * preserving per-section context set by recursive calls.
 */
function mergeSegments(segments: ChunkWithContext[], maxTokens: number): ChunkWithContext[] {
	const result: ChunkWithContext[] = [];
	let current: ChunkWithContext | null = null as ChunkWithContext | null;

	for (const seg of segments) {
		if (!current) {
			current = seg;
			continue;
		}
		const joinedContent = `${current.content}\n${seg.content}`;
		if (estimateTokens(joinedContent) <= maxTokens || isHeadingOnly(current.content)) {
			current = {
				content: joinedContent,
				// Prefer the earlier heading context — it's from closer in the doc.
				headingContext: current.headingContext ?? seg.headingContext
			};
		} else {
			result.push({
				content: current.content.trim(),
				headingContext: current.headingContext
			});
			current = seg;
		}
	}
	if (current)
		result.push({
			content: current.content.trim(),
			headingContext: current.headingContext
		});
	return result.filter((c) => c.content);
}

const SEPARATORS = ['\n# ', '\n## ', '\n### ', '\n\n', '\n', '. '];

/**
 * Split `content` into semantic chunks, each paired with an optional heading
 * context for embedding. Stored content is always the normalized chunk text;
 * callers must prepend `headingContext` (when non-null) to the embedding input.
 */
export function chunkMarkdown(
	content: string,
	maxTokens = CHUNK_TARGET_TOKENS
): ChunkWithContext[] {
	const trimmed = content.trim();
	if (estimateTokens(trimmed) <= maxTokens) {
		return [{ content: trimmed, headingContext: null }];
	}

	// Prepend \n so that all heading separators (which start with \n) also match
	// at the very beginning of the document, e.g. a document starting with "# H1".
	const normalized = `\n${trimmed}`;

	for (const sep of SEPARATORS) {
		const segments = splitKeepSeparator(normalized, sep);
		if (segments.length <= 1) continue;

		// Recursively chunk any segment that is still too large. Recursive calls
		// return ChunkWithContext with correct per-section headingContext already set.
		const refined = segments.flatMap((seg) => {
			const s = seg.trim();
			if (!s) return [] as ChunkWithContext[];
			return estimateTokens(s) > maxTokens
				? chunkMarkdown(s, maxTokens)
				: [{ content: s, headingContext: null } as ChunkWithContext];
		});

		// Merge while preserving each chunk's headingContext from recursive calls.
		const merged = mergeSegments(refined, maxTokens);
		if (merged.length > 1) {
			// Apply this section's leading heading as a fallback for chunks that
			// have no context from a deeper recursive call and don't start with
			// their own heading. Chunks from sub-sections already have the right
			// context set, so we never overwrite a non-null headingContext.
			const leadingHeading = trimmed.match(/^(#{1,6} [^\n]+)/)?.[1] ?? null;
			if (leadingHeading) {
				return merged.map((chunk) => ({
					content: chunk.content,
					headingContext:
						chunk.headingContext ??
						(!chunk.content.trimStart().startsWith('#') ? leadingHeading : null)
				}));
			}
			return merged;
		}
	}

	// Hard character split as last resort — deliberately crude, no word boundary.
	const charLimit = maxTokens * 4;
	const chunks: ChunkWithContext[] = [];
	for (let i = 0; i < trimmed.length; i += charLimit) {
		const slice = trimmed.slice(i, i + charLimit).trim();
		if (slice) chunks.push({ content: slice, headingContext: null });
	}
	return chunks;
}

/**
 * Prepend a tail of the previous text to each entry so context straddling a
 * boundary is not lost. Applied only to embedding inputs — not stored content.
 * Pass overlapTokens = 0 to skip.
 */
export function applyChunkOverlap(texts: string[], overlapTokens: number): string[] {
	if (overlapTokens <= 0 || texts.length <= 1) return texts;
	const overlapChars = overlapTokens * 4;
	return texts.map((text, i) => {
		if (i === 0) return text;
		const tail = texts[i - 1].slice(-overlapChars).trim();
		return tail ? `${tail}\n\n${text}` : text;
	});
}
