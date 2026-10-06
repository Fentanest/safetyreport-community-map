# 화면 서버 집계 구현 보고 · 2026-10-06

기준 `fix/screen-server-aggregate` / `1d846aa`. request_mode=구현. **미커밋 후보이며 운영 반영 없음.** 운영 DB·Edge·Pages 접근/배포, push, 다른 컨테이너·볼륨 변경 없이 지정 로컬 스택만 transaction/ROLLBACK으로 사용했다.

## 선택과 결과

단일 snapshot RPC 안에서 SQL이 대표 선출과 화면 집계를 수행하고, Edge는 작은 충분통계로 기존 DTO를 조립하는 `screen-aggregate-v1`을 선택했다. 원시 facts를 전송하지 않는다. UI 배열 정렬·페이지·지도 압축은 기존 JS 함수를 재사용한다. SQL이 만드는 것은 최종 브라우저 JSON 자체가 아니라 건수·정확한 분위수·그룹·주소 anchor 등의 집계 source다.

3만/6만 합성 fact에서 RPC 전송은 **19.10/38.21 MB → 0.190–0.217 MB (98.87–99.47% 감소)**, 원시 행/34열 복원은 **27,332/54,664행 → 0행**이다. Node에서 실제 screen handler를 재생한 시간은 **1.19–4.29초 → 23–27ms**이며, 모든 대량 측정에서 기존 전체 화면 패킷과 deep equal이다. 최종 브라우저 응답 크기는 그대로다.

**SQL 계산은 더 느려졌다.** 전체 집계를 DB로 옮긴 결과 6만 전체기간의 PostgREST 모양 쿼리는 2.55→3.99초다. 핵심 개선은 DB 이후 전송·원시 복원·JS 재집계 작업 제거다. 운영 ARM 소형 DB에서 첫 화면 수 초 목표 달성 여부는 **배포 후 총괄 측정**이다. 로컬 절대시간이나 단계별 시간을 합산해 운영 end-to-end 통과로 판정하지 않는다.

다른 방향과 비교:

| 방식 | 판단 |
|---|---|
| SQL 집계 + 기존 RPC | 선택. 같은 statement에서 state/viewer/집계가 일치하며 기존 인증·전송·배포 체계를 유지한다. |
| Edge DB 직접 연결 | 미선택. PostgREST 재직렬화는 피하지만 19–38MB 전송, 약 93만–186만 셀 복원과 초 단위 JS 집계가 남는다. 새 pool/접속 설정도 필요하다. 직접 연결 성능을 실측했다고 주장하지 않는다. |
| dataset_version+scope 캐시 | 미선택. viewer별 compare, 동의/철회, scope, 패널 조합 무효화가 추가된다. 이번에는 저장 캐시와 TTL 없이 하나의 snapshot으로 해결한다. |

## 계약과 구현

- `internal_analytics_read_snapshot`은 이름·인자·json 반환형·소유자·service_role ACL을 유지한다. opt-in 옵션에만 새 경로를 적용한다. state/viewer/집계는 STABLE 호출의 같은 statement snapshot이다.
- 카카오·세션·contributor active·공개 10건을 SQL에서 먼저 검사한다. Edge의 기존 인증·rate limit·query validation도 유지한다. 실패 시 부분 집계나 빈 성공으로 대체하지 않는다.
- 전역 대표는 기존 R1/R2 선출과 후보 key의 전체 적격 이력을 사용한다. 개인 compare는 요청 viewer의 복사본을 신고/처리 코호트별로 선출한다. 처리/신고 날짜축, 이전 동일 길이 기간, COHORT_POLICY_VERSION은 그대로다.
- 기관/담당자/법규/지역/주소별 수치, 월별, duration median/p90, amount median, 별점·히스토그램·차량 반복 분포를 SQL로 계산한다. 분위수 배열은 DB 안에서만 사용한다. 공개 1건도 숨기지 않는다.
- 주소·법규·차량 정규화는 JS 공백/Unicode 규칙과 일치한다. 원번호·UUID·report identity를 집계 source나 공개 DTO에 넣지 않는다. 차량 TOP5는 기존 마스킹을 적용한다. 주소 좌표는 기존 weighted/map 및 unweighted/focus 선택을 구분한다.
- 그룹의 첫 등장 순서와 기존 localeCompare/동명이인/표 정렬을 보존한다. 지도 1,000개 초과 compact와 bbox는 기존 JS 함수를 사용한다.
- 새 private 함수 안에서만 `enable_nestloop=off`, `enable_sort=off`를 지정했다. 중첩 loop와 전역 sort aggregate 비용을 줄이는 용도이며 필수 대표 선출 정렬은 남는다. 글로벌 설정·work_mem·timeout·테이블·인덱스는 변경하지 않았다.

| 변경 파일 | 역할 |
|---|---|
| `supabase/migrations/202610060900_screen_server_aggregate.sql` | snapshot opt-in, private 집계·정규화·정확 분위수 helper 및 권한 |
| `server/screenAggregate.ts` | 충분통계→기존 dashboard/panels/compare DTO 조립 |
| `server/screenHandler.ts`, `server/publicHandler.ts` | 단일 source 선택과 기존 gate/validator 후 집계 사용, 구 SQL fallback |
| `tests/integration/screen-server-aggregate.test.ts`, `tests/product/screenSnapshot.test.ts` | SQL 전체 패킷 parity·보안·호환·규모/예산 검사 |
| `scripts/benchmark/screen_server_aggregate.py` | 로컬 transaction SQL/전송량 계측 |
| `scripts/browser/vite.screen-aggregate.config.ts`, `verify_screen_aggregate.mjs` | 실제 handler+SQL export의 로컬 Chrome 회귀 검사 |
| `docs/data-contract.md`, migration manifest, 본 디렉터리 | 계약·공유 파일·migration 해시·재현·적용/롤백·증거 |

호출자 영향: `my-analytics/screen`만 새 옵션과 집계 source를 사용한다. 브라우저 `screen-v1`/내부 v2 DTO, public-analytics, user-rankings, 독립 개인 API, 앱 API 계약은 유지된다. 공통 public handler의 추가 hook은 화면 전용 repository에만 설정된다. 기존 호출자는 facts/rollup을 계속 받는다.

## 전/후 실측

PostgreSQL 17.6 x86_64, 동일 합성 자료·동일 transaction. SQL 측정 세션의 work_mem=2MB. 257개 주소/400개 원시 차량 후보를 추가한 diverse fixture. 최근 12개월 `2025-10-07..2026-10-06`, 전체 `2019-04-23..2026-10-06`. 각 단계 독립 3회 중앙값이며 병렬 부하 없이 측정했다. MB는 1,000,000bytes, 시간은 ms다.

| fact 규모 / 범위 | RPC bytes 전→후 | 함수 직접 전→후 | PostgREST 모양 전→후 | source parse 전→후 | handler 전→후 | 공개 packet bytes (동일) |
|---|---:|---:|---:|---:|---:|---:|
| 30,000 / 12개월 | 19,100,320 → 190,350 | 894.5 → 1,570.4 | 974.0 → 1,577.2 | 81.92 → 1.21 | 1,189.98 → 23.39 | 294,319 |
| 30,000 / 전체 | 19,100,322 → 216,506 | 1,011.2 → 1,988.6 | 1,060.4 → 1,949.4 | 79.19 → 1.28 | 1,897.01 → 26.80 | 358,740 |
| 60,000 / 12개월 | 38,205,391 → 202,515 | 2,150.7 → 3,233.4 | 2,446.5 → 3,259.1 | 162.52 → 1.24 | 2,726.84 → 23.42 | 302,118 |
| 60,000 / 전체 | 38,205,391 → 217,440 | 2,329.8 → 4,011.3 | 2,548.4 → 3,985.8 | 159.75 → 1.27 | 4,285.36 → 25.30 | 360,728 |

- 3만→6만에서 원시 decode 셀은 929,288→1,858,576개였으나 새 경로는 모두 0개다. 집계 그룹은 최근 528→575개, 전체 648→648개, RPC bytes는 각각 +6.4%, +0.43%다.
- source JSON.parse는 양쪽 1회다. handler 내부 관찰 parse는 warm 기준 양쪽 13회(패널·JWT·검사용 최종 packet 포함). 첫 legacy 실행은 런타임 초기화로 14회다. **호출 횟수 감소가 아니라 파싱 대상 크기와 원시 복원·재집계 제거가 개선점**이다.
- PostgREST 모양은 `coalesce((json_agg(t.s)->0)::text,'null')`를 직접 실행한 DB 쿼리다. 실제 PostgREST HTTP/네트워크는 미측정이다. handler는 Node에서 실제 코드를 실행하고 auth/RPC만 stub했다. hosted Edge 시간/메모리는 미측정이다.
- 운영 기준 22MB·11–14초·503은 작업지시서의 총괄 제공값이다. 이 작업에서 운영을 재측정하지 않았다.

원본: [summary.json](evidence/summary.json), `sql-{30000,60000}-diverse-{year,all}.json`, `handler-{30000,60000}-diverse-{year,all}.json`. `initial-correlated-plan/`, `sorted-aggregate-plan/`, `development/`는 실패/중간 구현 증거이며 최종 측정에 섞지 않았다.

## 검사 결과

| 검사 | 실제 결과 |
|---|---|
| 새 rollback-only SQL 통합 | **9 passed**, benchmark opt-in 1 skipped. 양 날짜축 20개 scope, 단일 1건·빈 범위, 카테고리·지역·기관/담당자·법규·bbox, focus/missing/prefix/compare, strict DTO·전체 deep equal |
| 경계·선출·호환 | 위 9개 안에서 mixed status/공개 정책/0원/동명이인/중복 dataset/대표 동률, generic·custom plan, Unicode·마스킹 충돌, 1,000개 초과 주소, 12만 후보의 양 경로 RESULT_TOO_LARGE, 권한/잘못된 세션/5건/철회, SQL rollback 후 신 Edge equality 통과 |
| 기존 DB 통합 | screen-transport 9개 + cohort-timeout 5개 통과. 첫 묶음 로그는 새 검사 당시 8개를 포함해 22 passed, 이후 새 suite를 9개로 확장해 재실행 |
| 대량 Node replay | 30k/60k × 12개월/전체 4회 실행, 모두 whole-packet deep equal, 매 실행 경로별 3회 측정 |
| 전체 Vitest 단위 실행 | **656 passed / 1 failed / 141 skipped**. skipped는 실제 통과로 세지 않음. 아래 기존 실패 참조 |
| Python | blueprint 27개, product 12개 통과 |
| build / public dist scan | 성공 / `passed:true, issues:[]`. 기존 chunk 크기·dynamic import 경고 있음 |
| migration compose | 51 migrations / 7 functions 통과. 새 SQL SHA `599f77d5f3da0bae6a8b8a6e3bd8340438c123004926cbed2570e51670719e21` |
| 로컬 DB 보존 | 전/후 전체 dump SQL 4,275,923bytes, SHA `adcb305b483759bc3699f2d63a2fd66d0d85da388a66c4af6c28a1676c0305af` 동일. 새 함수 부재, 기존 work_mem=4MB 유지 |

전체 단위 검사 실패는 기준 HEAD와 byte-identical인 `202610060800_service_role_statement_timeout.sql` 1–2행 주석의 ASCII apostrophe 때문이다. [기준 파일 동일성 증거](evidence/existing-unit-failure.json), [실패 로그](evidence/unit.log). 이미 운영 적용된 migration의 해시와 테스트 기대값을 보존했다. **전체 검사 green으로 보고하지 않는다.** 총괄의 기존 migration 관리 정책에 따른 별도 정리가 필요하다.

브라우저는 **PASS**: Chrome 154, 390·1440·1920·2560px × dark/light 8종, 법규 정렬·개인 비교·전체기간 전환·version 일치. screen 요청 13건 모두 200, console/page error 0, 가로 overflow 0. [browser/results.json](evidence/browser/results.json) 및 같은 폴더 실제 screenshot을 참조한다. 모바일 dark/light·1440 상호작용 후·2560 light 이미지를 직접 열어 KPI/차량 마스킹/차트/표 표시도 확인했다. 실제 Chrome에서 SQL export→실제 screen handler→프런트를 실행한다. 인증은 합성, 지도는 MOCK이다. 검수 후보는 미커밋 파일 해시로 식별하며 독립 Muse/fixed-commit/실제 카카오/운영 UI 승인을 뜻하지 않는다.

## 운영 반영·롤백·남은 위험

[적용/롤백 지침](MIGRATION.md): **SQL→my-analytics Edge→Pages(필요시)**. 응답 계약이 같아 이번 변경만으로 Pages 배포는 필요 없다. 구 Edge+신 SQL은 opt-in이 없어 기존 source, 신 Edge+구 SQL은 동일 RPC source의 legacy fallback을 사용한다. 추가 DB 재조회는 없다. 롤백은 Edge 이전 artifact 및 필요시 [rollback.sql](rollback.sql)을 새 forward migration으로 적용한다. 데이터/동의/version/ledger를 과거로 되돌리지 않는다.

남은 위험과 미확인:

1. 운영 PostgreSQL ARM/소형 리소스에서 SQL 집계 CPU·메모리, 실제 PostgREST, hosted Edge, 카카오 로그인 브라우저 latency/503 해소는 **배포 후 총괄 측정**이다. 로컬 SQL 시간 증가는 명확하며, 운영 성능 검증 전 완료된 SLA로 간주할 수 없다.
2. 정확한 대표 선출·분위수 계산의 DB 작업량은 여전히 입력에 비례한다. SQL 내부 배열/해시 메모리와 정렬 spill, 동시 요청 부하는 별도 운영 확인이 필요하다. 함수 한정 planner 설정은 다른 분포에서 재검증해야 한다.
3. 작은 전송량은 fact 수보다 **주소·기관·담당자·법규 등 distinct 그룹 수**에 좌우된다. 서로 다른 주소/담당자가 fact와 같은 속도로 증가하는 자료에서는 출력도 증가한다. 1,000개 초과 주소의 정확성은 검사했으나 6만 distinct 주소 성능은 측정하지 않았다. 전송량이 항상 상수라는 주장은 하지 않는다.
4. 기존 100,000 후보 이력 row budget을 유지한다. 초과는 RESULT_TOO_LARGE/503이며 무제한 확장 구현이 아니다. 새로운 source 캐시나 서버 취소 전파는 없어 범위 전환 시 SQL 중첩 자체는 남는다.
5. SQL/JS 집계 의미가 두 구현에 존재하므로 이후 계약 변경은 parity suite와 함께 갱신해야 한다. 초기 개발의 O(N²) 상관 조회/전역 sort 병목은 제거했으며 관련 증거는 분리 보존했다.
6. 기존 단위 검사 실패 1개와 독립 Muse/운영 검수 미실행을 남긴다. 현재 결과는 **검토 가능한 구현 후보**다.

[재현 지침](REPRODUCE.md)에 로컬 스택 보존·측정·검사·브라우저 실행을 기록했다. 검수용 Vite는 해당 세션 Ctrl-C로 종료(exit 130), Chrome은 스크립트 finally에서 종료했다. 커밋하지 않았다.
