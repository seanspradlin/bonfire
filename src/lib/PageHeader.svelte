<script lang="ts">
	const { title, subtitle }: { title: string; subtitle: string } = $props();
</script>

<div class="mb-7">
	<h1
		class="mb-1 text-[28px] font-semibold tracking-[-0.02em] text-text"
		style="font-family:'Tenon','DM Sans',sans-serif"
	>
		{title}
	</h1>
	<p class="text-sm text-text-muted">{subtitle}</p>
</div>
