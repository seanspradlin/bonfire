<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Avatar from '$lib/Avatar.svelte';
	import ConfirmDeleteModal from '$lib/ConfirmDeleteModal.svelte';
	import EditRoleModal from '$lib/EditRoleModal.svelte';
	import FilterPills from '$lib/FilterPills.svelte';
	import Icon from '$lib/Icon.svelte';
	import IconBtn from '$lib/IconBtn.svelte';
	import PageHeader from '$lib/PageHeader.svelte';
	import RoleBadge from '$lib/RoleBadge.svelte';
	import StatusBadge from '$lib/StatusBadge.svelte';
	import type { User } from '$lib/types/user';

	interface PageData {
		users: User[];
	}

	interface Props {
		data: PageData;
	}

	let { data }: Props = $props();

	// data.users is the authoritative source; mutations call invalidateAll() so
	// SvelteKit re-runs the load function and this derived re-evaluates automatically.
	const users = $derived(data.users);

	let search = $state('');
	let filter = $state('All');
	let editingUser = $state<User | null>(null);
	let isEditModalOpen = $state(false);
	let deletingUser = $state<User | null>(null);
	let isDeleteModalOpen = $state(false);

	const filtered = $derived(
		users.filter((u) => {
			const matchSearch =
				u.name.toLowerCase().includes(search.toLowerCase()) ||
				u.email.toLowerCase().includes(search.toLowerCase());
			const matchFilter =
				filter === 'All' || u.role.toLowerCase() === filter.toLowerCase() || u.status === filter;
			return matchSearch && matchFilter;
		})
	);

	const stats = $derived([
		{ label: 'Total Users', value: users.length, colorVar: 'var(--accent)' },
		{
			label: 'Active',
			value: users.filter((u) => u.status === 'Active').length,
			colorVar: 'var(--success)'
		},
		{
			label: 'Inactive',
			value: users.filter((u) => u.status === 'Inactive').length,
			colorVar: 'var(--warning)'
		},
		{
			label: 'Admins',
			value: users.filter((u) => u.role === 'Admin').length,
			colorVar: 'var(--role-admin)'
		}
	]);

	function openDeleteModal(u: User) {
		deletingUser = u;
		isDeleteModalOpen = true;
	}

	async function handleDeleteUser() {
		if (!deletingUser) return;
		const userId = deletingUser.id;

		const response = await fetch(`/api/users/${userId}`, { method: 'DELETE' });

		if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			throw new Error(body.error ?? 'Failed to remove user');
		}

		await invalidateAll();
	}

	function openEditModal(user: User) {
		editingUser = user;
		isEditModalOpen = true;
	}

	async function handleRoleChange(newRole: string) {
		if (!editingUser) return;
		const userId = editingUser.id;

		try {
			const response = await fetch(`/api/users/${userId}/role`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ role: newRole })
			});

			if (!response.ok) {
				throw new Error('Failed to update role');
			}

			// Re-run the load function so data.users reflects the server's truth.
			await invalidateAll();
		} catch (error) {
			throw error instanceof Error ? error : new Error('Failed to update role');
		}
	}
</script>

<div class="max-w-[1100px] p-9">
	<div class="mb-7 flex items-start justify-between">
		<PageHeader
			title="User Management"
			subtitle="Manage access and permissions for the knowledge base"
		/>
		<a
			href={resolve('/invite')}
			class="mt-1 flex shrink-0 items-center gap-2 rounded-[9px] border-0 bg-accent px-[18px] py-[10px] text-sm font-semibold text-white no-underline"
		>
			<Icon name="plus" size={14} />
			Invite User
		</a>
	</div>

	<div class="mb-8 grid grid-cols-4 gap-4">
		{#each stats as s (s.label)}
			<div
				class="rounded-xl border-[1.5px] border-border bg-bg-card p-5 shadow-[var(--shadow-card)]"
			>
				<div
					class="mb-0.5 text-[28px] font-semibold"
					style="font-family:'Tenon','DM Sans',sans-serif; color:{s.colorVar}"
				>
					{s.value}
				</div>
				<div class="text-[13px] text-text-muted">{s.label}</div>
			</div>
		{/each}
	</div>

	<div class="mb-5 flex items-center gap-3">
		<div class="relative max-w-[320px] flex-1">
			<div class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-faint">
				<Icon name="search" size={14} />
			</div>
			<input placeholder="Search users…" bind:value={search} class="h-[38px] pl-9 text-[13px]" />
		</div>
		<FilterPills
			options={['All', 'Admin', 'Editor', 'Viewer', 'Active', 'Inactive']}
			active={filter}
			onChange={(v) => (filter = v)}
		/>
	</div>

	<div
		class="overflow-hidden rounded-xl border-[1.5px] border-border bg-bg-card shadow-[var(--shadow-card)]"
	>
		<table class="w-full border-collapse">
			<thead>
				<tr class="border-b border-border">
					{#each ['User', 'Role', 'Status', 'Last seen', 'Joined', ''] as h (h)}
						<th
							class="px-4 py-3 text-left text-[11px] font-semibold tracking-[0.06em] text-text-faint uppercase"
							>{h}</th
						>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each filtered as u, i (u.id)}
					<tr
						class={[
							'transition-colors duration-100 hover:bg-bg-hover',
							i < filtered.length - 1
								? 'border-b border-[color-mix(in_oklch,var(--border)_60%,transparent)]'
								: ''
						].join(' ')}
					>
						<td class="px-4 py-[14px]">
							<div class="flex items-center gap-[10px]">
								<Avatar name={u.name} role={u.role} size={32} />
								<div>
									<div class="text-sm font-medium">{u.name}</div>
									<div class="text-xs text-text-muted">{u.email}</div>
								</div>
							</div>
						</td>
						<td class="px-4 py-[14px]"><RoleBadge role={u.role} /></td>
						<td class="px-4 py-[14px]"><StatusBadge status={u.status} /></td>
						<td class="px-4 py-[14px] text-[13px] text-text-muted">{u.lastSeen}</td>
						<td class="px-4 py-[14px] text-[13px] text-text-faint">{u.joined}</td>
						<td class="px-4 py-[14px]">
							<div class="flex gap-1">
								<IconBtn title="Edit role" onclick={() => openEditModal(u)}>
									<Icon name="settings" size={13} />
								</IconBtn>
								<IconBtn danger title="Remove user" onclick={() => openDeleteModal(u)}>
									<Icon name="trash" size={13} />
								</IconBtn>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		{#if filtered.length === 0}
			<div class="p-10 text-center text-sm text-text-faint">No users match your search.</div>
		{/if}
	</div>
</div>

<EditRoleModal
	isOpen={isEditModalOpen}
	userName={editingUser?.name ?? ''}
	currentRole={editingUser?.role ?? ''}
	onClose={() => {
		isEditModalOpen = false;
		editingUser = null;
	}}
	onSave={handleRoleChange}
/>

<ConfirmDeleteModal
	isOpen={isDeleteModalOpen}
	userName={deletingUser?.name ?? ''}
	userRole={deletingUser?.role ?? ''}
	onClose={() => {
		isDeleteModalOpen = false;
		deletingUser = null;
	}}
	onConfirm={handleDeleteUser}
/>
