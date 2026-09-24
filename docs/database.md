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
