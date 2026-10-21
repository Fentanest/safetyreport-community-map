# 데이터베이스 구현 방향
이 패키지는 실제 Supabase에 접속해 새 schema를 적용하지 않았다. `202608150001_initial_schema.sql`은 과거 v1로 유지한다.
이미 적용된 migration의 본문을 바꾸어 새 상태가 된 척하지 않는다. v2 변경은 신규 migration으로 작성하고 staging에서 검증한다.

## 논리 계층
1. auth.users / identities — Google 연결 UUID·이메일, 공개 불가.
2. private contributors/snapshots/facts — 현재 active facts, 날짜·기관·담당자·차량 canonical, 공개 불가.
3. analytics_* — versioned read models/인덱스. report date axis와 completion date axis를 구분.
4. cm_export — 초기 캐시 생성용 safe views. 차량·contributor ID 제외.
5. public.internal_analytics_* RPC — service executor만 execute; fixed params/DTO, search_path 잠금.

source schema introspection → field mapping → supported metrics → aggregation → security tests 순서로 진행한다.
service_role이 RLS 우회할 수 있으므로 이름에 public이 붙은 view를 광범위로 읽는 함수를 만들지 않는다.
view의 security_invoker/security_definer/owner 권한을 문서화하고 anon/authenticated deny 테스트를 한다.
[근거 S01·S02]

## 최소권한 exporter
CI login role은 NOINHERIT·NOBYPASSRLS·NOCREATEDB·NOCREATEROLE, safe export schema USAGE와 지정 view SELECT만.
실제 ownership/privileges를 검사한 후 부여한다. 'default_transaction_read_only=true'만으로 쓰기 권한을 제거했다고 주장하지 않는다.
raw private table·auth schema·mutating RPC는 접근 실패해야 한다. 예제 SQL는 templates/export-role.sql.example 참고.

## 인덱스/집계
필터별 실제 EXPLAIN ANALYZE로 검증한다. 날짜+category+region, agency+manager+completed_date,
vehicle_canonical+report_date+spatial key에 workload 맞춘 인덱스. 대규모 공간 검색은 PostGIS GiST 검토.
연도별 distinct contributor count를 합산하지 않는다. facts에서 count(distinct) 또는 정확한 membership 기반으로 계산.
집계의 cutoff/version을 meta에 고정한다. snapshot switch·withdraw concurrent test를 수행한다.
화면 정규화 보조 표 `private.screen_fact_norm`(2026-10-18, 로컬): 사실 행 PK별 결정적 정규화 결과와 입력값만 둔다. 선출·자격·집계 상태는 저장하지 않는다.
facts 쓰기 트리거로 유지하고 FK cascade로 사실과 함께 지워지며, 읽는 쪽은 입력·`screen_norm_version()`이 같은 행만 쓴다
([보고서](implementation/screen-query-opt-20261018/REPORT.md)).


## 원본 JSON v2 로컬 후보 (2026-10-21)

정본은 [구현 계획](implementation/raw-json-ingest-20261021/PLAN.md), 현 상태·미완료 목록은
[SOL-REPORT](implementation/raw-json-ingest-20261021/SOL-REPORT.md)다. 운영에는 적용하지 않았다.
`contracts/community-ingest-v2`의 원본 문자열·보조 필드·선택 비교 DTO를 검증해 private raw와 queue에 저장한다.
워커가 PC 1a67d01의 고정 Python 파서로 해석한 뒤 공용 SQL 투영 함수로 facts를 갱신한다.
`stored` ACK는 중앙 저장 완료이며 `parse_pending`은 지도 반영 대기다. 파싱 실패 시 이전 fact를 유지한다.
새 raw/parsed/diffs/queue는 public API·화면 캐시·rollup·CSV의 원천이 아니며 anon/authenticated에 권한이 없다.
실제 철회는 raw 삭제와 parsed/diffs/queue cascade를 실행한다. 정책 대체(superseded_policy)는 철회와 구분한다.
v1 원장 payload는 30일 뒤 제거하되 재시도 식별에 필요한 최소 메타·해시·영수증은 유지한다.
capability·notice·차단일은 같은 private 설정 행을 사용하며 v2 기본값은 꺼짐, 차단일은 미정이다.
새 계정 status 계약 사본은 [account-api](account-api.md)다. v1 wire 계약 파일은 유지한다.
