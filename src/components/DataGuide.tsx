import type { DashboardData } from '../domain/public';
import { fmtDate } from './format';

export default function DataGuide({ data }: { data: DashboardData | null }) {
  const caps = data ? Object.entries(data.meta.capabilities) : [];
  return (
    <section className="cm-panel guide" id="guide" aria-label="데이터 안내">
      <div className="panel-top" style={{ padding: 0 }}>
        <div>
          <h2>데이터 안내</h2>
          <span className="subtitle">표본·집계 기준·공개 범위를 함께 확인하세요</span>
        </div>
      </div>
      <p style={{ margin: 0 }}>
        이 화면의 데이터는 이용자가 자발적으로 제공한 신고 표본이며, 전국 모든 신고를 대표하지 않습니다.
        신고 건수는 위반 확정 건수도 실제 지역 발생률도 아닙니다.
      </p>
      <ul>
        <li>신고량 지표는 신고일, 처리·처분 지표는 처리완료일 기준입니다. {data && `${fmtDate(data.scope.start)} — ${fmtDate(data.scope.end)}`}</li>
        <li>담당자는 전체 성명과 기관을 함께 표시합니다. 동명이인을 이름만으로 합치지 않습니다.</li>
        <li>차량은 비공개 원번호로 집계한 뒤, 지역명은 그대로 두고 그 뒤 번호의 2·4·6번째 글자를 *로 표시합니다. 원번호·해시는 공개하지 않습니다.</li>
        <li>좌표는 입력 좌표 그대로이며 격자화·무작위 이동을 하지 않습니다. 저줌 집계 표시는 별도 표기합니다.</li>
        <li>표본 1건도 공개합니다. 결측은 ‘—’와 사유로 표시하며 0과 구분합니다.</li>
      </ul>
      {data && (
        <>
          <div className="cap-list" aria-label="집계 지원 범위">
            {caps.map(([k, c]) => (
              <span key={k} className={`cap ${c.status}`} title={c.reason ?? '지원'}>
                {k}: {c.status === 'supported' ? '지원' : c.status === 'partial' ? '부분' : '미지원'}
              </span>
            ))}
          </div>
          <p className="cm-muted" style={{ fontSize: 12, margin: 0 }}>
            {data.meta.coverage_note} · 스키마 v{data.meta.schema_version} · 데이터셋 {data.meta.dataset_version} ·
            생성 {data.meta.generated_at}{data.meta.source_updated_at ? ` · 원천 갱신 ${data.meta.source_updated_at}` : ' · 원천 갱신 미상'}
          </p>
        </>
      )}
      <p className="cm-muted" style={{ fontSize: 12, margin: 0 }}>
        UI03 실제 Kakao 지도와 live 공개 API 연동은 키·엔드포인트가 없어 BLOCKED입니다. 정정·삭제 요청 채널은 운영 안내를 따릅니다.
      </p>
    </section>
  );
}
