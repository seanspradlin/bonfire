<script lang="ts">
	import { untrack } from 'svelte';
	import Btn from '$lib/Btn.svelte';
	import Icon from '$lib/Icon.svelte';

	interface Props {
		isOpen: boolean;
		title: string;
		message: string;
		confirmLabel?: string;
		onClose: () => void;
		onConfirm: () => Promise<void>;
	}

	let {
		isOpen = false,
		title,
		message,
		confirmLabel = 'Confirm',
		onClose,
		onConfirm
	}: Props = $props();

	let dialogEl = $state<HTMLDialogElement | null>(null);
	let isLoading = $state(false);
	let error = $state('');
	let triggerEl: Element | null = null;

	$effect(() => {
		if (!dialogEl) return;
		if (isOpen) {
			untrack(() => { error = ''; });
			triggerEl = document.activeElement;
			dialogEl.showModal();
		} else {
			dialogEl.close();
		}
	});

	async function handleConfirm() {
		isLoading = true;
		error = '';
		try {
			await onConfirm();
			handleClose();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Something went wrong';
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
	oncancel={(e) => { if (isLoading) e.preventDefault(); }}
	aria-labelledby="confirm-dialog-title"
	class="m-auto w-[90%] max-w-[400px] overflow-hidden rounded-2xl border border-border bg-bg-card p-0 shadow-[0_24px_64px_rgba(0,0,0,0.25)] backdrop:bg-black/45 backdrop:backdrop-blur-[3px]"
>
	<div class="px-7 pt-6 pb-6">
		<div class="mb-4 flex items-center justify-between">
			<h2 id="confirm-dialog-title" class="text-lg font-bold tracking-[-0.02em] text-text">
				{title}
			</h2>
			<button
				onclick={handleClose}
				class="cursor-pointer rounded-md border-none bg-transparent p-0.5 text-text-faint"
				aria-label="Close dialog"
			>
				<Icon name="x" size={16} />
			</button>
		</div>

		<p class="mb-5 text-sm leading-relaxed text-text-muted">{message}</p>

		{#if error}
			<div
				class="mb-4 rounded-lg border border-[color-mix(in_oklch,var(--danger)_35%,transparent)] bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-3 py-[10px] text-[13px] text-danger"
			>
				{error}
			</div>
		{/if}

		<div class="flex justify-end gap-2">
			<button
				onclick={handleClose}
				disabled={isLoading}
				class="cursor-pointer rounded-[9px] border-[1.5px] border-border bg-bg px-5 py-[9px] text-sm font-medium text-text-muted transition-all duration-200"
			>
				Cancel
			</button>
			<Btn danger onclick={handleConfirm} loading={isLoading}>{confirmLabel}</Btn>
		</div>
	</div>
</dialog>
