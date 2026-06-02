<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	// Always redirect to /chat — the (app) layout's server load will redirect
	// unauthenticated users to /login before they ever see this page.
	onMount(() => {
		goto(resolve('/chat'));
	});
</script>
