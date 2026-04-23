/**
 * Helpers for parsing and validating multipart/form-data upload requests.
 *
 * Both the image and PDF upload endpoints share the same optional-field
 * parsing contract. Centralising it here removes duplication and gives each
 * rule a single test-able home.
 */

import { z } from "zod";

const isoDatetime = z.string().datetime();

// ---------------------------------------------------------------------------
// Allowed image types
// ---------------------------------------------------------------------------

export type AllowedImageMediaType =
	| "image/jpeg"
	| "image/png"
	| "image/gif"
	| "image/webp";

export const ALLOWED_IMAGE_MEDIA_TYPES: AllowedImageMediaType[] = [
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
];

export function isAllowedImageMediaType(
	value: string,
): value is AllowedImageMediaType {
	return ALLOWED_IMAGE_MEDIA_TYPES.includes(value as AllowedImageMediaType);
}

// ---------------------------------------------------------------------------
// Allowed text types
// ---------------------------------------------------------------------------

export type AllowedTextMediaType =
	| "text/plain"
	| "text/markdown"
	| "text/x-markdown";

export const ALLOWED_TEXT_MEDIA_TYPES: AllowedTextMediaType[] = [
	"text/plain",
	"text/markdown",
	"text/x-markdown",
];

export function isAllowedTextMediaType(
	value: string,
): value is AllowedTextMediaType {
	// Strip charset/boundary params (e.g. "text/plain; charset=UTF-8" → "text/plain")
	const essence = value.split(";")[0].trim();
	return ALLOWED_TEXT_MEDIA_TYPES.includes(essence as AllowedTextMediaType);
}

// ---------------------------------------------------------------------------
// Field parsers
// ---------------------------------------------------------------------------

/**
 * Parse and validate an optional document ID from a FormData field named "id".
 *
 * Returns:
 *   - The trimmed string ID when present and valid.
 *   - `undefined` when the field is absent or empty.
 *   - `null` when the ID contains the reserved `:chunk:` namespace.
 *
 * The `:chunk:` pattern is reserved for internal chunk IDs and must not be
 * supplied by callers — accepting it would let callers overwrite chunks
 * directly and break the parent-child invariants the ingestion pipeline relies
 * on.
 */
export function parseOptionalId(formData: FormData): string | undefined | null {
	const raw = formData.get("id");
	if (!raw) return undefined;
	const id = String(raw).trim();
	if (!id) return undefined;
	return id.includes(":chunk:") ? null : id;
}

/**
 * Parse and validate an optional ISO 8601 datetime from a FormData field
 * named "date".
 *
 * Returns:
 *   - The value normalised to a UTC ISO string when present and valid.
 *   - `undefined` when the field is absent or empty.
 *   - `null` when the value is present but not a valid ISO 8601 datetime.
 */
export function parseOptionalDate(
	formData: FormData,
): string | undefined | null {
	const raw = formData.get("date");
	if (!raw) return undefined;
	const result = isoDatetime.safeParse(String(raw));
	if (!result.success) return null;
	return new Date(result.data).toISOString();
}

/**
 * Parse an optional comma-separated tags string from a FormData field named
 * "tags". Whitespace around each tag is trimmed and empty strings are removed.
 *
 * Returns an array of tag strings, or `undefined` if the field is absent.
 */
export function parseOptionalTags(formData: FormData): string[] | undefined {
	const raw = formData.get("tags");
	if (!raw) return undefined;
	return String(raw)
		.split(",")
		.map((t) => t.trim())
		.filter(Boolean);
}

/**
 * Parse an optional plain-text string from a named FormData field.
 * Returns the trimmed string value, or `undefined` if the field is absent.
 */
export function parseOptionalString(
	formData: FormData,
	fieldName: string,
): string | undefined {
	const raw = formData.get(fieldName);
	if (!raw) return undefined;
	const trimmed = String(raw).trim();
	return trimmed || undefined;
}
