<script lang="ts">
	import Btn from '$lib/Btn.svelte';
	import Icon from '$lib/Icon.svelte';
	import PageHeader from '$lib/PageHeader.svelte';

	let currentPassword = $state('');
	let newPassword = $state('');
	let confirmPassword = $state('');
	let showCurrent = $state(false);
	let showNew = $state(false);
	let showConfirm = $state(false);
	let passwordLoading = $state(false);
	let passwordBanner = $state<{ kind: 'error' | 'success'; message: string } | null>(null);

	type PasswordStrength = { label: string; colorClass: string; barClass: string; width: string };

	const passwordStrength = $derived<PasswordStrength>(
		!newPassword
			? { label: '', colorClass: '', barClass: '', width: '0%' }
			: newPassword.length < 8
				? { label: 'Too short', colorClass: 'text-danger', barClass: 'bg-danger', width: '25%' }
				: newPassword.length < 12 || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)
					? { label: 'Fair', colorClass: 'text-warning', barClass: 'bg-warning', width: '55%' }
					: { label: 'Strong', colorClass: 'text-success', barClass: 'bg-success', width: '100%' }
	);

	async function handlePasswordSubmit(e: SubmitEvent) {
		e.preventDefault();
		passwordBanner = null;

		if (newPassword !== confirmPassword) {
			passwordBanner = { kind: 'error', message: "Passwords don't match." };
			return;
		}
		if (newPassword.length < 8) {
			passwordBanner = { kind: 'error', message: 'Password must be at least 8 characters.' };
			return;
		}

		passwordLoading = true;
		try {
			const res = await fetch('/api/auth/password', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ currentPassword, newPassword })
			});

			const data = await res.json().catch(() => ({}));
			if (!res.ok) {
				passwordBanner = { kind: 'error', message: data.error ?? 'Failed to change password.' };
			} else {
				passwordBanner = { kind: 'success', message: 'Password updated successfully.' };
				currentPassword = '';
				newPassword = '';
				confirmPassword = '';
				setTimeout(() => (passwordBanner = null), 4000);
			}
		} catch {
			passwordBanner = { kind: 'error', message: 'Network error — please try again.' };
		} finally {
			passwordLoading = false;
		}
	}
</script>

<div class="max-w-[680px] p-9">
	<PageHeader title="My Account" subtitle="Manage your password" />

	<div
		class="overflow-hidden rounded-[14px] border-[1.5px] border-border bg-bg-card shadow-[var(--shadow-card)]"
	>
		<div
			class="border-b border-border px-6 py-[14px] text-[11px] font-bold tracking-[0.07em] text-text-faint uppercase"
		>
			Change Password
		</div>
		<div class="p-6">
			{#if passwordBanner}
				<div
					class={[
						'mb-5 flex items-center gap-2 rounded-lg border px-[14px] py-[10px] text-[13px]',
						passwordBanner.kind === 'error'
							? 'border-[color-mix(in_oklch,var(--danger)_35%,transparent)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] text-danger'
							: 'border-[color-mix(in_oklch,var(--success)_35%,transparent)] bg-[color-mix(in_oklch,var(--success)_8%,transparent)] text-success'
					].join(' ')}
				>
					<Icon name={passwordBanner.kind === 'error' ? 'x' : 'check'} size={14} />
					{passwordBanner.message}
				</div>
			{/if}

			<form onsubmit={handlePasswordSubmit} class="flex flex-col gap-4">
				<!-- Current password -->
				<div>
					<label
						for="current-password"
						class="mb-1.5 block text-[13px] font-medium text-text-muted"
					>
						Current password
					</label>
					<div class="relative">
						<input
							id="current-password"
							type={showCurrent ? 'text' : 'password'}
							placeholder="••••••••"
							bind:value={currentPassword}
							class="pr-10"
						/>
						<button
							type="button"
							onclick={() => (showCurrent = !showCurrent)}
							aria-label={showCurrent ? 'Hide password' : 'Show password'}
							class="absolute top-1/2 right-3 -translate-y-1/2 border-0 bg-transparent p-1 text-text-faint"
						>
							<Icon name={showCurrent ? 'eyeOff' : 'eye'} size={15} />
						</button>
					</div>
				</div>

				<!-- New password -->
				<div>
					<label for="new-password" class="mb-1.5 block text-[13px] font-medium text-text-muted">
						New password
					</label>
					<div class="relative">
						<input
							id="new-password"
							type={showNew ? 'text' : 'password'}
							placeholder="••••••••"
							bind:value={newPassword}
							class="pr-10"
						/>
						<button
							type="button"
							onclick={() => (showNew = !showNew)}
							aria-label={showNew ? 'Hide password' : 'Show password'}
							class="absolute top-1/2 right-3 -translate-y-1/2 border-0 bg-transparent p-1 text-text-faint"
						>
							<Icon name={showNew ? 'eyeOff' : 'eye'} size={15} />
						</button>
					</div>
					{#if newPassword}
						<div class="mt-2">
							<div class="h-[3px] overflow-hidden rounded-sm bg-border">
								<div
									class="h-full rounded-sm transition-all duration-300 {passwordStrength.barClass}"
									style="width: {passwordStrength.width}"
								></div>
							</div>
							<span class="mt-1 block text-[11px] {passwordStrength.colorClass}">
								{passwordStrength.label}
							</span>
						</div>
					{/if}
				</div>

				<!-- Confirm password -->
				<div>
					<label
						for="confirm-password"
						class="mb-1.5 block text-[13px] font-medium text-text-muted"
					>
						Confirm new password
					</label>
					<div class="relative">
						<input
							id="confirm-password"
							type={showConfirm ? 'text' : 'password'}
							placeholder="••••••••"
							bind:value={confirmPassword}
							class="pr-10"
						/>
						<button
							type="button"
							onclick={() => (showConfirm = !showConfirm)}
							aria-label={showConfirm ? 'Hide password' : 'Show password'}
							class="absolute top-1/2 right-3 -translate-y-1/2 border-0 bg-transparent p-1 text-text-faint"
						>
							<Icon name={showConfirm ? 'eyeOff' : 'eye'} size={15} />
						</button>
					</div>
				</div>

				<div class="flex justify-end">
					<Btn type="submit" loading={passwordLoading}>Update password</Btn>
				</div>
			</form>
		</div>
	</div>
</div>
