<script lang="ts">
	import { onMount } from 'svelte';
	import Btn from '$lib/Btn.svelte';
	import Icon from '$lib/Icon.svelte';
	import IconBtn from '$lib/IconBtn.svelte';
	import McpGuideModal from '$lib/McpGuideModal.svelte';
	import PageHeader from '$lib/PageHeader.svelte';

	// ---------------------------------------------------------------------------
	// Password section
	// ---------------------------------------------------------------------------
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

	// ---------------------------------------------------------------------------
	// Token section
	// ---------------------------------------------------------------------------
	type Token = {
		id: string;
		name: string;
		masked: string;
		createdAt: string;
		lastUsed: string;
	};

	let tokens = $state<Token[]>([]);
	let tokensLoading = $state(true);
	let tokensError = $state('');
	let newTokenName = $state('');
	let revealedToken = $state<string | null>(null);
	let copyLabel = $state('Copy');
	let generateLoading = $state(false);
	let revokeError = $state('');
	let showMcpGuide = $state(false);

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: 'numeric'
		});
	}

	function relativeTime(iso: string, createdIso: string): string {
		// Same timestamp (to the second) means the token has never been used
		if (iso.slice(0, 19) === createdIso.slice(0, 19)) return 'never';

		const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
		const diffMs = new Date(iso).getTime() - Date.now();
		const diffSec = Math.round(diffMs / 1000);
		const absSec = Math.abs(diffSec);

		if (absSec < 60) return 'just now';
		if (absSec < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
		if (absSec < 86400) return rtf.format(Math.round(diffSec / 3600), 'hour');
		if (absSec < 2592000) return rtf.format(Math.round(diffSec / 86400), 'day');
		if (absSec < 31536000) return rtf.format(Math.round(diffSec / 2592000), 'month');
		return rtf.format(Math.round(diffSec / 31536000), 'year');
	}

	onMount(async () => {
		try {
			const res = await fetch('/api/auth/tokens');
			if (!res.ok) throw new Error('Failed to load tokens');
			const data = await res.json();
			tokens = data.keys;
		} catch {
			tokensError = 'Failed to load tokens.';
		} finally {
			tokensLoading = false;
		}
	});

	async function handleGenerateToken() {
		if (!newTokenName.trim() || generateLoading) return;
		generateLoading = true;
		try {
			const res = await fetch('/api/auth/tokens', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newTokenName.trim() })
			});

			const data = await res.json();
			if (!res.ok) {
				tokensError = data.error ?? 'Failed to generate token.';
				return;
			}

			tokens = [
				...tokens,
				{
					id: data.id,
					name: newTokenName.trim(),
					masked: data.masked,
					createdAt: new Date().toISOString(),
					lastUsed: new Date().toISOString()
				}
			];
			revealedToken = data.key;
			newTokenName = '';
			copyLabel = 'Copy';
		} catch {
			tokensError = 'Network error — please try again.';
		} finally {
			generateLoading = false;
		}
	}

	async function revokeToken(id: string) {
		revokeError = '';
		try {
			const res = await fetch(`/api/auth/tokens/${id}`, { method: 'DELETE' });
			if (res.ok) {
				tokens = tokens.filter((t) => t.id !== id);
				if (revealedToken && tokens.length === 0) revealedToken = null;
			} else {
				const body = await res.json().catch(() => ({}));
				revokeError = body.error ?? 'Failed to revoke token — please try again.';
			}
		} catch {
			revokeError = 'Network error — could not revoke token.';
		}
	}

	async function copyToken() {
		if (!revealedToken) return;
		await navigator.clipboard.writeText(revealedToken);
		copyLabel = 'Copied!';
		setTimeout(() => (copyLabel = 'Copy'), 2000);
	}
</script>

<div class="max-w-[680px] p-9">
	<PageHeader title="My Account" subtitle="Manage your password and API access tokens" />

	<!-- -------------------------------------------------------------------------
	     Change Password
	     ---------------------------------------------------------------------- -->
	<div
		class="mb-5 overflow-hidden rounded-[14px] border-[1.5px] border-border bg-bg-card shadow-[var(--shadow-card)]"
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

	<!-- -------------------------------------------------------------------------
	     Access Tokens
	     ---------------------------------------------------------------------- -->
	<div
		class="overflow-hidden rounded-[14px] border-[1.5px] border-border bg-bg-card shadow-[var(--shadow-card)]"
	>
		<div
			class="border-b border-border px-6 py-[14px] text-[11px] font-bold tracking-[0.07em] text-text-faint uppercase"
		>
			Access Tokens
		</div>
		<div class="p-6">
			<McpGuideModal isOpen={showMcpGuide} onClose={() => (showMcpGuide = false)} />

			<p class="mb-5 text-[13px] text-text-muted">
				Generate tokens to authenticate the MCP server and other integrations. Tokens are shown once
				— store them securely.
			</p>

			<!-- MCP connection guide banner -->
			<div
				class="mb-5 flex items-center justify-between gap-3 rounded-[10px] border-[1.5px] border-border bg-bg px-4 py-3.5"
			>
				<div class="flex min-w-0 items-center gap-3">
					<div
						class="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-accent"
					>
						<Icon name="settings" size={15} />
					</div>
					<div class="min-w-0">
						<div class="mb-0.5 text-[13px] font-semibold text-text">Connect to the MCP server</div>
						<div class="text-[12px] text-text-muted">
							Setup instructions for Claude Code, Cursor, GitHub Copilot, and more
						</div>
					</div>
				</div>
				<button
					type="button"
					onclick={() => (showMcpGuide = true)}
					class="shrink-0 cursor-pointer rounded-lg border-[1.5px] border-border bg-transparent px-4 py-[7px] text-[13px] font-semibold text-accent transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--accent)_5%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
				>
					View guide →
				</button>
			</div>

			<!-- Newly generated token reveal -->
			{#if revealedToken}
				<div
					class="mb-5 rounded-[10px] border-[1.5px] border-[color-mix(in_srgb,var(--success)_30%,transparent)] bg-[color-mix(in_srgb,var(--success)_8%,var(--bg-card))] p-4"
				>
					<div class="mb-2 flex items-center gap-2 text-[12px] font-semibold text-success">
						<Icon name="check" size={13} />
						Token generated — copy it now, it won't be shown again
					</div>
					<div class="flex items-center gap-2">
						<code
							class="flex-1 truncate rounded-md bg-bg px-3 py-2 font-mono text-[12px] text-text"
						>
							{revealedToken}
						</code>
						<button
							onclick={copyToken}
							class="flex shrink-0 items-center gap-1.5 rounded-[7px] border border-[color-mix(in_srgb,var(--success)_40%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] px-3 py-1.5 text-[12px] font-medium text-success"
						>
							{#if copyLabel === 'Copied!'}
								<Icon name="check" size={12} />
							{/if}
							{copyLabel}
						</button>
					</div>
				</div>
			{/if}

			<!-- Revoke error banner -->
			{#if revokeError}
				<div
					class="mb-4 flex items-center gap-2 rounded-lg border border-[color-mix(in_oklch,var(--danger)_35%,transparent)] bg-[color-mix(in_oklch,var(--danger)_8%,transparent)] px-[14px] py-[10px] text-[13px] text-danger"
				>
					<Icon name="x" size={14} />
					{revokeError}
				</div>
			{/if}

			<!-- Token list -->
			{#if tokensLoading}
				<div class="mb-4 py-4 text-center text-[13px] text-text-faint">Loading tokens…</div>
			{:else if tokensError}
				<div class="mb-4 text-[13px] text-danger">{tokensError}</div>
			{:else if tokens.length > 0}
				<div class="mb-4 flex flex-col gap-2">
					{#each tokens as token (token.id)}
						<div
							class="flex items-center gap-3 rounded-[10px] border-[1.5px] border-border bg-bg px-4 py-3"
						>
							<div class="flex min-w-0 flex-1 flex-col gap-0.5">
								<span class="text-[13px] font-semibold text-text">{token.name}</span>
								<span class="font-mono text-[12px] text-text-faint">{token.masked}</span>
							</div>
							<div class="shrink-0 text-right text-[11px] text-text-faint">
								<div>Created {formatDate(token.createdAt)}</div>
								<div>Last used {relativeTime(token.lastUsed, token.createdAt)}</div>
							</div>
							<IconBtn danger title="Revoke token" onclick={() => revokeToken(token.id)}>
								<Icon name="trash" size={13} />
							</IconBtn>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Generate new token -->
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleGenerateToken();
				}}
				class="flex items-center gap-3"
			>
				<input
					type="text"
					placeholder="Token name (e.g. MCP Server)"
					bind:value={newTokenName}
					class="flex-1 text-[13px]"
				/>
				<Btn type="submit" loading={generateLoading} disabled={!newTokenName.trim()}>
					Generate token
				</Btn>
			</form>
		</div>
	</div>
</div>
