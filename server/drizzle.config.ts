import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./src/modules/db/schema.ts",
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: {
		url:
			process.env.DATABASE_URL ??
			"postgresql://bonfire:bonfire@localhost:5432/bonfire",
	},
});
