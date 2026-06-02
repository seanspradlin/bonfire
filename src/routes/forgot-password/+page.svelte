<script lang="ts">
	import { resolve } from '$app/paths';
	import { authClient } from '$lib/auth-client';
	import Btn from '$lib/Btn.svelte';
	import Icon from '$lib/Icon.svelte';

	let email = $state('');
	let loading = $state(false);
	let submitted = $state(false);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!email) return;
		loading = true;

		// Always redirect to origin-relative reset-password so the server-side
		// callback lands back on whichever host the user is currently on.
		const redirectTo = `${window.location.origin}/reset-password`;

		await authClient.requestPasswordReset({ email, redirectTo }).catch(() => {});

		// Always show the success state regardless of whether the email exists
		// to avoid leaking whether an address is registered.
		submitted = true;
		loading = false;
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
			<p class="text-[13px] tracking-[0.05em] text-text-muted uppercase">Team Knowledge Base</p>
		</div>

		<div class="rounded-2xl border-[1.5px] border-border bg-bg-card p-9 shadow-[var(--shadow)]">
			{#if submitted}
				<div class="text-center">
					<div
						class="mx-auto mb-5 flex size-14 items-center justify-center rounded-full border-2 border-[color-mix(in_oklch,var(--success)_40%,transparent)] bg-[color-mix(in_oklch,var(--success)_12%,transparent)] text-success"
					>
						<Icon name="mail" size={24} />
					</div>
					<h1
						class="mb-2 text-[22px] font-semibold tracking-[-0.02em]"
						style="font-family:'Tenon','DM Sans',sans-serif"
					>
						Check your inbox
					</h1>
					<p class="mb-7 text-sm text-text-muted">
						If that email is registered, we've sent a reset link. It expires in 6 hours.
					</p>
					<a
						href={resolve('/login')}
						class="inline-flex items-center justify-center gap-2 rounded-[9px] border-0 bg-accent px-5 py-[11px] text-sm font-medium text-white transition-opacity duration-200 hover:opacity-90"
					>
						Back to login
					</a>
				</div>
			{:else}
				<h1
					class="mb-1.5 text-[26px] font-semibold tracking-[-0.02em]"
					style="font-family:'Tenon','DM Sans',sans-serif"
				>
					Forgot password?
				</h1>
				<p class="mb-7 text-sm text-text-muted">
					Enter your email and we'll send you a reset link.
				</p>

				<form onsubmit={handleSubmit}>
					<div class="mb-6">
						<label for="forgot-email" class="mb-1.5 block text-[13px] font-medium text-text-muted">
							Email address
						</label>
						<div class="relative">
							<div
								class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-text-faint"
							>
								<Icon name="mail" size={15} />
							</div>
							<input
								id="forgot-email"
								type="email"
								placeholder="you@example.com"
								bind:value={email}
								class="pl-9"
								required
							/>
						</div>
					</div>

					<Btn full {loading} type="submit">Send reset link</Btn>
				</form>

				<p class="mt-5 text-center text-[13px] text-text-faint">
					<a href={resolve('/login')} class="text-accent">Back to login</a>
				</p>
			{/if}
		</div>
	</div>
</div>
