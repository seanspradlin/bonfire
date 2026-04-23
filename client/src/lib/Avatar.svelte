<script lang="ts">
	const { name, role, size = 32 }: { name: string; role: string; size?: number } = $props();

	const initials = $derived(
		name
			.split(' ')
			.map((n) => n[0])
			.join('')
			.slice(0, 2)
			.toUpperCase()
	);

	const roleKey = $derived(role.toLowerCase());
	const colorVar = $derived(
		roleKey === 'admin'
			? 'var(--role-admin)'
			: roleKey === 'editor'
				? 'var(--role-editor)'
				: 'var(--role-viewer)'
	);
</script>

<div
	style="
		--role-color: {colorVar};
		width: {size}px;
		height: {size}px;
		font-size: {size * 0.35}px;
	"
	class="flex shrink-0 items-center justify-center rounded-full border-[1.5px] border-[color-mix(in_oklch,var(--role-color)_35%,transparent)] bg-[color-mix(in_oklch,var(--role-color)_18%,transparent)] font-semibold tracking-[-0.03em] text-[var(--role-color)]"
>
	{initials}
</div>
