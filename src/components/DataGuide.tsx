import type { DashboardData } from '../domain/public';
import { fmtDate } from './format';

/** Deletion requests and questions (public board; user decision 2026-09-27). */
export const ISSUES_URL = 'https://github.com/Fentanest/safetyreport-community-map/issues';

/** Plain-language names for features the data source does not provide yet (never show internal keys). */
const NOT_YET: Record<string, string> = {
  fine_amount: '과태료 금액',
  rating: '답변 만족도 별점',
  processing_duration: '답변까지 걸린 기간',
  region_boundaries: '행정구역 경계 지도',
  vehicle_top5: '많이 신고된 차량',
  manager_status_cross: '담당자별 처리 결과',
  agency_status_cross: '기관별 처리 결과',
  completion_dates: '답변일 자료',
  daily_report_dates: '기간별 통계',
};

function updatedAt(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export default function DataGuide({ data }: { data: DashboardData | null }) {
  const notYet = data
    ? Object.entries(data.meta.capabilities)
      .filter(([key, c]) => c.status !== 'supported' && NOT_YET[key])
      .map(([key]) => NOT_YET[key])
    : [];
  const updated = updatedAt(data?.meta.generated_at ?? null);
  return (
    <section className="cm-panel guide" id="guide" aria-label="이용 안내">
      <div className="panel-top" style={{ padding: 0 }}>
        <div>
          <h2>이용 안내</h2>
          <span className="subtitle">숫자를 읽기 전에 알아 두세요</span>
        </div>
      </div>
      <p style={{ margin: 0 }}>
        이 지도는 나만의 안전신문고 이용자들이 직접 공유한 신고만 모았습니다. 전국의 모든 신고가 아니며,
        신고 건수가 곧 위반 건수나 실제 발생 건수를 뜻하지는 않습니다.
      </p>
      <ul>
        <li>
          날짜 기준(신고일 또는 답변일)을 하나 고르면, 그 날짜가 기간 안인 신고 하나의 묶음으로 건수·처리 결과·과태료·지도·표·그래프를 모두 셉니다.
          다른 날짜가 기간 밖이어도 그 신고는 빠지지 않습니다(예: 7월에 신고하고 9월에 답변 받은 신고는 신고일 7월 조회에 9월 답변 결과와 함께 들어갑니다).
          고른 날짜가 없는 신고는 그 기간에 넣을 수 없어 따로 셉니다. 과거 시점의 상태가 아니라 지금 공개된 최신 결과입니다.
          {data && ` 지금 보는 조건: ${data.scope.date_basis === 'report_date' ? '신고일' : '답변일'} 기준 ${fmtDate(data.scope.start)} ~ ${fmtDate(data.scope.end)}`}
        </li>
        <li>담당자는 이름과 소속 기관을 함께 보여 드립니다. 이름이 같아도 기관이 다르면 따로 셉니다.</li>
        <li>차량 번호는 지역명 뒤 2·4·6번째 글자를 *로 가려서 보여 드립니다. 번호 전체는 공개하지 않습니다.</li>
        <li>같은 주소의 신고는 핀 하나로 묶어 보여 줍니다(원래 입력된 주소·위치는 그대로 보관). 핀 위치는 그 주소의 신고 위치 중 하나를 고른 표시용 위치이고, 지도를 넓게 보면 가까운 주소를 묶어 보여 줍니다. 주소가 없는 신고는 지도에 없고 통계에만 들어갑니다. ‘신고 수’는 주소별 핀으로, 수용률·불수용률·과태료는 행정구역 색으로 보여 줍니다.</li>
        <li>신고가 1건뿐인 결과도 숨기지 않습니다. 알 수 없는 값은 0이 아니라 ‘—’로 표시합니다.</li>
        <li>평균 별점은 공개에 동의한 1~5점 숫자만 합산해 별점 건수로 나눕니다. 별점이 없는 신고는 평균 계산에서 빼고, 별점 사유 글은 받지 않습니다.</li>
        <li>
          공유한 신고의 삭제는 <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">문의 게시판(GitHub Issues)</a>에 요청할 수 있습니다.
          공개 게시판이니 개인정보는 적지 마세요. 공개 지도에서만 빼려면 앱에서 동의를 철회하면 됩니다.
          PC·Docker는 설정 → ‘신고내용 공유 동의’, 모바일은 설정 → ‘커뮤니티 계정’에서 ‘동의 철회’를 누르면 그 동의로 보낸 신고가 지도에서 바로 빠집니다.
          철회하면 다시 동의할 때까지 앱을 쓸 수 없습니다.
        </li>
      </ul>
      {notYet.length > 0 && (
        <p className="cm-muted" style={{ fontSize: 13, margin: 0 }}>아직 제공하지 않는 정보: {notYet.join(', ')}</p>
      )}
      {data?.meta.sample && (
        <p className="cm-muted" style={{ fontSize: 13, margin: 0 }}>지금 화면은 실제 신고가 아닌 예시 자료로 만들었습니다.</p>
      )}
      {updated && <p className="cm-muted" style={{ fontSize: 13, margin: 0 }}>마지막 갱신: {updated}</p>}
    </section>
  );
}
