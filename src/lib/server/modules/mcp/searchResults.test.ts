import { describe, expect, it } from 'vitest';
import {
	deduplicateByBestSimilarity,
	formatSearchResult,
	mergeRepoRefs,
	type RepoSourceDocument
} from './searchResults';
import type { SearchResult } from '@/modules/repository';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(
	overrides: Partial<SearchResult> & Pick<SearchResult, 'id' | 'similarity'>
): SearchResult {
	return {
		title: 'Test Document',
		content: 'Some content.',
		tags: [],
		repos: [],
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		date: null,
		parentId: null,
		userId: null,
		artifactKey: null,
		...overrides
	};
}

// ---------------------------------------------------------------------------
// formatSearchResult
// ---------------------------------------------------------------------------

describe('formatSearchResult', () => {
	it('rounds similarity to 3 decimal places', () => {
		const result = makeResult({ id: 'doc1', similarity: 0.98765432 });
		expect(formatSearchResult(result, null).similarity).toBe(0.988);
	});

	it('preserves the title for a top-level document (parentId is null)', () => {
		const result = makeResult({
			id: 'doc1',
			similarity: 0.9,
			title: 'My Doc [1/3]',
			parentId: null
		});
		expect(formatSearchResult(result, null).title).toBe('My Doc [1/3]');
	});

	it('strips the [i/N] chunk suffix from a chunk document (parentId is set)', () => {
		const result = makeResult({
			id: 'doc1:chunk:0000',
			similarity: 0.9,
			title: 'My Doc [2/5]',
			parentId: 'doc1'
		});
		expect(formatSearchResult(result, null).title).toBe('My Doc');
	});

	it('does not strip if the title does not end with the chunk pattern', () => {
		const result = makeResult({
			id: 'doc1:chunk:0000',
			similarity: 0.9,
			title: 'No Suffix Here',
			parentId: 'doc1'
		});
		expect(formatSearchResult(result, null).title).toBe('No Suffix Here');
	});

	it('passes through all other fields unchanged', () => {
		const result = makeResult({
			id: 'doc1',
			similarity: 0.5,
			tags: ['a', 'b'],
			content: 'Hello',
			parentId: null
		});
		const formatted = formatSearchResult(result, null);
		expect(formatted.id).toBe('doc1');
		expect(formatted.tags).toEqual(['a', 'b']);
		expect(formatted.content).toBe('Hello');
		expect(formatted.parentId).toBeNull();
	});

	it('includes the artifactUrl in the formatted result', () => {
		const result = makeResult({
			id: 'doc1',
			similarity: 0.9,
			artifactKey: 'artifacts/doc1/file.pdf'
		});
		const url = 'https://example.com/presigned-url';
		expect(formatSearchResult(result, url).artifactUrl).toBe(url);
	});

	it('passes null artifactUrl through when no artifact exists', () => {
		const result = makeResult({ id: 'doc1', similarity: 0.9, artifactKey: null });
		expect(formatSearchResult(result, null).artifactUrl).toBeNull();
	});

	it('defaults repos to an empty array', () => {
		const result = makeResult({ id: 'doc1', similarity: 0.9 });
		expect(formatSearchResult(result, null).repos).toEqual([]);
	});

	it('includes the document repos in the formatted result', () => {
		const repos = [{ url: 'org/repo', paths: ['src/index.ts'] }];
		const result = makeResult({ id: 'doc1', similarity: 0.9, repos });
		expect(formatSearchResult(result, null).repos).toEqual(repos);
	});
});

// ---------------------------------------------------------------------------
// deduplicateByBestSimilarity
// ---------------------------------------------------------------------------

describe('deduplicateByBestSimilarity', () => {
	it('returns an empty array when all input lists are empty', () => {
		expect(deduplicateByBestSimilarity([], 5)).toEqual([]);
		expect(deduplicateByBestSimilarity([[]], 5)).toEqual([]);
	});

	it('deduplicates results that appear in multiple lists, keeping the highest similarity', () => {
		const doc1Low = makeResult({ id: 'doc1', similarity: 0.5 });
		const doc1High = makeResult({ id: 'doc1', similarity: 0.9 });
		const doc2 = makeResult({ id: 'doc2', similarity: 0.7 });

		const merged = deduplicateByBestSimilarity([[doc1Low, doc2], [doc1High]], 10);

		const ids = merged.map((r) => r.id);
		expect(ids.filter((id) => id === 'doc1')).toHaveLength(1);

		const doc1Result = merged.find((r) => r.id === 'doc1');
		expect(doc1Result?.similarity).toBe(0.9);
	});

	it('returns results sorted by similarity descending', () => {
		const results = [
			makeResult({ id: 'a', similarity: 0.3 }),
			makeResult({ id: 'b', similarity: 0.9 }),
			makeResult({ id: 'c', similarity: 0.6 })
		];

		const merged = deduplicateByBestSimilarity([results], 10);
		const similarities = merged.map((r) => r.similarity);
		expect(similarities).toEqual([0.9, 0.6, 0.3]);
	});

	it('truncates to the specified limit', () => {
		const results = Array.from({ length: 10 }, (_, i) =>
			makeResult({ id: `doc${i}`, similarity: i / 10 })
		);
		const merged = deduplicateByBestSimilarity([results], 3);
		expect(merged).toHaveLength(3);
	});

	it('handles a single result list with no duplicates', () => {
		const results = [
			makeResult({ id: 'x', similarity: 0.8 }),
			makeResult({ id: 'y', similarity: 0.6 })
		];
		const merged = deduplicateByBestSimilarity([results], 10);
		expect(merged).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// mergeRepoRefs
// ---------------------------------------------------------------------------

describe('mergeRepoRefs', () => {
	function makeSource(overrides: Partial<RepoSourceDocument> & { id: string }): RepoSourceDocument {
		return { title: `Doc ${overrides.id}`, repos: [], ...overrides };
	}

	it('returns an empty array when no documents reference repos', () => {
		expect(mergeRepoRefs([])).toEqual([]);
		expect(mergeRepoRefs([makeSource({ id: 'a' })])).toEqual([]);
	});

	it('skips repo refs with an empty url', () => {
		const merged = mergeRepoRefs([makeSource({ id: 'a', repos: [{ url: '' }] })]);
		expect(merged).toEqual([]);
	});

	it('annotates each repo with its source documents', () => {
		const merged = mergeRepoRefs([
			makeSource({ id: 'a', title: 'Auth Doc', repos: [{ url: 'org/auth' }] })
		]);
		expect(merged).toEqual([{ url: 'org/auth', sources: [{ id: 'a', title: 'Auth Doc' }] }]);
	});

	it('dedupes by url, merging paths and sources across documents', () => {
		const merged = mergeRepoRefs([
			makeSource({ id: 'a', title: 'A', repos: [{ url: 'org/repo', paths: ['src/a.ts'] }] }),
			makeSource({ id: 'b', title: 'B', repos: [{ url: 'org/repo', paths: ['src/b.ts'] }] })
		]);

		expect(merged).toHaveLength(1);
		expect(merged[0].url).toBe('org/repo');
		expect(merged[0].paths).toEqual(['src/a.ts', 'src/b.ts']);
		expect(merged[0].sources).toEqual([
			{ id: 'a', title: 'A' },
			{ id: 'b', title: 'B' }
		]);
	});

	it('dedupes repeated paths and repeated source documents', () => {
		const merged = mergeRepoRefs([
			makeSource({
				id: 'a',
				repos: [
					{ url: 'org/repo', paths: ['src/x.ts'] },
					{ url: 'org/repo', paths: ['src/x.ts'] }
				]
			})
		]);

		expect(merged).toHaveLength(1);
		expect(merged[0].paths).toEqual(['src/x.ts']);
		expect(merged[0].sources).toHaveLength(1);
	});

	it('keeps the first non-empty ref and note seen for a url', () => {
		const merged = mergeRepoRefs([
			makeSource({ id: 'a', repos: [{ url: 'org/repo', ref: 'main', note: 'first' }] }),
			makeSource({ id: 'b', repos: [{ url: 'org/repo', ref: 'dev', note: 'second' }] })
		]);

		expect(merged[0].ref).toBe('main');
		expect(merged[0].note).toBe('first');
	});

	it('omits the paths field when no paths were collected', () => {
		const merged = mergeRepoRefs([makeSource({ id: 'a', repos: [{ url: 'org/repo' }] })]);
		expect('paths' in merged[0]).toBe(false);
	});
});
