import { Resend } from 'resend';
import { env } from '$env/dynamic/private';

export function getResendClient(): Resend | null {
	const apiKey = env.RESEND_API_KEY;
	if (!apiKey) return null;
	return new Resend(apiKey);
}
