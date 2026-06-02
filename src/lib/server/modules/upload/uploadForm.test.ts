import { describe, expect, it } from 'vitest';
import {
	isAllowedImageMediaType,
	parseOptionalDate,
	parseOptionalId,
	parseOptionalString,
	parseOptionalTags
} from './uploadForm';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formDataWith(fields: Record<string, string>): FormData {
	const fd = new FormData();
	for (const [key, value] of Object.entries(fields)) {
		fd.append(key, value);
	}
	return fd;
}

// ---------------------------------------------------------------------------
// isAllowedImageMediaType
// ---------------------------------------------------------------------------

describe('isAllowedImageMediaType', () => {
	it('accepts each of the four allowed MIME types', () => {
		expect(isAllowedImageMediaType('image/jpeg')).toBe(true);
		expect(isAllowedImageMediaType('image/png')).toBe(true);
		expect(isAllowedImageMediaType('image/gif')).toBe(true);
		expect(isAllowedImageMediaType('image/webp')).toBe(true);
	});

	it('rejects types that are not in the allow-list', () => {
		expect(isAllowedImageMediaType('application/pdf')).toBe(false);
		expect(isAllowedImageMediaType('image/tiff')).toBe(false);
		expect(isAllowedImageMediaType('')).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// parseOptionalId
// ---------------------------------------------------------------------------

describe('parseOptionalId', () => {
	it('returns undefined when the id field is absent', () => {
		expect(parseOptionalId(new FormData())).toBeUndefined();
	});

	it('returns the id string when valid', () => {
		expect(parseOptionalId(formDataWith({ id: 'my-doc-id' }))).toBe('my-doc-id');
	});

	it('returns null when the id contains the reserved :chunk: namespace', () => {
		expect(parseOptionalId(formDataWith({ id: 'parent:chunk:0001' }))).toBeNull();
	});

	it("accepts an id that contains 'chunk' but not ':chunk:'", () => {
		expect(parseOptionalId(formDataWith({ id: 'chunk-of-text' }))).toBe('chunk-of-text');
	});

	it('trims surrounding whitespace from the id', () => {
		expect(parseOptionalId(formDataWith({ id: '  my-doc-id  ' }))).toBe('my-doc-id');
	});

	it('returns undefined when the id is whitespace only', () => {
		expect(parseOptionalId(formDataWith({ id: '   ' }))).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// parseOptionalDate
// ---------------------------------------------------------------------------

describe('parseOptionalDate', () => {
	it('returns undefined when the date field is absent', () => {
		expect(parseOptionalDate(new FormData())).toBeUndefined();
	});

	it('returns a UTC ISO string for a valid ISO 8601 datetime', () => {
		const result = parseOptionalDate(formDataWith({ date: '2026-04-20T12:00:00.000Z' }));
		expect(result).toBe('2026-04-20T12:00:00.000Z');
	});

	it('returns null for a datetime with a numeric timezone offset (Zod requires Z suffix)', () => {
		const result = parseOptionalDate(formDataWith({ date: '2026-04-20T12:00:00.000+05:00' }));
		expect(result).toBeNull();
	});

	it('returns null for a non-datetime string', () => {
		expect(parseOptionalDate(formDataWith({ date: 'not-a-date' }))).toBeNull();
	});

	it('returns null for a date-only string (no time component)', () => {
		expect(parseOptionalDate(formDataWith({ date: '2026-04-20' }))).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// parseOptionalTags
// ---------------------------------------------------------------------------

describe('parseOptionalTags', () => {
	it('returns undefined when the tags field is absent', () => {
		expect(parseOptionalTags(new FormData())).toBeUndefined();
	});

	it('splits a comma-separated string into an array', () => {
		expect(parseOptionalTags(formDataWith({ tags: 'a,b,c' }))).toEqual(['a', 'b', 'c']);
	});

	it('trims whitespace from each tag', () => {
		expect(parseOptionalTags(formDataWith({ tags: ' foo , bar ' }))).toEqual(['foo', 'bar']);
	});

	it('filters out empty strings produced by trailing commas', () => {
		expect(parseOptionalTags(formDataWith({ tags: 'a,,b,' }))).toEqual(['a', 'b']);
	});
});

// ---------------------------------------------------------------------------
// parseOptionalString
// ---------------------------------------------------------------------------

describe('parseOptionalString', () => {
	it('returns undefined when the named field is absent', () => {
		expect(parseOptionalString(new FormData(), 'context')).toBeUndefined();
	});

	it('returns the string value when the field is present', () => {
		expect(parseOptionalString(formDataWith({ context: 'some hint' }), 'context')).toBe(
			'some hint'
		);
	});

	it('trims surrounding whitespace', () => {
		expect(parseOptionalString(formDataWith({ context: '  padded  ' }), 'context')).toBe('padded');
	});

	it('returns undefined when the field is whitespace only', () => {
		expect(parseOptionalString(formDataWith({ context: '   ' }), 'context')).toBeUndefined();
	});
});
