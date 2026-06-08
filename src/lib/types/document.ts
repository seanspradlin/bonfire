/**
 * Client-side mirror of the server `RepoRef` type (see
 * `src/lib/server/db/schema.ts`). A reference from a document to a git
 * repository it describes — descriptive metadata only.
 */
export interface RepoRef {
	/** Repository URL or shorthand, e.g. "https://github.com/org/repo" or "org/repo". */
	url: string;
	/** Relevant files/dirs within the repo, e.g. ["src/auth/guards.ts"]. */
	paths?: string[];
	/** Optional branch, tag, or commit. */
	ref?: string;
	/** Optional note on why this repo is relevant to the document. */
	note?: string;
}

export interface Document {
	id: string;
	title: string;
	content: string;
	tags: string[];
	repos: RepoRef[];
	createdAt: string;
	updatedAt: string;
	date: string | null;
	userId: string | null;
}
