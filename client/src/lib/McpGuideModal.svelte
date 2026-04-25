<script lang="ts">
	import { untrack } from 'svelte';
	import Icon from '$lib/Icon.svelte';

	interface Props {
		isOpen: boolean;
		onClose: () => void;
	}

	let { isOpen = false, onClose }: Props = $props();

	let dialogEl = $state<HTMLDialogElement | null>(null);
	let activeTab = $state<'claudecode' | 'cursor' | 'vscode' | 'other'>('claudecode');
	let copyLabel = $state('Copy');
	// Tracks the element that opened the modal so we can restore focus on close.
	let triggerEl: Element | null = null;

	const SERVER_URL = 'https://bonfire.example.com/mcp';

	type Tab = {
		id: 'claudecode' | 'cursor' | 'vscode' | 'other';
		label: string;
	};

	const tabs: Tab[] = [
		{ id: 'claudecode', label: 'Claude Code' },
		{ id: 'cursor', label: 'Cursor' },
		{ id: 'vscode', label: 'VS Code' },
		{ id: 'other', label: 'Other' }
	];

	type TabContent = {
		steps: string[];
		code: string;
	};

	const tabContent: Record<Tab['id'], TabContent> = {
		claudecode: {
			steps: [
				'Generate an access token from the section below and copy it.',
				'Run the command below in your terminal, replacing YOUR_TOKEN_HERE with your token.',
				'Bonfire will appear as a connected MCP tool in Claude Code.'
			],
			code: `claude mcp add --transport http bonfire --scope user ${SERVER_URL} --header "Authorization: Bearer YOUR_TOKEN_HERE"`
		},
		cursor: {
			steps: [
				'Generate an access token and copy it.',
				'Open Cursor → Settings → MCP Servers.',
				'Click "Add Server" and enter the details below.',
				'Save and reload the window.'
			],
			code: `// Cursor MCP Server config
{
  "name": "Bonfire",
  "url": "${SERVER_URL}",
  "auth": {
    "type": "bearer",
    "token": "YOUR_TOKEN_HERE"
  }
}`
		},
		vscode: {
			steps: [
				'Generate an access token and copy it.',
				'Press Cmd+Shift+P and select "MCP: Open User Configuration".',
				'Under "servers", add the entry shown below.',
				'Save — VS Code will connect automatically.'
			],
			code: `// MCP User Configuration (VS Code)
{
  "servers": {
    "bonfire": {
      "url": "${SERVER_URL}",
      "type": "http",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN_HERE"
      }
    }
  }
}`
		},
		other: {
			steps: [
				'Generate an access token and copy it.',
				'Point your MCP client to the server URL below.',
				'Pass your token as a Bearer token in the Authorization header.',
				"Refer to your client's documentation for exact configuration steps."
			],
			code: `// Generic MCP connection
Server URL:  ${SERVER_URL}
Auth header: Authorization: Bearer YOUR_TOKEN_HERE
Protocol:    MCP over HTTP/SSE`
		}
	};

	const currentContent = $derived(tabContent[activeTab]);

	// Bridge reactive `isOpen` to the imperative native <dialog> API.
	$effect(() => {
		if (!dialogEl) return;
		if (isOpen) {
			untrack(() => {
				activeTab = 'claudecode';
				copyLabel = 'Copy';
			});
			triggerEl = document.activeElement;
			dialogEl.showModal();
		} else {
			dialogEl.close();
		}
	});

	function handleClose() {
		onClose();
		(triggerEl as HTMLElement | null)?.focus();
	}

	// The native <dialog> fires a 'close' event on Escape — sync that back to the parent.
	function handleDialogClose() {
		onClose();
		(triggerEl as HTMLElement | null)?.focus();
	}

	async function copyCode() {
		await navigator.clipboard.writeText(currentContent.code);
		copyLabel = 'Copied!';
		setTimeout(() => (copyLabel = 'Copy'), 2000);
	}
</script>

<!--
	Using native <dialog> gives us:
	  - Built-in focus trap (Tab cycles within the dialog)
	  - Escape key closes the modal automatically
	  - Correct ARIA semantics (role="dialog" + aria-modal implied)
-->
<dialog
	bind:this={dialogEl}
	onclose={handleDialogClose}
	aria-labelledby="mcp-guide-title"
	class="m-auto w-[90%] max-w-[580px] max-h-[85vh] overflow-hidden rounded-2xl border border-border bg-bg-card p-0 shadow-[0_24px_64px_rgba(0,0,0,0.25)] backdrop:bg-black/45 backdrop:backdrop-blur-[3px]"
>
	<!-- Header -->
	<div class="px-7 pt-6 pb-0">
		<div class="mb-1.5 flex items-start justify-between gap-4">
			<div>
				<h2 id="mcp-guide-title" class="text-lg font-bold tracking-[-0.02em] text-text">
					Connect to the MCP Server
				</h2>
				<p class="mt-1 text-[13px] leading-[1.5] text-text-muted">
					Use your bearer token to authenticate Bonfire as an MCP tool in your AI coding
					environment.
				</p>
			</div>
			<button
				type="button"
				onclick={handleClose}
				class="mt-0.5 shrink-0 cursor-pointer rounded-md border-none bg-transparent p-0.5 text-text-faint hover:text-text-muted transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
				aria-label="Close dialog"
			>
				<Icon name="x" size={16} />
			</button>
		</div>

		<!-- Tab row -->
		<div class="mt-4 flex gap-1 border-b border-border">
			{#each tabs as tab (tab.id)}
				<button
					onclick={() => {
						activeTab = tab.id;
						copyLabel = 'Copy';
					}}
					class={[
						'cursor-pointer border-0 bg-transparent px-3 py-2 text-[13px] border-b-2 -mb-px transition-colors duration-150',
						activeTab === tab.id
							? 'font-semibold text-accent border-accent'
							: 'font-normal text-text-muted border-transparent'
					].join(' ')}
				>
					{tab.label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Scrollable body -->
	<div class="overflow-y-auto px-7 pt-5 pb-6">
		<!-- Numbered steps -->
		<ol class="mb-5 flex flex-col gap-3">
			{#each currentContent.steps as step, i (i)}
				<li class="flex items-start gap-3">
					<span
						class="mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full border bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] border-[color-mix(in_srgb,var(--accent)_35%,transparent)] text-[11px] font-bold text-accent"
					>
						{i + 1}
					</span>
					<span class="text-[13px] leading-[1.6] text-text-muted">{step}</span>
				</li>
			{/each}
		</ol>

		<!-- Code block -->
		<div class="mb-5 overflow-hidden rounded-[10px] border border-border bg-bg">
			<div class="flex items-center justify-between px-4 py-2.5 border-b border-border">
				<span class="text-[10px] font-bold tracking-[0.08em] text-text-faint uppercase">
					Config
				</span>
				<button
					type="button"
					onclick={copyCode}
					class={[
						'flex cursor-pointer items-center gap-1.5 rounded-[7px] border px-2.5 py-1 text-[11px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
						copyLabel === 'Copied!'
							? 'border-[color-mix(in_srgb,var(--accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-accent'
							: 'border-border bg-transparent text-text-muted hover:bg-bg-hover hover:text-text'
					].join(' ')}
				>
					{#if copyLabel === 'Copied!'}
						<Icon name="check" size={11} />
					{/if}
					{copyLabel}
				</button>
			</div>
			<pre class="overflow-x-auto px-4 py-4 font-mono text-[12px] leading-[1.7] text-text">{currentContent.code}</pre>
		</div>

		<!-- Security callout -->
		<div
			class="rounded-[10px] border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_7%,transparent)] px-4 py-3 text-[12px] leading-[1.6] text-text-muted"
		>
			<strong class="font-semibold text-text">Remember:</strong> Replace
			<code class="rounded bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-1 font-mono text-[11px] text-accent">YOUR_TOKEN_HERE</code>
			with the token you generate below. Keep it secret — treat it like a password.
		</div>
	</div>
</dialog>
