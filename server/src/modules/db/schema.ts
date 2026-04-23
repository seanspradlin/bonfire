import {
	boolean,
	index,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	vector,
} from "drizzle-orm/pg-core";

export const documents = pgTable(
	"documents",
	{
		id: text("id").primaryKey(),
		userId: text("user_id"),
		title: text("title").notNull(),
		content: text("content").notNull(),
		tags: jsonb("tags").notNull().$type<string[]>().default([]),
		embedding: vector("embedding", { dimensions: 1536 }),
		createdAt: text("created_at").notNull(),
		updatedAt: text("updated_at").notNull(),
		date: text("date"),
		parentId: text("parent_id"),
	},
	(t) => [
		index("documents_parent_id_idx").on(t.parentId),
		index("documents_user_id_idx").on(t.userId),
		// HNSW index accelerates cosine similarity (<=> operator) queries via pgvector
		index("documents_embedding_hnsw_idx").using(
			"hnsw",
			t.embedding.op("vector_cosine_ops"),
		),
	],
);

export const user = pgTable(
	"user",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		email: text("email").notNull(),
		emailVerified: boolean("email_verified").notNull().default(false),
		image: text("image"),
		username: text("username"),
		displayUsername: text("display_username"),
		role: text("role").notNull().default("user"),
		banned: boolean("banned").notNull().default(false),
		banReason: text("ban_reason"),
		banExpires: timestamp("ban_expires", { mode: "date" }),
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
	},
	(t) => [
		uniqueIndex("user_email_unique").on(t.email),
		uniqueIndex("user_username_unique").on(t.username),
	],
);

export const session = pgTable(
	"session",
	{
		id: text("id").primaryKey(),
		expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
		token: text("token").notNull(),
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
		ipAddress: text("ip_address"),
		userAgent: text("user_agent"),
		userId: text("user_id").notNull(),
		impersonatedBy: text("impersonated_by"),
	},
	(t) => [
		uniqueIndex("session_token_unique").on(t.token),
		index("session_user_id_idx").on(t.userId),
	],
);

export const account = pgTable(
	"account",
	{
		id: text("id").primaryKey(),
		accountId: text("account_id").notNull(),
		providerId: text("provider_id").notNull(),
		userId: text("user_id").notNull(),
		accessToken: text("access_token"),
		refreshToken: text("refresh_token"),
		idToken: text("id_token"),
		accessTokenExpiresAt: timestamp("access_token_expires_at", {
			mode: "date",
		}),
		refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
			mode: "date",
		}),
		scope: text("scope"),
		password: text("password"),
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
	},
	(t) => [
		index("account_user_id_idx").on(t.userId),
		uniqueIndex("account_provider_account_unique").on(
			t.providerId,
			t.accountId,
		),
	],
);

export const verification = pgTable(
	"verification",
	{
		id: text("id").primaryKey(),
		identifier: text("identifier").notNull(),
		value: text("value").notNull(),
		expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
	},
	(t) => [index("verification_identifier_idx").on(t.identifier)],
);

export const apiKey = pgTable(
	"api_key",
	{
		id: text("id").primaryKey(),
		userId: text("user_id").notNull(),
		keyHash: text("key_hash").notNull(),
		name: text("name").notNull(),
		keyHint: text("key_hint").notNull().default(""),
		lastUsedAt: timestamp("last_used_at", { mode: "date" }),
		expiresAt: timestamp("expires_at", { mode: "date" }),
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
		updatedAt: timestamp("updated_at", { mode: "date" }).notNull(),
	},
	(t) => [
		index("api_key_user_id_idx").on(t.userId),
		uniqueIndex("api_key_hash_unique").on(t.keyHash),
	],
);

export const invitations = pgTable(
	"invitations",
	{
		id: text("id").primaryKey(),
		email: text("email").notNull(),
		role: text("role").notNull(),
		token: text("token").notNull(),
		invitedBy: text("invited_by").notNull(),
		expiresAt: timestamp("expires_at", { mode: "date" }).notNull(),
		acceptedAt: timestamp("accepted_at", { mode: "date" }),
		createdAt: timestamp("created_at", { mode: "date" }).notNull(),
	},
	(t) => [
		uniqueIndex("invitations_token_unique").on(t.token),
		index("invitations_email_idx").on(t.email),
	],
);

export type DocumentRow = typeof documents.$inferSelect;
