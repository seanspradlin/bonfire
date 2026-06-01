import Anthropic from "@anthropic-ai/sdk";
import { parseAiJsonResponse } from "@/shared/parseAiJsonResponse";

export interface PdfInput {
	data: string;
}

export interface PdfResult {
	title: string;
	content: string;
	tags: string[];
}

export interface PdfContext {
	context?: string;
	title?: string;
}

export interface PdfProvider {
	analyzePdf(pdf: PdfInput, ctx?: PdfContext): Promise<PdfResult>;
}

const SYSTEM_PROMPT = `You are an assistant that extracts and structures content from PDF documents for a team knowledge base.

Given a PDF, return a JSON object with three fields:
- "title": a short, descriptive title (under 80 characters)
- "content": full markdown representation of the document's content
- "tags": an array of lowercase, hyphenated tags derived from the document content (e.g. ["architecture", "meeting-notes", "q2-planning"])

Guidelines for content:
- Preserve all meaningful text, headings, lists, and tables
- Use markdown headings, lists, and tables where they improve readability
- Omit headers, footers, and page numbers unless they contain meaningful content
- For multi-section documents, use markdown headings to reflect the document structure

Guidelines for tags:
- Extract meaningful nouns, topics, and proper nouns from the document
- Use lowercase and hyphens (no spaces, no special characters)
- Aim for 3–8 tags that would help someone find this document later
- Include project names, people, technologies, document types, and topics

Respond with only the JSON object, no other text.`;

class AnthropicPdfProvider implements PdfProvider {
	private readonly apiKey: string | undefined;
	private readonly model: string;
	private cachedClient: Anthropic | undefined;

	constructor(apiKey: string | undefined, model = "claude-haiku-4-5-20251001") {
		this.apiKey = apiKey;
		this.model = model;
	}

	// The Anthropic client is built lazily so the server can boot without
	// ANTHROPIC_API_KEY; the error surfaces only if PDF analysis is used.
	private get client(): Anthropic {
		if (!this.apiKey) {
			throw new Error(
				"ANTHROPIC_API_KEY environment variable is required for PDF analysis.",
			);
		}
		this.cachedClient ??= new Anthropic({ apiKey: this.apiKey });
		return this.cachedClient;
	}

	async analyzePdf(pdf: PdfInput, ctx?: PdfContext): Promise<PdfResult> {
		const parts: string[] = ["Analyze this PDF document."];
		if (ctx?.title) parts.push(`Title: ${ctx.title}`);
		if (ctx?.context) parts.push(`Additional context: ${ctx.context}`);
		const userText = parts.join(" ");

		const response = await this.client.messages.create({
			model: this.model,
			max_tokens: 8192,
			system: SYSTEM_PROMPT,
			messages: [
				{
					role: "user",
					content: [
						{
							type: "document",
							source: {
								type: "base64",
								media_type: "application/pdf",
								data: pdf.data,
							},
						},
						{ type: "text", text: userText },
					],
				},
			],
		});

		const text = response.content
			.filter(
				(
					b,
				): b is Extract<(typeof response.content)[number], { type: "text" }> =>
					b.type === "text",
			)
			.map((b) => b.text)
			.join("");

		const parsed = parseAiJsonResponse(text);
		if (parsed?.title && parsed?.content) {
			const tags = Array.isArray(parsed.tags)
				? parsed.tags.filter((t): t is string => typeof t === "string")
				: [];
			return {
				title: String(parsed.title),
				content: String(parsed.content),
				tags,
			};
		}
		return {
			title: "PDF Document",
			content: text || "No content extracted from PDF.",
			tags: [],
		};
	}
}

export function createPdfProvider(): PdfProvider {
	// PDF analysis is optional — defer the ANTHROPIC_API_KEY check to call time
	// so the server boots with only OPENAI_API_KEY configured.
	return new AnthropicPdfProvider(process.env.ANTHROPIC_API_KEY);
}
