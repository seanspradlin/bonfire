export interface TocEntry {
	level: number;
	text: string;
	slug: string;
}

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/<[^>]*>/g, '')
		.replace(/[^\w\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.trim();
}

function stripMarkdown(text: string): string {
	return text
		.replace(/\*\*(.+?)\*\*/g, '$1')
		.replace(/`(.+?)`/g, '$1')
		.replace(/\*(.+?)\*/g, '$1')
		.replace(/_(.+?)_/g, '$1');
}

export function extractHeadings(markdown: string): TocEntry[] {
	const entries: TocEntry[] = [];
	for (const line of markdown.split('\n')) {
		const m = line.match(/^(#{1,6})\s+(.+)$/);
		if (m) {
			const text = stripMarkdown(m[2].trim());
			entries.push({ level: m[1].length, text, slug: slugify(text) });
		}
	}
	return entries;
}

/**
 * If the first heading matches the page title, splits the markdown into
 * an intro (content under the first heading) and the remaining content.
 * Returns empty strings when the first heading doesn't match.
 */
export function splitIntroAndContent(
	markdown: string,
	pageTitle: string
): { intro: string; content: string } {
	const lines = markdown.split('\n');
	let firstIdx = -1;
	let secondIdx = -1;

	for (let i = 0; i < lines.length; i++) {
		if (/^#{1,6}\s+/.test(lines[i])) {
			if (firstIdx === -1) {
				firstIdx = i;
			} else {
				secondIdx = i;
				break;
			}
		}
	}

	if (firstIdx === -1) return { intro: '', content: markdown };

	const firstText = stripMarkdown(lines[firstIdx].replace(/^#{1,6}\s+/, '').trim());
	if (firstText.toLowerCase() !== pageTitle.toLowerCase()) {
		return { intro: '', content: markdown };
	}

	const introLines = secondIdx === -1 ? lines.slice(firstIdx + 1) : lines.slice(firstIdx + 1, secondIdx);
	const intro = introLines.join('\n').trim();
	const content = secondIdx === -1 ? '' : lines.slice(secondIdx).join('\n');

	return { intro, content };
}

export function addAnchorIds(html: string): string {
	return html.replace(/<h([1-6])>(.*?)<\/h[1-6]>/g, (_, level: string, content: string) => {
		const slug = slugify(content.replace(/<[^>]*>/g, ''));
		return `<h${level} id="${slug}">${content}</h${level}>`;
	});
}
