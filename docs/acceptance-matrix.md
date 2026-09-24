# 완료 기준 · 반드시 테스트로 닫을 항목
P0 실패는 출시 차단. 검증 불가면 BLOCKED/NOT_RUN, 합격으로 바꾸지 않는다.

| ID | 우선 | 검증 |
|---|---|---|
| DATA01 | P0 | v1만 제공되면 월별/담당자/차량 기능을 지원한다고 위장하지 않음 |
| DATA02 | P0 | report_date와 completed_date 월이 다른 fixture의 지표가 올바른 월에 포함 |
| DATA03 | P0 | 수용/일부수용/불수용 rates가 D 기준, known/unknown 분모 설명 |
| DATA04 | P0 | 0분모 null, prior0 신규, both0 비교없음, %p와% 구분 |
| DATA05 | P0 | partial month는 같은 경과기간 비교; 시간대/연말/윤일 포함 |
| DATA06 | P0 | 월별 TOP5 밖 차량이 합계1등인 fixture를 정확히 계산 |
| DATA07 | P0 | 원번호 동일성으로 집계 후 마스킹, 지역prefix 다른 번호는 합치지 않음 |
| DATA08 | P0 | 한 사용자 snapshot 재전송 이중count 없음; distinct contributor 합산 오류 없음 |
| DATA09 | P0 | 기관·담당자 교차정보 없으면 비례 추정 안 함 |
| DATA10 | P0 | completion/date 결측을 신고일/업로드일로 대체 안 함 |
| PRIV01 | P0 | 담당자 full name, exact coords, n=1 marker/row/차트 모두 표시 |
| PRIV02 | P0 | raw vehicle/hashed global id/계정정보가 response·HTML·JS·URL·aria·export에 없음 |
| PRIV03 | P0 | canonical prefix는 identity 보존, display prefix제거 + 2/4/6 글자 정확한 위치 |
| PRIV04 | P0 | duplicate masked label을 합치지 않고 독립 row 표시 |
| SEC01 | P0 | CI role이 private/auth/write/RPC mutating에 접근 못함; 키 이름 아닌 실제권한 검사 |
| SEC02 | P0 | VITE 변수/소스맵/압축·Pages artifact에 secret/원본 fixture 없음 |
| SEC03 | P0 | public API 임의 table/SQL/query abuse 차단, rate-limit/timeout |
| SEC04 | P0 | 이름/주소/URL의 XSS payload가 실행되지 않음 |
| SEC05 | P0 | withdrawal version 갱신/API invalidation/static emergency refresh |
| UI01 | P0 | 1920 dark/light 실제 브라우저 지도/KPI/차트/표 연동 |
| UI02 | P0 | 390×844 가로overflow 없음, 날짜/filter/sheet/표 기능 터치 가능 |
| UI03 | P0 | 실제 Kakao SDK loading·domain·key·marker·relayout 확인(모형은 불인정) |
| UI04 | P0 | small sample 숨김없음, unsupported vs empty vs0 구분 |
| UI05 | P0 | 범위chip·기간·date basis·분모가 filter 결과와 일치 |
| UI06 | P1 | 1440/2560 레이아웃·브리핑mode·Esc·focus 복귀 |
| UI07 | P0 | light popup/chart tooltip/drawer까지 토큰 적용 |
| UI08 | P1 | keyboard tab/focus/aria-sort/reduced motion/차트 표대안 |
| UI09 | P1 | 카카오 로고/축척 안가림, dark invert 미사용 |
| PERF01 | P1 | 전국 node all-at-once 아님, 10k synthetic locations panning/검색 측정 |
| PERF02 | P1 | 데이터/JS 예산 측정, long tasks·중복 listener 메모리 증가 측정 |
| REL01 | P0 | GitHub Pages subpath에서 assets/refresh/share URL 동작 |
| REL02 | P0 | live 실패에 demo 자동전환 없음, status sample badge 동작 |
| REL03 | P0 | Muse 실제 model/URL/행동/screenshot 검수 증거와 최종 commit 일치 |
| REL04 | P0 | 승인 없는 운영 DB·push·배포 안 함, 미실행 영역 분리 보고 |

테스트 계층: unit(stat/privacy) → schema → API integration(read permissions, consistency) → E2E →
Muse 실제 시각검수. screenshot baseline 생성 자체는 기존 정답과의 비교가 아니다.
