/**
 * Embedding provider abstraction.
 *
 * Swap the implementation (e.g. Voyage AI, Cohere, local model) by creating a
 * new class that satisfies `EmbeddingProvider` and updating `createEmbeddingProvider`.
 */

import OpenAI from "openai";

export const EMBEDDING_DIMENSIONS = 1536;

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface EmbeddingProvider {
	/** Generate an embedding vector for the given text. */
	embed(text: string): Promise<number[]>;
}

// ---------------------------------------------------------------------------
// OpenAI implementation
// ---------------------------------------------------------------------------

class OpenAIEmbeddingProvider implements EmbeddingProvider {
	private client: OpenAI;
	private model: string;

	constructor(apiKey: string, model = "text-embedding-3-small") {
		this.client = new OpenAI({ apiKey });
		this.model = model;
	}

	async embed(text: string): Promise<number[]> {
		const response = await this.client.embeddings.create({
			model: this.model,
			input: text,
			dimensions: EMBEDDING_DIMENSIONS,
		});
		return response.data[0].embedding;
	}
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createEmbeddingProvider(): EmbeddingProvider {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new Error(
			"OPENAI_API_KEY environment variable is required. " +
				"Set it to your OpenAI API key to enable semantic search.",
		);
	}
	return new OpenAIEmbeddingProvider(apiKey);
}
