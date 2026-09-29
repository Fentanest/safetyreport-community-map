# 대시보드 후속 수정 보고 R1–R7 (2026-09-30)

기준: main `f16979e`, 브랜치 `claude/gallant-darwin-7ldkbl`. 이 세션의 Claude가 계획·구현·검수를 모두 했다(Sol/Muse 호출 경로 없음,
Muse 모델 검수 **MODEL_UNVERIFIED**).

**검증 범위.** 자동 검사, 로컬 PostgreSQL 16 SQL 검사, 로컬 live 스택 브라우저 검사가 있다. 로컬 live 스택은 실제 프런트,
실제 Edge 핸들러 코드, 합성 자료, **MOCK 카카오 SDK**로 이루어진다. 운영 DB, Edge 배포, 실제 카카오 SDK, 운영 로그는
**미적용·미검증**이다. 아래 표의 "통과"는 모두 fixture 기준이다.

## 자동 검사
| 검사 | 결과 |
|---|---|
| `npm test` | **384 passed / 41 skipped**. skip은 기존 Docker 통합 전용이다. |
| 신규 테스트 | `tests/product/followup0930.test.tsx`, 15건 |
| `npm run build` | 통과 |
| `npm run scan` | `passed: true, issues: []` |
| `scripts/sql/verify_long_range.sh` | 로컬 PostgreSQL 16의 stub 스키마에서 **PASS**. BEFORE 재현, 12년 48행, 1826·1827일, data_min/max 계산과 유지값 우선, 역전 거절, 10만 건 초과 RESULT_TOO_LARGE. |
| 브라우저 | `node scripts/browser/verify_followup.mjs docs/implementation/dashboard-redesign/evidence/followup-0930`로 `followup.json`과 PNG를 만든다. |
| 기존 개편 브라우저 회귀 | R04, P03, P04, R08, R09, R10, P07을 다시 실행했다. 자동 갱신은 요청 1회에 지도 2→2다. 날짜 키보드 입력, 칩, 권한 게이트, 가로 넘침 0이 유지된다. |

## 장기간 실패의 근본 원인 (R1)
2014-09-30..2026-09-29 요청은 네 겹의 상한에 막혀 있었다.

| 층 | 위치 | 동작 |
|---|---|---|
| API | `server/publicHandler.ts` `parseScope` | 1826일을 넘으면 **400 INVALID_QUERY**. 가장 먼저 걸리는 곳이다. |
| 집계 | `server/aggregate.ts` `selectScope` | 1827일을 넘으면 throw. |
| SQL | `internal_analytics_v2_facts` | `p_end - p_start > 1826`이면 INVALID_QUERY. BEFORE를 SQL로 재현했다. |

- 화면은 코드 없이 "통계를 불러오지 못했습니다"만 보여 원인이 숨어 있었다.
- '전체 기간'은 `analytics_state.data_min/max`가 한 번도 채워지지 않아(NULL) 동작하지 않았다.
- 기존 SQL은 CTE 안의 `limit 100001` 때문에 결과를 조용히 잘라 낼 위험도 있었다.

**SQL/RPC 변경: 있음.** 새 증분 마이그레이션 `supabase/migrations/202609300100_long_range_bounds.sql`을 추가했다. 기존 파일은 수정하지 않았다.
- facts 함수: 길이 상한을 없앴다.
- 후보가 10만 건을 넘으면 `RESULT_TOO_LARGE`로 명시적으로 거절한다. `limit`은 삭제했다.
- state 함수: data_min/max를 공개 가능한 사실에서 계산한다. 따로 넣어 둔 값이 있으면 그 값이 우선한다.
- 되돌리기 방법은 파일 머리말에 있다.

## 추적표
| ID | 변경 파일 | 연결(서버→API→타입→클라이언트→화면) | 자동 검사 | 브라우저 증거 (fixture, MOCK SDK) | 결과 |
|---|---|---|---|---|---|
| R1 장기간·전체 기간 | 마이그레이션 202609300100, `publicHandler.ts`, `aggregate.ts`, `personalHandler.ts`, Edge `public-analytics`/`my-analytics`, `client.ts`, `personal.ts`, `refreshController.ts`(meta 보관), `filters.ts`(validateRange·presetRange), `CommandBar.tsx`, `Dashboard.tsx`, `redesign.css`(.stale) | SQL과 집계의 상한 제거 → 422 RESULT_TOO_LARGE → 클라이언트 메시지에 `(코드, HTTP)` 포함 → '전체 기간'은 meta의 실제 범위로 즉시 적용 → 날짜 버튼·칩·URL 동기 → 비교 기간이 없으면 null | 1826/1827/12년 parseScope, 12년 집계(48건, previous null), 핸들러 200과 422, validateRange(윤년·역전·미완성·미래·첫 자료 이전 허용), presetRange 미확정 시 null, SQL 스크립트 | '전체 기간' 클릭: dashboard **1회 200**, 버튼·칩·URL이 2014.12.03—2026.09.24로 같다. 입력한 2014-09-30~2026-09-29: 200. '전체 분류'는 날짜를 유지한다(title "전체 분류 (기간은 그대로)"). 역전 입력: 팝오버 유지, 입력값 유지, 요청 0, 오류 문구 표시. 뒤로가기: 이전 범위로 복원. 503 주입: 마지막 화면 유지, `.stale`, 코드 표시 (`R1-*.png`) | 통과(fixture). 운영 적용·운영 URL 재현은 **미검증** |
| R2 장소 기관·담당자 칸 | `entityMetrics.ts`(신규), `PlaceDetailsPanel.tsx`, `redesign.css`(.pe-*, container query) | 서버 장소 상세 행 → `entityRates`(C·A·P·R·K·U·F·W, null 안전) → 이름만 버튼, 지표는 칸 | C20·A12·P3·R3·U2·F8·W5 → 66.7/16.7/16.7/40.0/25.0, 동명이인은 기관명으로 구별, K=0·미확인은 '—' | 중첩 버튼 0, 이름 title로 전체 이름 확인, 숫자 15px·라벨 12px, 칸 넘침 0. 1920·1440·1280·768·390 × 다크·라이트 (`W-place-*.png`) | 통과(fixture) |
| R3 담당자별 처리 현황 그래프 | `PlaceEntityChart.tsx`(신규), `charts.ts`(DataZoom), `client.ts loadPlace(entityLimit)`, `publicHandler.ts entity_limit`, `demoEngine.ts`, `Dashboard.tsx` | 100% 누적 막대(왼쪽 축)와 C 선(오른쪽 축) → 라디오 전환 시 재요청 없음 → 표 보기 → "표시/전체"와 나머지 불러오기(`entity_limit`) | 막대 분모: 수용률 18, 과태료 20. 선은 두 모드 모두 20. K=0이면 막대 없음 | 라디오 전환 시 요청 0. 과태료 모드의 나머지는 "과태료 외(경고·범칙금·처분 없음·미확인)". 110명 합성 주소: "표시 100명 / 전체 110명" → 불러오기 1회(`entity_limit=110`) → 표 110행. dataZoom 슬라이더 동작, K=0 담당자는 막대 없음 (`R3-*.png`) | 통과(fixture) |
| R4 히트맵 법규 미상 제외 | `analyticsDistributions.ts`, `AnalyticsCharts.tsx` | 상위 N을 고르기 전에 서버에서 `lawKey !== null`만 남긴다. 현황 법규 표에는 법규 미상이 그대로 있다. 모두 미상이면 빈 문구를 보인다. | 가장 흔한 값이 미상이어도 칸을 차지하지 않는다. 미상만 있는 기관은 행이 없다. 총계는 불변이다. | 표 머리에 '법규 미상' 없음 | 통과(fixture) |
| R5 별점 행·비교 쌍 | `analyticsDistributions.ts`, `domain/public.ts`, `schema.ts`, `AnalyticsCharts.tsx`(ratingLines·RatingCard) | 행: 전체·수용·일부수용·불수용·과태료 처분(겹침)·결과 미상 → 비교를 켜면 키로 맞춘 전체/내 신고 쌍 → 라벨 "평가 N건 · 평균 X.X점" → 표가 그래프와 같은 행을 보여 준다 | fine+accepted는 두 행에 모두 들어간다. 두 계정의 내 신고 값이 서로 다르다. 쌍 순서. 불러오는 중·실패·로그인 필요·서버 미지원(구 서버의 fine 행 없음)은 0이 아니라 상태로 보인다. | 비교 끔: 6행. 켬: 12행('모든 결과 · 전체 / · 내 신고' …). 다시 끔: 6행 (`R5-*.png`, `W-rating-*.png`) | 통과(fixture) |
| R6 '1건' 표시 제거 | `EntityTable.tsx`, `LawTable.tsx`, `ManagerCompare.tsx`, `app.css` | 값이 1이어도 다른 값과 같은 모양으로 보인다. 열 단위를 통일했다(답변(건), N건). | 0/1/2/10이 같은 마크업 | `.sample-one` 0, '1건' 배지 0 | 통과(fixture) |
| R7 비율 지도 = 지역 색칠 | `MapPanel.tsx`, `lib/kakao.ts`, `RegionSummaryCard.tsx`(신규), `Dashboard.tsx`, `redesign.css`, mock SDK(polygon click) | 서버 `regionRows`(Σ분자/Σ분모, 원천 신고 기준) → 비율 모드에서 `setPoints([])`와 경계 강제 표시 → 확대 수준으로 단계 결정 → 지역 클릭 시 region_code 필터와 카드 | 1/1 + 9/99 → 시도 10%. `renderModeOf`, `boundaryLevelFor`(>9 시도, ≤9 시군구), `outOfScopeCodes` | 아래 참조 (`R7-*.png`, `W-ratemap-*.png`) | 통과(fixture). 실제 SDK는 미검증 |

## 명시 항목
- **장기간 실패 원인:** 위의 네 겹 상한과 NULL data_min/max다. 운영 응답과 로그로 확인하지는 않았다(권한 없음). 코드와 SQL BEFORE 재현으로 확인했다.
- **SQL/RPC 변경:** 있다(202609300100). 운영 적용은 하지 않았다.
- **별점 DTO 변경:**
  - `RatingRow.status`에 `'fine'`을 추가했다. 행 순서는 all, accepted, partial, rejected, fine, unknown이고 schema max는 6이다.
  - 개인 비교 DTO도 같은 행을 쓴다.
  - 구 서버 응답(fine 행 없음)도 schema를 통과하고 화면에는 '서버 미지원'으로 보인다.
- **비율 모드에서 핀이 실제로 사라지는가:** 로컬 MOCK SDK에서 확인했다.
  - 수용률·불수용률·과태료에서 살아 있는 마커가 **0**이고 장소 목록도 0이다.
  - 20회 조작(이동, 확대, 지표 전환) 동안 최대 마커 수도 **0**이다.
  - 같은 동안 지도 인스턴스는 2→2로 재마운트가 없고, 추가 요청도 0이다.
  - 신고 수로 돌아오면 핀이 다시 보인다.
- **시도↔시군구 전환:** 확대 수준 8 → '시군구별', 11 → '시도별', 7 → '시군구별'로 바뀌었다. 핀은 계속 0이다.
- **경계 끄기 설정:** 신고 수에서 경계를 끄면 폴리곤이 0이다. 비율 지표로 바꾸면 423개가 그려지고, 비활성 안내 문구가 보인다. 신고 수로 돌아오면 다시 0이고, 설정값(off)은 유지된다.
- **지역 클릭:** URL에 `region_code=11`이 붙고 dashboard 요청은 1회뿐이다. 반복 요청 루프는 없다. '선택한 지역' 카드가 보인다(신고·답변·세 비율의 n/d). 핀은 0이다.

## 운영 적용 순서 (승인 필요, 이 세션에서 하지 않음)
1. DB: `202609300100_long_range_bounds.sql`
2. Edge: `public-analytics`, `my-analytics`
3. Pages

자세한 smoke 절차는 `docs/deployment.md`에 있다. 새 클라이언트는 구 서버와도 동작한다.

## 남은 조건 / 미검증
- 운영 Supabase·Edge 적용과 운영 URL·HTTP 상태·로그 재현: **미검증**
- 실제 카카오 SDK(폴리곤 클릭·hover·마커 제거): **미검증**. MOCK SDK로만 확인했다.
- 전체 마이그레이션 체인에 대한 SQL 검사: 이 저장소 밖의 community-auth 스키마가 필요해 stub 스키마로 대신했다.
- 다크·라이트 × 5개 폭 검사 범위는 장소 패널, 담당자 그래프, 비율 지도, 별점 카드다. 전체 화면은 P07 회귀 검사로 확인했다.
