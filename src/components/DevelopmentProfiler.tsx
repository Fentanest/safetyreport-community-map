import { Profiler, type PropsWithChildren } from 'react';

/** Diagnostic boundary only. The production path has no Profiler or measurements. */
export default function DevelopmentProfiler({ id, children }: PropsWithChildren<{ id: string }>) {
  if (!import.meta.env.DEV) return children;
  return <Profiler id={id} onRender={(name, phase, actualDuration, baseDuration) => {
    const state = window as unknown as { __cmProfileEnabled?: boolean; __cmCommits?: unknown[] };
    if (!state.__cmProfileEnabled) return;
    const samples = state.__cmCommits ??= [];
    samples.push({ id: name, phase, actualDuration, baseDuration, at: performance.now() });
    if (samples.length > 5000) samples.splice(0, samples.length - 5000);
  }}>{children}</Profiler>;
}
