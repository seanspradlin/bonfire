// ssr = false: this page is hit from email links and runs client-side only;
// token validation here guards the fetch URL, full server validation happens in the accept POST.
export const ssr = false;

// Tokens must be 16–128 characters of URL-safe base64 / hex characters only.
// Rejecting malformed values before they reach the API prevents path-injection attacks.
const SAFE_TOKEN_RE = /^[a-zA-Z0-9_-]{16,128}$/;

export async function load({ url }: { url: URL }) {
	const token = url.searchParams.get('token');

	if (!token) {
		return { valid: false, error: 'Missing invitation token', token: '', email: '', role: '' };
	}

	if (!SAFE_TOKEN_RE.test(token)) {
		return {
			valid: false,
			error: 'This invitation link is invalid or has expired.',
			token: '',
			email: '',
			role: ''
		};
	}

	const res = await fetch(`/api/invitations/${token}`);

	if (!res.ok) {
		// Server collapses missing / accepted / expired invitations into a 404 with
		// a generic body to avoid leaking token state. Surface its message when
		// available; fall back to a generic one if the body isn't JSON.
		const body = await res.json().catch(() => null);
		return {
			valid: false,
			error: body?.error ?? 'Invalid or expired invitation',
			token: '',
			email: '',
			role: ''
		};
	}

	const data = await res.json();
	return { valid: true, error: '', token, email: data.email, role: data.role };
}
