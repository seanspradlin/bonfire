<script lang="ts">
	import DOMPurify from 'isomorphic-dompurify';
	import { marked } from 'marked';

	let { text }: { text: string } = $props();

	// Register the link-hardening hook exactly once per module lifetime.
	// The hook runs after DOMPurify strips dangerous attributes so our additions
	// are not themselves sanitized away.
	let hookRegistered = false;
	function ensureHook() {
		if (hookRegistered) return;
		hookRegistered = true;
		DOMPurify.addHook('afterSanitizeAttributes', (node) => {
			if (node.tagName === 'A') {
				// Force all links to open in a new tab and prevent opener access.
				node.setAttribute('target', '_blank');
				node.setAttribute('rel', 'noopener noreferrer nofollow');
			}
		});
	}

	// `marked` accepts options inline; gfm+breaks gives us familiar chat-style rendering
	// (single-newline → <br>, fenced code blocks, tables, strikethrough).
	const html = $derived.by(() => {
		ensureHook();
		const raw = marked.parse(text, { async: false, gfm: true, breaks: true }) as string;
		// Restrict URIs to http(s) and mailto only — blocks javascript: and data: URLs.
		return DOMPurify.sanitize(raw, {
			USE_PROFILES: { html: true },
			ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i
		});
	});
</script>

<div class="md-body">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html html}
</div>

<style>
	.md-body {
		/* Match the enclosing bubble's text sizing while leaving room for block spacing. */
		font-size: 14px;
		line-height: 1.55;
	}

	.md-body :global(p) {
		margin: 0;
	}

	.md-body :global(p + p),
	.md-body :global(p + ul),
	.md-body :global(p + ol),
	.md-body :global(p + pre),
	.md-body :global(ul + p),
	.md-body :global(ol + p),
	.md-body :global(pre + p) {
		margin-top: 0.6em;
	}

	.md-body :global(h1),
	.md-body :global(h2),
	.md-body :global(h3),
	.md-body :global(h4) {
		font-weight: 600;
		line-height: 1.3;
		margin: 0.4em 0 0.2em;
	}

	.md-body :global(h1) {
		font-size: 1.1em;
	}
	.md-body :global(h2) {
		font-size: 1.05em;
	}
	.md-body :global(h3),
	.md-body :global(h4) {
		font-size: 1em;
	}

	.md-body :global(ul),
	.md-body :global(ol) {
		margin: 0;
		padding-left: 1.25em;
	}

	.md-body :global(ul) {
		list-style: disc;
	}
	.md-body :global(ol) {
		list-style: decimal;
	}

	.md-body :global(li + li) {
		margin-top: 0.15em;
	}

	.md-body :global(li > ul),
	.md-body :global(li > ol) {
		margin-top: 0.15em;
	}

	.md-body :global(strong) {
		font-weight: 600;
	}

	.md-body :global(em) {
		font-style: italic;
	}

	.md-body :global(a) {
		color: var(--accent);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.md-body :global(code) {
		font-family:
			ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New',
			monospace;
		font-size: 0.9em;
		background: var(--bg-input);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 0.05em 0.3em;
	}

	.md-body :global(pre) {
		margin: 0.4em 0;
		padding: 0.7em 0.9em;
		background: var(--bg-input);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow-x: auto;
	}

	.md-body :global(pre code) {
		background: transparent;
		border: 0;
		padding: 0;
		font-size: 0.88em;
	}

	.md-body :global(blockquote) {
		margin: 0.4em 0;
		padding: 0.1em 0.8em;
		border-left: 3px solid var(--border);
		color: var(--text-muted);
	}

	.md-body :global(hr) {
		border: 0;
		border-top: 1px solid var(--border);
		margin: 0.6em 0;
	}

	.md-body :global(table) {
		border-collapse: collapse;
		margin: 0.4em 0;
		font-size: 0.95em;
	}

	.md-body :global(th),
	.md-body :global(td) {
		border: 1px solid var(--border);
		padding: 0.3em 0.55em;
		text-align: left;
	}

	.md-body :global(th) {
		background: var(--bg-input);
		font-weight: 600;
	}
</style>
