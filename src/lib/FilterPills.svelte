<script lang="ts">
	const {
		options,
		active,
		onChange
	}: { options: string[]; active: string; onChange: (v: string) => void } = $props();
</script>

<div class="flex flex-wrap gap-[6px]">
	{#each options as option (option)}
		<button
			onclick={() => onChange(option)}
			class={[
				'rounded-[20px] border px-3 py-[5px] text-xs font-medium transition-all duration-150',
				active === option
					? 'border-accent bg-accent-bg text-accent'
					: 'border-border bg-transparent text-text-muted hover:border-accent hover:text-accent'
			].join(' ')}
		>
			{option}
		</button>
	{/each}
</div>
