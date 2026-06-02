import { describe, expect, it } from 'vitest';
import { canEdit, canModifyResource, isAdmin } from './guards';

describe('isAdmin', () => {
	it('detects admin from a string role', () => {
		expect(isAdmin({ role: 'admin' })).toBe(true);
		expect(isAdmin({ role: 'editor' })).toBe(false);
	});

	it('detects admin from a comma-separated role string', () => {
		expect(isAdmin({ role: 'editor,admin' })).toBe(true);
		expect(isAdmin({ role: 'editor, viewer' })).toBe(false);
	});

	it('detects admin from an array role', () => {
		expect(isAdmin({ role: ['viewer', 'admin'] })).toBe(true);
		expect(isAdmin({ role: ['viewer'] })).toBe(false);
	});

	it('returns false for null/undefined roles', () => {
		expect(isAdmin({ role: null })).toBe(false);
		expect(isAdmin({})).toBe(false);
	});
});

describe('canEdit', () => {
	it('allows admins and editors', () => {
		expect(canEdit({ role: 'admin' })).toBe(true);
		expect(canEdit({ role: 'editor' })).toBe(true);
	});

	it('rejects viewers and the default user role', () => {
		expect(canEdit({ role: 'viewer' })).toBe(false);
		expect(canEdit({ role: 'user' })).toBe(false);
		expect(canEdit({ role: null })).toBe(false);
	});
});

describe('canModifyResource', () => {
	const admin = { id: 'admin-1', role: 'admin' };
	const editor = { id: 'editor-1', role: 'editor' };
	const viewer = { id: 'viewer-1', role: 'viewer' };

	it('lets admins modify any resource, including others and ownerless', () => {
		expect(canModifyResource(admin, 'someone-else')).toBe(true);
		expect(canModifyResource(admin, admin.id)).toBe(true);
		expect(canModifyResource(admin, null)).toBe(true);
	});

	it('lets editors modify only resources they own', () => {
		expect(canModifyResource(editor, editor.id)).toBe(true);
		expect(canModifyResource(editor, 'someone-else')).toBe(false);
		// Ownerless resources are admin-only.
		expect(canModifyResource(editor, null)).toBe(false);
	});

	it('never lets viewers modify, even their own resources', () => {
		expect(canModifyResource(viewer, viewer.id)).toBe(false);
		expect(canModifyResource(viewer, 'someone-else')).toBe(false);
	});
});
