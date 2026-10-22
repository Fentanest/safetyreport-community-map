import { useContext } from 'react';
import { ClientUpdateContext } from './ClientUpdateNotice';

/** "10월 22일 오후 3:30" in KST, or null. */
export function kstTime(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(t);
}

/** The sentence under the title: what happens and when; the viewer has nothing to do. */
export function uploadPauseText(resumeAt: string | null): string {
  const at = kstTime(resumeAt);
  return at
    ? `앱의 신고 업로드가 잠시 멈췄습니다. ${at}에 자동으로 다시 올립니다. 지도는 그대로 볼 수 있습니다.`
    : '앱의 신고 업로드가 잠시 멈췄습니다. 점검이 끝나면 자동으로 다시 올립니다. 지도는 그대로 볼 수 있습니다.';
}

/**
 * Server maintenance (2026-10-22, task 2-9): a banner only. The map stays open; nothing renders unless the map's own
 * client-status says uploads are paused right now (the server already applied the automatic resume time).
 */
export default function UploadPauseBanner() {
  const { status } = useContext(ClientUpdateContext);
  const p = status?.upload_pause;
  if (!p?.paused) return null;
  return (
    <aside className="upload-pause-banner" role="status" aria-label="서버 점검 안내">
      <p className="upload-pause-title">서버 점검 중</p>
      <p className="upload-pause-message">{uploadPauseText(p.resume_at)}</p>
      {p.message && <p className="upload-pause-note">{p.message}</p>}
    </aside>
  );
}
