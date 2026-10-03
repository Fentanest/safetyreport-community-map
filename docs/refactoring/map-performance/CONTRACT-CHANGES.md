# 리팩터링 계약·소비자·적용 경계

2026-10-04, 로컬 후보. 운영 적용 없음. public analytics v2 / single-date-v1 / user-rankings-v1 / community-ingest / my-reports의 공개 wire 계약과 자격 기준은 유지한다.

## 전용 집계

`202610040300_analytics_rollups.sql`은 service_role 전용 `internal_analytics_rollup(jsonb,text,jsonb)`과 private helper/지역 registry를 추가한다. anon/authenticated 실행·private table 접근은 허용하지 않는다. Edge는 기존 getUser→viewer→rate→state/expected_version 흐름 뒤 기관·담당자·법규·월별 집계에만 새 RPC를 호출한다. 대표 선출은 전체 관측 이력에서 먼저 하고 날짜/분류/기관/법규/현재 지역/bbox는 선출 뒤 적용한다. 조기 조회 조건은 대표 후보 key의 안전한 상위 집합일 뿐 과거 대표를 부활시키는 필터가 아니다.

집계 RPC는 공개 DTO에 필요한 수와 합/평균/중앙값 및 전체 동일 이름 헤더만 반환한다. 원문·원차량번호·contributor UUID·receipt/session·개별 신고 이력을 Edge로 보내지 않는다. null/0·알 수 없는 처리 결과·금액/평점/법규 consent disclosure·역전/결측 소요일을 기존 계산과 일치시킨다. 전역 검색/분류/정렬 후 페이지를 자르며 현재 페이지를 전체 순위로 표시하지 않는다. Zod 검증은 public Edge `rollupSchema.ts`에만 존재한다. 공용 순수 `rollups.ts`를 분리해 my-analytics의 Deno import closure가 새 Zod 런타임을 요구하지 않게 했다.

지역 resolver는 현재 계약 `regions-20260701.json`의 token/rename/split/geometry를 private SQL에 고정한다. 지역 registry 변경은 새 migration과 SQL/JS 동등성 재검사가 필요하다. 등록명 우선·기관 유형·law article/paragraph 정규화·동명이인 전체 범위도 보존한다.

**잔여 제한:** dashboard/지도·개인 비교·맞춤 통계의 원시 cohort RPC 경로와 10만 건 전체 거절은 유지된다. 전용 목록/추이만 이 cap에서 분리했다. 합성 메모리 handler에서 50만 건을 처리했다고 운영 API의 50만 건 dashboard 지원이라고 주장하지 않는다. 상한 증가/부분 자료 반환은 없다.

## 랭킹

`202610040100`은 번호 보완에서 실제 번호가 있는 관측만 정렬하고 payload max/대표 election의 identity 정렬 prefix를 맞춘다. NULL legacy 보완은 LEFT JOIN으로 유지한다. `202610040200`은 대표 집합을 한 번 분류해 aggregate+diagnostics를 묶고 전체 참가자에서 version/rank/tie를 계산한 뒤 페이지+전역 me의 JSON을 만든다. 이전 stats composite field order/type와 version hash input은 유지한다. work_mem 32MB, timeout 20s, viewer 10건/참가 최소 1건, 정확 분수 정렬, 경쟁 순위 및 no-store 정책을 바꾸지 않는다. TTL/snapshot/Redis/materialized ranking/브라우저 결과 저장은 추가하지 않았다.

API 소비자(지도 UI, PC/mobile ingest, 내 신고 확장)는 기존 URL/권한/응답 버전을 계속 사용한다. Ranking UI의 기존 `rk_*` URL/이력/월별 링크도 유지한다. 짧은 UUID로 React key/계정 동일성을 판단하지 않는다.

`202610040400`은 조회자의 번호 없는 신고 키에서만 전역 최초 번호를 LATERAL/index lookup으로 보완한다. 기존 identity/session/profile/consent 검사와 고유 신고 수 정의를 유지한다. 다른 계정의 최초 번호 철회로 글로벌 보완 번호가 달라질 수 있는 기존 의미도 보존한다. `202610040500`은 metadata bounds의 행별 lineage 함수를 active-grant 집합 JOIN으로 바꾼다. 전체 날짜 bounds/state/version 의미는 변하지 않는다. 두 함수는 원본 본문과 같은 트랜잭션에서 auth/철회/재동의/정지/삭제/중복/번호 보완을 비교했다.

`202610040600`은 scope-bound constant SQL을 계획하고 이 private source 안에서 nested loop를 배제한다. 상관된 grant/user join의1행 추정이500k에서 quadratic 작업을 만들었다. 이어서 동일 disclosed law 문자열을 요청별 distinct 집합에서 정규화한다. EXPLAIN의 대표 선출6.7s 뒤 행별 정규화가28s까지 늘어난 근거와10회 최종8–10s 측정이 있다. 전역 선출/필터/NULL law/공개 동의·반환형은 동일하다. 원시 fact, 결과 snapshot, 사용자별 캐시는 저장하지 않는다. 제품 work_mem32MB/timeout20s는 그대로이며 직접SQL진단 outer budget30s를 운영 성공으로 부르지 않는다. rollback은040300 source 본문/함수 설정 복구다.

`202610040700`은 DB CHECK로 보장되는64자리 lower-case hex source/dataset key를 내부 정렬에서32-byte bytea로 바꾼다. C collation 순서와 partition/election 의미를 보존하고 반환 identity는 기존 hex+report number 문자열로 복원한다. payload hash는 text를 유지한다. 전체 version/tie/page/me differential과50만 교대 측정이 일치했다. 번호 문자를 임의 축약하거나 rank 결과를 저장하지 않는다.

`202610040800`은 viewer key_numbers를 요청 내 materialized CTE로1회 계산한다.500 own key의250000 lateral 반복을500 lookup으로 제한하고 completed/numbered partial index를 추가한다. 번호 없는 자료는 index에 저장되지 않지만 기존 전체역사 번호 선출의 earliest order/동의/profile 검사는 그대로다. 입력 자료나 ingest ack/수정 권한은 바뀌지 않는다. 추가 index의 저장공간 및 numbered fact 쓰기 유지비용은 존재하며 운영 write-throughput은 미측정이다. rollback은040400 viewer 함수 복구→새 index 제거이다.

## 요청과 UI

비활성 dashboard/개인 비교/지도 refinement와 숨겨진 chart 작업을 중단하고 최신 scope/account/generation의 응답만 반영한다. Abort는 클라이언트 대기 중단이며 PostgreSQL 작업 취소의 증거로 취급하지 않는다. 통계는 metadata만으로 직접 진입하며 draft 편집은 API를 호출하지 않고 통계 만들기로 실행한다. 메타데이터 실패에는 재시도 UI가 있다. 라이트/다크 토큰, 저장/공유/차트/행·열·지표/개인 비교/export는 보존한다. 계정 메뉴의 축약 ID는 9/30 최신 결정대로 유지한다.

Date parsing의 1024개 bounded cache는 ISO 날짜 문자열→일 번호만 저장한다. 신고/사용자/통계/랭킹 응답은 저장하지 않는다. chart/React Profiler counter는 dev 진단이고 production 성능 결과와 구분한다.

## 준비된 배포 순서와 롤백

운영 승인 후: ① migration manifest/check 및 백업·권한 확인 ② 040100→040200→040300→040400→040500→040600→040700→040800 ③ public Edge 배포(새 RPC/strict schema, pinned Zod import config) ④ Pages UI/정적 자산. 새 DB는 이전 Edge와 호환되고 새 Edge는 새 RPC를 요구한다. PC/mobile·내 신고 API를 함께 바꾸거나 재배포할 필요는 없다.

실패 시 Pages/Edge를 이전 커밋으로 forward revert하고, ranking 함수는 030100 대표 및 030200 RPC, 281900 viewer, 010100 state 본문을 새 forward migration으로 복구한다. 새 service-only rollup 함수/registry는 사용 중인 소비자가 없는지 확인한 후 정리한다. 유저·동의·철회·삭제·현재 data version을 과거 snapshot으로 되돌리지 않는다. 로컬 커밋을 원격 push하거나 main에 병합하지 않았다.
