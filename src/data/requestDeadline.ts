/** Bound the entire read, including auth refresh and response body consumption. */
// 30 s (2026-10-12 사용자 결정): 셀프호스트 실측 최악 약 11초(동시 4개 15초)의 2배이고, 서버(service_role)가 30초에
// 쿼리를 취소하므로 더 기다려도 얻는 것이 없다. 무료 클라우드 때 임시로 늘린 60초(2693180)를 대신한다.
export const ANALYTICS_READ_TIMEOUT_MS = 30_000;

export class AnalyticsReadTimeout extends Error {
  constructor() { super('Analytics read deadline exceeded'); this.name = 'AnalyticsReadTimeout'; }
}

export async function withReadDeadline<T>(read: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: () => void = () => {};
  const stopped = new Promise<never>((_, reject) => {
    cancel = () => {
      const reason = signal?.reason ?? new DOMException('Aborted', 'AbortError');
      reject(reason);
      controller.abort(reason);
    };
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      const reason = new AnalyticsReadTimeout();
      reject(reason);
      controller.abort(reason);
    }, ANALYTICS_READ_TIMEOUT_MS);
  });
  try {
    // The race also bounds auth/body implementations that do not respond to AbortSignal.
    return await Promise.race([stopped, controller.signal.aborted ? stopped : read(controller.signal)]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}
