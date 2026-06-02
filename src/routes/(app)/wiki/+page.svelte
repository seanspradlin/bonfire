<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { resolve } from '$app/paths';
	import Icon from '$lib/Icon.svelte';
	import Markdown from '$lib/Markdown.svelte';
	import PageHeader from '$lib/PageHeader.svelte';
	import type { WikiPage } from '$lib/types/wiki';
	import { formatRelativeTime } from '$lib/utils/dateFormat';

	interface Props {
		data: { pages: WikiPage[]; index: WikiPage | null };
	}

	const { data }: Props = $props();

	const pages = $derived(
		[...data.pages]
			.filter((p) => p.slug !== 'index')
			.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
	);

	const allTags = $derived([...new Set(pages.flatMap((p) => p.tags))].sort());

	const activeTag = $derived($page.url.searchParams.get('tag'));
	let search = $state('');

	function setTag(tag: string | null) {
		// Navigate to the wiki index with an updated ?tag= query param.
		// replaceState keeps the browser history clean — tag changes are a filter toggle.
		// The path always starts with resolve('/wiki') so the rule is satisfied semantically.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(tag ? resolve('/wiki') + `?tag=${encodeURIComponent(tag)}` : resolve('/wiki'), {
			replaceState: true
		});
	}

	const filtered = $derived(
		pages.filter((p) => {
			const q = search.toLowerCase();
			const matchSearch =
				!search ||
				p.title.toLowerCase().includes(q) ||
				p.tags.some((t) => t.toLowerCase().includes(q));
			const matchTag = !activeTag || p.tags.includes(activeTag);
			return matchSearch && matchTag;
		})
	);
</script>

<div class="p-8">
	<PageHeader title="Wiki" subtitle="LLM-maintained synthesis of the knowledge base" />

	{#if data.index}
		<div class="mb-8 rounded-xl border border-border bg-bg-card px-6 py-5">
			<Markdown text={data.index.content} />
		</div>
	{/if}

	<div class="mb-5 flex items-center gap-3">
		<div class="relative max-w-sm flex-1">
			<input
				type="text"
				placeholder="Search pages..."
				bind:value={search}
				class="w-full rounded-lg border border-border bg-bg-input px-3 py-2 pl-8 text-sm text-text placeholder:text-text-muted focus:ring-1 focus:ring-accent focus:outline-none"
			/>
			<span class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-muted">
				<Icon name="search" size={14} />
			</span>
		</div>

		{#if allTags.length > 0}
			<div class="flex flex-wrap gap-1.5">
				<button
					onclick={() => setTag(null)}
					class={[
						'rounded-md px-2.5 py-1 text-xs transition-colors',
						activeTag === null
							? 'bg-accent text-white'
							: 'border border-border bg-bg-input text-text-muted hover:text-text'
					].join(' ')}
				>
					All
				</button>
				{#each allTags as tag (tag)}
					<button
						onclick={() => setTag(activeTag === tag ? null : tag)}
						class={[
							'rounded-md px-2.5 py-1 text-xs transition-colors',
							activeTag === tag
								? 'bg-accent text-white'
								: 'border border-border bg-bg-input text-text-muted hover:text-text'
						].join(' ')}
					>
						{tag}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	{#if pages.length === 0}
		<div class="flex flex-col items-center justify-center py-24 text-center">
			<div class="mb-4 rounded-xl border border-border bg-bg-input p-4 text-text-muted">
				<Icon name="book" size={28} />
			</div>
			<p class="mb-1 text-sm font-medium text-text">The wiki is empty</p>
			<p class="max-w-xs text-xs text-text-muted">
				Use the <code class="rounded bg-bg-input px-1 py-0.5 font-mono">create_wiki_page</code> MCP tool
				to synthesize your first page from source documents.
			</p>
		</div>
	{:else if filtered.length === 0}
		<p class="text-sm text-text-muted">No pages match your filter.</p>
	{:else}
		<div class="divide-y divide-border rounded-xl border border-border bg-bg-card">
			{#each filtered as page (page.slug)}
				<a
					href={resolve(`/wiki/${page.slug}`)}
					class="group flex items-start justify-between gap-4 px-5 py-4 no-underline transition-colors hover:bg-bg-hover"
				>
					<div class="min-w-0">
						<div class="mb-1 flex items-center gap-2">
							<span
								class="truncate text-sm font-medium text-text transition-colors group-hover:text-accent"
							>
								{page.title}
							</span>
						</div>
						{#if page.tags.length > 0}
							<div class="flex flex-wrap gap-1">
								{#each page.tags as tag (tag)}
									<span
										class="rounded border border-border bg-bg-input px-1.5 py-0.5 text-[11px] text-text-muted"
									>
										{tag}
									</span>
								{/each}
							</div>
						{/if}
					</div>
					<span class="mt-0.5 shrink-0 text-[11px] whitespace-nowrap text-text-muted">
						{formatRelativeTime(page.updatedAt)}
					</span>
				</a>
			{/each}
		</div>
	{/if}
</div>
