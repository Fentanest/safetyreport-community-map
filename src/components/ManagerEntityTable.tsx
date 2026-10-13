import type { PublicEntity } from '../domain/public';
import { entityRates } from './entityMetrics';
import { managerLabel, sameNameIndex, sameNameNote } from '../domain/managerNames';
import { fmtCountRate, fmtInt, fmtPercent } from './format';

/**
 * 2026-10-13 지도 폭 축소 개편 — 오른쪽 담당자 통계를 "담당자 한 명 = 한 행" 표로. 주소별 상세(PlaceDetailsPanel)와
 * 지역/전국 범위 상세(ScopeDetailsPanel) 양쪽의 담당자 목록이 이 하나의 컴포넌트를 공유한다(공통 표).
 * 열: 담당자 | 답변 | 분류 | 수용률 | 일부수용률 | 불수용률 | 과태료 | 계도.
 * 계산은 모두 entityMetrics.entityRates 재사용 — 중복 구현하지 않는다:
 *   답변 = completed_count(C), 분류 = result_known(K), 수용·일부수용·불수용률 = 각 건수 / K,
 *   과태료 = fine_count 와 fine_count / completed_count, 계도 = warning_count 와 warning_count / completed_count.
 * 과태료·계도 칸은 fmtCountRate로 '59건 · 92.2%' 형태 + 미제공/계산불가/실제 0건을 구분한다(format.ts 주석 참고).
 * 동명이인은 기존 sameNameIndex/managerLabel 규칙을 그대로 쓴다(이름만으로 합치지 않고, 다른 기관이면 소속 기관으로 구분).
 * 담당자 선택·active 하이라이트는 호출부(EntityList/ScopeEntities)가 쥔 activeAgency/activeManager를 그대로 받는다 —
 * 더 보기/검색/로딩/오류/빈 상태는 호출부가 감싼 채 유지하고, 이 컴포넌트는 "보이는 rows"만 그린다(부분 목록을
 * 전체 정렬처럼 보이지 않도록 정렬·총건수 안내는 호출부 몫).
 *
 * 2026-10-13 P3 수정(Astra 검수): 동명이인 인덱스(sameNameIndex)는 반드시 **지금까지 받은 전체 목록**(`rows`)으로
 * 만들고, 화면에는 그 전체 목록 중 "더 보기"로 드러난 부분(`visible`)만 그린다. 예전에는 이미 잘라낸 visible을
 * sameNameIndex에 그대로 넣어서, same_name 서버 메타데이터가 없는 행(구서버/정적 스냅샷 fallback)의 라벨이
 * "더 보기" 전후로 달라졌다(짝이 되는 동명이인이 아직 안 보이는 구간에서는 계산에서 빠졌다가, 보이는 순간 이름이
 * 바뀜). rows와 visible을 분리해 인덱스는 항상 rows 전체 기준으로 고정한다.
 */
export default function ManagerEntityTable({ rows, visible, activeAgency, activeManager, onPick }: {
  /** 동명이인 인덱스 계산에 쓰는, 지금까지 로드된 전체 담당자 목록(화면에 아직 안 보이는 행도 포함) */
  rows: PublicEntity[];
  /** 실제로 그릴 행 — rows의 부분집합(rows.slice(0, shown)). 생략하면 rows 전체를 그린다. */
  visible?: PublicEntity[];
  activeAgency: string | null;
  activeManager: string | null;
  onPick: (kind: 'manager', e: PublicEntity) => void;
}) {
  const same = sameNameIndex(rows);
  const shown = visible ?? rows;
  return (
    <div className="table-scroll manager-table-scroll">
      <table className="entity-table manager-entity-table">
        <thead>
          <tr>
            <th scope="col">담당자</th>
            <th scope="col" className="num" title="답변 완료 건수(completed_count)">답변</th>
            <th scope="col" className="num" title="수용·일부수용·불수용으로 결과가 분류된 답변(result_known)">분류</th>
            <th scope="col" className="num" title="수용 ÷ 분류(result_known)">수용률</th>
            <th scope="col" className="num" title="일부수용 ÷ 분류(result_known)">일부수용률</th>
            <th scope="col" className="num" title="불수용 ÷ 분류(result_known)">불수용률</th>
            <th scope="col" className="num" title="과태료 처분 건수와 ÷ 답변(completed_count)">과태료</th>
            <th scope="col" className="num" title="경고·계도 처분 건수와 ÷ 답변(completed_count)">계도</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((e) => {
            const sn = same.get(e);
            const label = managerLabel(e, sn);
            const m = entityRates(e);
            const active = activeManager === e.manager_key && activeAgency === e.agency_key;
            return (
              <tr key={e.key} className={active ? 'active' : undefined}>
                <td>
                  <button type="button" className="mini-btn table-pick" aria-pressed={active}
                    title={`${label} · ${e.agency_name} — 이 담당자만 보기${sn ? `\n${sameNameNote(sn).join('\n')}` : ''}`}
                    disabled={!e.agency_key || !e.manager_key} onClick={() => onPick('manager', e)}>
                    <span className="table-name">{label}</span>
                    {active && <small className="active-tag">적용 중</small>}
                  </button>
                  <small title={e.agency_name}>{e.agency_name}</small>
                </td>
                <td className="num">{fmtInt(m.C)}</td>
                <td className="num">{fmtInt(m.K)}</td>
                <td className="num">{fmtPercent(m.accept)}</td>
                <td className="num">{fmtPercent(m.partial)}</td>
                <td className="num">{fmtPercent(m.reject)}</td>
                <td className="num">{fmtCountRate(m.F, m.fineRate)}</td>
                <td className="num">{fmtCountRate(m.W, m.warnRate)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 표 아래 분모 설명(간결). rows.length가 전체 목록 중 "보이는" 수만큼임을 호출부가 이미 안내하므로, 여기서는 지표
 *  정의만 짧게. 2026-10-13 P3 수정(Astra 검수): 실제 cell 표현과 정확히 맞춘다 — 두 칸 그룹의 "계산 불가"가
 *  다르게 보인다는 점이 핵심이다.
 *  - 수용률·일부수용률·불수용률(fmtPercent만): 분류(K)=0이면 계산 불가 → <b>—</b> 하나뿐(건수 없음). K>0이면
 *    0건이어도 0.0%(실제 값). 이 세 칸에는 "미제공" 상태가 없다 — 서버가 분류 자체를 안 주는 경우가 없다.
 *  - 과태료·계도(fmtCountRate, format.ts): 서버가 건수 자체를 안 주면(미제공) 건수 없이 <b>—</b> 하나만.
 *    건수는 있는데 답변(분모)이 0건이면(계산 불가) 건수는 보이고 비율만 <b>—</b>(예: "0건 · —"). 답변이 있으면
 *    0건이어도 "0건 · 0.0%"(실제 값). 즉 미제공과 계산 불가는 과태료·계도 칸에서 서로 다르게 보인다
 *    (미제공은 건수조차 없이 — 하나, 계산 불가는 건수 뒤에 —가 붙는다). */
export function ManagerTableFootnote() {
  return (
    <p className="cm-muted manager-table-note">
      답변 = 답변완료 건수 · 분류 = 수용·일부수용·불수용으로 결과가 나온 건수(미분류 제외) ·
      수용률·일부수용률·불수용률 = 각 건수 ÷ 분류(분류가 0건이면 비율을 계산할 수 없어 <b>—</b>로 보입니다) ·
      과태료·계도 = 처분 건수와 ÷ 답변. 답변이 있으면 건수가 0건이어도 실제 값(0.0%)으로, 답변이 0건이면
      계산할 수 없어 건수만 보이고 비율은 <b>—</b>로 보입니다. 서버가 과태료·계도 건수 자체를 주지 않으면(미제공)
      건수 칸까지 포함해 <b>—</b> 하나만 보입니다.
    </p>
  );
}
