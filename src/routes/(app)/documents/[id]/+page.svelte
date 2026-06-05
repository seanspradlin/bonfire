<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import ConfirmDialog from '$lib/ConfirmDialog.svelte';
	import EditDocumentModal from '$lib/EditDocumentModal.svelte';
	import Icon from '$lib/Icon.svelte';
	import IconBtn from '$lib/IconBtn.svelte';
	import Markdown from '$lib/Markdown.svelte';
	import type { Document, RepoRef } from '$lib/types/document';
	import { formatRelativeTime } from '$lib/utils/dateFormat';

	interface Props {
		data: { document: Document };
	}

	let { data }: Props = $props();
	const doc = $derived(data.document);

	let isEditModalOpen = $state(false);
	let isDeleteConfirmOpen = $state(false);

	/**
	 * Resolve a repo reference to a browsable URL. Full URLs are used as-is;
	 * `owner/repo` shorthand is expanded to a GitHub URL for convenience.
	 */
	function repoHref(url: string): string {
		if (/^https?:\/\//i.test(url)) return url;
		return `https://github.com/${url}`;
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'long',
			day: 'numeric',
			year: 'numeric'
		});
	}

	async function handleDelete() {
		const res = await fetch(`/api/documents/${doc.id}`, { method: 'DELETE' });
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new Error(body.error ?? 'Failed to delete document');
		}
		goto(resolve('/documents'));
	}

	async function handleSaveEdit(updates: {
		title: string;
		content: string;
		tags: string[];
		repos: RepoRef[];
		date: string;
	}) {
		const res = await fetch(`/api/documents/${doc.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title: updates.title,
				content: updates.content,
				tags: updates.tags,
				repos: updates.repos,
				...(updates.date ? { date: updates.date } : {})
			})
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new Error(body.error ?? 'Failed to update document');
		}
		await invalidateAll();
	}
</script>

<div class="mx-auto max-w-3xl px-8 py-8">
	<div class="mb-5 flex items-center justify-between">
		<a
			href={resolve('/documents')}
			class="inline-flex items-center gap-1 text-xs text-text-muted no-underline transition-colors hover:text-text"
		>
			<span style="display:inline-block;transform:rotate(90deg)"
				><Icon name="chevronDown" size={12} /></span
			>
			Documents
		</a>
		<div class="flex items-center gap-1">
			<IconBtn title="Edit document" onclick={() => (isEditModalOpen = true)}>
				<Icon name="pencil" size={13} />
			</IconBtn>
			<IconBtn danger title="Delete document" onclick={() => (isDeleteConfirmOpen = true)}>
				<Icon name="trash" size={13} />
			</IconBtn>
		</div>
	</div>

	<h1
		class="mb-2 text-[28px] font-semibold tracking-[-0.02em] text-text"
		style="font-family:'Tenon','DM Sans',sans-serif"
	>
		{doc.title}
	</h1>

	<div class="mb-4 flex flex-wrap gap-4 text-xs text-text-muted">
		<span>Updated {formatRelativeTime(doc.updatedAt)}</span>
		{#if doc.date}
			<span class="text-border">·</span>
			<span>Dated {formatDate(doc.date)}</span>
		{/if}
	</div>

	{#if doc.tags.length > 0}
		<div class="mb-6 flex flex-wrap gap-1.5">
			{#each doc.tags as tag (tag)}
				<span
					class="rounded-full border border-[color-mix(in_srgb,var(--accent)_20%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-3 py-1 text-[12px] font-semibold text-accent"
				>
					{tag}
				</span>
			{/each}
		</div>
	{/if}

	{#if doc.repos?.length > 0}
		<div class="mb-6 flex flex-col gap-2">
			<span class="text-[12px] font-semibold tracking-wide text-text-muted uppercase">
				Repositories
			</span>
			{#each doc.repos as repo (repo.url)}
				<div class="rounded-lg border border-border bg-bg-card px-3 py-2 text-[13px]">
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<a
						href={repoHref(repo.url)}
						target="_blank"
						rel="noreferrer noopener"
						class="font-medium text-accent no-underline hover:underline"
					>
						{repo.url}
					</a>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{#if repo.ref}
						<span class="ml-2 text-text-faint">@{repo.ref}</span>
					{/if}
					{#if repo.paths?.length}
						<div class="mt-1 flex flex-wrap gap-1.5">
							{#each repo.paths as path (path)}
								<code
									class="rounded border border-border bg-bg px-1.5 py-0.5 text-[12px] text-text-muted"
								>
									{path}
								</code>
							{/each}
						</div>
					{/if}
					{#if repo.note}
						<p class="mt-1 text-[12px] text-text-faint">{repo.note}</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<div class="rounded-xl border border-border bg-bg-card px-6 py-5">
		<Markdown text={doc.content} />
	</div>
</div>

<EditDocumentModal
	isOpen={isEditModalOpen}
	document={doc}
	onClose={() => (isEditModalOpen = false)}
	onSave={handleSaveEdit}
/>

<ConfirmDialog
	isOpen={isDeleteConfirmOpen}
	title="Delete Document"
	message="This will permanently delete the document and all its indexed chunks. This action cannot be undone."
	confirmLabel="Delete"
	onClose={() => (isDeleteConfirmOpen = false)}
	onConfirm={handleDelete}
/>
