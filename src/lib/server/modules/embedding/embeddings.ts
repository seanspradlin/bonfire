/**
 * Embedding provider abstraction.
 *
 * Swap the implementation (e.g. Voyage AI, Cohere, local model) by creating a
 * new class that satisfies `EmbeddingProvider` and updating `createEmbeddingProvider`.
 */

import OpenAI from 'openai';
import { env } from '$env/dynamic/private';

export const EMBEDDING_DIMENSIONS = 1536;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface EmbeddingProvider {
	/** Generate an embedding vector for the given text. */
	embed(text: string): Promise<number[]>;

	/**
	 * Generate embedding vectors for multiple texts in a single API call.
	 * Prefer this over calling `embed` in a loop — it's faster and cheaper.
	 */
	embedBatch(texts: string[]): Promise<number[][]>;
}

// ---------------------------------------------------------------------------
// OpenAI implementation
// ---------------------------------------------------------------------------

class OpenAIEmbeddingProvider implements EmbeddingProvider {
	private client: OpenAI;
	private model: string;

	constructor(apiKey: string, model = 'text-embedding-3-small') {
		this.client = new OpenAI({ apiKey });
		this.model = model;
	}

	async embed(text: string): Promise<number[]> {
		const response = await this.client.embeddings.create({
			model: this.model,
			input: text,
			dimensions: EMBEDDING_DIMENSIONS
		});
		return response.data[0].embedding;
	}

	async embedBatch(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];
		const response = await this.client.embeddings.create({
			model: this.model,
			input: texts,
			dimensions: EMBEDDING_DIMENSIONS
		});
		// OpenAI guarantees results are ordered by index
		return response.data.map((d) => d.embedding);
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEmbeddingProvider(): EmbeddingProvider {
	const apiKey = env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new Error(
			'OPENAI_API_KEY environment variable is required. ' +
				'Set it to your OpenAI API key to enable semantic search.'
		);
	}
	return new OpenAIEmbeddingProvider(apiKey);
}
