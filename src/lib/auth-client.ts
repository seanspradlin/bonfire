import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import { createAuthClient } from 'better-auth/svelte';
import { adminClient } from 'better-auth/client/plugins';

export const authClient = createAuthClient({
	basePath: '/api/auth',
	emailAndPassword: { enabled: true },
	plugins: [adminClient(), oauthProviderClient()]
});
