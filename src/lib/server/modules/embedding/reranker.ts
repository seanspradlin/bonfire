import { CohereClient } from 'cohere-ai';
import { env } from '$env/dynamic/private';

export interface RerankProvider {
	rerank(params: {
		query: string;
		documents: Array<{ id: string; content: string }>;
		topN: number;
	}): Promise<Array<{ id: string; relevanceScore: number }>>;
}

class CohereRerankProvider implements RerankProvider {
	private client: CohereClient;
	private model: string;

	constructor(apiKey: string, model = 'rerank-v3.5') {
		this.client = new CohereClient({ token: apiKey });
		this.model = model;
	}

	async rerank(params: {
		query: string;
		documents: Array<{ id: string; content: string }>;
		topN: number;
	}): Promise<Array<{ id: string; relevanceScore: number }>> {
		if (params.documents.length === 0) return [];

		const response = await this.client.rerank({
			model: this.model,
			query: params.query,
			documents: params.documents.map((d) => d.content),
			topN: Math.min(params.topN, params.documents.length)
		});

		return response.results.map((r) => ({
			id: params.documents[r.index].id,
			relevanceScore: r.relevanceScore
		}));
	}
}

export function createRerankProvider(): RerankProvider | null {
	const apiKey = env.COHERE_API_KEY;
	if (!apiKey) return null;
	return new CohereRerankProvider(apiKey);
}
