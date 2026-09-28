# 제품 결정 정본
2026-09-24 / 사용자 확정과 기술 제안을 구분한다.

## 사용자 확정
| 항목 | 정본 |
|---|---|
| 담당자 | 전체 성명 공개. 기관명·집계 기간과 함께 표시 |
| 차량번호 | 지역명이 있으면 표시에서 제외하고 남은 번호의 2·4·6번째 문자 각각 '*' |
| 좌표 | 정확한 원 좌표. 마스킹/격자화 금지 |
| 최소 표본 | 1건도 공개. 숨기는 최소 n 정책 없음 |
| 공간 | 대한민국 전국. 제주·울릉·독도 포함 데이터를 배제하지 않음 |
| 기간 | 프런트에서 날짜 범위 사용자 선택; 프리셋·월 단위 brush 병행 |
| 날짜 기준 | 신고 현황=신고일; 처리·과태료 처분 현황=처리완료일; 지표명에 명시 |
| 기반 | 사용자 소유 Supabase/Google 프로젝트, GitHub Pages, Kakao Maps |
| 분위기 | 기존 안전신문고 제품군 토큰/에셋의 상위급 분석 상황판. 세련된 projector wall |
| 에이전트 | 6-Sol + Muse Spark contributor; Muse 실제 브라우저 UI/UX 검수 |
| 업로드 | 카카오 계정 + 필수 공유 동의, 수집 직후 실시간·지도 탭 수동·매일 00:00 KST(2026-09-26 개정). 서버 모드는 서버 실행 |

차량 문장의 해석을 명료하게 고정했다: **지역명은 표시하고, 위치를 셀 때만 건너뛰어 그 뒤 번호의 2/4/6번째를 마스킹**한다
(경기76자3623 → 경기7*자*6*3). 2026-09-26 사용자 정정: 이전 구현이 지역명을 표시에서 제거했던 것은 오해였다.
이는 앞서 요청한 '원번호 전체 공개 금지'와 함께 적용한 규칙이며 docs/privacy-security.md와 테스트가 동일하게 따른다.

## 이번 기술 선택
- UI: Vite + React + TypeScript + CSS custom property tokens + ECharts + Kakao Maps Web SDK.
  현재 레포에 다른 실제 구현이 생겼다면 무조건 삭제하지 말고 보존·어댑터 비용을 보고한다.
- 비밀 경계: Pages는 공개 UI. private 원본 집계·차량 마스킹은 Supabase 서버에서 한다.
- 읽기 모델: 모든 통계는 public-analytics API로 조회한다. 지도는 공유자 전용(카카오 로그인 + 공유 동의 + 지도에 올라간 본인 신고 1건 이상)이며, 익명 공개 전환 스위치는 두지 않는다. Actions의 초기 snapshot은 만들지 않는다(docs/public-api-contract.md §열람 조건). 2026-09-27 사용자 재확인: 모든 데이터·계정·업로드 함수는 자기 사용자 세션을 검사한다. 로그인 시작 전 `community-auth-relay`만 일회용 capability로 보호하는 예외다.
- 기간 기본: 전국, 최근 12개월(오늘 포함), KST. 분석 가능 기간의 최소/최대는 meta에서 받는다.
- 첫 방문 테마: dark. 사용자 저장값 우선. light·system도 제공한다.
- 지도 색 기본: 신고건수 순차색. 다른 지표 선택 시 독립 범례/분모/기준이 바뀐다.
- 주 메뉴: 지도 상황판 / 지역 분석 / 기관·담당자 / 월별 추이 / 데이터 안내.
- 양의 신고 증가는 '좋음'의 초록 신호가 아니다. 방향은 중립 청색/회색, 상태별 semantic color와 분리한다.

## 2026-09-27 사용자 결정
- 화면의 **수용률 = 수용 ÷ 결과가 나온 신고(수용+일부 수용+불수용)**, **일부수용률 = 일부 수용 ÷ 같은 분모**를 **따로** 보여 준다.
  둘을 합친 비율은 화면에 쓰지 않는다. 지도 색·지역 목록·기관/담당자 표와
  서버 정렬(`/entities sort=acceptRate`)·개인 비교(`my-analytics`)가 같은 정의를 쓴다. 공개 API의 `accepted_including_partial` 필드는
  이름 그대로의 별도 지표로 남겨 두며 화면의 수용률로 쓰지 않는다.
- 화면에는 일반 이용자 말만 쓴다(docs/personal-comparison.md §5.7).

<## 2026-09-28 신고번호·소유 이전

- 안전신문고 신고번호는 별도 private 이벤트 필드로 수집한다. Observation 해시는 유지하고 공개 API에는 번호를 내보내지 않는다.
- 다른 카카오 계정의 같은 링크 ID와 같은 신고번호를 가진 fact는 Observation payload 가 **완전히 같을 때만** 나중에 올린 계정으로 이전한다(상태 포함 하나라도 다르면 비재시도 `cross_account_mismatch` 거절). `status_only` 예외는 없다. 이전 감사 기록은 private에 남으며 reason 은 `identical` 만 허용한다.
- 참여자 수의 동일인 추정·계정 병합은 드롭했다. `contributor_count`는 현재 공개 fact를 가진 계정 수 그대로다.
- 레거시 NULL 번호는 기존 소유자의 재수집으로 백필될 때까지 이전할 수 없다. 조사와 검증 계획: [report-owner-transfer-plan.md](integration/community-ingest/report-owner-transfer-plan.md).

## 2026-09-28 답변 완료만 중앙 수집 (같은 날 확정)

- 답변 완료된 신고만 중앙에 올린다. 적격 = status ∈ {accepted, partial, rejected, completed_unknown}(수용/일부수용/불수용/답변완료·기타).
  처리중·보완요청·취하·이송·other 는 앱이 올리지도, 서버가 받지도 않는다.
- 앱은 `status_correction` 이벤트를 발급하지 않는다. 적격이 아닌 관측은 이벤트 없음(기존 로컬 `detail_status` 기록만).
  로컬 outbox 에 이미 남아 있는 미전송 `status_correction` 행은 보내지 않고 `blocked:deprecated_status_correction` 으로 보존한다(PC·모바일 동일, drop 하지 않음).
- 서버는 payload 가 적격이 아니거나 event_type 이 `status_correction` 인 이벤트를 이벤트 단위로 재시도 불가 `rejected:non_final_not_accepted`(durable=false)로 거절한다.
  배치의 나머지 이벤트는 정상 처리한다(요청 전체 422가 아님). `status_correction` 이름은 구버전 앱이 이벤트별 거절을 받도록 인식만 유지한다.
- 답변 완료로 올라간 신고가 나중에 비종결 상태로 돌아가면(드묾) 중앙은 마지막 답변 상태를 유지한다. 중앙 fact 는 바뀌지 않는다.

## 2026-09-28 사용자 결정 · 위반법규 공개
- 앱(PC·모바일)이 답변 처리내용에서 **법 이름·조항만** 뽑아 `violation_law`로 보낸다(observation-v2). 처리내용 원문은 보내지 않는다.
- 공개는 동의문 **2026-09-28.2**부터다(‘위반법규’ 행 추가). 그 버전(또는 그 뒤 버전)이 현재 동의인 계보의 사실만 법규를 내보낸다
  (`community_policy_disclosures.violation_law_public`). 금액 공개(amounts_public)도 2026-09-28.2에서 그대로 유지한다.
- **조 단위로 묶는다**(같은 날 사용자 결정): 키 `{법이름} 제{N}조[의{M}]` — 항은 버리고 `조의M`은 유지, 공백 차이 흡수, 형식 밖 값은 trim 한 원문.
  지도 서버 집계에서만 적용(`lawKey`), 계약·ingest·저장 원문·SQL·앱은 그대로.
- 지도: 위반법규 필터(조 단위 키 + ‘법규 미상’)와 ‘위반법규별 현황’ 표(답변 완료·수용률·일부수용률·과태료 부과율·답변에 적힌 과태료 금액·범칙금·경고).
- 구 자료: 위반법규가 없는 기존 사실(v1 업로드)은 ‘법규 미상’으로 보인다. 서버는 v1 payload도 계속 받는다.
  **배포 때 운영자가 중앙 공유 자료를 초기화하고 앱이 새로 올린다**(이 작업에서는 하지 않음 — 운영 승인 경계).
- 배포 순서: 중앙 SQL(auth `202609281000` 정책·본문 → map `202609281100`) → Edge Functions(`community-ingest`, `public-analytics`, `my-analytics`)
  → 앱(지도 Pages, PC, 모바일). docs/integration/community-ingest/deployment-and-rollback.md §9.

## 제외·보류
차량 실번호 검색·차량의 이동경로·연속 추적·원본 민원 본문/첨부/신고자 프로필·공무원 우열 점수·실시간인 척하는 ticker는 제외.
다중 로그인 제공자, 입금·과태료 실제 납부 추정, 없는 historical backlog 재구성도 제외.
지점별 1건은 숨기지 않는다. 다만 원천 필드 결측은 결측으로 표시하며 품질 오류를 정상 숫자로 바꾸지 않는다.
