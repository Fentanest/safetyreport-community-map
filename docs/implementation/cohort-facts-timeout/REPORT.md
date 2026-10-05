# cohort facts 시간 초과 수정 · 로컬 검증

대상: `fix/cohort-facts-timeout`, 기준 `9d67fe0`. 운영 접속·push·배포 없이 새 migration으로 RPC 구현을 수정한다. 기존 migration은 변경하지 않는다.

## 원인과 확인 범위

사용자가 제공한 운영 증거는 2026-10-05 23:18:46 KST의 `internal_analytics_cohort_facts` HTTP 500과 8초 뒤의 PostgreSQL `57014`다. 운영 EXPLAIN을 얻거나 운영 DB에 접속하지 않았으므로 운영의 정확한 실행계획을 확정했다고 주장하지 않는다.

로컬 PostgreSQL 17.6에서 합성 자료 주입 후 facts/profiles/grants에 ANALYZE를 실행하고 동일 원본 함수를 측정해 다음 구조적 병목을 확인했다.

- 최초 3천 행 진단: 529ms. `community_lineage_active`를 포함한 fact 스캔이 5번이며 후보 쿼리가 예산/결과 생성에서 반복된다. 이 조건에서는 8초 취소가 재현되지 않았다.
- 캐시된 generic plan: scoped를 실제 수천 행 대신 **1행**으로 추정한다. `key_numbers`와 scoped의 중첩 루프에서 3천 행 fixture가 **6,933,621번**의 불일치 비교를 만든다. `scoped` 2,733행을 2,538번 다시 읽는다. 공개 동의 EXISTS 세 개도 각각 2,733번 실행된다. 이는 단순 자료량이 아닌 행 수 추정과 반복 평가 문제다.
- 3만 행·generic plan·호출 시작 시 8초 제한에서 원본의 `57014`를 재현한다. 수정본은 같은 제한 안에 완료된다. 함수 안의 기존 `set_config('statement_timeout','8000',true)`는 그대로이며, 재현기는 호출 전에 8초를 설정해 실제 취소를 검증한다.
- 단순 SELECT 위의 EXPLAIN은 함수 내부 노드를 보여 주지 않으므로 `EXPLAIN (ANALYZE, BUFFERS)`와 `auto_explain.log_nested_statements/analyze/buffers`를 함께 기록했다. 최초 원본 진단과 최종 실행계획은 [evidence](evidence/)에 있다.

## 수정

`202610060100_cohort_facts_setwise.sql`은 기존 함수 하나만 교체한다.

1. 현재 동의의 공개 허용 항목을 lineage별로 묶고, 유효 grant를 한 번 계산해 재사용한다. 유효성은 lineage+user, 공개 항목은 기존 EXISTS처럼 lineage-only다. 과거 grant·미등록 disclosure·철회된 lineage·다른 user의 lineage 충돌도 기존 의미를 보존한다.
2. 후보 키를 한 번 계산하고, 후보의 전체 유효 이력을 한 번 읽어 예산·번호 보완·대표 선출에 재사용한다. 날짜 인덱스를 후보 탐색에 사용할 수 있게 하여 빈/좁은 범위의 전국 wide-row 저장을 피한다.
3. 예산을 초과하면 admitted CTE의 one-time 조건이 대표 선출과 JSON 생성을 막고, `RESULT_TOO_LARGE`를 발생시킨다. 지역 코드는 이전처럼 예산 계산 뒤에 적용한다.
4. 함수 내부 `enable_nestloop=off`로 잘못된 1행 추정이 이차 시간 조인이 되는 것을 억제한다. 함수가 반환하면 호출자 설정이 복원된다. 전역 설정·timeout·work_mem은 변경하지 않는다.
5. 기존 날짜·source key·grant 인덱스로 충분하여 새 인덱스는 추가하지 않는다. `internal_my_analytics_cohort_source`는 이 함수를 호출하며 state는 이미 `202610040500`에서 set-wise로 개선됐다. 개인 함수의 인증/조회 의미를 다시 작성하지 않는다.

JSON 필드·null·배열 순서·D13·R2·공동 기여·100,000행 예산·service_role 전용 권한·STABLE·SECURITY DEFINER·빈 search_path를 동등 비교한다. 원본의 정렬 동률에 새로운 tiebreaker를 추가하지 않았다. 명시적 최종 ORDER BY가 없는 원본의 모든 가능한 동률 순서를 수학적으로 보장한다고 확대해석하지 않으며, 테스트는 동률 fixture에서도 **정렬로 정규화하지 않은 JSONB 전체**를 비교한다.

## 성능

모든 수치는 실제 로컬 PostgreSQL 호출 시간이며 synthetic 자료다. HTTP 왕복·Edge JSON 파싱·운영 p95가 아니다. 30개 합성 사용자, 서로 다른 동의 정책, 중복 신고 키, 결측 날짜/좌표, 비공개/정지/철회 자료를 포함해 정확히 3,000/30,000 fact 행을 만든다. 고유 신고 수와 전체 관측 행 수는 다르다.

3천 행은 기본 `plan_cache_mode=auto`의 연속 요청, 3만 행은 원본도 전체 조건을 끝내 동등 비교할 수 있도록 `force_custom_plan`을 사용한다. 각 조건의 표 값은 두 날짜 기준 × 비교기간 true/false 네 요청 중 최대값이다. 별도 generic timeout 재현으로 빠른 custom plan 수치가 원본의 느린 cached plan을 가리지 않도록 한다. EXPLAIN 계측 시간과 일반 호출 시간은 구분한다.

| 조건 | 3천 원본 ms | 3천 수정 ms | 3만 원본 ms | 3만 수정 ms |
|---|---:|---:|---:|---:|
| 전체 기간/all | 1464.3 | 176.6 | 3740.2 | 1779.8 |
| 연도 | 517.3 | 95.5 | 2673.6 | 997.7 |
| 월 | 32.4 | 15.2 | 200.8 | 97.3 |
| 기관 | 96.5 | 30.1 | 464.6 | 209.8 |
| 기관+담당자 | 26.6 | 17.2 | 202.9 | 90.7 |
| bbox | 336.0 | 82.2 | 1623.7 | 692.9 |
| 분류+지역 | 235.3 | 36.5 | 1583.0 | 337.9 |
| 빈 기간 | 15.3 | 5.8 | 4.4 | 2.8 |
| 개인 통계·유효 세션 | 1464.2 | 244.5 | 4535.1 | 2341.1 |
| 개인 통계·무효 세션 | 52.2 | 51.1 | 444.3 | 424.6 |

- 3천 fact 조회 최대 **187.2ms**(custom 포함), 개인 통계 포함 최대 **251.6ms**. 3만 fact 조회 최대 **1,779.8ms**, 개인 통계 포함 최대 **2,341.1ms**. 목표 범위 안이다.
- 3만 generic plan 별도 재현: 원본 **8,004.3ms / 57014**, 수정 **1,795.8ms / 27,295행 반환**. [재현 결과](evidence/generic-timeout.txt).
- 각 규모의 32조건+개인2, 3천 auto 추가34 = **102회 JSONB 전체 동등 비교 통과**. [3천 auto](evidence/3000-auto.json), [3천 custom](evidence/3000-force_custom_plan.json), [3만 custom](evidence/30000-force_custom_plan.json).
- 위 시간은 조건당 1회, 반복 조건 간 캐시가 있는 로컬 측정이다. p50/p95나 운영 SLA로 표시하지 않는다. 원본을 읽고 수정본을 이어 호출하므로 cold-cache 이점을 제거한 벤치마크도 아니다. 계획상의 반복 횟수 제거와 별도의 generic-plan 취소 재현을 함께 근거로 사용한다.
- 최종 generic 실행계획에서 대표 선출 조인은 hash join으로 실행되고 반복적 lineage 함수 호출이 사라졌다. 3만 plan에는 work_mem 4MB에 따른 임시 파일 사용이 남지만 timeout/work_mem을 늘리지 않았다.


## 검증·환경 복원

| 검사 | 최종 결과 | 증거 |
|---|---|---|
| `npm test` | **624 passed / 116 skipped**, 실패 0. 기본값으로 꺼진 로컬/성능 검사를 통과 수에 포함하지 않음 | [unit](evidence/unit.txt) |
| Python blueprint / product | **27 / 12 passed**, 실패 0 | [blueprint](evidence/blueprint.txt), [product](evidence/python-product.txt) |
| 신규 rollback-only SQL 회귀 | **5 passed**: 56개 scope/plan 비교, D13/번호/공유 payload/동률/다중 기기, 9개 동의 전이, 개인 인증/권한/설정 복원, 6개 validation·4개 budget 결과 | [cohort](evidence/cohort-tests.txt) |
| 기존 날짜 기준·rollup·viewer/state 통합 | **17 passed / 3 suites**, 실패 0. 실제 로컬 PostgreSQL·GoTrue·PostgREST와 JS 집계 비교 | [integration](evidence/existing-integration.txt) |
| 규모별 성능·JSONB 동등성 | **102 comparisons passed**, 3만 generic 57014 재현 및 수정본 8초 이내 완료 | 위 성능 표·JSON·plans |
| live-mode build / artifact scan | **passed**, scan issues 0 | [build](evidence/build.txt), [scan](evidence/scan.txt) |
| 공유 migration manifest | **43 migrations / 7 functions**, hash/dependency/import-closure 검사 통과 | [manifest](evidence/manifest.txt) |
| 로컬 원상 복원 | **54개 private/auth 테이블 행 수·내용 해시 동일**, 원래 fact 488행·원래 함수 정의·41개 migration 이력·fact 트리거 활성 상태 확인 | [restoration](evidence/restoration.json) |

신규 SQL 테스트·벤치마크는 각 실행 전체를 롤백한다. 기존 17개 검사는 후보 함수를 로컬에 일시 적용해 수행하고, 합성 사용자 정리 뒤 기존 함수·projection 메타데이터·audit 항목을 복원했다. DB reset/다른 스택·볼륨 삭제는 하지 않았다. 최초부터 실행되던 같은 6개 Docker 서비스도 유지했다. 누적 통과 수는 최종 실행 기준이며 중간 후보의 재실행 횟수를 더하지 않는다.

운영 적용 현황은 저장소 기록만 사용했다. 2026-10-04 배포 보고서가 지도 `202610040800`까지를 기록하고, 로컬도 같은 지도 이력이었다. manifest의 Auth `202610050100`은 로컬 미적용으로 남겼으며 이 함수 변경의 선행 의존성이 아니다. 신규 migration도 테스트 뒤 로컬 이력에 남기지 않았다. BLOCKED 없음; 미실행 항목은 아래에 구분한다.


실패 이력: 초기 새 테스트의 fixture 크기 토큰이 주석에서만 치환돼 5건이 실패했고 `replaceAll`로 고쳤다. 다음 실행의 예상 비교 수를 112로 잘못 적어 1건이 실패했으며 실제 7조건×2날짜×2비교×2plan=56으로 고쳤다. 벤치마크 초기 harness도 예상 행 수를 66으로 잘못 적어 동등 비교 34개가 모두 참인데 실행을 실패로 표시했으며, 실제 32조건+개인2=34로 바로잡았다. 비교 범위나 동등성 assertion을 제거하지 않았다. 최종 결과만 아래 통과 수에 포함한다.

기존 통합 테스트의 `DATASET_CHANGED`/`INVALID_QUERY` 로그는 오류 거절을 의도적으로 검사한 경우로, 최종 Vitest 결과와 함께 읽는다. npm 빌드는 기존 큰 chunk와 ineffective dynamic import 경고를 남긴다.

NOT_RUN: 운영 DB·사용자 JWT/OAuth·실제 브라우저 UI/Muse·호스팅 Edge·Pages 배포. UI/Edge 코드를 바꾸지 않는 SQL 작업이며, 이번 검증을 실제 운영 UI 승인으로 표시하지 않는다. unrelated OAuth/ingest Edge 통합 및 기존 50만 행 성능 스위트는 이번 범위에서 실행하지 않았다.

배포는 **SQL 한 파일만**, Edge/Pages 재배포 불필요. 운영자가 실행할 명령·이력 등록·되돌리기는 [MIGRATION.md](MIGRATION.md). 요청된 외부 `REPORT.md`에 최종 커밋 SHA와 이 보고서 위치를 함께 기록한다.
