<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import Btn from '$lib/Btn.svelte';
	import Icon from '$lib/Icon.svelte';
	import type { PageData } from './$types';

	const { data }: { data: PageData } = $props();

	let password = $state('');
	let confirmPassword = $state('');
	let showPw = $state(false);
	let showConfirmPw = $state(false);
	let loading = $state(false);
	let error = $state('');
	let isTokenError = $state(false);

	const confirmError = $derived(
		confirmPassword && password !== confirmPassword ? 'Passwords do not match' : ''
	);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!password || !confirmPassword) return;
		if (confirmError) {
			error = confirmError;
			return;
		}

		loading = true;
		error = '';
		isTokenError = false;

		try {
			const result = await authClient.resetPassword({
				newPassword: password,
				token: data.token
			});

			if (result.error) {
				if (result.error.code === 'INVALID_TOKEN') {
					error = 'This reset link has expired or already been used.';
					isTokenError = true;
				} else {
					error = result.error.message || 'Something went wrong. Please try again.';
				}
			} else {
				goto(resolve('/login?reset=1'));
			}
		} catch {
			error = 'An unexpected error occurred. Please try again.';
		} finally {
			loading = false;
		}
	}
</script>

<div class="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
	<div
		class="pointer-events-none absolute -top-[20%] -right-[10%] size-[500px] rounded-full"
		style="background:radial-gradient(circle, color-mix(in srgb, #fb2d61 10%, transparent), transparent 70%)"
	></div>
	<div
		class="pointer-events-none absolute -bottom-[15%] -left-[10%] size-[400px] rounded-full"
		style="background:radial-gradient(circle, color-mix(in srgb, #9728D1 7%, transparent), transparent 70%)"
	></div>

	<div class="relative z-10 w-full max-w-[440px]">
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
			<p class="text-[13px] tracking-[0.05em] text-text-muted uppercase">
				Team Knowledge Base
			</p>
		</div>

		{#if !data.valid}
			<div
				class="rounded-2xl border-[1.5px] border-border bg-bg-card p-9 text-center shadow-[var(--shadow)]"
			>
				<div
					class="mx-auto mb-5 flex size-14 items-center justify-center rounded-full border-2 border-[color-mix(in_oklch,var(--danger)_40%,transparent)] bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] text-danger"
				>
					<Icon name="x" size={24} />
				</div>
				<h1
					class="mb-2 text-[22px] font-semibold tracking-[-0.02em]"
					style="font-family:'Tenon','DM Sans',sans-serif"
				>
					Link expired
				</h1>
				<p class="mb-7 text-sm text-text-muted">
					This password reset link is invalid or has expired. Reset links are single-use and valid
					for 6 hours.
				</p>
				<a
					href={resolve('/forgot-password')}
					class="inline-flex items-center justify-center gap-2 rounded-[9px] border-0 bg-accent px-5 py-[11px] text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90"
				>
					Request a new link
				</a>
			</div>
		{:else}
			<div class="rounded-2xl border-[1.5px] border-border bg-bg-card p-9 shadow-[var(--shadow)]">
				<h1
					class="mb-1.5 text-[26px] font-semibold tracking-[-0.02em]"
					style="font-family:'Tenon','DM Sans',sans-serif"
				>
					Set new password
				</h1>
				<p class="mb-7 text-sm text-text-muted">Choose a new password for your account.</p>

				{#if error}
					<div
						class="mb-5 rounded-lg border border-[color-mix(in_oklch,var(--danger)_35%,transparent)] bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] px-[14px] py-[10px] text-[13px] text-danger"
					>
						{error}
					</div>
					{#if isTokenError}
						<p class="mb-5 text-center text-[13px] text-text-faint">
							<a href={resolve('/forgot-password')} class="text-accent">Request a new link</a>
						</p>
					{/if}
				{/if}

				<form onsubmit={handleSubmit} class="flex flex-col gap-5">
					<div>
						<label
							for="reset-password"
							class="mb-1.5 block text-[13px] font-medium text-text-muted"
						>
							New password
						</label>
						<div class="relative">
							<div
								class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-faint"
							>
								<Icon name="lock" size={14} />
							</div>
							<input
								id="reset-password"
								type={showPw ? 'text' : 'password'}
								placeholder="••••••••"
								bind:value={password}
								class="pr-10 pl-9"
								minlength={8}
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
							for="reset-confirm-password"
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
								id="reset-confirm-password"
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

					<Btn full {loading} type="submit">Set new password</Btn>
				</form>
			</div>
		{/if}
	</div>
</div>
