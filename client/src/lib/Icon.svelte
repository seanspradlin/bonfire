<script lang="ts">
	const { name, size = 16 }: { name: string; size?: number } = $props();

	const PATHS: Record<string, string> = {
		lock: `<rect x="3" y="7" width="10" height="8" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
		mail: `<rect x="1.5" y="3.5" width="13" height="9" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M1.5 5l6.5 4.5L14.5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
		eye: `<path d="M1 8s3-5 7-5 7 5 7 5-3 5-7 5-7-5-7-5z" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/>`,
		eyeOff: `<path d="M2 2l12 12M6.5 6.6A3 3 0 0111.4 11M4 4.6C2.5 5.8 1 8 1 8s3 5 7 5c1.4 0 2.7-.5 3.8-1.2M7 3.1C7.3 3 7.7 3 8 3c4 0 7 5 7 5s-.7 1.2-2 2.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
		users: `<circle cx="6" cy="5" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M1 13c0-2.8 2.2-5 5-5s5 2.2 5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M11 7.5c1.4.3 2.5 1.5 2.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M13 4a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" stroke="currentColor" stroke-width="1.5"/>`,
		upload: `<path d="M8 10V3M5 6l3-3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 11v1.5A1.5 1.5 0 003.5 14h9a1.5 1.5 0 001.5-1.5V11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
		plus: `<path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
		search: `<circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
		settings: `<circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
		logout: `<path d="M6 2H3a1 1 0 00-1 1v10a1 1 0 001 1h3M11 11l3-3-3-3M5 8h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
		pdf: `<path d="M10 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5l-3-4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 1v4h3" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.5 9h2M5.5 11h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
		image: `<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.5"/><circle cx="5.5" cy="6" r="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M1.5 11l4-4 3 3 2-2 3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
		trash: `<path d="M2 4h12M5 4V2.5a.5.5 0 01.5-.5h5a.5.5 0 01.5.5V4M6 7v5M10 7v5M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
		check: `<path d="M2.5 8.5l4 4 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
		chevronDown: `<path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
		x: `<path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
		flame: `<path d="M8 14c-3 0-5-2-5-4.5 0-1.5.8-3 2-4-.2 1 .4 2 1 2.5-.1-2 1-4 3-5.5-.3 2 1 3.5 2.5 4-.3-1 0-2 .5-2.5 1 1 2 2.5 2 4.5C14 12 11 14 8 14z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
		sun: `<circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`,
		moon: `<path d="M13.5 10A6 6 0 016 2.5c0-.2 0-.4.01-.6A7 7 0 1013.5 10z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`,
		file: `<path d="M10 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5l-3-4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M10 1v4h3" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.5 7h5M5.5 9h5M5.5 11h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
		pencil: `<path d="M11.5 2.5l2 2L5 13l-2.5.5.5-2.5L11.5 2.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`
	};
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 16 16"
	fill="none"
	style="display:inline-block;flex-shrink:0"
>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html PATHS[name] ?? ''}
</svg>
