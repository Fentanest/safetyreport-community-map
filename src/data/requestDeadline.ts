/** Bound the entire read, including auth refresh and response body consumption. */
export const ANALYTICS_READ_TIMEOUT_MS = 20_000;

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
