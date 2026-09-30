import { useReportActivity } from '../data/queryActivity';
import { exportController, useExportState } from '../export/controller';
import { STAGE_LABEL, type ExportSnapshot, type ExportSource } from '../export/model';

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

/**
 * F06 "엑셀 다운로드" (통계표 · 편집 가능한 차트 · 조회 조건). `capture` builds the immutable snapshot at click time
 * from the result on screen; `blocked` explains why there is nothing to export yet (no result, a newer request still
 * running, my comparison not arrived…). The same controller serves every entry point: one file at a time.
 */
export default function ExportButton({ source, capture, blocked, extra }: {
  source: ExportSource;
  capture: () => ExportSnapshot | null;
  blocked: string | null;
  /** optional inline options (e.g. 숨긴 계열도 차트에 포함) */
  extra?: React.ReactNode;
}) {
  const st = useExportState();
  const mine = st.source === source;
  const otherRunning = st.status === 'running' && !mine;
  useReportActivity(`export:${source}`, st.status === 'running' && mine
    ? { resource: 'export', phase: 'processing', label: `엑셀 파일 만드는 중 · ${st.stage === 'queued' ? '준비 중' : STAGE_LABEL[st.stage]}`, scope: 'local' } : null);
  const start = () => { const snap = capture(); if (snap) exportController.start(snap); };
  return (
    <div className="export-box" data-export-source={source}>
      {!(st.status === 'running' && mine) && (
        <button type="button" className="mini-btn export-btn" disabled={!!blocked || otherRunning} onClick={start}
          title={blocked ?? (otherRunning ? '다른 엑셀 파일을 만드는 중입니다' : '통계표 · 편집 가능한 차트 · 조회 조건')}
          aria-describedby={`export-hint-${source}`}>
          엑셀 다운로드
        </button>
      )}
      {(blocked || otherRunning) && (
        <small id={`export-hint-${source}`} className="cm-muted export-hint">{blocked ?? '다른 엑셀 파일을 만드는 중입니다'}</small>
      )}
      <a className="link-btn export-license" href={`${import.meta.env.BASE_URL}licenses/excel-export-third-party.txt`} target="_blank" rel="noreferrer">오픈소스 고지</a>
      {extra}
      {st.status === 'running' && mine && (
        <span className="export-progress" role="status">
          <span className="spinner" aria-hidden="true" />
          {st.stage === 'queued' ? '엑셀 준비 중' : STAGE_LABEL[st.stage]}…
          <button type="button" className="link-btn" onClick={() => exportController.cancel()}>취소</button>
        </span>
      )}
      {st.status === 'ready' && mine && (
        <span className="export-ready" role="status">
          파일이 준비됐습니다 ({kb(st.size)}).{st.saved > 0 ? ' 다운로드가 시작되지 않았다면 ‘파일 저장’을 누르세요.' : ''}
          <button type="button" className="mini-btn" onClick={() => exportController.save()}>파일 저장</button>
          <button type="button" className="link-btn" onClick={() => exportController.dismiss()}>닫기</button>
        </span>
      )}
      {st.status === 'error' && mine && (
        <span className="export-error" role="alert">
          {st.message}
          <button type="button" className="mini-btn" onClick={() => exportController.retry()}>다시 시도</button>
          <button type="button" className="link-btn" onClick={() => exportController.dismiss()}>닫기</button>
        </span>
      )}
      {st.status === 'idle' && mine && st.note && <span className="cm-muted export-note" role="status">{st.note}</span>}
    </div>
  );
}
