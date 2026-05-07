<script lang="ts">
	import { resolve } from '$app/paths';
	import Icon from '$lib/Icon.svelte';
	import Markdown from '$lib/Markdown.svelte';
	import type { WikiPage } from '$lib/types/wiki';
	import { formatRelativeTime } from '$lib/utils/dateFormat';
	import { extractHeadings, splitIntroAndContent } from '$lib/utils/toc';

	interface Props {
		data: { page: WikiPage; sourceDocuments: { id: string; title: string }[] };
	}

	const { data }: Props = $props();
	const { page, sourceDocuments } = $derived(data);

	const { intro, content } = $derived(splitIntroAndContent(page.content, page.title));
	const allHeadings = $derived(extractHeadings(page.content));
	const toc = $derived(
		intro !== ''
			? allHeadings.slice(1) // skip the first heading since it matches the page title
			: allHeadings
	);
	const bodyContent = $derived(intro !== '' ? content : page.content);
</script>

<div class="mx-auto max-w-3xl px-8 py-8">
	<div class="mb-6">
		<a
			href={resolve('/wiki')}
			class="mb-4 inline-flex items-center gap-1 text-xs text-text-muted no-underline transition-colors hover:text-text"
		>
			<span style="display:inline-block;transform:rotate(90deg)"
				><Icon name="chevronDown" size={12} /></span
			>
			Wiki
		</a>

		<div class="mb-1 flex items-start justify-between gap-4">
			<h1
				class="text-[28px] font-semibold tracking-[-0.02em] text-text"
				style="font-family:'Tenon','DM Sans',sans-serif"
			>
				{page.title}
			</h1>
		</div>

		<div class="flex flex-wrap items-center gap-3 text-xs text-text-muted">
			<span>Updated {formatRelativeTime(page.updatedAt)}</span>
			{#if page.tags.length > 0}
				<span class="text-border">·</span>
				<div class="flex flex-wrap gap-1">
					{#each page.tags as tag (tag)}
						<a
							href={resolve(`/wiki?tag=${encodeURIComponent(tag)}`)}
							class="rounded border border-border bg-bg-input px-1.5 py-0.5 text-[11px] text-text-muted no-underline transition-colors hover:text-text"
						>
							{tag}
						</a>
					{/each}
				</div>
			{/if}
		</div>

		{#if intro}
			<div class="mt-4 text-sm leading-relaxed text-text-muted">
				<Markdown text={intro} />
			</div>
		{/if}
	</div>

	{#if toc.length > 0}
		<div class="mb-6 rounded-xl border border-border bg-bg-card px-5 py-4">
			<h2 class="mb-3 text-xs font-semibold tracking-wider text-text-muted uppercase">
				Contents
			</h2>
			<nav>
				<ol class="space-y-1">
					{#each toc as entry, i (entry.slug)}
						<li
							style="padding-left: {(entry.level - Math.min(...toc.map((e) => e.level))) * 1}rem"
						>
							<a
								href="#{entry.slug}"
								class="group flex items-baseline gap-2 text-sm no-underline transition-colors hover:text-text"
							>
								<span class="text-xs text-text-muted tabular-nums">{i + 1}.</span>
								<span class="text-text-muted group-hover:text-text">{entry.text}</span>
							</a>
						</li>
					{/each}
				</ol>
			</nav>
		</div>
	{/if}

	<div class="mb-8 rounded-xl border border-border bg-bg-card px-6 py-5">
		<Markdown text={bodyContent} anchors={true} />
	</div>

	{#if sourceDocuments.length > 0}
		<div class="rounded-xl border border-border bg-bg-card px-5 py-4">
			<h2 class="mb-3 text-xs font-semibold tracking-wider text-text-muted uppercase">
				Source Documents
			</h2>
			<ul class="space-y-1.5">
				{#each sourceDocuments as doc (doc.id)}
					<li>
						<a
							href={resolve(`/documents/${doc.id}`)}
							class="text-sm text-accent no-underline hover:underline"
						>
							{doc.title}
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>
