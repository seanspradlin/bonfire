export interface Document {
	id: string;
	title: string;
	content: string;
	tags: string[];
	createdAt: string;
	updatedAt: string;
	date: string | null;
	userId: string | null;
}
