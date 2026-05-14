export const ssr = false;

// better-auth tokens are 24-char alphanumeric strings (generateId uses a-z A-Z 0-9)
const SAFE_TOKEN_RE = /^[a-zA-Z0-9]{16,128}$/;

export async function load({ url }: { url: URL }) {
	const token = url.searchParams.get('token');
	const error = url.searchParams.get('error');

	if (error || !token || !SAFE_TOKEN_RE.test(token)) {
		return { valid: false, token: '' };
	}

	return { valid: true, token };
}
