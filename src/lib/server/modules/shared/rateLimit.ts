/**
 * Best-effort in-memory per-key rate limiter.
 *
 * NOTE: state lives in the process heap, so it is reset on restart and is NOT
 * shared across instances. It is sufficient to bound abuse and runaway AI cost
 * on a single Node instance; move to a shared store (Postgres/Redis) before
 * scaling horizontally.
 */

interface RateLimitEntry {
	count: number;
	windowStart: number;
}

export interface RateLimiter {
	/** Returns true when the key has exceeded its budget for the current window. */
	isLimited(key: string): boolean;
}

/**
 * Create a fixed-window rate limiter allowing `maxRequests` per `windowMs`.
 * Stale entries are swept on an interval so the backing map cannot grow
 * unbounded; the sweep timer is `unref()`-ed so it never blocks shutdown.
 */
export function createRateLimiter(maxRequests: number, windowMs: number): RateLimiter {
	const map = new Map<string, RateLimitEntry>();

	const sweepInterval = setInterval(
		() => {
			const now = Date.now();
			for (const [key, entry] of map) {
				if (now - entry.windowStart > windowMs) {
					map.delete(key);
				}
			}
		},
		Math.max(windowMs, 60_000)
	);
	sweepInterval.unref();

	return {
		isLimited(key: string): boolean {
			const now = Date.now();
			const entry = map.get(key);
			if (!entry || now - entry.windowStart > windowMs) {
				map.set(key, { count: 1, windowStart: now });
				return false;
			}
			entry.count += 1;
			return entry.count > maxRequests;
		}
	};
}
