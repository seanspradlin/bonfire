export interface WikiPage {
	slug: string;
	title: string;
	content: string;
	tags: string[];
	sourceDocumentIds: string[];
	createdAt: string;
	updatedAt: string;
	userId: string | null;
}
