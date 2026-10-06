# 전체 Supabase 쿼리 감사 · 2026-10-06

map `5cf45c6`의 cohort 개선을 그대로 유지하고 map/auth가 공유하는 현재 SQL과 모든 저장소 소유 DB 호출 경로를 감사했다. 운영 접속·push·배포는 하지 않았다. 새 map forward migration 4개가 읽기 반복 동의 검사, INSERT/DELETE manifest 반복 갱신, 기관 재계산의 행별 UPDATE를 줄인다. Auth 제품 SQL·Edge·웹 코드는 변경하지 않는다.

## 범위와 근거

[INVENTORY.md](INVENTORY.md)에 기준 함수 74개, 제품 테이블 28개, 제품 인덱스 59개, 트리거 8개와 Edge/server/web 호출·발생 빈도·최종 정의 위치를 기록했다. 제품 view와 RLS policy는 0개다. 로컬에 남아 있던 Realtime 제어 테이블·인덱스·정책 각 1개는 제품과 별도로 계수했다. 후보 적용 후 함수 76개/트리거 10개이며 제품 테이블·인덱스·권한 경계는 그대로다.

3천/3만 fact, 30/300 계정, 120/1,200 동의 이력, 60/600 연결, 600/6,000 relay 요청 및 3천/3만 rate·ingest 원장을 합성했다. 전체 fact가 한 계정에 집중되는 조건도 별도로 측정했다. 운영 계정 분포는 제공되지 않았고 운영에 접속하지 않았으므로 이는 운영 자료의 복제본이 아니다. PostgreSQL 17.6, JIT on, custom/generic plan 강제 조건에서 실행했다. [MEASUREMENTS.md](MEASUREMENTS.md)의 79개 시나리오 전후 표와 [coverage.json](evidence/coverage.json)이 기존 74개와 새 batch trigger 함수 2개를 직접/내부/트리거로 대응한다. 루트 EXPLAIN ANALYZE BUFFERS 및 함수 내부 auto_explain은 별도 계측 실행으로 보관했다.

anon/authenticated/service_role 실제 역할로 520개 ACL/RLS probe를 실행했다. 제품 private 테이블의 실제 접근 거부와, 트랜잭션 내 임시 SELECT 권한만 부여한 default-deny RLS 계획을 구분한다. 후자는 애플리케이션 권한 변경이 아니며 롤백됐다. 최종 함수 ACL·SECURITY DEFINER·빈 search_path를 검사했다.

## 변경과 불변 조건

- `060200`: state·viewer·legacy facts·개인 source·ranking의 lineage 확인을 집합 조인/EXISTS로 수행한다. legacy의 날짜 합집합 범위·전체 이력 번호 보완·10만 행 선행 한도·대표 선택·JSON 필드/배열 순서를 보존한다. D13 cohort 함수로 legacy 계약을 치환하지 않는다. legacy와 ranking representative 함수 안에 nested loop 억제를 설정하고 기존 8초 한도는 그대로 둔다.
- `060300`: INSERT/DELETE transition table을 contributor/dataset별로 묶되 generation을 **영향받은 completed 행 수만큼** 증가시킨다. UPDATE/키 이동/upsert conflict의 원래 행별 규칙은 보존한다. projection 무효화 전 manifest를 갱신하도록 trigger 이름 순서를 유지한다.
- `060400`: registry 버전의 FOR SHARE 잠금, 중복/유효성 검사와 모든 CAS 조건을 유지한 하나의 UPDATE로 기관 보정을 처리한다. 빈 배열은 DML을 실행하지 않는다. applied/skipped와 변경 행·manifest는 같다. dataset_version은 원래부터 불투명한 무효화 토큰이며 한 배치의 갱신 횟수는 공개 계약이 아니다.

`060500`은 지역 필터의 반복 지역명 해석을 제거한다. 좌표 없이 확정되는 지역명은 한 번 해석하고, 분할 구역은 서로 다른 좌표 입력별로 기존 geometry 함수를 호출한다. 서울·인천 옛 지명/분할 구역·세종·NULL/알 수 없는 지역을 이전 함수와 비교한다.

새 인덱스는 0개다. 기존 PK/부분 인덱스가 선택 조회를 지원했고 이번 병목은 같은 행 집합의 반복 함수 실행과 manifest 행의 반복 쓰기였다. 작은 1/20 event ingest도 별도 측정했다. transition table은 대량 쓰기 성능을 개선하지만 작은 배치에는 몇 ms의 변동/추가 비용이 있을 수 있다. 보편적인 업로드 속도 개선으로 과장하지 않는다.

## 남은 비용과 변경하지 않은 이유

- raw cohort/legacy JSON 반환은 3천 약 3.4 MB, 3만 약 36 MB로 100ms를 넘는다. serialization 대체 실험은 유의한 이득이 없어 제거했다. 반환 필드/건수·전체 이력 의미를 줄이지 않았으며 TASK1 함수도 다시 쓰지 않았다.
- 한 계정의 3만 fact를 임의 SQL로 한꺼번에 상태 변경하는 UPDATE는 여전히 8초 진단 한도에 걸린다. 기존 manifest의 행별 키 이동 의미를 보존했다. 제품 ingest는 최대 20 event, 기관 보정은 completed 키 집합을 바꾸지 않는다. 임의 대량 UPDATE 문제를 해결했다고 표시하지 않는다.
- 3만 bulk INSERT와 큰 삭제 fence 생성, 전체 own/raw source 반환, 10배 rollup·개인 검색은 여전히 100ms 이상이다. 출력/정렬/기존 FK 및 registry 검사 비용이다. 측정한 제품 조회는 개선 후 진단 한도 내이며 작은 운영 규모에서 새로운 timeout 회피를 위해 결과를 축소하지 않았다.
- 지역 조건이 없으면 지역 해석 조인을 생략하도록 보완했다. 중간 후보에서 관찰한 무필터 추가 비용은 `rollup-before-join-gate`에 보존하며 최종 후보와 구분한다. 무필터 조회까지 지역 필터와 같은 개선율을 주장하지 않는다.
- Auth relay의 일반 액션/동의/기기 RPC는 운영 규모에서 100ms 미만이고 10배 cleanup도 약 0.1초다. 전역 capacity 직렬화, rate, nonce 소진·코드 단회 전달 잠금을 바꾸지 않았다.
- Edge는 fact별 RPC N+1이 없다. public 조회는 Auth 1 + DB 4, 개인/랭킹/내 신고는 Auth 1 + DB 2다. gate/rate의 거절 순서와 오류 의미를 보존했다. catalog의 state 조회 생략은 실패 의미를 바꿀 수 있어 이번 SQL 감사에서 제거하지 않았다.

## 결과 동등성

동일 SQL 문장 안에서 이전/새 함수의 JSONB 전체(배열 순서 포함)를 비교하는 60개 읽기 사례, 동의 철회/복원·suspend·NULL 날짜·bounds override, legacy 검증/10만·10만1행 한도, manifest의 INSERT/DELETE/UPDATE/키 이동/upsert/빈 statement, 기관 CAS 성공·실패·중복·빈 배열, 실제 역할 권한 회귀를 실행한다. 대규모 행렬 parity의 ranking generated_at은 별도 문장 시각이므로 그 한 필드만 제거하며 작은 동일 문장 회귀에서는 그 필드도 정확히 비교한다. 기존 3만 generic legacy/개인 source의 timeout 때문에 응답이 없는 두 비교는 parity PASS로 세지 않는다.

최종 검사 상태와 로컬 복원 결과는 아래 실행 증거를 따른다. 운영 적용 순서/명령은 [MIGRATION.md](MIGRATION.md), 재현 방법은 [REPRODUCE.md](REPRODUCE.md), 변경 요약은 [CHANGELOG.md](CHANGELOG.md)에 있다.

## 테스트 실행 기록

- 첫 전체 map 실행: 73파일, 699 passed / 6 failed / 준비 실패로 40 skipped. 최종 전체 단위 실행: 628 passed / 118 통합 선택항목 skipped. 원래 전체 실행의 통합 항목과 실패 파일 재실행을 합치면 746개 고유 테스트를 실행했다. 새 SQL 뒤의 영향받는 rollup/Edge 재검사 결과는 tests.json에 별도 기록한다.
- 최초 실패는 잘못 선택한 Auth용 mock(A/B), 자체 Deno 포트 56999 충돌, 새 migration 주석의 ASCII apostrophe였다. map mock으로 교체하고 단독 실행했으며 주석을 수정했다. 추가 재실행에서 F 계정이 다른 suite의 공유 삭제 테스트에도 쓰인다는 fixture 충돌을 발견해 never-consented 전용 L 계정으로 분리했다. 같은 오류코드/권한 assertion을 유지한다.
- 기존 viewer 측정은 이미 설치된 인덱스를 없는 것으로 가정하므로 롤백 트랜잭션 안에서만 그 인덱스를 먼저 제거해 정확한 without-index 비교를 재현한다. 내 신고 측정 출력 위치만 선택 가능하게 해 과거 증거를 덮지 않는다.
- 기존 선택적 성능 suite도 실행했다: handler 0~50만 합성 입력, 내 신고 own 2만/타인 20만, rollup 50만 대표/60만 관측, rankings 50만 대표, HTTP 각 경로 반복, viewer NULL-number 500개/90개 동일 응답. rankings의 50만 확장 측정은 중간 후보 약 14~21초에서 함수 범위의 계획 보정 뒤 약 5.1~5.5초로 줄었다. 운영 규모/10배 결과로 섞지 않는다. HTTP 두 wrapper는 동일 후보 DB이므로 SQL 변경 전후 비교로 해석하지 않는다.
- Python blueprint 27개, product 12개, 새 SQL 의미 회귀 6개(그 안의 읽기 60개·지역 18개 포함), filter parity 20개, 실제 역할 probe 520개를 실행했다. DB 변경은 측정/새 회귀에서 롤백한다. 기존 통합 suite의 영속 변경은 전체 로컬 백업 복원으로 되돌린다.
- 두 저장소 build/공개 artifact scan 통과. 공유 manifest 47 migration/7 Edge 일치. 운영 접속·hosted Kakao·실제 Pages 배포 smoke는 NOT-RUN(금지된 운영/배포 범위). Kakao는 mock이며 native hosted Edge 대신 실제 Deno 엔트리/로컬 gateway를 썼다.


최종 재측정 중 ranking의 분산 3만/custom 조건에서 다시 timeout이 재현됐다. `ranking-regression-plan.json`의 own CTE가 1행으로 추정되고 번호 보완에 Nested Loop Left Join을 택했다. 실패 시각/결과는 `ranking-plan-regression-observed.json`에 보관했다. `060200`의 ranking 함수에도 `enable_nestloop=off`를 함수 범위에서만 지정했다. 같은 조건의 EXPLAIN ANALYZE에서 전체 rankings 약 295ms, representative 반환 약 440ms로 완료됐다. 성능 회귀는 계정 집중뿐 아니라 분산 조건도 검증하도록 넓혔다. 서비스/전역 GUC·timeout·응답 의미는 바꾸지 않았다.


## 최종 검사와 복원

최종 영향 범위 재검사 6파일 28개, 마지막 지역 조인 조건까지 반영한 rollup/통계 Edge 재검사 3파일 12개가 통과했다. 50만 대표 rollup의 마지막 10회 측정은 manager median 8,749ms, laws 8,698ms, series 7,994ms였다. 이 확장 부하 결과는 3천/3만 규모 표와 구분한다. 최종 Auth는 단위 54개·relay 24개·Chromium 11개가 통과했고, relay 24개는 실제 Deno 엔트리로도 별도 통과했다. [tests.json](evidence/tests.json) 및 tests/*.log에 초기 실패와 재실행을 함께 보존했다. 최종 코드/SQL 해시는 [run-manifest.json](evidence/run-manifest.json)에 있다.

[local-restoration.json](evidence/local-restoration.json): 백업의 auth/private/public 56개 테이블 행 수·행 해시가 모두 일치한다. 원래 함수·트리거·RLS·ACL·인덱스 카탈로그, relay FK, 시퀀스 4개와 migration 이력 41개도 복원했다. 제공된 Supabase 6개 컨테이너는 같은 ID로 실행 중이며 healthcheck가 있는 서비스는 healthy다. 다른 컨테이너는 시작 시각까지 그대로다. 추가 테스트 Deno/mock/site 서버의 포트는 모두 닫혔다.

시스템 Realtime publication 전체는 일치하지 않는다. 서비스가 작업 중 10월 7~9일의 빈 메시지 파티션을 생성하고 재시작 때 9월 30일·10월 2일의 만료 파티션을 정리했다. 제품 publication은 일치한다. 이 서비스 유지보수 차이는 증거 JSON에 명시하며, 시스템 시계·WAL·통계·만료 파티션까지 과거로 되돌렸다고 주장하지 않는다. 운영 접속·push·배포는 수행하지 않았다.
