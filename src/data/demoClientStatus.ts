// Demo builds only (loaded behind the literal VITE_DATA_MODE check in data/personal.ts, absent from live builds):
// `?client_status=` previews of the server-driven update guidance for browser review. Without the parameter the
// demo behaves like a server with no notice. The message and links are example server values, not app defaults.
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
  const base = { consent: 'active', last_contract: 'community-ingest-v2', v1_connections: 0, v2_enabled: true, notice: null };
  switch (f) {
    case 'outdated': return { ...base, consent: 'outdated', last_contract: 'community-ingest-v1', v1_connections: 1, notice: notice(PC, MOBILE) };
    case 'v1': return { ...base, last_contract: 'community-ingest-v1', v1_connections: 1, notice: notice(PC, MOBILE) };
    case 'pc-only': return { ...base, consent: 'outdated', v1_connections: 1, notice: notice(PC, null, 'required') };
    case 'unsafe-link': return { ...base, consent: 'outdated', v1_connections: 1, notice: notice('javascript:alert(1)', 'http://example.com/') };
    case 'none': return { ...base, consent: 'none', last_contract: null, notice: notice(PC, MOBILE, 'info') };
    case 'revoked': return { ...base, consent: 'revoked', notice: notice(PC, MOBILE, 'info') };
    case 'v2-off': return { ...base, consent: 'outdated', v1_connections: 1, v2_enabled: false, notice: notice(PC, MOBILE) };
    case 'no-notice': return { ...base, consent: 'outdated', v1_connections: 1 };
    default: return base;
  }
}
