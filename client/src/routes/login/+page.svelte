<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import Btn from '$lib/Btn.svelte';
	import Icon from '$lib/Icon.svelte';

	let email = $state('');
	let password = $state('');
	let showPw = $state(false);
	let loading = $state(false);
	let error = $state('');

	const passwordReset = $derived($page.url.searchParams.get('reset') === '1');

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!email || !password) {
			error = 'Please enter your email and password.';
			return;
		}
		error = '';
		loading = true;

		try {
			const result = await authClient.signIn.email({ email, password });

			if (result.error) {
				error = result.error.message || 'Failed to sign in. Please check your credentials.';
			} else {
				const redirect = $page.url.searchParams.get('redirect');
				goto(redirect ?? resolve('/chat'));
			}
		} catch (err) {
			error = 'An unexpected error occurred. Please try again.';
			console.error('Login error:', err);
		} finally {
			loading = false;
		}
	}
</script>

<div class="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
	<!-- Decorative background glows -->
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

		<div class="rounded-2xl border-[1.5px] border-border bg-bg-card p-9 shadow-[var(--shadow)]">
			<h1
				class="mb-1.5 text-[26px] font-semibold tracking-[-0.02em]"
				style="font-family:'Tenon','DM Sans',sans-serif"
			>
				Welcome back
			</h1>
			<p class="mb-7 text-sm text-text-muted">Sign in to manage the knowledge base</p>

			{#if passwordReset}
				<div
					class="mb-5 rounded-lg border border-[color-mix(in_oklch,var(--success)_35%,transparent)] bg-[color-mix(in_oklch,var(--success)_12%,transparent)] px-[14px] py-[10px] text-[13px] text-success"
				>
					Password updated — sign in with your new password.
				</div>
			{/if}

			{#if error}
				<div
					class="mb-5 rounded-lg border border-[color-mix(in_oklch,var(--danger)_35%,transparent)] bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] px-[14px] py-[10px] text-[13px] text-danger"
				>
					{error}
				</div>
			{/if}

			<form onsubmit={handleSubmit}>
				<div class="mb-4">
					<label for="login-email" class="mb-1.5 block text-[13px] font-medium text-text-muted">
						Email address
					</label>
					<div class="relative">
						<div
							class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-faint"
						>
							<Icon name="mail" size={15} />
						</div>
						<input
							id="login-email"
							type="email"
							placeholder="you@example.com"
							bind:value={email}
							class="pl-9"
						/>
					</div>
				</div>

				<div class="mb-6">
					<label for="login-password" class="mb-1.5 block text-[13px] font-medium text-text-muted">
						Password
					</label>
					<div class="relative">
						<div
							class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-faint"
						>
							<Icon name="lock" size={15} />
						</div>
						<input
							id="login-password"
							type={showPw ? 'text' : 'password'}
							placeholder="••••••••"
							bind:value={password}
							class="pr-10 pl-9"
						/>
						<button
							type="button"
							onclick={() => (showPw = !showPw)}
							class="absolute top-1/2 right-3 -translate-y-1/2 border-0 bg-transparent p-1 text-text-faint"
						>
							<Icon name={showPw ? 'eyeOff' : 'eye'} size={15} />
						</button>
					</div>
				</div>

				<Btn full {loading} type="submit">Sign in</Btn>
			</form>

			<p class="mt-5 text-center text-[13px] text-text-faint">
				<a href={resolve('/forgot-password')} class="text-accent">Forgot your password?</a>
			</p>
		</div>

		<p class="mt-6 text-center text-xs text-text-faint">Need access? Contact your administrator.</p>
	</div>
</div>
