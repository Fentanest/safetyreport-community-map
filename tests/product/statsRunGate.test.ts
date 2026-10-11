import { describe, expect, it, vi } from 'vitest';
import { RunGate } from '../../src/state/statistics';

/**
 * S04 ③ (Astra 검수 2026-10-12, 지도/src/pages/StatisticsPage.tsx:149): 차단기 대기 중 새 조회 B를 접수할 때 이전
 * 실행 A를 취소·세대 증가하지 않아 A의 늦은 완료가 표시되고 B는 실행되지 않던 버그. `RunGate.accept()`가 "지금 바로
 * fetch할지 쿨다운을 기다릴지" 분기 **앞에서 무조건** 이전 실행을 취소하고 세대를 올리게 해서, 두 경로가 다시는
 * 갈라지지 않도록 한다.
 */
describe('RunGate (statistics execute() 세대 가드)', () => {
  it('starts at generation 0 and advances by exactly 1 per accept()', () => {
    const gate = new RunGate();
    expect(gate.current()).toBe(0);
    const a = gate.accept();
    expect(a).toBe(1);
    expect(gate.current()).toBe(1);
    const b = gate.accept();
    expect(b).toBe(2);
    expect(b).not.toBe(a);
  });

  it('isCurrent is true only for the latest accepted generation', () => {
    const gate = new RunGate();
    const a = gate.accept();
    expect(gate.isCurrent(a)).toBe(true);
    const b = gate.accept();
    expect(gate.isCurrent(a)).toBe(false);
    expect(gate.isCurrent(b)).toBe(true);
  });

  // The exact bug: B is accepted while A is still "registered" as cancellable (A never got the chance to
  // register a no-op/abort because, before the fix, the cooldown-wait branch skipped accept() entirely).
  // With the fix, accept() ALWAYS cancels whatever the previous run registered, regardless of what the new
  // run ends up doing next (fetch now vs. wait for a cooldown) — so this must hold for both orderings.
  it('accept() cancels a previous run that was fetching, even though the new run only waits on a cooldown', () => {
    const gate = new RunGate();
    const cancelA = vi.fn();
    const a = gate.accept();
    gate.onCancel(a, cancelA); // A registers its abort() as how to cancel it (fetching now)

    const b = gate.accept(); // B is accepted while cooldown is open — it will only wait, not fetch yet
    expect(cancelA).toHaveBeenCalledTimes(1); // A's fetch must be cancelled the instant B is accepted
    expect(gate.isCurrent(a)).toBe(false); // A's late completion must be recognized as stale
    expect(gate.isCurrent(b)).toBe(true);

    // A's fetch "resolves late" — the caller's .then guard checks isCurrent(a) and must skip it.
    expect(gate.isCurrent(a)).toBe(false);
  });

  it('accept() cancels a previous run that was only waiting on a cooldown timer (not fetching yet)', () => {
    const gate = new RunGate();
    const clearTimerA = vi.fn();
    const a = gate.accept();
    gate.onCancel(a, clearTimerA); // A registers "clear my cooldown-wait timeout" as its cancel

    const b = gate.accept(); // B supersedes A before A's cooldown ever resumed into a fetch
    expect(clearTimerA).toHaveBeenCalledTimes(1);
    expect(gate.isCurrent(a)).toBe(false);
    expect(gate.isCurrent(b)).toBe(true);
    // A's cooldown timer fires anyway (clearTimeout is best-effort in real code) — its resume check must see stale.
    expect(gate.isCurrent(a)).toBe(false);
  });

  it('onCancel registered for an already-superseded generation is a no-op (never overwrites the current cancel)', () => {
    const gate = new RunGate();
    const cancelA = vi.fn();
    const a = gate.accept();
    const b = gate.accept(); // supersedes a before a had the chance to register anything
    gate.onCancel(a, cancelA); // a is stale now — must not become "the" cancel callback
    const cancelB = vi.fn();
    gate.onCancel(b, cancelB);
    gate.accept(); // accepting the next run must cancel B's callback, never A's
    expect(cancelA).not.toHaveBeenCalled();
    expect(cancelB).toHaveBeenCalledTimes(1);
  });

  it('settle() clears the registered cancel without invoking it, so a later accept() does not call a stale no-op', () => {
    const gate = new RunGate();
    const cancelA = vi.fn();
    const a = gate.accept();
    gate.onCancel(a, cancelA);
    gate.settle(a); // A finished on its own (success) — no cancellation needed
    gate.accept(); // must not invoke cancelA (it already finished)
    expect(cancelA).not.toHaveBeenCalled();
  });

  it('settle() for an already-superseded generation is a no-op (never clears the CURRENT run\'s cancel)', () => {
    const gate = new RunGate();
    const a = gate.accept();
    const b = gate.accept();
    const cancelB = vi.fn();
    gate.onCancel(b, cancelB);
    gate.settle(a); // a's late .then/.catch fires after being superseded — must not touch b's registration
    gate.accept();
    expect(cancelB).toHaveBeenCalledTimes(1);
  });

  // End-to-end shape of the real bug, driven entirely through the gate (no React/timers needed): A is fetching,
  // the breaker opens, B is accepted and only waits — then A resolves. The gate must already show A as stale
  // BEFORE A's async callback runs, which is exactly what a real `.then((r) => { if (!gate.isCurrent(myGen)) return; ... })`
  // guard depends on.
  it('end-to-end: B accepted mid-flight while only waiting on a cooldown drops A\'s late success and stays live for B', () => {
    const gate = new RunGate();
    const abortA = vi.fn();
    const a = gate.accept();
    gate.onCancel(a, abortA); // A is "fetching" (registered its abort)

    // B arrives while the shared breaker is still cooling down: it is accepted immediately (cancelling A)
    // but only starts a cooldown-wait timer, no fetch yet.
    const clearWaitB = vi.fn();
    const b = gate.accept();
    gate.onCancel(b, clearWaitB);

    expect(abortA).toHaveBeenCalledTimes(1); // A's in-flight request was aborted the instant B was accepted
    expect(gate.isCurrent(a)).toBe(false);

    // A's fetch promise resolves anyway (abort is best-effort) — the real code's `.then` guard must reject it.
    const aLateSuccessAccepted = gate.isCurrent(a);
    expect(aLateSuccessAccepted).toBe(false);

    // B's cooldown elapses and its timer fires — the real code's resume guard must accept it.
    const bResumeAccepted = gate.isCurrent(b);
    expect(bResumeAccepted).toBe(true);
  });
});
