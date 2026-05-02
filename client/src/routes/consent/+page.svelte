<script lang="ts">
	import { page } from '$app/stores';
	import Icon from '$lib/Icon.svelte';
	import Btn from '$lib/Btn.svelte';
	import { authClient } from '$lib/auth-client';

	const clientId = $derived($page.url.searchParams.get('client_id') ?? '');
	const rawScope = $derived($page.url.searchParams.get('scope') ?? '');
	const scopes = $derived(rawScope ? rawScope.split(' ').filter(Boolean) : []);

	let clientName = $state<string | null>(null);
	$effect(() => {
		if (!clientId) return;
		fetch(`/api/oauth/clients/${encodeURIComponent(clientId)}`)
			.then((r) => r.json())
			.then((data) => {
				if (data.name) clientName = data.name;
			})
			.catch(() => {});
	});

	const displayName = $derived(clientName ?? (clientId || 'An application'));

	const SCOPE_LABELS: Record<string, string> = {
		openid: 'Verify your identity',
		profile: 'Read your name and username',
		email: 'Read your email address',
		offline_access: 'Stay connected when you close the app'
	};

	let loading = $state(false);
	let error = $state('');

	async function handleConsent(accept: boolean) {
		loading = true;
		error = '';
		try {
			const result = await authClient.oauth2.consent({
				accept,
				scope: accept ? rawScope : undefined
			});
			if (result?.error) {
				error = result.error.message ?? 'Something went wrong.';
			}
			// Better Auth redirects on success; if we're still here, something failed
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
		</div>

		<div class="rounded-2xl border-[1.5px] border-border bg-bg-card p-9 shadow-[var(--shadow)]">
			<h1
				class="mb-1.5 text-[26px] font-semibold tracking-[-0.02em]"
				style="font-family:'Tenon','DM Sans',sans-serif"
			>
				Authorize access
			</h1>
			<p class="mb-4 text-sm text-text-muted">
				<span class="font-medium text-text">{displayName}</span> is requesting access to your Bonfire
				account.
			</p>
			<p class="mb-6 text-[12px] text-text-faint">
				Client ID: <code class="bg-bg-subtle rounded px-1.5 py-0.5 font-mono text-text-muted"
					>{clientId}</code
				>
			</p>

			{#if scopes.length > 0}
				<div class="mb-6">
					<p class="mb-2 text-[13px] font-medium tracking-[0.05em] text-text-muted uppercase">
						Requested permissions
					</p>
					<ul class="space-y-2">
						{#each scopes as scope (scope)}
							<li class="flex items-center gap-2 text-sm text-text">
								<Icon name="check" size={14} />
								<span>
									{SCOPE_LABELS[scope] ?? scope}
									<code
										class="bg-bg-subtle ml-1.5 rounded px-1.5 py-0.5 font-mono text-[11px] text-text-faint"
										>{scope}</code
									>
								</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if error}
				<div
					class="mb-5 rounded-lg border border-[color-mix(in_oklch,var(--danger)_35%,transparent)] bg-[color-mix(in_oklch,var(--danger)_12%,transparent)] px-[14px] py-[10px] text-[13px] text-danger"
				>
					{error}
				</div>
			{/if}

			<div class="flex gap-3">
				<button
					type="button"
					disabled={loading}
					onclick={() => handleConsent(false)}
					class="flex w-full items-center justify-center gap-2 rounded-[9px] border border-border bg-bg-card px-5 py-[11px] text-sm font-medium text-text transition-opacity duration-200 disabled:opacity-70"
				>
					Deny
				</button>
				<Btn full {loading} onclick={() => handleConsent(true)}>Allow</Btn>
			</div>
		</div>

		<p class="mt-6 text-center text-xs text-text-faint">
			Only authorize applications you trust.
		</p>
	</div>
</div>
