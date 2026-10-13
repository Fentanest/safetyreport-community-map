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
 */
export default function ManagerEntityTable({ rows, activeAgency, activeManager, onPick }: {
  rows: PublicEntity[];
  activeAgency: string | null;
  activeManager: string | null;
  onPick: (kind: 'manager', e: PublicEntity) => void;
}) {
  const same = sameNameIndex(rows);
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
          {rows.map((e) => {
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
 *  정의만 짧게. 미제공(—)·계산 불가(건수만)·실제 0건(건수+0.0%)을 다시 한 번 구분해 둔다. */
export function ManagerTableFootnote() {
  return (
    <p className="cm-muted manager-table-note">
      답변 = 답변완료 건수 · 분류 = 수용·일부수용·불수용으로 결과가 나온 건수(미분류 제외) · 수용률·일부수용률·불수용률 = 각 건수 ÷ 분류 ·
      과태료·계도 = 처분 건수와 ÷ 답변. 서버가 건수를 안 주면 <b>—</b>, 분류·답변이 0건이라 비율을 계산할 수 없으면 건수만, 실제 0건이면 0.0%로 보입니다.
    </p>
  );
}
