import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from './rateLimit';

describe('createRateLimiter', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('allows up to maxRequests within a window, then blocks', () => {
		const limiter = createRateLimiter(3, 60_000);

		expect(limiter.isLimited('user-1')).toBe(false); // 1
		expect(limiter.isLimited('user-1')).toBe(false); // 2
		expect(limiter.isLimited('user-1')).toBe(false); // 3
		expect(limiter.isLimited('user-1')).toBe(true); // 4 — over budget
	});

	it('tracks keys independently', () => {
		const limiter = createRateLimiter(1, 60_000);

		expect(limiter.isLimited('a')).toBe(false);
		expect(limiter.isLimited('a')).toBe(true);
		// A different key has its own fresh budget.
		expect(limiter.isLimited('b')).toBe(false);
	});

	it('resets after the window elapses', () => {
		const limiter = createRateLimiter(1, 60_000);

		expect(limiter.isLimited('user-1')).toBe(false);
		expect(limiter.isLimited('user-1')).toBe(true);

		vi.advanceTimersByTime(60_001);

		expect(limiter.isLimited('user-1')).toBe(false);
	});
});
