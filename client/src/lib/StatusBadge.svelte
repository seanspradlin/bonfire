<script lang="ts">
	const { status }: { status: string } = $props();

	const colorVar = $derived((): string => {
		if (status === 'Active' || status === 'Indexed') return 'var(--success)';
		if (status === 'Pending' || status === 'Processing') return 'var(--warning)';
		return 'var(--text-faint)';
	});

	const label = $derived((): string => {
		if (status === 'Processing') return 'Processing…';
		return status;
	});

	const pulsing = $derived(status === 'Processing');
</script>

<span
	style="--status-color: {colorVar()}"
	class="inline-flex items-center gap-[5px] rounded-[20px] border border-[color-mix(in_oklch,var(--status-color)_30%,transparent)] bg-[color-mix(in_oklch,var(--status-color)_12%,transparent)] px-[9px] py-[3px] text-[11px] font-semibold whitespace-nowrap text-[var(--status-color)]"
>
	<span
		class={[
			'size-[5px] shrink-0 rounded-full bg-[var(--status-color)]',
			pulsing ? 'animate-pulse' : ''
		].join(' ')}
	></span>
	{label()}
</span>
