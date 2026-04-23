<script lang="ts">
	import PageHeader from '$lib/PageHeader.svelte';
	import Icon from '$lib/Icon.svelte';
	import IconBtn from '$lib/IconBtn.svelte';

	type UploadStatus = 'uploading' | 'success' | 'error';
	type FileKind = 'pdf' | 'image' | 'text';

	type UploadEntry = {
		id: number;
		name: string;
		kind: FileKind;
		size: string;
		status: UploadStatus;
		error?: string;
	};

	const TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'text/x-markdown']);
	// Mirrors the server's ALLOWED_IMAGE_MEDIA_TYPES — keep in sync to avoid
	// queuing uploads the server will reject with 415.
	const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

	let dragging = $state(false);
	let uploads = $state<UploadEntry[]>([]);
	let nextId = $state(0);
	let fileInput: HTMLInputElement;

	function formatSize(bytes: number): string {
		if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
		return (bytes / 1024 / 1024).toFixed(1) + ' MB';
	}

	function fileKind(file: File): FileKind {
		if (IMAGE_MIME_TYPES.has(file.type)) return 'image';
		if (TEXT_MIME_TYPES.has(file.type)) return 'text';
		return 'pdf';
	}

	function endpoint(kind: FileKind): string {
		if (kind === 'image') return '/api/upload/image';
		if (kind === 'text') return '/api/upload/text';
		return '/api/upload/pdf';
	}

	function isAccepted(file: File): boolean {
		return (
			file.type === 'application/pdf' ||
			IMAGE_MIME_TYPES.has(file.type) ||
			TEXT_MIME_TYPES.has(file.type)
		);
	}

	async function uploadFile(entry: UploadEntry, file: File) {
		const body = new FormData();
		body.append('file', file);

		try {
			const res = await fetch(endpoint(entry.kind), { method: 'POST', body });
			if (!res.ok) {
				const json = await res.json().catch(() => null);
				const message = json?.error ?? 'Upload failed';
				uploads = uploads.map((u) =>
					u.id === entry.id ? { ...u, status: 'error', error: message } : u
				);
			} else {
				uploads = uploads.map((u) => (u.id === entry.id ? { ...u, status: 'success' } : u));
			}
		} catch {
			uploads = uploads.map((u) =>
				u.id === entry.id ? { ...u, status: 'error', error: 'Network error — please try again' } : u
			);
		}
	}

	function addFiles(files: File[]) {
		const accepted = files.filter(isAccepted);

		const newEntries: UploadEntry[] = accepted.map((f) => ({
			id: nextId++,
			name: f.name,
			kind: fileKind(f),
			size: formatSize(f.size),
			status: 'uploading'
		}));

		uploads = [...newEntries, ...uploads];

		for (let i = 0; i < accepted.length; i++) {
			uploadFile(newEntries[i], accepted[i]);
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		if (e.dataTransfer?.files) addFiles(Array.from(e.dataTransfer.files));
	}

	function handleFileInput(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files) addFiles(Array.from(input.files));
		input.value = '';
	}

	function dismiss(id: number) {
		uploads = uploads.filter((u) => u.id !== id);
	}

	const kindIcon: Record<FileKind, string> = { pdf: 'pdf', image: 'image', text: 'file' };
</script>

<div class="max-w-[900px] p-9">
	<PageHeader
		title="Upload Files"
		subtitle="Add PDFs, images, and text files to the knowledge base for RAG indexing"
	/>

	<!-- Drop zone -->
	<div
		ondragover={(e) => {
			e.preventDefault();
			dragging = true;
		}}
		ondragleave={() => (dragging = false)}
		ondrop={handleDrop}
		onclick={() => fileInput.click()}
		role="button"
		tabindex="0"
		aria-label="Upload files — drop or click to browse"
		onkeydown={(e) => e.key === 'Enter' && fileInput.click()}
		class={[
			'cursor-pointer rounded-2xl border-2 p-10 text-center transition-all duration-200',
			dragging
				? 'border-accent bg-accent-bg shadow-[0_0_0_4px_color-mix(in_oklch,var(--accent)_15%,transparent)]'
				: 'border-border bg-bg-card'
		].join(' ')}
	>
		<input
			bind:this={fileInput}
			type="file"
			multiple
			accept=".pdf,.md,.txt,image/*"
			onchange={handleFileInput}
			class="hidden"
		/>
		<div
			class="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl border-[1.5px] border-[color-mix(in_oklch,var(--accent)_40%,transparent)] bg-accent-bg text-accent"
		>
			<Icon name="upload" size={22} />
		</div>
		<div class="mb-1.5 text-[15px] font-medium">
			{dragging ? 'Drop files to upload' : 'Drag & drop files here'}
		</div>
		<div class="mb-4 text-[13px] text-text-muted">or click to browse your computer</div>
		<div class="inline-flex gap-2">
			{#each ['PDF', 'PNG', 'JPG', 'WEBP', 'MD', 'TXT'] as ext (ext)}
				<span
					class="rounded-md border border-border bg-bg px-2 py-[3px] text-[11px] font-medium text-text-faint"
				>
					{ext}
				</span>
			{/each}
		</div>
	</div>

	<!-- Upload results -->
	{#if uploads.length > 0}
		<div class="mt-6 flex flex-col gap-2">
			{#each uploads as entry (entry.id)}
				<div
					class="flex items-center gap-3 rounded-[10px] border-[1.5px] border-border bg-bg-card px-4 py-3 shadow-[var(--shadow-card)]"
				>
					<div
						class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-bg text-accent"
					>
						<Icon name={kindIcon[entry.kind]} size={16} />
					</div>

					<div class="min-w-0 flex-1">
						<div class="overflow-hidden text-sm font-medium text-ellipsis whitespace-nowrap">
							{entry.name}
						</div>
						<div class="text-xs text-text-muted">{entry.size}</div>
					</div>

					{#if entry.status === 'uploading'}
						<span
							class="inline-block size-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
						></span>
					{:else if entry.status === 'success'}
						<span class="flex items-center gap-1.5 text-[12px] font-medium text-success">
							<Icon name="check" size={13} />
							Uploaded
						</span>
					{:else}
						<span class="max-w-[200px] truncate text-[12px] text-danger" title={entry.error}>
							{entry.error ?? 'Upload failed'}
						</span>
					{/if}

					{#if entry.status !== 'uploading'}
						<IconBtn title="Dismiss" onclick={() => dismiss(entry.id)}>
							<Icon name="x" size={13} />
						</IconBtn>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
