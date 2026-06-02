import {
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	vector
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Knowledge base tables
// ---------------------------------------------------------------------------

export const documents = pgTable(
	'documents',
	{
		id: text('id').primaryKey(),
		userId: text('user_id'),
		title: text('title').notNull(),
		content: text('content').notNull(),
		tags: jsonb('tags').notNull().$type<string[]>().default([]),
		embedding: vector('embedding', { dimensions: 1536 }),
		createdAt: text('created_at').notNull(),
		updatedAt: text('updated_at').notNull(),
		date: text('date'),
		parentId: text('parent_id'),
		artifactKey: text('artifact_key')
	},
	(t) => [
		index('documents_parent_id_idx').on(t.parentId),
		index('documents_user_id_idx').on(t.userId),
		// HNSW index accelerates cosine similarity (<=> operator) queries via pgvector
		index('documents_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops'))
	]
);

export const wikiPages = pgTable(
	'wiki_pages',
	{
		slug: text('slug').primaryKey(),
		title: text('title').notNull(),
		content: text('content').notNull(),
		embedding: vector('embedding', { dimensions: 1536 }),
		tags: jsonb('tags').notNull().$type<string[]>().default([]),
		sourceDocumentIds: jsonb('source_document_ids').notNull().$type<string[]>().default([]),
		createdAt: text('created_at').notNull(),
		updatedAt: text('updated_at').notNull(),
		userId: text('user_id')
	},
	(t) => [
		index('wiki_pages_user_id_idx').on(t.userId),
		// HNSW index accelerates cosine similarity (<=> operator) queries via pgvector
		index('wiki_pages_embedding_hnsw_idx').using('hnsw', t.embedding.op('vector_cosine_ops'))
	]
);

// ---------------------------------------------------------------------------
// Better Auth tables
// ---------------------------------------------------------------------------

export const user = pgTable(
	'user',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		email: text('email').notNull(),
		emailVerified: boolean('email_verified').notNull().default(false),
		image: text('image'),
		username: text('username'),
		displayUsername: text('display_username'),
		role: text('role').notNull().default('user'),
		banned: boolean('banned').notNull().default(false),
		banReason: text('ban_reason'),
		banExpires: timestamp('ban_expires', { mode: 'date' }),
		createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
		updatedAt: timestamp('updated_at', { mode: 'date' }).notNull()
	},
	(t) => [
		uniqueIndex('user_email_unique').on(t.email),
		uniqueIndex('user_username_unique').on(t.username)
	]
);

export const session = pgTable(
	'session',
	{
		id: text('id').primaryKey(),
		expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
		token: text('token').notNull(),
		createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
		updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		userId: text('user_id').notNull(),
		impersonatedBy: text('impersonated_by')
	},
	(t) => [
		uniqueIndex('session_token_unique').on(t.token),
		index('session_user_id_idx').on(t.userId)
	]
);

export const account = pgTable(
	'account',
	{
		id: text('id').primaryKey(),
		accountId: text('account_id').notNull(),
		providerId: text('provider_id').notNull(),
		userId: text('user_id').notNull(),
		accessToken: text('access_token'),
		refreshToken: text('refresh_token'),
		idToken: text('id_token'),
		accessTokenExpiresAt: timestamp('access_token_expires_at', { mode: 'date' }),
		refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { mode: 'date' }),
		scope: text('scope'),
		password: text('password'),
		createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
		updatedAt: timestamp('updated_at', { mode: 'date' }).notNull()
	},
	(t) => [
		index('account_user_id_idx').on(t.userId),
		uniqueIndex('account_provider_account_unique').on(t.providerId, t.accountId)
	]
);

export const verification = pgTable(
	'verification',
	{
		id: text('id').primaryKey(),
		identifier: text('identifier').notNull(),
		value: text('value').notNull(),
		expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
		createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
		updatedAt: timestamp('updated_at', { mode: 'date' }).notNull()
	},
	(t) => [index('verification_identifier_idx').on(t.identifier)]
);

// ---------------------------------------------------------------------------
// App-specific tables
// ---------------------------------------------------------------------------

export const invitations = pgTable(
	'invitations',
	{
		id: text('id').primaryKey(),
		email: text('email').notNull(),
		role: text('role').notNull(),
		token: text('token').notNull(),
		invitedBy: text('invited_by').notNull(),
		expiresAt: timestamp('expires_at', { mode: 'date' }).notNull(),
		acceptedAt: timestamp('accepted_at', { mode: 'date' }),
		createdAt: timestamp('created_at', { mode: 'date' }).notNull()
	},
	(t) => [
		uniqueIndex('invitations_token_unique').on(t.token),
		index('invitations_email_idx').on(t.email)
	]
);

// ---------------------------------------------------------------------------
// Better Auth JWT / OAuth provider tables
// ---------------------------------------------------------------------------

export const jwks = pgTable('jwks', {
	id: text('id').primaryKey(),
	publicKey: text('public_key').notNull(),
	privateKey: text('private_key').notNull(),
	createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
	expiresAt: timestamp('expires_at', { mode: 'date' })
});

export const oauthClient = pgTable(
	'oauth_client',
	{
		id: text('id').primaryKey(),
		clientId: text('client_id').notNull(),
		clientSecret: text('client_secret'),
		disabled: boolean('disabled').default(false),
		skipConsent: boolean('skip_consent'),
		enableEndSession: boolean('enable_end_session'),
		subjectType: text('subject_type'),
		scopes: text('scopes').array(),
		userId: text('user_id'),
		createdAt: timestamp('created_at', { mode: 'date' }),
		updatedAt: timestamp('updated_at', { mode: 'date' }),
		name: text('name'),
		uri: text('uri'),
		icon: text('icon'),
		contacts: text('contacts').array(),
		tos: text('tos'),
		policy: text('policy'),
		softwareId: text('software_id'),
		softwareVersion: text('software_version'),
		softwareStatement: text('software_statement'),
		redirectUris: text('redirect_uris').array().notNull(),
		postLogoutRedirectUris: text('post_logout_redirect_uris').array(),
		tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
		grantTypes: text('grant_types').array(),
		responseTypes: text('response_types').array(),
		public: boolean('public'),
		type: text('type'),
		requirePKCE: boolean('require_pkce'),
		referenceId: text('reference_id'),
		metadata: jsonb('metadata')
	},
	(t) => [uniqueIndex('oauth_client_client_id_unique').on(t.clientId)]
);

export const oauthRefreshToken = pgTable('oauth_refresh_token', {
	id: text('id').primaryKey(),
	token: text('token').notNull(),
	clientId: text('client_id').notNull(),
	sessionId: text('session_id'),
	userId: text('user_id').notNull(),
	referenceId: text('reference_id'),
	expiresAt: timestamp('expires_at', { mode: 'date' }),
	createdAt: timestamp('created_at', { mode: 'date' }),
	revoked: timestamp('revoked', { mode: 'date' }),
	authTime: timestamp('auth_time', { mode: 'date' }),
	scopes: text('scopes').array().notNull()
});

export const oauthAccessToken = pgTable(
	'oauth_access_token',
	{
		id: text('id').primaryKey(),
		token: text('token'),
		clientId: text('client_id').notNull(),
		sessionId: text('session_id'),
		userId: text('user_id'),
		referenceId: text('reference_id'),
		refreshId: text('refresh_id'),
		expiresAt: timestamp('expires_at', { mode: 'date' }),
		createdAt: timestamp('created_at', { mode: 'date' }),
		scopes: text('scopes').array().notNull()
	},
	(t) => [uniqueIndex('oauth_access_token_token_unique').on(t.token)]
);

export const oauthConsent = pgTable('oauth_consent', {
	id: text('id').primaryKey(),
	clientId: text('client_id').notNull(),
	userId: text('user_id'),
	referenceId: text('reference_id'),
	scopes: text('scopes').array().notNull(),
	createdAt: timestamp('created_at', { mode: 'date' }),
	updatedAt: timestamp('updated_at', { mode: 'date' })
});

// ---------------------------------------------------------------------------
// Derived types
// ---------------------------------------------------------------------------

export type DocumentRow = typeof documents.$inferSelect;
export type WikiPageRow = typeof wikiPages.$inferSelect;
