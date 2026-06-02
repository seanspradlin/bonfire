import { writable } from 'svelte/store';
import { browser } from '$app/environment';

function persisted<T>(key: string, def: T) {
	const initial: T = browser
		? ((JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? def)
		: def;
	const store = writable<T>(initial);
	if (browser) {
		store.subscribe((v) => localStorage.setItem(key, JSON.stringify(v)));
	}
	return store;
}

export const tweaks = persisted<{ theme: string; variant: string }>('teg_tweaks', {
	theme: 'light',
	variant: 'ember'
});
