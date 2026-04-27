<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import ConfirmDialog from '$lib/ConfirmDialog.svelte';
	import EditDocumentModal from '$lib/EditDocumentModal.svelte';
	import Icon from '$lib/Icon.svelte';
	import IconBtn from '$lib/IconBtn.svelte';
	import PageHeader from '$lib/PageHeader.svelte';
	import type { Document } from '$lib/types/document';
	import Markdown from '$lib/Markdown.svelte';
	import { formatRelativeTime } from '$lib/utils/dateFormat';

	interface PageData {
		documents: Document[];
	}

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	const documents = $derived(data.documents);

	let search = $state('');
	let activeTag = $state<string | null>(null);
	let tagSearch = $state('');
	let tagDropOpen = $state(false);
	let selected = $state<Document | null>(null);
	let isEditModalOpen = $state(false);
	let isDeleteConfirmOpen = $state(false);

	let tagDropEl = $state<HTMLDivElement | null>(null);

	const allTags = $derived([...new Set(documents.flatMap((d) => d.tags))].sort());
	const filteredTags = $derived(allTags.filter((t) => t.toLowerCase().includes(tagSearch.toLowerCase())));

	const sorted = $derived(
		[...documents]
			.filter((d) => {
				const q = search.toLowerCase();
				const matchSearch =
					!search ||
					d.title.toLowerCase().includes(q) ||
					d.content.toLowerCase().includes(q) ||
					d.tags.some((t) => t.toLowerCase().includes(q));
				const matchTag = !activeTag || d.tags.includes(activeTag);
				return matchSearch && matchTag;
			})
			.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
	);

	// Keep selected in sync after list refreshes (e.g. after edit/delete)
	const selectedDoc = $derived(selected ? (documents.find((d) => d.id === selected!.id) ?? null) : null);

	$effect(() => {
		function handleClick(e: MouseEvent) {
			if (tagDropEl && !tagDropEl.contains(e.target as Node)) {
				tagDropOpen = false;
			}
		}
		document.addEventListener('mousedown', handleClick);
		return () => document.removeEventListener('mousedown', handleClick);
	});

	async function handleDelete() {
		if (!selectedDoc) return;
		const res = await fetch(`/api/documents/${selectedDoc.id}`, { method: 'DELETE' });
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new Error(body.error ?? 'Failed to delete document');
		}
		selected = null;
		await invalidateAll();
	}

	async function handleSaveEdit(updates: { title: string; content: string; tags: string[]; date: string }) {
		if (!selectedDoc) return;
		const res = await fetch(`/api/documents/${selectedDoc.id}`, {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title: updates.title,
				content: updates.content,
				tags: updates.tags,
				...(updates.date ? { date: updates.date } : {})
			})
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}));
			throw new Error(body.error ?? 'Failed to update document');
		}
		await invalidateAll();
	}

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'long',
			day: 'numeric',
			year: 'numeric'
		});
	}
</script>

<div class="flex h-screen overflow-hidden">
	<!-- List pane -->
	<div
		class={[
			'flex flex-col overflow-hidden',
			selectedDoc
				? 'w-[380px] shrink-0 border-r border-border'
				: 'mx-auto w-full max-w-[900px] px-9'
		].join(' ')}
	>
		<!-- Header -->
		<div class={['shrink-0 pt-7', selectedDoc ? 'px-6' : 'px-0'].join(' ')}>
			<PageHeader title="Documents" subtitle="All indexed documents, sorted by last update" />

			<!-- Search + tag filter -->
			<div class="mb-4 flex flex-wrap gap-[10px]">
				<div class="relative min-w-[220px]" style="flex: 2 1 220px">
					<div class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-faint">
						<Icon name="search" size={14} />
					</div>
					<input
						placeholder="Search documents…"
						bind:value={search}
						class="h-[38px] pl-9 text-[13px]"
					/>
				</div>

				<!-- Tag combobox -->
				<div bind:this={tagDropEl} class="relative min-w-[160px]" style="flex: 1 1 160px">
					<div class="flex gap-1">
						<button
							type="button"
							onclick={() => (tagDropOpen = !tagDropOpen)}
							class={[
								'flex h-[38px] flex-1 items-center justify-between gap-1 rounded-lg border px-3 text-[13px] transition-all duration-150',
								tagDropOpen
									? 'border-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent)_15%,transparent)]'
									: 'border-border',
								activeTag ? 'bg-bg-input text-text' : 'bg-bg-input text-text-faint'
							].join(' ')}
						>
							<span class="overflow-hidden text-ellipsis whitespace-nowrap">
								{activeTag ? `Tag: ${activeTag}` : 'Filter by tag…'}
							</span>
							<Icon name="chevronDown" size={14} />
						</button>
						{#if activeTag}
							<button
								type="button"
								onclick={() => { activeTag = null; tagSearch = ''; }}
								class="flex h-[38px] shrink-0 items-center rounded-lg border border-border bg-bg-input px-2 text-text-faint transition-all duration-150 hover:text-text"
								aria-label="Clear tag filter"
							>
								<Icon name="x" size={12} />
							</button>
						{/if}
					</div>

					{#if tagDropOpen}
						<div
							class="absolute top-[calc(100%+4px)] left-0 right-0 z-10 overflow-hidden rounded-[10px] border border-border bg-bg-card shadow-[var(--shadow)]"
						>
							<div class="px-2 pt-2 pb-1">
								<!-- svelte-ignore a11y_autofocus -->
								<input
									autofocus
									placeholder="Search tags…"
									bind:value={tagSearch}
									onclick={(e) => e.stopPropagation()}
									class="h-8 rounded-md text-[12px]"
								/>
							</div>
							<div class="max-h-[200px] overflow-auto px-2 pb-2">
								{#if filteredTags.length === 0}
									<div class="px-2 py-[10px] text-[12px] text-text-faint">No tags found.</div>
								{/if}
								{#each filteredTags as tag (tag)}
									<button
										type="button"
										onclick={() => { activeTag = tag; tagDropOpen = false; tagSearch = ''; }}
										class={[
											'flex w-full cursor-pointer items-center justify-between rounded-[7px] border-none px-[10px] py-2 text-left text-[13px] transition-colors duration-100',
											activeTag === tag
												? 'bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-accent'
												: 'bg-transparent text-text hover:bg-bg-hover'
										].join(' ')}
									>
										{tag}
										{#if activeTag === tag}
											<Icon name="check" size={12} />
										{/if}
									</button>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Document list -->
		<div class={['flex-1 overflow-auto pb-6', selectedDoc ? 'px-6' : 'px-0'].join(' ')}>
			{#if sorted.length === 0}
				<div class="pt-10 text-center text-sm text-text-faint">No documents found.</div>
			{/if}
			{#each sorted as doc (doc.id)}
				{@const isSelected = selectedDoc?.id === doc.id}
				<button
					type="button"
					onclick={() => (selected = isSelected ? null : doc)}
					class={[
						'mb-2 w-full cursor-pointer rounded-xl border-[1.5px] p-4 text-left shadow-[var(--shadow-card)] transition-all duration-150',
						isSelected
							? 'border-accent bg-[color-mix(in_srgb,var(--accent)_6%,var(--bg-card))]'
							: 'border-border bg-bg-card hover:border-text-faint'
					].join(' ')}
				>
					<div class="mb-1.5 flex items-start justify-between gap-2">
						<div class="text-sm font-semibold leading-snug text-text">{doc.title}</div>
						<div class="shrink-0 text-[11px] text-text-faint">{formatRelativeTime(doc.updatedAt)}</div>
					</div>
					<p
						class="mb-[10px] overflow-hidden text-[12px] leading-relaxed text-text-muted"
						style="-webkit-line-clamp:2; -webkit-box-orient:vertical; display:-webkit-box"
					>
						{doc.content}
					</p>
					<div class="flex flex-wrap gap-[5px]">
						{#each doc.tags as tag (tag)}
							<span
								class="rounded-full border border-[color-mix(in_srgb,var(--accent)_20%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-2 py-0.5 text-[10px] font-semibold text-accent"
							>
								{tag}
							</span>
						{/each}
					</div>
				</button>
			{/each}
		</div>
	</div>

	<!-- Detail pane -->
	{#if selectedDoc}
		<div class="flex-1 overflow-auto bg-bg p-8">
			<div class="max-w-[620px]">
				<!-- Actions row -->
				<div class="mb-5 flex items-center justify-between">
					<button
						onclick={() => { selected = null; }}
						class="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-transparent px-3 py-1.5 text-[12px] text-text-muted transition-all duration-150 hover:bg-bg-hover"
					>
						<Icon name="x" size={12} />
						Close
					</button>
					<div class="flex items-center gap-1">
						<IconBtn title="Edit document" onclick={() => (isEditModalOpen = true)}>
							<Icon name="pencil" size={13} />
						</IconBtn>
						<IconBtn danger title="Delete document" onclick={() => (isDeleteConfirmOpen = true)}>
							<Icon name="trash" size={13} />
						</IconBtn>
					</div>
				</div>

				<!-- Title -->
				<h1
					class="mb-2 text-[24px] font-bold leading-tight tracking-[-0.02em] text-text"
					style="font-family:'Tenon','DM Sans',sans-serif"
				>
					{selectedDoc.title}
				</h1>

				<!-- Metadata -->
				<div class="mb-4 flex flex-wrap gap-4 text-[12px] text-text-muted">
					<span>Updated {formatDate(selectedDoc.updatedAt)}</span>
					{#if selectedDoc.date}
						<span>·</span>
						<span>Dated {formatDate(selectedDoc.date)}</span>
					{/if}
				</div>

				<!-- Tags -->
				{#if selectedDoc.tags.length > 0}
					<div class="mb-6 flex flex-wrap gap-1.5">
						{#each selectedDoc.tags as tag (tag)}
							<span
								class="rounded-full border border-[color-mix(in_srgb,var(--accent)_20%,transparent)] bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-3 py-1 text-[12px] font-semibold text-accent"
							>
								{tag}
							</span>
						{/each}
					</div>
				{/if}

				<!-- Content card -->
				<div
					class="rounded-xl border-[1.5px] border-border bg-bg-card p-6 shadow-[var(--shadow-card)]"
				>
					<div
						class="mb-3 text-[11px] font-bold tracking-[0.07em] text-text-faint uppercase"
					>
						Content
					</div>
					<div class="text-text-muted">
						<Markdown text={selectedDoc.content} />
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<EditDocumentModal
	isOpen={isEditModalOpen}
	document={selectedDoc}
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
