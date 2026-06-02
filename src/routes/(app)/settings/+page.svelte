<script lang="ts">
	import { tweaks } from '$lib/stores';
	import PageHeader from '$lib/PageHeader.svelte';
	import Icon from '$lib/Icon.svelte';

	const sections = [
		{
			title: 'RAG Pipeline',
			items: [
				{ label: 'Embedding model', val: 'text-embedding-3-large' },
				{ label: 'Chunk size', val: '512 tokens' },
				{ label: 'Chunk overlap', val: '64 tokens' },
				{ label: 'Similarity threshold', val: '0.75' }
			]
		},
		{
			title: 'Storage',
			items: [
				{ label: 'Vector database', val: 'Pinecone' },
				{ label: 'File storage', val: 'AWS S3 · us-east-1' },
				{ label: 'Total indexed', val: '5 documents' }
			]
		}
	];

	const themeOptions = [
		{ val: 'clean', label: 'Pure White', color: '#fb2d61', theme: 'light' },
		{ val: 'ember', label: 'Off-White', color: '#9728D1', theme: 'light' },
		{ val: 'pro', label: 'Dark Mode', color: '#84c3f7', theme: 'dark' }
	];

	function setTheme(variant: string, theme: string) {
		$tweaks = { theme, variant };
	}
</script>

<div class="max-w-[620px] p-9">
	<PageHeader title="Settings" subtitle="Configure the knowledge base and RAG pipeline" />

	{#each sections as section (section.title)}
		<div
			class="mb-5 overflow-hidden rounded-xl border-[1.5px] border-border bg-bg-card shadow-[var(--shadow-card)]"
		>
			<div
				class="border-b border-border px-5 py-3 text-[11px] font-semibold tracking-[0.06em] text-text-faint uppercase"
			>
				{section.title}
			</div>
			{#each section.items as item, i (item.label)}
				<div
					class={[
						'flex items-center justify-between px-5 py-[14px]',
						i < section.items.length - 1
							? 'border-b border-[color-mix(in_oklch,var(--border)_50%,transparent)]'
							: ''
					].join(' ')}
				>
					<span class="text-sm text-text-muted">{item.label}</span>
					<span class="font-mono text-sm font-medium text-accent">{item.val}</span>
				</div>
			{/each}
		</div>
	{/each}

	<div
		class="mb-5 overflow-hidden rounded-xl border-[1.5px] border-border bg-bg-card shadow-[var(--shadow-card)]"
	>
		<div
			class="border-b border-border px-5 py-3 text-[11px] font-semibold tracking-[0.06em] text-text-faint uppercase"
		>
			Visual Style
		</div>
		<div class="flex flex-col gap-0.5 px-[10px] py-3">
			{#each themeOptions as opt (opt.val)}
				{@const active =
					$tweaks.variant === opt.val || ($tweaks.theme === 'dark' && opt.val === 'pro')}
				<button
					onclick={() => setTheme(opt.val, opt.theme)}
					class={[
						'flex w-full items-center gap-2 rounded-lg px-[10px] py-[7px] text-left text-[13px] transition-all duration-150',
						active
							? 'border border-[color-mix(in_oklch,var(--accent)_30%,transparent)] bg-accent-bg text-accent'
							: 'border border-transparent text-text-muted hover:bg-bg-hover hover:text-text'
					].join(' ')}
				>
					<span class="size-[10px] shrink-0 rounded-full" style="background:{opt.color}"></span>
					{opt.label}
					{#if active}
						<span class="ml-auto"><Icon name="check" size={12} /></span>
					{/if}
				</button>
			{/each}
		</div>
	</div>
</div>
