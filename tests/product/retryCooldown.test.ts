import { describe, expect, it } from 'vitest';
import { isCooldownFailure, RetryCooldown } from '../../src/data/retryCooldown';

/** Shared per-tab failure breaker (cloud-retry-brief.md 지도 웹 ①): a manual clock and a fixed "random" so the
 *  jitter/backoff math is exact, never flaky. */
function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe('RetryCooldown', () => {
  it('is clear until the first failure, and a 400/403/404/409/422 never opens it', () => {
    const { now } = clock();
    const c = new RetryCooldown(now, () => 0.5);
    expect(c.blockedError()).toBeNull();
    for (const status of [400, 401, 403, 404, 409, 422]) c.recordFailure({ status });
    expect(c.blockedError()).toBeNull();
    expect(c.failureStreak()).toBe(0);
  });

  it.each([null, 429, 500, 503])('opens on a network failure / 429 / 5xx (status=%s)', (status) => {
    const { now } = clock();
    const c = new RetryCooldown(now, () => 0.5); // random=0.5 → jitter factor exactly 1 (no ± spread)
    c.recordFailure({ status });
    const blocked = c.blockedError();
    expect(blocked).not.toBeNull();
    expect(blocked!.retryAfterSeconds).toBe(5); // BASE_SECONDS
  });

  it('doubles the backoff on each consecutive failure, capped at 120s', () => {
    const clk = clock();
    const c = new RetryCooldown(clk.now, () => 0.5);
    const seenSeconds: number[] = [];
    for (let i = 0; i < 8; i++) {
      c.recordFailure({ status: 503 });
      seenSeconds.push(c.blockedError()!.retryAfterSeconds);
      clk.advance(seenSeconds[i] * 1000 + 1); // let the wait fully elapse before the next failure
    }
    // 5, 10, 20, 40, 80, 120 (capped), 120, 120
    expect(seenSeconds).toEqual([5, 10, 20, 40, 80, 120, 120, 120]);
  });

  it('jitters ±20% around the exponential backoff', () => {
    const { now } = clock();
    const low = new RetryCooldown(now, () => 0); // factor 0.8
    low.recordFailure({ status: 503 });
    expect(low.blockedError()!.retryAfterSeconds).toBe(4); // ceil(5 * 0.8)
    const high = new RetryCooldown(now, () => 1); // factor 1.2
    high.recordFailure({ status: 503 });
    expect(high.blockedError()!.retryAfterSeconds).toBe(6); // ceil(5 * 1.2)
  });

  it('never shortens the wait below a longer server Retry-After', () => {
    const { now } = clock();
    const c = new RetryCooldown(now, () => 0.5);
    c.recordFailure({ status: 429, retryAfterSeconds: 90 }); // far longer than the 5s backoff
    expect(c.blockedError()!.retryAfterSeconds).toBe(90);
  });

  it('a server Retry-After shorter than the computed backoff never shortens it either', () => {
    const { now } = clock();
    const c = new RetryCooldown(now, () => 0.5);
    c.recordFailure({ status: 503, retryAfterSeconds: 1 }); // backoff (5s) wins
    expect(c.blockedError()!.retryAfterSeconds).toBe(5);
  });

  it('a later failure never cuts an existing, longer wait short', () => {
    const { now } = clock();
    const c = new RetryCooldown(now, () => 0.5);
    c.recordFailure({ status: 429, retryAfterSeconds: 90 });
    c.recordFailure({ status: 503 }); // computed backoff (10s at streak 2) is shorter than the remaining 90s
    expect(c.blockedError()!.retryAfterSeconds).toBe(90);
  });

  it('counts down to clear, then a success resets the streak to 0', () => {
    const clk = clock();
    const c = new RetryCooldown(clk.now, () => 0.5);
    c.recordFailure({ status: 503 });
    expect(c.blockedError()!.retryAfterSeconds).toBe(5);
    clk.advance(4000);
    expect(c.blockedError()!.retryAfterSeconds).toBe(1);
    clk.advance(1000);
    expect(c.blockedError()).toBeNull();
    // Only a SUCCESS resets the streak (공통 원칙: 성공하면 n=0) — the wait merely elapsing does not forgive a
    // server that is still failing, so a next failure backs off further (streak 2 → 10s), not back to base.
    c.recordFailure({ status: 503 });
    expect(c.blockedError()!.retryAfterSeconds).toBe(10);
    c.recordSuccess();
    expect(c.blockedError()).toBeNull();
    expect(c.failureStreak()).toBe(0);
  });

  it('isCooldownFailure matches the breaker rule exactly', () => {
    expect(isCooldownFailure(null)).toBe(true);
    expect(isCooldownFailure(429)).toBe(true);
    expect(isCooldownFailure(500)).toBe(true);
    expect(isCooldownFailure(503)).toBe(true);
    for (const status of [200, 400, 401, 403, 404, 409, 422]) expect(isCooldownFailure(status)).toBe(false);
  });
});
