import Anthropic from '@anthropic-ai/sdk';
import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { parseAiJsonResponse } from '@/modules/shared/parseAiJsonResponse';

export interface ImageInput {
	data: string;
	mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

export interface VisionResult {
	title: string;
	content: string;
	tags: string[];
}

export interface ImageContext {
	context?: string;
	title?: string;
	description?: string;
}

export interface VisionProvider {
	analyzeImage(image: ImageInput, ctx?: ImageContext): Promise<VisionResult>;
}

const SYSTEM_PROMPT = `You are an assistant that transcribes and describes images for a team knowledge base.

Given an image, return a JSON object with three fields:
- "title": a short, descriptive title (under 80 characters)
- "content": full markdown transcription/description of the image
- "tags": an array of lowercase, hyphenated tags derived from the image content and any provided title/description (e.g. ["architecture", "whiteboard", "great-big-game-show"])

Guidelines for content:
- Transcribe all visible text exactly as written, preserving structure
- Describe diagrams, charts, and drawings clearly
- Use markdown headings, lists, and tables where they improve readability
- For whiteboards or handwritten notes, preserve the logical structure even if the layout is freeform

Guidelines for tags:
- Extract meaningful nouns, topics, and proper nouns from image content AND from the provided title/description
- Use lowercase and hyphens (no spaces, no special characters)
- Aim for 3–8 tags that would help someone find this document later
- Include project names, people, technologies, document types, and topics

Respond with only the JSON object, no other text.`;

class AnthropicVisionProvider implements VisionProvider {
	private client: Anthropic;
	private model: string;

	constructor(apiKey: string, model = 'claude-haiku-4-5-20251001') {
		this.client = new Anthropic({ apiKey });
		this.model = model;
	}

	async analyzeImage(image: ImageInput, ctx?: ImageContext): Promise<VisionResult> {
		const parts: string[] = ['Analyze this image.'];
		if (ctx?.title) parts.push(`Title: ${ctx.title}`);
		if (ctx?.description) parts.push(`Description: ${ctx.description}`);
		if (ctx?.context) parts.push(`Additional context: ${ctx.context}`);
		const userText = parts.join(' ');

		const response = await this.client.messages.create({
			model: this.model,
			max_tokens: 2048,
			system: SYSTEM_PROMPT,
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'image',
							source: {
								type: 'base64',
								media_type: image.mediaType,
								data: image.data
							}
						},
						{ type: 'text', text: userText }
					]
				}
			]
		});

		const text = response.content
			.filter(
				(b): b is Extract<(typeof response.content)[number], { type: 'text' }> => b.type === 'text'
			)
			.map((b) => b.text)
			.join('');

		const parsed = parseAiJsonResponse(text);
		if (parsed?.title && parsed?.content) {
			const tags = Array.isArray(parsed.tags)
				? parsed.tags.filter((t): t is string => typeof t === 'string')
				: [];
			return {
				title: String(parsed.title),
				content: String(parsed.content),
				tags
			};
		}
		return {
			title: 'Image Analysis',
			content: text || 'No content extracted from image.',
			tags: []
		};
	}
}

export function createVisionProvider(): VisionProvider {
	const apiKey = env.ANTHROPIC_API_KEY?.trim();
	if (!apiKey) {
		if (building) return new AnthropicVisionProvider('build-only-anthropic-api-key-placeholder');
		throw new Error('ANTHROPIC_API_KEY environment variable is required for image analysis.');
	}
	return new AnthropicVisionProvider(apiKey);
}
