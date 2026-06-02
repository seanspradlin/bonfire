<script lang="ts">
	import Btn from '$lib/Btn.svelte';
	import Icon from '$lib/Icon.svelte';
	import PageHeader from '$lib/PageHeader.svelte';
	import RoleBadge from '$lib/RoleBadge.svelte';

	let email = $state('');
	let role = $state('Viewer');
	let sent = $state(false);
	let loading = $state(false);
	let error = $state('');

	const roles = [
		{ role: 'Admin', desc: 'Full access including user management' },
		{ role: 'Editor', desc: 'Can upload files and edit content' },
		{ role: 'Viewer', desc: 'Read-only access to the knowledge base' }
	];

	const roleColorVar = (r: string) =>
		r === 'Admin'
			? 'var(--role-admin)'
			: r === 'Editor'
				? 'var(--role-editor)'
				: 'var(--role-viewer)';

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!email) return;

		loading = true;
		error = '';

		try {
			const res = await fetch('/api/invitations', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ email, role: role.toLowerCase() })
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				error = body.error ?? 'Failed to send invitation';
			} else {
				sent = true;
			}
		} catch {
			error = 'An unexpected error occurred. Please try again.';
		} finally {
			loading = false;
		}
	}

	function reset() {
		sent = false;
		email = '';
		role = 'Viewer';
		error = '';
	}
</script>

<div class="max-w-[540px] p-9">
	<PageHeader title="Invite User" subtitle="Grant access to the knowledge base" />

	{#if sent}
		<div
			class="rounded-2xl border-[1.5px] border-border bg-bg-card p-9 text-center shadow-[var(--shadow)]"
		>
			<div
				class="mx-auto mb-5 flex size-14 items-center justify-center rounded-full border-2 border-[color-mix(in_oklch,var(--success)_40%,transparent)] bg-[color-mix(in_oklch,var(--success)_15%,transparent)] text-success"
			>
				<Icon name="check" size={24} />
			</div>
			<h2 class="mb-2 text-[22px] font-semibold" style="font-family:'Tenon','DM Sans',sans-serif">
				Invite sent!
			</h2>
			<p class="mb-2 text-sm text-text-muted">
				An invitation email has been sent to <strong class="text-text">{email}</strong>.
			</p>
			<p class="mb-7 text-[13px] text-text-faint">
				They'll receive a link to set up their account as a <RoleBadge {role} inline />.
			</p>
			<Btn onclick={reset}>Invite another user</Btn>
		</div>
	{:else}
		<div
			class="rounded-2xl border-[1.5px] border-border bg-bg-card p-8 shadow-[var(--shadow-card)]"
		>
			<form onsubmit={handleSubmit} class="flex flex-col gap-5">
				<div>
					<label for="invite-email" class="mb-1.5 block text-[13px] font-medium text-text-muted">
						Work email
					</label>
					<div class="relative">
						<div
							class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-faint"
						>
							<Icon name="mail" size={14} />
						</div>
						<input
							id="invite-email"
							type="email"
							placeholder="user@example.com"
							bind:value={email}
							class="pl-9"
							required
						/>
					</div>
				</div>

				<fieldset class="border-0 p-0">
					<legend class="mb-2 block text-[13px] font-medium text-text-muted">Role</legend>
					<div class="grid grid-cols-3 gap-[10px]">
						{#each roles as r (r.role)}
							<label
								style="--role-color: {roleColorVar(r.role)}"
								class={[
									'cursor-pointer rounded-[10px] border-[1.5px] px-[14px] py-3 transition-all duration-150',
									role === r.role
										? 'border-[var(--role-color)] bg-[color-mix(in_oklch,var(--role-color)_10%,transparent)]'
										: 'border-border bg-bg'
								].join(' ')}
							>
								<!-- Hidden radio — visual styling lives on the label -->
								<input type="radio" name="role" value={r.role} bind:group={role} class="sr-only" />
								<div
									class={[
										'mb-1 text-[13px] font-semibold',
										role === r.role ? 'text-[var(--role-color)]' : 'text-text'
									].join(' ')}
								>
									{r.role}
								</div>
								<div class="text-[11px] leading-[1.4] text-text-faint">{r.desc}</div>
							</label>
						{/each}
					</div>
				</fieldset>

				{#if error}
					<div
						class="rounded-lg border border-[color-mix(in_oklch,var(--danger)_35%,transparent)] bg-[color-mix(in_oklch,var(--danger)_10%,transparent)] px-3 py-[10px] text-[13px] text-danger"
					>
						{error}
					</div>
				{/if}

				<Btn full {loading} type="submit">Send invitation</Btn>
			</form>
		</div>
	{/if}
</div>
