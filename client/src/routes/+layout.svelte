<script lang="ts">
	import './layout.css';
	import type { Snippet } from 'svelte';
	import { tweaks } from '$lib/stores';

	const { children }: { children: Snippet } = $props();

	const themeKey = $derived(
		$tweaks.theme === 'dark'
			? 'dark_pro'
			: $tweaks.variant === 'ember'
				? 'light_ember'
				: 'light_clean'
	);
</script>

<svelte:head>
	<title>Bonfire — Knowledge Base</title>
</svelte:head>

<div
	data-theme={themeKey}
	class="min-h-screen bg-bg text-text transition-colors duration-300"
	style="font-family:'Tenon','DM Sans',sans-serif"
>
	{@render children()}
</div>
