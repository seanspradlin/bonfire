<script lang="ts">
	import type { Snippet } from 'svelte';

	const {
		danger = false,
		title = '',
		onclick,
		children
	}: {
		danger?: boolean;
		title?: string;
		onclick?: () => void;
		children: Snippet;
	} = $props();
</script>

<button
	{title}
	{onclick}
	class={[
		'flex size-7 items-center justify-center rounded-[7px] border border-transparent transition-all duration-150',
		danger
			? 'text-text-faint hover:border-[color-mix(in_oklch,var(--danger)_40%,transparent)] hover:bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] hover:text-danger'
			: 'text-text-faint hover:border-border hover:bg-[color-mix(in_oklch,var(--text-faint)_10%,transparent)] hover:text-text-faint'
	].join(' ')}
>
	{@render children()}
</button>
