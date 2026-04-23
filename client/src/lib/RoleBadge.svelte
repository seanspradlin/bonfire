<script lang="ts">
	const { role, inline = false }: { role: string; inline?: boolean } = $props();

	const roleKey = $derived(role.toLowerCase());
	const roleLabel = $derived(role[0].toUpperCase() + role.slice(1).toLowerCase());
	const colorVar = $derived(
		roleKey === 'admin'
			? 'var(--role-admin)'
			: roleKey === 'editor'
				? 'var(--role-editor)'
				: 'var(--role-viewer)'
	);
</script>

{#if inline}
	<span
		style="--role-color: {colorVar}"
		class="inline-flex items-center text-xs font-medium text-[var(--role-color)]"
	>
		{roleLabel}
	</span>
{:else}
	<span
		style="--role-color: {colorVar}"
		class="inline-flex items-center rounded-[20px] border border-[color-mix(in_oklch,var(--role-color)_30%,transparent)] bg-[color-mix(in_oklch,var(--role-color)_12%,transparent)] px-[9px] py-[3px] text-[11px] font-semibold text-[var(--role-color)]"
	>
		{roleLabel}
	</span>
{/if}
