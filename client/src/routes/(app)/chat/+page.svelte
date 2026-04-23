<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import Icon from '$lib/Icon.svelte';
	import Markdown from '$lib/Markdown.svelte';
	import PageHeader from '$lib/PageHeader.svelte';

	type Role = 'assistant' | 'user';

	type Source = { id: string; title: string };

	type Message = {
		id: number;
		role: Role;
		/** Authoritative text received from the server. */
		text: string;
		/** Smoothed typewriter output that trails `text`; falls back to `text` for static messages. */
		displayed?: string;
		/** Short status line shown while a tool call is in flight. */
		status?: string;
		sources?: Source[];
	};

	const WELCOME_MESSAGE =
		"Hi! I'm Bonfire, your knowledge base assistant. Ask me anything about the team's operations, training materials, or procedures.";

	let messages = $state<Message[]>([{ id: 0, role: 'assistant', text: WELCOME_MESSAGE }]);

	let inputText = $state('');
	let loading = $state(false);
	let nextId = $state(1);
	let bottomRef = $state<HTMLElement | null>(null);
	/** ID of the assistant message currently receiving deltas; drives cursor + pump. */
	let streamingId = $state<number | null>(null);

	let animFrame: number | null = null;
	/** AbortController for the in-flight fetch; replaced on each new send. */
	let abortController: AbortController | null = null;

	onDestroy(() => {
		if (animFrame !== null) cancelAnimationFrame(animFrame);
		abortController?.abort();
	});

	/**
	 * Advance each assistant message's `displayed` string toward its full `text`.
	 * Uses a proportional step so small deltas reveal quickly while large bursts
	 * still feel like typing.
	 */
	function pumpTypewriter() {
		let anyBehind = false;
		messages = messages.map((m) => {
			if (m.role !== 'assistant') return m;
			const shown = m.displayed ?? m.text;
			if (shown.length >= m.text.length) return m;
			anyBehind = true;
			const remaining = m.text.length - shown.length;
			// min 2 chars/frame (~120 char/sec) scaling up to remaining/6 when backlogged.
			const step = Math.max(2, Math.ceil(remaining / 6));
			return { ...m, displayed: m.text.slice(0, shown.length + step) };
		});

		// Keep pumping while either text is still catching up or a stream is active
		// (more deltas may arrive).
		if (anyBehind || streamingId !== null) {
			animFrame = requestAnimationFrame(pumpTypewriter);
		} else {
			animFrame = null;
		}
	}

	function ensurePumpRunning() {
		if (animFrame === null) {
			animFrame = requestAnimationFrame(pumpTypewriter);
		}
	}

	// Scroll to bottom on new messages or status/displayed-text updates.
	$effect(() => {
		const _len = messages.length;
		const _last = messages[messages.length - 1];
		const _signal = `${_len}:${(_last?.displayed ?? _last?.text ?? '').length}:${_last?.status ?? ''}`;
		void _signal;
		tick().then(() => {
			bottomRef?.scrollIntoView({ behavior: 'smooth' });
		});
	});

	function toolStatusLabel(name: string): string {
		switch (name) {
			case 'query_knowledge_base':
			case 'search_documents':
				return 'Searching knowledge base…';
			case 'get_document':
				return 'Reading document…';
			case 'list_documents':
				return 'Listing documents…';
			default:
				return `Using ${name}…`;
		}
	}

	function updateAssistant(assistantId: number, patch: Partial<Message>) {
		messages = messages.map((m) => (m.id === assistantId ? { ...m, ...patch } : m));
	}

	function buildHistory(userText: string) {
		// Omit the static welcome message; send only real turns.
		const prior = messages.filter((m) => m.id !== 0).map(({ role, text }) => ({ role, text }));
		return [...prior, { role: 'user' as const, text: userText }];
	}

	async function sendMessage() {
		const text = inputText.trim();
		if (!text || loading) return;

		// Abort any in-flight request before starting a new one.
		abortController?.abort();
		abortController = new AbortController();

		inputText = '';
		const userId = nextId++;
		const assistantId = nextId++;
		messages = [
			...messages,
			{ id: userId, role: 'user', text },
			{ id: assistantId, role: 'assistant', text: '', displayed: '', status: 'Thinking…' }
		];
		loading = true;
		streamingId = assistantId;
		ensurePumpRunning();

		try {
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ messages: buildHistory(text) }),
				signal: abortController.signal
			});

			if (!response.ok || !response.body) {
				throw new Error(`Chat request failed (${response.status})`);
			}

			await consumeSseStream(response.body, assistantId);
		} catch (err) {
			console.error(err);
			updateAssistant(assistantId, {
				status: undefined,
				text: "Sorry, I couldn't reach the knowledge base right now. Please try again."
			});
		} finally {
			loading = false;
			streamingId = null;
			// Pump stays alive on its own until `displayed` catches up to `text`.
		}
	}

	async function consumeSseStream(body: ReadableStream<Uint8Array>, assistantId: number) {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			// SSE frames are separated by a blank line.
			let sep: number;
			while ((sep = buffer.indexOf('\n\n')) !== -1) {
				const frame = buffer.slice(0, sep);
				buffer = buffer.slice(sep + 2);
				handleSseFrame(frame, assistantId);
			}
		}
	}

	function handleSseFrame(frame: string, assistantId: number) {
		let eventName = 'message';
		const dataLines: string[] = [];
		for (const line of frame.split('\n')) {
			if (line.startsWith('event:')) eventName = line.slice(6).trim();
			else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
		}
		const dataRaw = dataLines.join('\n');
		if (eventName === 'done') return;
		if (!dataRaw) return;

		let data: unknown;
		try {
			data = JSON.parse(dataRaw);
		} catch {
			return;
		}

		const current = messages.find((m) => m.id === assistantId);
		if (!current) return;

		switch (eventName) {
			case 'text': {
				const delta = (data as { delta?: string }).delta ?? '';
				updateAssistant(assistantId, {
					status: undefined,
					text: current.text + delta
				});
				ensurePumpRunning();
				break;
			}
			case 'tool_use': {
				const name = (data as { name?: string }).name ?? '';
				updateAssistant(assistantId, { status: toolStatusLabel(name) });
				break;
			}
			case 'tool_result': {
				// Keep status visible until the next text delta arrives — it clears naturally there.
				break;
			}
			case 'sources': {
				const sources = Array.isArray(data) ? (data as Source[]) : [];
				updateAssistant(assistantId, { sources });
				break;
			}
			case 'error': {
				const message = (data as { message?: string }).message ?? 'Unknown error';
				updateAssistant(assistantId, {
					status: undefined,
					text: current.text || `Error: ${message}`
				});
				break;
			}
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	}
</script>

<div class="flex h-screen flex-col">
	<!-- Header -->
	<div class="border-b border-border bg-bg-card px-8 py-5">
		<PageHeader title="Chat" subtitle="Ask questions about your knowledge base" />
	</div>

	<!-- Messages area -->
	<div class="flex flex-1 flex-col gap-4 overflow-auto px-8 py-6">
		{#each messages as message (message.id)}
			{#if message.role === 'assistant'}
				<div class="flex flex-row items-end gap-3">
					<!-- Flame avatar -->
					<div
						class="flex size-8 shrink-0 items-center justify-center rounded-full border border-accent bg-accent-bg text-accent"
					>
						<Icon name="flame" size={14} />
					</div>
					<!-- Bubble -->
					<div
						class="max-w-[70%] rounded-[14px_14px_14px_4px] border-[1.5px] border-border bg-bg-card px-4 py-3 text-[14px] leading-relaxed text-text"
					>
						{#if message.status && !(message.displayed ?? message.text)}
							<div class="flex items-center gap-2 text-text-muted">
								<span class="size-[6px] animate-pulse rounded-full bg-accent [animation-delay:0ms]"
								></span>
								<span
									class="size-[6px] animate-pulse rounded-full bg-accent [animation-delay:150ms]"
								></span>
								<span
									class="size-[6px] animate-pulse rounded-full bg-accent [animation-delay:300ms]"
								></span>
								<span class="text-[13px]">{message.status}</span>
							</div>
						{:else}
							{@const shown = message.displayed ?? message.text}
							{@const isStreaming =
								streamingId === message.id || shown.length < message.text.length}
							<Markdown text={shown} />
							{#if isStreaming && !message.status}
								<span class="md-cursor" aria-hidden="true"></span>
							{/if}
							{#if message.status}
								<div class="mt-2 flex items-center gap-2 text-text-muted">
									<span
										class="size-[6px] animate-pulse rounded-full bg-accent [animation-delay:0ms]"
									></span>
									<span class="text-[12px]">{message.status}</span>
								</div>
							{/if}
							{#if message.sources && message.sources.length > 0}
								<div class="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-2">
									<span class="text-[11px] tracking-wide text-text-faint uppercase">Sources</span>
									{#each message.sources as source (source.id)}
										<span
											class="rounded-md border border-border bg-bg px-1.5 py-0.5 text-[11px] text-text-muted"
										>
											{source.title}
										</span>
									{/each}
								</div>
							{/if}
						{/if}
					</div>
				</div>
			{:else}
				<div class="flex flex-row-reverse items-end gap-3">
					<!-- Bubble (no avatar for user) -->
					<div
						class="max-w-[70%] rounded-[14px_14px_4px_14px] bg-accent px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap text-white"
					>
						{message.text}
					</div>
				</div>
			{/if}
		{/each}

		<!-- Scroll anchor -->
		<div bind:this={bottomRef}></div>
	</div>

	<!-- Input bar -->
	<div class="border-t border-border bg-bg-card px-8 pt-4 pb-6">
		<div class="flex items-center gap-3">
			<input
				type="text"
				placeholder="Ask Bonfire anything…"
				bind:value={inputText}
				onkeydown={handleKeydown}
				disabled={loading}
				class="flex-1 text-[14px]"
			/>
			<button
				onclick={sendMessage}
				disabled={!inputText.trim() || loading}
				class="flex shrink-0 items-center gap-2 rounded-[9px] border-0 bg-accent px-5 py-[11px] text-sm font-medium text-white transition-opacity duration-200 disabled:opacity-50"
			>
				Send
			</button>
		</div>
	</div>
</div>

<style>
	.md-cursor {
		display: inline-block;
		width: 2px;
		height: 1em;
		margin-left: 2px;
		vertical-align: text-bottom;
		background: var(--accent);
		animation: md-cursor-blink 1.05s steps(2, start) infinite;
	}

	@keyframes md-cursor-blink {
		to {
			visibility: hidden;
		}
	}
</style>
