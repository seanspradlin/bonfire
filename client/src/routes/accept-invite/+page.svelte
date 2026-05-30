<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Btn from '$lib/Btn.svelte';
	import Icon from '$lib/Icon.svelte';
	import RoleBadge from '$lib/RoleBadge.svelte';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	let name = $state('');
	let password = $state('');
	let confirmPassword = $state('');
	let showPw = $state(false);
	let showConfirmPw = $state(false);
	let loading = $state(false);
	let error = $state('');

	// Only show the mismatch hint once the user has typed something in the confirm field.
	const confirmError = $derived(
		confirmPassword && password !== confirmPassword ? 'Passwords do not match' : ''
	);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!name || !password || !confirmPassword) return;
		if (confirmError) {
			error = confirmError;
			return;
		}

		loading = true;
		error = '';

		try {
			const res = await fetch(`/api/invitations/${data.token}/accept`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, password })
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				error = body.error ?? 'Failed to accept invitation. The link may have expired.';
			} else {
				goto(resolve('/login?invited=1'));
			}
		} catch {
			error = 'An unexpected error occurred. Please try again.';
		} finally {
			loading = false;
		}
	}
</script>

<div class="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
	<!-- Decorative background glows, matching the login page -->
	<div
		class="pointer-events-none absolute -top-[20%] -right-[10%] size-[500px] rounded-full"
		style="background:radial-gradient(circle, color-mix(in srgb, #fb2d61 10%, transparent), transparent 70%)"
	></div>
	<div
		class="pointer-events-none absolute -bottom-[15%] -left-[10%] size-[400px] rounded-full"
		style="background:radial-gradient(circle, color-mix(in srgb, #9728D1 7%, transparent), transparent 70%)"
	></div>

	<div class="relative z-10 w-full max-w-[440px]">
		<!-- Branding header -->
		<div class="mb-10 text-center">
			<div class="mb-4 inline-flex items-center gap-[10px]">
				<div
					class="flex size-10 items-center justify-center rounded-[10px] border-[1.5px] border-accent bg-accent-bg text-accent"
				>
					<Icon name="flame" size={20} />
				</div>
				<span
					class="text-[22px] font-semibold tracking-[-0.02em] text-text"
					style="font-family:'Tenon','DM Sans',sans-serif"
				>
					Bonfire
				</span>
			</div>
			<p class="text-[13px] tracking-[0.05em] text-text-muted uppercase">Team Knowledge Base</p>
		</div>

		{#if !data.valid}
			<!-- Invalid / expired token state -->
			<div
				class="rounded-2xl border-[1.5px] border-border bg-bg-card p-9 text-center shadow-[var(--shadow)]"
			>
				<div
					class="mx-auto mb-5 flex size-14 items-center justify-center rounded-full border-2 border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] text-danger"
				>
					<Icon name="x" size={24} />
				</div>
				<h1 class="mb-2 text-[22px] font-semibold" style="font-family:'Tenon','DM Sans',sans-serif">
					Invitation invalid
				</h1>
				<p class="mb-7 text-sm text-text-muted">
					{data.error || 'This invitation link is invalid or has expired.'}
				</p>
				<a
					href={resolve('/login')}
					class="inline-flex items-center justify-center gap-2 rounded-[9px] border-0 bg-accent px-5 py-[11px] text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90"
				>
					Go to login
				</a>
			</div>
		{:else}
			<!-- Valid token: account setup form -->
			<div class="rounded-2xl border-[1.5px] border-border bg-bg-card p-9 shadow-[var(--shadow)]">
				<h1
					class="mb-1.5 text-[26px] font-semibold tracking-[-0.02em]"
					style="font-family:'Tenon','DM Sans',sans-serif"
				>
					Set up your account
				</h1>
				<p class="mb-7 text-sm text-text-muted">
					You've been invited as a <RoleBadge role={data.role} inline /> to Bonfire
				</p>

				{#if error}
					<div
						class="mb-5 rounded-lg border border-[color-mix(in_oklch,var(--danger)_35%,transparent)] bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] px-[14px] py-[10px] text-[13px] text-danger"
					>
						{error}
					</div>
				{/if}

				<form onsubmit={handleSubmit} class="flex flex-col gap-5">
					<!-- Read-only email — shows what account they're activating -->
					<div>
						<label for="accept-email" class="mb-1.5 block text-[13px] font-medium text-text-muted">
							Email address
						</label>
						<div class="relative">
							<div
								class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-faint"
							>
								<Icon name="mail" size={14} />
							</div>
							<input
								id="accept-email"
								type="email"
								value={data.email}
								class="pl-9 opacity-60"
								readonly
								disabled
							/>
						</div>
					</div>

					<div>
						<label for="accept-name" class="mb-1.5 block text-[13px] font-medium text-text-muted">
							Full name
						</label>
						<input
							id="accept-name"
							type="text"
							placeholder="Jordan Ellis"
							bind:value={name}
							required
						/>
					</div>

					<div>
						<label
							for="accept-password"
							class="mb-1.5 block text-[13px] font-medium text-text-muted"
						>
							Password
						</label>
						<div class="relative">
							<div
								class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-faint"
							>
								<Icon name="lock" size={14} />
							</div>
							<input
								id="accept-password"
								type={showPw ? 'text' : 'password'}
								placeholder="••••••••"
								bind:value={password}
								class="pr-10 pl-9"
								minlength={7}
								required
							/>
							<button
								type="button"
								onclick={() => (showPw = !showPw)}
								class="absolute top-1/2 right-3 -translate-y-1/2 border-0 bg-transparent p-1 text-text-faint"
							>
								<Icon name={showPw ? 'eyeOff' : 'eye'} size={14} />
							</button>
						</div>
					</div>

					<div>
						<label
							for="accept-confirm-password"
							class="mb-1.5 block text-[13px] font-medium text-text-muted"
						>
							Confirm password
						</label>
						<div class="relative">
							<div
								class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-faint"
							>
								<Icon name="lock" size={14} />
							</div>
							<input
								id="accept-confirm-password"
								type={showConfirmPw ? 'text' : 'password'}
								placeholder="••••••••"
								bind:value={confirmPassword}
								class="pr-10 pl-9"
								required
							/>
							<button
								type="button"
								onclick={() => (showConfirmPw = !showConfirmPw)}
								class="absolute top-1/2 right-3 -translate-y-1/2 border-0 bg-transparent p-1 text-text-faint"
							>
								<Icon name={showConfirmPw ? 'eyeOff' : 'eye'} size={14} />
							</button>
						</div>
						{#if confirmError}
							<p class="mt-1.5 text-[12px] text-danger">{confirmError}</p>
						{/if}
					</div>

					<Btn full {loading} type="submit">Set up account</Btn>
				</form>
			</div>
		{/if}

		<p class="mt-6 text-center text-xs text-text-faint">Need help? Contact your administrator.</p>
	</div>
</div>
