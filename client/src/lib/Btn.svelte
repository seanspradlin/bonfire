<script lang="ts">
	import type { Snippet } from 'svelte';

	const {
		full = false,
		loading = false,
		disabled = false,
		danger = false,
		type = 'button',
		onclick,
		children
	}: {
		full?: boolean;
		loading?: boolean;
		disabled?: boolean;
		danger?: boolean;
		type?: 'button' | 'submit' | 'reset';
		onclick?: () => void;
		children: Snippet;
	} = $props();
</script>

<button
	{type}
	{onclick}
	disabled={loading || disabled}
	class={[
		'flex items-center justify-center gap-2 rounded-[9px] px-5 py-[11px] text-sm font-medium transition-opacity duration-200',
		full ? 'w-full' : 'w-auto',
		loading || disabled ? 'opacity-70' : 'opacity-100',
		danger
			? 'border border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--danger)_15%,transparent)] text-danger'
			: 'border-0 bg-accent text-white'
	].join(' ')}
>
	{#if loading}
		<span
			class="inline-block size-[14px] animate-spin rounded-full border-2 border-current border-t-transparent"
		></span>
	{/if}
	{@render children()}
</button>
