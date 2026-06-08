<script lang="ts">
	import { untrack } from 'svelte';
	import Btn from '$lib/Btn.svelte';
	import Icon from '$lib/Icon.svelte';
	import type { Document, RepoRef } from '$lib/types/document';

	interface Props {
		isOpen: boolean;
		document: Document | null;
		onClose: () => void;
		onSave: (updates: {
			title: string;
			content: string;
			tags: string[];
			repos: RepoRef[];
			date: string;
		}) => Promise<void>;
	}

	let { isOpen = false, document = null, onClose, onSave }: Props = $props();

	let dialogEl = $state<HTMLDialogElement | null>(null);
	let isLoading = $state(false);
	let error = $state('');
	let triggerEl: Element | null = null;

	let title = $state('');
	let tagsRaw = $state('');
	let reposRaw = $state('');
	let content = $state('');
	let date = $state('');

	/**
	 * Serialise repo references to one line each: `url` or `url | path1, path2`.
	 * The `ref`/`note` fields aren't shown in this minimal editor but are
	 * preserved across edits (see parseRepos).
	 */
	function serializeRepos(repos: RepoRef[]): string {
		return repos
			.map((r) => (r.paths && r.paths.length > 0 ? `${r.url} | ${r.paths.join(', ')}` : r.url))
			.join('\n');
	}

	/**
	 * Parse the textarea back into RepoRef[]. Each non-empty line is
	 * `url` or `url | path1, path2`. Any `ref`/`note` previously set on a repo
	 * with the same url (e.g. via MCP) is preserved so the UI never silently
	 * drops it.
	 */
	function parseRepos(raw: string, existing: RepoRef[]): RepoRef[] {
		const byUrl = new Map(existing.map((r) => [r.url, r]));
		return raw
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const [urlPart, pathsPart] = line.split('|', 2);
				const url = urlPart.trim();
				const paths = pathsPart
					? pathsPart
							.split(',')
							.map((p) => p.trim())
							.filter(Boolean)
					: [];
				const prev = byUrl.get(url);
				const repo: RepoRef = { url };
				if (paths.length > 0) repo.paths = paths;
				if (prev?.ref) repo.ref = prev.ref;
				if (prev?.note) repo.note = prev.note;
				return repo;
			})
			.filter((r) => r.url.length > 0);
	}

	$effect(() => {
		if (!dialogEl) return;
		if (isOpen && document) {
			untrack(() => {
				title = document!.title;
				tagsRaw = document!.tags.join(', ');
				reposRaw = serializeRepos(document!.repos ?? []);
				content = document!.content;
				date = document!.date ?? '';
				error = '';
			});
			triggerEl = globalThis.document?.activeElement ?? null;
			dialogEl.showModal();
		} else {
			dialogEl.close();
		}
	});

	async function handleSave() {
		const trimmedTitle = title.trim();
		const trimmedContent = content.trim();
		if (!trimmedTitle) {
			error = 'Title is required.';
			return;
		}
		if (!trimmedContent) {
			error = 'Content is required.';
			return;
		}

		const tags = tagsRaw
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);

		const repos = parseRepos(reposRaw, document?.repos ?? []);

		isLoading = true;
		error = '';
		try {
			await onSave({
				title: trimmedTitle,
				content: trimmedContent,
				tags,
				repos,
				date: date.trim()
			});
			handleClose();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to save document';
		} finally {
			isLoading = false;
		}
	}

	function handleClose() {
		if (isLoading) return;
		error = '';
		onClose();
		(triggerEl as HTMLElement | null)?.focus();
	}

	function handleDialogClose() {
		if (!isLoading) {
			error = '';
			onClose();
			(triggerEl as HTMLElement | null)?.focus();
		}
	}
</script>

<dialog
	bind:this={dialogEl}
	onclose={handleDialogClose}
	oncancel={(e) => {
		if (isLoading) e.preventDefault();
	}}
	aria-labelledby="edit-doc-title"
	class="m-auto w-[90%] max-w-[640px] overflow-hidden rounded-2xl border border-border bg-bg-card p-0 shadow-[0_24px_64px_rgba(0,0,0,0.25)] backdrop:bg-black/45 backdrop:backdrop-blur-[3px]"
>
	<div class="px-7 pt-6 pb-6">
		<div class="mb-5 flex items-center justify-between">
			<h2 id="edit-doc-title" class="text-lg font-bold tracking-[-0.02em] text-text">
				Edit Document
			</h2>
			<button
				onclick={handleClose}
				class="cursor-pointer rounded-md border-none bg-transparent p-0.5 text-text-faint"
				aria-label="Close dialog"
			>
				<Icon name="x" size={16} />
			</button>
		</div>

		<div class="flex flex-col gap-4">
			<div>
				<label
					class="mb-1.5 block text-[13px] font-medium text-text-muted"
					for="edit-doc-title-input"
				>
					Title
				</label>
				<input
					id="edit-doc-title-input"
					bind:value={title}
					placeholder="Document title"
					class="h-[38px] text-[13px]"
					disabled={isLoading}
				/>
			</div>

			<div>
				<label class="mb-1.5 block text-[13px] font-medium text-text-muted" for="edit-doc-tags">
					Tags <span class="font-normal text-text-faint">(comma-separated)</span>
				</label>
				<input
					id="edit-doc-tags"
					bind:value={tagsRaw}
					placeholder="e.g. operations, training, safety"
					class="h-[38px] text-[13px]"
					disabled={isLoading}
				/>
			</div>

			<div>
				<label class="mb-1.5 block text-[13px] font-medium text-text-muted" for="edit-doc-repos">
					Repositories <span class="font-normal text-text-faint"
						>(one per line — <code>owner/repo</code> or
						<code>owner/repo | path1, path2</code>)</span
					>
				</label>
				<textarea
					id="edit-doc-repos"
					bind:value={reposRaw}
					placeholder="e.g. org/backend | src/auth/guards.ts, src/db/schema.ts&#10;org/frontend"
					rows={3}
					class="resize-y font-mono text-[13px] leading-relaxed"
					disabled={isLoading}
				></textarea>
			</div>

			<div>
				<label class="mb-1.5 block text-[13px] font-medium text-text-muted" for="edit-doc-date">
					Document date <span class="font-normal text-text-faint"
						>(optional — when the content is from)</span
					>
				</label>
				<input
					id="edit-doc-date"
					type="date"
					bind:value={date}
					class="h-[38px] text-[13px]"
					disabled={isLoading}
				/>
			</div>

			<div>
				<label class="mb-1.5 block text-[13px] font-medium text-text-muted" for="edit-doc-content">
					Content
				</label>
				<textarea
					id="edit-doc-content"
					bind:value={content}
					placeholder="Document content…"
					rows={12}
					class="resize-y text-[13px] leading-relaxed"
					disabled={isLoading}
				></textarea>
			</div>
		</div>

		{#if error}
			<div
				class="mt-4 rounded-lg border border-[color-mix(in_oklch,var(--danger)_35%,transparent)] bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-3 py-[10px] text-[13px] text-danger"
			>
				{error}
			</div>
		{/if}

		<div class="mt-5 flex justify-end gap-2">
			<button
				onclick={handleClose}
				disabled={isLoading}
				class="cursor-pointer rounded-[9px] border-[1.5px] border-border bg-bg px-5 py-[9px] text-sm font-medium text-text-muted transition-all duration-200"
			>
				Cancel
			</button>
			<Btn onclick={handleSave} loading={isLoading}>Save Changes</Btn>
		</div>
	</div>
</dialog>
