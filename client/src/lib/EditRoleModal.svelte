<script lang="ts">
	import { untrack } from 'svelte';
	import Avatar from '$lib/Avatar.svelte';
	import Btn from '$lib/Btn.svelte';
	import Icon from '$lib/Icon.svelte';

	interface Props {
		isOpen: boolean;
		userName: string;
		currentRole: string;
		onClose: () => void;
		onSave: (role: string) => Promise<void>;
	}

	let { isOpen = false, userName = '', currentRole = '', onClose, onSave }: Props = $props();

	let dialogEl = $state<HTMLDialogElement | null>(null);
	let selectedRole = $state('');
	let isLoading = $state(false);
	let error = $state('');
	// Tracks the element that opened the modal so we can restore focus on close.
	let triggerEl: Element | null = null;

	const roles = [
		{
			value: 'admin',
			label: 'Admin',
			desc: 'Full access including user management',
			colorVar: 'var(--role-admin)'
		},
		{
			value: 'editor',
			label: 'Editor',
			desc: 'Can upload files and edit content',
			colorVar: 'var(--role-editor)'
		},
		{
			value: 'viewer',
			label: 'Viewer',
			desc: 'Read-only access to the knowledge base',
			colorVar: 'var(--role-viewer)'
		}
	];

	// Bridge reactive `isOpen` to the imperative native <dialog> API.
	// State resets (selectedRole, error) are wrapped in untrack() so they
	// don't create a dependency loop — they are write-only side-effects here.
	$effect(() => {
		if (!dialogEl) return;
		if (isOpen) {
			untrack(() => {
				selectedRole = currentRole.toLowerCase();
				error = '';
			});
			triggerEl = document.activeElement;
			dialogEl.showModal();
		} else {
			dialogEl.close();
		}
	});

	async function handleSave() {
		if (selectedRole === currentRole.toLowerCase()) {
			handleClose();
			return;
		}

		isLoading = true;
		error = '';

		try {
			await onSave(selectedRole);
			handleClose();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to update role';
		} finally {
			isLoading = false;
		}
	}

	function handleClose() {
		if (isLoading) return;
		error = '';
		onClose();
		// Return focus to the element that opened the dialog.
		(triggerEl as HTMLElement | null)?.focus();
	}

	// The native <dialog> fires a 'close' event on Escape — sync that back to the parent.
	function handleDialogClose() {
		if (!isLoading) {
			error = '';
			onClose();
			// Return focus to the element that opened the dialog.
			(triggerEl as HTMLElement | null)?.focus();
		}
	}
</script>

<!--
	Using native <dialog> gives us:
	  - Built-in focus trap (Tab cycles within the dialog)
	  - Escape key closes the modal automatically
	  - Correct ARIA semantics (role="dialog" + aria-modal implied)
-->
<dialog
	bind:this={dialogEl}
	onclose={handleDialogClose}
	aria-labelledby="edit-role-title"
	class="m-auto w-[90%] max-w-[400px] overflow-hidden rounded-2xl border border-border bg-bg-card p-0 shadow-[0_24px_64px_rgba(0,0,0,0.25)] backdrop:bg-black/45 backdrop:backdrop-blur-[3px]"
>
	<!-- Header -->
	<div class="px-7 pt-6">
		<div class="mb-1 flex items-center justify-between">
			<h2 id="edit-role-title" class="text-lg font-bold tracking-[-0.02em] text-text">
				Edit User Role
			</h2>
			<button
				onclick={handleClose}
				class="cursor-pointer rounded-md border-none bg-transparent p-0.5 text-text-faint"
				aria-label="Close dialog"
			>
				<Icon name="x" size={16} />
			</button>
		</div>
		<div class="mb-6 flex items-center gap-2.5">
			<Avatar name={userName} role={currentRole} size={28} />
			<span class="text-sm whitespace-nowrap text-text-muted">{userName}</span>
		</div>
		<div class="mb-2.5 text-[11px] font-bold tracking-[0.08em] text-text-faint uppercase">
			New Role
		</div>
	</div>

	<!-- Role options -->
	<div class="flex flex-col gap-2 px-7">
		{#each roles as role (role.value)}
			{@const active = selectedRole === role.value}
			<button
				onclick={() => {
					selectedRole = role.value;
				}}
				disabled={isLoading}
				style="--role-color: {role.colorVar}"
				class={[
					'flex cursor-pointer items-center gap-3.5 rounded-[10px] border-[1.5px] px-4 py-3.5 text-left transition-all duration-150',
					active
						? 'border-[var(--role-color)] bg-[color-mix(in_srgb,var(--role-color)_8%,var(--bg-card))]'
						: 'border-border bg-bg'
				].join(' ')}
			>
				<!-- Custom radio circle -->
				<div
					class={[
						'flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-all duration-150',
						active
							? 'border-[var(--role-color)] bg-[var(--role-color)]'
							: 'border-border bg-transparent'
					].join(' ')}
					aria-hidden="true"
				>
					{#if active}
						<div class="size-1.5 rounded-full bg-white"></div>
					{/if}
				</div>
				<div class="flex-1">
					<div
						class={[
							'mb-0.5 text-sm font-semibold',
							active ? 'text-[var(--role-color)]' : 'text-text'
						].join(' ')}
					>
						{role.label}
					</div>
					<div class="text-xs leading-[1.4] text-text-faint">{role.desc}</div>
				</div>
			</button>
		{/each}
	</div>

	{#if error}
		<div
			class="mx-7 mt-4 rounded-lg border border-[color-mix(in_oklch,var(--danger)_35%,transparent)] bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-3 py-[10px] text-[13px] text-danger"
		>
			{error}
		</div>
	{/if}

	<!-- Footer -->
	<div class="flex justify-end gap-2 px-7 pt-5 pb-6">
		<button
			onclick={handleClose}
			disabled={isLoading}
			class="cursor-pointer rounded-[9px] border-[1.5px] border-border bg-bg px-5 py-[9px] text-sm font-medium text-text-muted transition-all duration-200"
		>
			Cancel
		</button>
		<Btn
			onclick={handleSave}
			loading={isLoading}
			disabled={selectedRole === currentRole.toLowerCase() || isLoading}
		>
			Save
		</Btn>
	</div>
</dialog>
