<script lang="ts">
	import type { Snippet } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/stores';
	import Avatar from '$lib/Avatar.svelte';
	import Icon from '$lib/Icon.svelte';
	import { authClient } from '$lib/auth-client';
	import type { LayoutData } from './$types';

	interface Props {
		children: Snippet;
		data: LayoutData;
	}

	const { children, data }: Props = $props();

	const currentPath = $derived($page.url.pathname.replace(/^\//, ''));

	type NavItemId = 'chat' | 'documents' | 'upload' | 'dashboard' | 'settings';
	type NavItem = { id: NavItemId; label: string; icon: string };

	const canEdit = $derived(['admin', 'editor'].includes(data.user?.role ?? ''));

	const topNavItems = $derived<NavItem[]>([
		{ id: 'chat', label: 'Chat', icon: 'flame' },
		...(canEdit ? [{ id: 'documents' as NavItemId, label: 'Documents', icon: 'pdf' }] : []),
		{ id: 'upload', label: 'Upload Files', icon: 'upload' }
	]);

	const bottomNavItems: NavItem[] = [
		{ id: 'dashboard', label: 'Users', icon: 'users' },
		{ id: 'settings', label: 'Settings', icon: 'settings' }
	];

	let signOutError = $state('');

	async function logout() {
		signOutError = '';
		try {
			const result = await authClient.signOut();
			if (result.error) {
				signOutError = 'Sign-out failed — please retry.';
				return;
			}
			goto(resolve('/login'));
		} catch {
			signOutError = 'Sign-out failed — please retry.';
		}
	}

	function navLinkClass(active: boolean): string {
		return [
			'flex w-full items-center gap-[10px] rounded-lg px-3 py-[9px] text-left text-sm transition-all duration-150 no-underline',
			active
				? 'border border-transparent font-medium text-accent'
				: 'border border-transparent font-normal text-sidebar-muted hover:bg-[color-mix(in_oklch,var(--sidebar-text)_8%,transparent)] hover:text-sidebar-text'
		].join(' ');
	}
</script>

<div class="flex min-h-screen">
	<aside
		class="sticky top-0 flex h-screen w-[220px] shrink-0 flex-col border-r border-border bg-bg-sidebar"
	>
		<!-- Logo -->
		<div class="border-b border-white/[0.12] px-5 py-6">
			<div class="flex items-center gap-2">
				<div
					class="flex size-8 shrink-0 items-center justify-center rounded-lg border border-accent bg-accent-bg text-accent"
				>
					<Icon name="flame" size={16} />
				</div>
				<div>
					<div
						class="text-sm font-semibold tracking-[-0.01em] text-sidebar-text"
						style="font-family:'Tenon','DM Sans',sans-serif"
					>
						Bonfire
					</div>
					<div class="text-[10px] tracking-[0.04em] text-sidebar-muted uppercase">
						Knowledge Base
					</div>
				</div>
			</div>
		</div>

		<!-- Top nav items -->
		<nav class="flex flex-col gap-0.5 px-[10px] py-3">
			{#each topNavItems as item (item.id)}
				{@const active = currentPath === item.id}
				<a
					href={resolve(`/${item.id}`)}
					aria-current={active ? 'page' : undefined}
					class={navLinkClass(active)}
				>
					<Icon name={item.icon} size={15} />
					{item.label}
				</a>
			{/each}
		</nav>

		<!-- Spacer pushes bottom items down -->
		<div class="flex-1"></div>

		<!-- Bottom nav items -->
		<nav class="flex flex-col gap-0.5 px-[10px] py-3">
			{#each bottomNavItems as item (item.id)}
				{@const active = currentPath === item.id}
				<a
					href={resolve(`/${item.id}`)}
					aria-current={active ? 'page' : undefined}
					class={navLinkClass(active)}
				>
					<Icon name={item.icon} size={15} />
					{item.label}
				</a>
			{/each}
		</nav>

		<!-- User profile + sign out -->
		<div class="border-t border-white/[0.12] px-[10px] py-3">
			<a
				href={resolve('/account')}
				aria-current={currentPath === 'account' ? 'page' : undefined}
				class={[
					'mb-1 flex w-full items-center gap-[9px] rounded-lg px-3 py-2 text-left no-underline transition-all duration-150',
					currentPath === 'account'
						? 'bg-[color-mix(in_oklch,var(--sidebar-text)_8%,transparent)]'
						: 'hover:bg-[color-mix(in_oklch,var(--sidebar-text)_8%,transparent)]'
				].join(' ')}
			>
				<Avatar name={data.user?.name ?? ''} role={data.user?.role ?? 'viewer'} size={28} />
				<div>
					<div class="text-[13px] font-medium text-sidebar-text">
						{data.user?.name ?? ''}
					</div>
					<div class="text-[11px] text-sidebar-muted capitalize">
						{data.user?.role ?? 'viewer'}
					</div>
				</div>
			</a>
			{#if signOutError}
				<div
					class="mb-1 rounded-md border border-[color-mix(in_oklch,var(--danger)_35%,transparent)] bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-3 py-1.5 text-[11px] text-danger"
				>
					{signOutError}
				</div>
			{/if}
			<button
				onclick={logout}
				class="flex w-full items-center gap-[10px] rounded-lg border-0 bg-transparent px-3 py-2 text-left text-[13px] text-sidebar-muted transition-all duration-150 hover:bg-bg-hover hover:text-text"
			>
				<Icon name="logout" size={14} />
				Sign out
			</button>
		</div>
	</aside>

	<main class="flex-1 overflow-auto">
		{@render children()}
	</main>
</div>
