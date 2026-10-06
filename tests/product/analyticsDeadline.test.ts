import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANALYTICS_READ_TIMEOUT_MS, AnalyticsReadTimeout, withReadDeadline } from '../../src/data/requestDeadline';
import { PublicApiError, read } from '../../src/data/client';

const auth = vi.hoisted(() => ({ settled: vi.fn(), accessToken: vi.fn(), refreshToken: vi.fn() }));
vi.mock('../../src/hooks/usePersonal', () => ({ mapAuth: () => auth }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('VITE_PUBLIC_ANALYTICS_URL', 'https://local.invalid/functions/v1');
  auth.settled.mockResolvedValue(undefined);
  auth.accessToken.mockResolvedValue('synthetic-token');
  auth.refreshToken.mockResolvedValue('synthetic-refreshed');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
const never = () => new Promise<never>(() => {});

describe('analytics read deadline', () => {
  it('aborts a stalled request at the read deadline with a visible code, without claiming an HTTP response', async () => {
    const fetcher = vi.fn(never); vi.stubGlobal('fetch', fetcher);
    const result = read('@screen', null);
    const check = expect(result).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT', status: null,
      message: expect.stringContaining(`${ANALYTICS_READ_TIMEOUT_MS / 1000}초`) });
    await vi.advanceTimersByTimeAsync(ANALYTICS_READ_TIMEOUT_MS - 1);
    expect(fetcher.mock.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); await check;
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds a stalled response body after headers arrive', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: never }));
    const check = expect(read('@screen', null)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(ANALYTICS_READ_TIMEOUT_MS); await check;
  });
  it('bounds stalled auth and prevents a late token from sending a request', async () => {
    let release!: () => void;
    auth.settled.mockReturnValue(new Promise<void>(resolve => { release = resolve; }));
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const check = expect(read('@screen', null)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(ANALYTICS_READ_TIMEOUT_MS); await check;
    release(); await vi.advanceTimersByTimeAsync(0); expect(fetcher).not.toHaveBeenCalled();
  });
  it('shares one deadline with the 401 refresh and second body read', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 401 })).mockImplementationOnce(never);
    vi.stubGlobal('fetch', fetcher);
    auth.refreshToken.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve('new'), 15_000)));
    const check = expect(read('@screen', null)).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(ANALYTICS_READ_TIMEOUT_MS); await check;
    expect(fetcher).toHaveBeenCalledTimes(2); expect(auth.refreshToken).toHaveBeenCalledTimes(1);
  });
  it('cleans up on success, leaving the response and caller signal intact', async () => {
    const caller = new AbortController();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}')));
    expect(await read('@screen', null, caller.signal)).toEqual({ ok: true });
    expect(vi.getTimerCount()).toBe(0); expect(caller.signal.aborted).toBe(false);
  });
  it('preserves scope-change cancellation instead of reporting a timeout', async () => {
    const caller = new AbortController();
    const check = expect(withReadDeadline(never, caller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    caller.abort(); await check; expect(vi.getTimerCount()).toBe(0);
  });
  it('does not start a read that was already cancelled', async () => {
    const caller = new AbortController(); caller.abort(); const fn = vi.fn(never);
    await expect(withReadDeadline(fn, caller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fn).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it('rejects even when an operation ignores cancellation', async () => {
    const check = expect(withReadDeadline(never)).rejects.toBeInstanceOf(AnalyticsReadTimeout);
    await vi.advanceTimersByTimeAsync(ANALYTICS_READ_TIMEOUT_MS); await check;
  });
  it.each([['AGGREGATE_NOT_READY', 503], ['RESULT_TOO_LARGE', 422], ['RATE_LIMITED', 429], ['WORKER_LIMIT', 546]])(
    'keeps diagnostic code %s and HTTP %s in the visible message', async (code, status) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code, message: '통계를 불러오지 못했습니다.' } }), { status })));
      await expect(read('@screen', null)).rejects.toMatchObject({ code, status, message: expect.stringContaining(`오류 코드 ${code}, HTTP ${status}`) });
      expect(vi.getTimerCount()).toBe(0);
    });
  it('preserves access-gate codes and threshold progress', async () => {
    const error = { code: 'upload_required', message: '공유가 필요합니다.', details: { required: 10, current: 9 } };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error }), { status: 403 })));
    await expect(read('@screen', null)).rejects.toEqual(new PublicApiError(error.message, 403, null, error.code, error.details));
  });
});
