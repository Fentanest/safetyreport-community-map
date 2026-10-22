// Demo builds only (loaded behind the literal VITE_DATA_MODE check in data/personal.ts, absent from live builds):
// `?client_status=` previews of the server-driven update guidance for browser review. Without the parameter the
// demo behaves like a server with no notice, no pause and no required version. The message and links are example server values, not app defaults.
const notice = (pc: string | null, mobile: string | null, level = 'warning') => ({
  level,
  message: '새 공유 방식이 시작됩니다. 앱을 최신 버전으로 업데이트한 뒤 앱에서 새 [필수] 신고내용 공유 동의를 해 주세요.',
  min_version: { pc: '3.6.0', mobile: '2.5.0' },
  url: { pc, mobile },
  deadline: null,
});
const PC = 'https://github.com/Fentanest/safetyreport/releases/latest';
const MOBILE = 'https://play.google.com/store/apps/details?id=com.fentanest.mysafetyreport';

export function demoClientStatus(search: string): unknown {
  const f = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('client_status');
  const base = { consent: 'active', last_contract: 'community-ingest-v2', v1_connections: 0, v2_enabled: true, notice: null,
    upload_pause: { paused: false, message: null, resume_at: null }, update_gate: null };
  const gate = (blocked: boolean) => ({ blocked, min_version: { pc: '3.6.2', mobile: '2.5.1' }, url: { pc: PC, mobile: MOBILE }, message: null });
  switch (f) {
    case 'outdated': return { ...base, consent: 'outdated', last_contract: 'community-ingest-v1', v1_connections: 1, notice: notice(PC, MOBILE) };
    case 'v1': return { ...base, last_contract: 'community-ingest-v1', v1_connections: 1, notice: notice(PC, MOBILE) };
    case 'pc-only': return { ...base, consent: 'outdated', v1_connections: 1, notice: notice(PC, null, 'required') };
    case 'unsafe-link': return { ...base, consent: 'outdated', v1_connections: 1, notice: notice('javascript:alert(1)', 'http://example.com/') };
    case 'none': return { ...base, consent: 'none', last_contract: null, notice: notice(PC, MOBILE, 'info') };
    case 'revoked': return { ...base, consent: 'revoked', notice: notice(PC, MOBILE, 'info') };
    case 'v2-off': return { ...base, consent: 'outdated', v1_connections: 1, v2_enabled: false, notice: notice(PC, MOBILE) };
    case 'no-notice': return { ...base, consent: 'outdated', v1_connections: 1 };
    // 2026-10-22 previews: maintenance banner (with / without a resume time) and the required-version screen
    case 'paused': return { ...base, upload_pause: { paused: true, message: null, resume_at: new Date(Date.now() + 90 * 60_000).toISOString() } };
    case 'paused-open': return { ...base, upload_pause: { paused: true, message: '서버 저장 공간을 늘리는 중입니다.', resume_at: null } };
    case 'update-required': return { ...base, update_gate: gate(true) };
    case 'update-ok': return { ...base, update_gate: gate(false) };
    default: return base;
  }
}
