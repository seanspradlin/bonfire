import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { isAdmin, requireAuth } from '$lib/server/modules/auth/guards';
import { db } from '$lib/server/db';
import { invitations } from '$lib/server/db/schema';
import { getResendClient } from '$lib/server/modules/email/resend';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const createInvitationSchema = z.object({
	email: z.string().email(),
	role: z.enum(['admin', 'editor', 'viewer'])
});

/** 72 hours in milliseconds */
const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

function generateToken(): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
}

/**
 * POST /api/invitations — admin only.
 * Creates an invitation and sends an email via Resend.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const authUser = requireAuth(locals);
	if (!isAdmin(authUser)) {
		return json({ error: 'Forbidden' }, { status: 403 });
	}

	const body = await request.json();
	const parsed = createInvitationSchema.safeParse(body);
	if (!parsed.success) {
		return json({ error: parsed.error.flatten() }, { status: 400 });
	}

	const { email, role } = parsed.data;
	const id = crypto.randomUUID();
	const token = generateToken();
	const now = new Date();
	const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);

	await db.insert(invitations).values({
		id,
		email,
		role,
		token,
		invitedBy: authUser.id,
		expiresAt,
		createdAt: now
	});

	// Send the invitation email if Resend is configured; skip silently in dev.
	const clientUrl = env.CLIENT_URL ?? env.ORIGIN ?? 'http://localhost:5173';
	const inviteLink = `${clientUrl}/accept-invite?token=${token}`;
	const resend = getResendClient();

	if (!resend) {
		console.warn('RESEND_API_KEY is not set — skipping invitation email for', email);
	} else {
		const { error: emailError } = await resend.emails.send({
			from: env.EMAIL_FROM ?? 'Bonfire <noreply@example.com>',
			to: email,
			subject: "You've been invited to Bonfire",
			text: `You've been invited to join Bonfire as ${role}.\n\nAccept your invitation here:\n${inviteLink}\n\nThis link expires in 72 hours.`
		});

		if (emailError) {
			console.error('Failed to send invitation email:', emailError);
		}
	}

	return json({ id, email, role, expiresAt }, { status: 201 });
};
