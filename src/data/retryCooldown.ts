/**
 * Shared per-tab failure breaker (2026-10-11 사용자 보고: Supabase 장애 중 지도를 조작하면 탭 하나가 분당 수십 번
 * 요청을 보냈다). Every fetcher that goes through `read()`/`readWithinDeadline()` in `src/data/client.ts`, and the
 * personal-comparison client `src/data/personal.ts`, shares ONE cooldown: a network failure, 429 or 5xx anywhere
 * opens it, so a Supabase outage does not get hammered independently by the dashboard, statistics, personal
 * comparison, map viewport reads, etc.
 *
 * In-memory only — a module-level singleton, never written to localStorage/sessionStorage/IndexedDB. A reload or a
 * new tab always starts clear (no cross-tab/persisted state; this is a per-tab shock absorber, not a durable
 * schedule like the PC/모바일 upload retry).
 *
 * Policy (공통 원칙 모양을 그대로, 다만 지도 웹은 사용자가 보고 있는 화면이라 기준을 짧게 둔다):
 *   - jitter ±20% (uniform), exponential backoff BASE_SECONDS·2^(n-1) capped at MAX_SECONDS;
 *   - a server Retry-After that asks for longer always wins (the cooldown is never shortened below it);
 *   - a success resets the streak (n = 0) and clears the cooldown immediately, UNLESS a newer failure was
 *     recorded after that success's own request started (Astra 검수 ②, 2026-10-12: two requests can race —
 *     a later-starting one fails and opens/extends the breaker while an earlier, still in-flight one later
 *     succeeds; that late success must not erase the newer failure's streak or server deadline);
 *   - a plain 4xx (other than 429) is not a service outage and never opens or extends the breaker.
 */

export interface CooldownOutcome {
  /** HTTP status of the failed attempt; null for a network-level failure (no response at all). */
  status: number | null;
  /** The server's Retry-After, in seconds, when present and positive; otherwise null/undefined. */
  retryAfterSeconds?: number | null;
}

export interface CooldownBlock {
  /** Whole seconds remaining until a new request may start (always ≥ 1 while blocked). */
  retryAfterSeconds: number;
}

const BASE_SECONDS = 5;
const MAX_SECONDS = 120;
const JITTER_RATIO = 0.2;

/** Network failure, 429 or any 5xx counts; any other status (400/401/403/404/409/422…) is not an outage signal. */
export function isCooldownFailure(status: number | null): boolean {
  return status === null || status === 429 || status >= 500;
}

export class RetryCooldown {
  private untilMs = 0;
  private streak = 0;
  /** Bumped by every recorded failure. A success only clears the streak/deadline when it started at (or after)
   *  the generation current at the time it is reported — see {@link currentGeneration} / {@link recordSuccess}. */
  private generation = 0;

  constructor(private readonly now: () => number = () => Date.now(), private readonly random: () => number = Math.random) {}

  /** ms remaining until a request may start; 0 (never negative) once the cooldown has elapsed. */
  remainingMs(): number {
    return Math.max(0, this.untilMs - this.now());
  }

  /** null while clear; otherwise the whole seconds a caller must wait before trying the network again. */
  blockedError(): CooldownBlock | null {
    const ms = this.remainingMs();
    return ms > 0 ? { retryAfterSeconds: Math.max(1, Math.ceil(ms / 1000)) } : null;
  }

  /** Current consecutive-failure streak (diagnostics / tests only). */
  failureStreak(): number {
    return this.streak;
  }

  /** Snapshot a caller must take right before it starts a request (after passing {@link blockedError}'s gate),
   *  and hand back to {@link recordSuccess} when that same request succeeds. It never changes on its own with
   *  time or on a success — only {@link recordFailure} advances it. */
  currentGeneration(): number {
    return this.generation;
  }

  /** A request reached the server (or came back) and succeeded: forgets every past failure — UNLESS a newer
   *  failure was recorded after this request started (its generation no longer matches {@link currentGeneration}).
   *  In that race, the newer failure's streak and server deadline must stand; this late success is a no-op.
   *  @param startGeneration the value {@link currentGeneration} returned when THIS request started. Every
   *  production caller passes it; omitting it keeps the simple "always reset" behaviour for a caller that never
   *  shares this breaker with a concurrent request. */
  recordSuccess(startGeneration: number = this.generation): void {
    if (startGeneration !== this.generation) return;
    this.streak = 0;
    this.untilMs = 0;
  }

  /** Call once per failed attempt that is network/429/5xx (see {@link isCooldownFailure}); any other status is a
   *  no-op (a 400/403/404/409/422 answer is the server working normally, not an outage). */
  recordFailure(outcome: CooldownOutcome): void {
    if (!isCooldownFailure(outcome.status)) return;
    this.generation += 1;
    this.streak += 1;
    const backoff = Math.min(MAX_SECONDS, BASE_SECONDS * 2 ** (this.streak - 1));
    const jittered = backoff * (1 + (this.random() * 2 - 1) * JITTER_RATIO);
    const serverSeconds = outcome.retryAfterSeconds && outcome.retryAfterSeconds > 0 ? outcome.retryAfterSeconds : 0;
    const seconds = Math.max(jittered, serverSeconds);
    const until = this.now() + seconds * 1000;
    // A later, shorter computation (e.g. a smaller streak elsewhere racing in) never cuts an existing wait short.
    if (until > this.untilMs) this.untilMs = until;
  }
}

/**
 * Parses an HTTP `Retry-After` header value (RFC 9110 §10.2.3): either delta-seconds ("120") or an HTTP-date
 * ("Wed, 21 Oct 2026 07:28:00 GMT"). Returns whole seconds from `now()` when the value is present and resolves to
 * a positive wait, otherwise null — never `NaN`. Shared by every fetcher that reads this header
 * (`src/data/client.ts`, `src/data/personal.ts`, `src/data/rankings.ts`) so a server's HTTP-date Retry-After is
 * honored exactly like the common delta-seconds form instead of being silently discarded by a numbers-only parse
 * (Astra 검수 ⑤, 2026-10-12).
 */
export function parseRetryAfterHeader(value: string | null | undefined, now: () => number = Date.now): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds > 0 ? seconds : null;
  }
  const whenMs = Date.parse(trimmed);
  if (!Number.isFinite(whenMs)) return null;
  const seconds = Math.ceil((whenMs - now()) / 1000);
  return seconds > 0 ? seconds : null;
}

/** The one breaker this tab's fetchers share. Tests construct their own `new RetryCooldown(fakeNow, fakeRandom)`. */
export const sharedRetryCooldown = new RetryCooldown();
