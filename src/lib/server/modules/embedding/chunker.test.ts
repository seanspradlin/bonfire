import { describe, expect, it } from 'vitest';
import {
	applyChunkOverlap,
	CHUNK_OVERLAP_TOKENS,
	CHUNK_TARGET_TOKENS,
	chunkMarkdown,
	estimateTokens
} from './chunker';

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe('estimateTokens', () => {
	it('returns 0 for an empty string', () => {
		expect(estimateTokens('')).toBe(0);
	});

	it('estimates 1 token per 4 characters, rounded up', () => {
		expect(estimateTokens('abcd')).toBe(1);
		expect(estimateTokens('abcde')).toBe(2);
		expect(estimateTokens('a')).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// chunkMarkdown — short documents
// ---------------------------------------------------------------------------

describe('chunkMarkdown — short documents', () => {
	it('returns a single chunk for text under the token limit', () => {
		const short = 'Hello world.';
		const chunks = chunkMarkdown(short);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].content).toBe(short);
		expect(chunks[0].headingContext).toBeNull();
	});

	it('trims leading and trailing whitespace from the content', () => {
		const chunks = chunkMarkdown('  hello  ');
		expect(chunks[0].content).toBe('hello');
	});
});

// ---------------------------------------------------------------------------
// chunkMarkdown — splitting behaviour
// ---------------------------------------------------------------------------

describe('chunkMarkdown — splitting', () => {
	it('splits a long document into multiple chunks', () => {
		const longContent = 'word '.repeat(CHUNK_TARGET_TOKENS * 4 * 2);
		const chunks = chunkMarkdown(longContent);
		expect(chunks.length).toBeGreaterThan(1);
	});

	it('each chunk stays at or under the token limit', () => {
		const longContent = 'sentence. '.repeat(300);
		const chunks = chunkMarkdown(longContent, 100);
		for (const chunk of chunks) {
			expect(estimateTokens(chunk.content)).toBeLessThanOrEqual(100);
		}
	});

	it('preserves all content across all chunks (no character loss)', () => {
		const words = Array.from({ length: 600 }, (_, i) => `word${i}`);
		const content = words.join(' ');
		const chunks = chunkMarkdown(content, 100);
		const totalChunkChars = chunks.map((c) => c.content.replace(/\s+/g, '')).join('').length;
		const originalChars = content.replace(/\s+/g, '').length;
		expect(totalChunkChars).toBe(originalChars);
	});

	it('attaches a headingContext to chunks split away from a heading', () => {
		const heading = '# My Section';
		const body = 'body text. '.repeat(200);
		const doc = `${heading}\n\n${body}`;
		const chunks = chunkMarkdown(doc, 100);
		const chunksWithContext = chunks.filter((c) => c.headingContext !== null);
		expect(chunksWithContext.length).toBeGreaterThan(0);
		expect(chunksWithContext[0].headingContext).toBe(heading);
	});

	it('does not attach a headingContext to a chunk that starts with its own heading', () => {
		const doc = '# Section A\n\nbody. '.repeat(100);
		const chunks = chunkMarkdown(doc, 50);
		for (const chunk of chunks) {
			if (chunk.content.trimStart().startsWith('#')) {
				expect(chunk.headingContext).toBeNull();
			}
		}
	});

	it('falls back to hard character splitting when no separator works', () => {
		const blob = 'x'.repeat(CHUNK_TARGET_TOKENS * 4 * 3);
		const chunks = chunkMarkdown(blob);
		expect(chunks.length).toBeGreaterThan(1);
	});
});

// ---------------------------------------------------------------------------
// applyChunkOverlap
// ---------------------------------------------------------------------------

describe('applyChunkOverlap', () => {
	it('returns the same array when overlapTokens is 0', () => {
		const texts = ['a', 'b', 'c'];
		expect(applyChunkOverlap(texts, 0)).toEqual(texts);
	});

	it('returns the same array for a single text', () => {
		expect(applyChunkOverlap(['only one'], CHUNK_OVERLAP_TOKENS)).toEqual(['only one']);
	});

	it('leaves the first chunk unchanged', () => {
		const texts = ['first chunk', 'second chunk'];
		const result = applyChunkOverlap(texts, 10);
		expect(result[0]).toBe('first chunk');
	});

	it('prepends a tail of the previous chunk to subsequent chunks', () => {
		const prev = 'abcdefghijklmnopqrstuvwxyz';
		const next = 'next chunk text';
		const texts = [prev, next];
		// overlapTokens=1 → overlapChars=4 → tail is last 4 chars of prev
		const result = applyChunkOverlap(texts, 1);
		expect(result[1]).toContain('wxyz');
		expect(result[1]).toContain(next);
	});

	it('does not prepend when the previous chunk tail is empty after trimming', () => {
		const texts = ['   ', 'next'];
		const result = applyChunkOverlap(texts, 10);
		// Tail of '   ' trims to '' — next should be unchanged
		expect(result[1]).toBe('next');
	});
});
