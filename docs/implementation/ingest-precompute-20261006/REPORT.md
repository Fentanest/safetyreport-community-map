# 업로드 시점 사전 계산 · 로컬 후보 검증

기준 main `c53d44e`, 브랜치 `perf/ingest-precompute`, request_mode=구현. 지정 worktree만 수정했다. **커밋·push·운영 Supabase/Edge/Pages/스토어 접근 또는 배포는 하지 않았다.**

## 2026-10-12 브랜치 통합

사용자 지시로 후보 코드·재현 도구·기존 측정 기록을 main에 통합했다. 아래 수치는 2026-10-06 당시 기록이다. 현재 기본 요청은 `screen-aggregate-v2`이며 사전 계산 경로 활성화·운영 SQL 적용·Edge/Pages 배포는 하지 않았다. 아래 성능 미달·쓰기 timeout은 해결된 것으로 간주하지 않는다.

## 판정

이 후보는 쓰기 시 정규화·대표 선출과 트랜잭션 단위 월 패널 집계를 구현했지만, 요청이 소량 rollup만 읽도록 하는 목표는 완료하지 못했다. 범위 내 저장 관측을 읽는 경로와 정확한 분위수 배열 병합이 남는다. 제한 컨테이너 전체 DB 회귀에서는 동일 identity에 관측 100,001개가 몰린 쓰기의 timeout이 재발했다. 기본 Edge 선택은 `screen-aggregate-v1` 그대로다. opt-in SQL/decoder와 재현 가능한 검증 후보를 남기며, 이 구현을 성능 개선 완료나 운영 채택 가능으로 보고하지 않는다.

## 계약 결정

| 선택지 | 결정과 근거 |
|---|---|
| fact generated stored columns | 기존 fact rewrite/잠금을 피하기 위해 private sidecar를 선택했다. 공개 자격·계보·대표는 cross-row mutable 상태라 generated column만으로 유지할 수 없다. ingest 본문·handler는 변경하지 않는다. |
| identity 갱신 단위 | 영향받은 source_report_key의 전체 적격 이력만 다시 선출한다. 번호 없는 과거 관측의 R2 fallback, 같은 payload의 max(answer_accepted_at)이 함께 변할 수 있으므로 이미 계산된 identity 문자열만 좁히지 않는다. |
| 선출 규칙 | answer_time DESC → completed_date DESC NULLS LAST → first_accepted_at → contributor_id → dataset_key ASC. 대표 여부·identity 날짜·contribution_count를 저장한다. 초기 윈도 구현은 한 identity의 10만 이력에서 timeout이 나서, 동일 규칙의 GROUP BY + DISTINCT ON + join으로 교체했다. |
| rollup 구조 | 날짜축×월×카테고리 아래 summary/기관/기관+담당자/법규/지역/장소/heat를 분리한다. 완전한 월은 저장 집계, 기간 경계일과 복합 필터는 저장 관측을 사용한다. 전 차원의 조합 cube는 만들지 않았다. 이 선택 때문에 모든 필터의 비선형 읽기 목표는 미달이다. |
| 정확한 통계 | 월 평균/중앙값/TOP5를 평균·합산하지 않는다. count/sum/min/max와 private 기간·금액 배열로 정확한 중앙값/p90을 구한다. 차량·고유 참여자·좌표 anchor도 기존 전체 후보 규칙을 유지한다. 배열과 distinct 경로는 남은 비용이다. |
| 쓰기 유지 | 관측은 statement trigger, dirty 월은 DEFERRABLE constraint trigger로 COMMIT 전에 갱신한다. 이벤트별 20회 재계산을 트랜잭션당 한 번으로 모았다. 월 내부를 O(1) delta로 가감하는 구현은 아니다. |
| 쓰기 중 읽기 | dirty 월이 있는 자기 쓰기 트랜잭션은 v2로 읽는다. 외부 transaction에는 fact·저장 관측·rollup이 같은 COMMIT으로 보인다. STABLE snapshot RPC는 유지한다. |
| 잠금·격리 | 기존 analytics_state → control 순서로 잠근다. control epoch write는 오래된 REPEATABLE READ/SERIALIZABLE snapshot의 조용한 덮어쓰기를 막는다. 모든 다중 계정 트랜잭션의 deadlock/throughput 보장은 하지 않는다. |
| 개인정보 | 모든 저장물은 private/RLS, PUBLIC/anon/authenticated/service_role 직접 접근 회수. 차량 canonical은 private에서 구분하고 저장된 masked label만 내부 screen source에 넣는다. 공개 UUID 예외 범위/담당자 전체 성명/원 좌표/n=1을 바꾸지 않는다. |
| 바인딩 계약 | `/tmp/.../binding-contract.md`의 1:1 연결과 source key/번호 소유 제한을 바꾸지 않는다. `2026100611xx` 작업과 겹치는 ingest 본문은 그대로이며 새 버전은 `202610061200`이다. 바인딩 브랜치 실제 통합 검증은 별도다. |
| Auth cascade 보완 | 기존 manifest DELETE statement trigger가 이미 삭제된 auth.users를 참조해 FK 오류를 냈다. 삭제된 계정의 manifest를 새로 만들지 않도록 조건을 추가했다. 살아 있는 계정의 generation 규칙은 유지한다. |
| 배포 선택 | 성능 검증 전 기본 경로를 바꾸지 않는다. 신규 encoding은 private opt-in이다. SQL → backfill → 채택된 Edge 선택 → 필요시 Pages 순서. |

## 공개 자격 변경 경로

| 이벤트 | 유지 경로 / 검증 |
|---|---|
| 신규 fact, 내용·날짜·번호·dataset/owner 변경 | old/new source key 합집합 재선출, 이전/새 identity 날짜의 월 표시 |
| no_change/replay bookkeeping | 동일 key를 다시 계산한다. bookkeeping-only UPDATE 최적화는 아직 없다 |
| fact DELETE, 대표 관측 삭제 | 남은 적격 관측 재선출, 이전 월 집계 제거/재계산 |
| 사용자 철회 | grant UPDATE → 해당 user와 lineage의 source key 재선출 |
| 새 lineage 재동의 | 옛 grant의 fact가 자동으로 부활하지 않음. explicit reshare UPDATE가 있어야 다시 포함 |
| 같은 lineage 정책 승계 | revoke + 새 grant INSERT가 같은 트랜잭션에서 반영. 현재 lineage의 disclosure 적용 |
| profile 정지/재활성화/삭제 | old/new user의 원본+저장 key 모두 재선출 |
| disclosure 추가/수정/삭제 | old/new 정책 version → 관련 lineage/user → key 재선출. 금액/법규/별점 동시에 반영 |
| contributions-delete | 기존 같은 트랜잭션의 fence/tombstone/연결 폐기 + fact DELETE를 따른다. fence 자체에 새 공개 판정 의미를 추가하지 않음 |
| Auth 사용자 cascade 삭제 | fact/profile/grant trigger 및 manifest FK 보완으로 잔여 공개 관측 제거 |
| 원본/파생 TRUNCATE | 명시 오류로 거절. trigger disable/정규화 함수·지역 registry 변경은 운영자 전체 재계산 절차 필요 |

## 측정

| fact | 범위 | 첫 요청 전→후 (초) | warm 중앙값 전→후 (초) | SQL 결과 전→후 (MB) | 크기 감소 |
|---:|---|---:|---:|---:|---:|
| 35,000 | 1년 | 2.734 → 1.684 | 2.732 → 1.674 | 4.505 → 1.461 | 67.6% |
| 35,000 | 전체 | 3.538 → 2.201 | 3.360 → 2.015 | 5.049 → 1.864 | 63.1% |
| 100,000 | 1년 | 8.832 → 7.830 | 7.358 → 5.728 | 5.346 → 2.044 | 61.8% |
| 100,000 | 전체 | 11.400 → 8.722 | 11.160 → 6.781 | 5.585 → 2.418 | 56.7% |

**1초 안팎 목표 FAIL.** 10만 건의 저장 관측 조회/분위수 병합 비용이 남으며 기본 경로 전환을 권하지 않는다.

| fact | ingest 1건 전→후 (ms) | ingest 20건 전→후 (ms) | backfill (초) | 최장 배치 (ms) |
|---:|---:|---:|---:|---:|
| 35,000 | 12.4 → 430.6 | 40.4 → 418.4 | 29.23 | 485.7 |
| 100,000 | 14.8 → 1212.0 | 38.1 → 1093.8 | 90.96 | 1141.9 |

| fact | 저장된 적격 관측 | 패널 월 rollup 행 | 관측+인덱스 (MB) | rollup+인덱스 (MB) |
|---:|---:|---:|---:|---:|
| 35,000 | 32,332 | 161,979 | 50.32 | 157.73 |
| 100,000 | 92,373 | 385,809 | 143.85 | 373.87 |

MB는 10⁶ bytes다. 월 집계의 차원별 중복과 private 배열로 저장량도 크게 늘었다. 원 측정은 [3.5만](evidence/benchmark-35000.json), [10만](evidence/benchmark-100000.json), [실제 자원 설정](evidence/runtime-environment.json)이다. 두 측정의 migration SHA가 최종 SQL과 동일함을 확인했다.

숫자는 제한된 **로컬 x86_64**의 합성 데이터다. 운영 ARM 결과로 환산하지 않는다. PostgreSQL 17.6, Docker 1 CPU/1GiB, shared_buffers 224MB, work_mem 2MB, max_parallel_workers_per_gather=1, max_connections=60, jit=off를 실제 inspect/SHOW로 확인했다. 새 읽기 함수에 work_mem 증액은 없다.

PostgREST 형태의 `json_agg(t.s)->0`와 text 직렬화까지 SQL 타이머에 포함했다. bytes는 압축 전 UTF-8이다. warm은 3회 중앙값, 첫 요청은 자체 컨테이너 재시작 직후이며 **호스트 OS page cache는 통제하지 않았다**. 1건/20건은 실제 SQL ingest RPC이고 durable ACK 플래그/fact 증가를 확인했다. deferred flush를 타이머 안에서 실행하므로 커밋 전 rollup 계산을 포함한다. 측정마다 ROLLBACK하므로 **최종 COMMIT/WAL flush 지연은 제외**한다. 실제 COMMIT의 원자성은 별도 동시성 검사로 확인한다. Edge HTTP·브라우저 end-to-end 시간은 이 표에 없다.

장소 4,507·기관 127·기관+담당자 1,016·법규 31·차량 8,000 후보를 사용했다. 증가하는 fact에 distinct 차원도 무한히 늘리는 최악 분포는 미검증이다. 대표 선출·철회·미완료·날짜 결측·여러 계정/같은 key를 포함하며 eligible 수는 원 fact 수와 구분한다.

크기 감소는 DB→Edge의 내부 source에 대한 것이다. 공개 `screen-v1` DTO는 deep-equal 계약대로 유지하므로 브라우저로 나가는 공개 JSON bytes는 동일하다. 패리티 파일에 부가 기록된 Node parse/handler 시간은 제한되지 않은 검증 호스트의 진단값이며 성능 채택 근거로 쓰지 않는다.

초기 일회용 DB에 지역 사전 4개 테이블의 data를 빠뜨렸다. 이때 SQL v1도 JavaScript legacy와 지역 값이 달라 대량 패리티 4건이 실패했다. 해당 시간·원인·실패는 `evidence/development/missing-region-registry/`에 보존하고 **최종 수치에서 제외**했다. 최종 bootstrap은 저장소의 20260701 지역 사전/geometry를 넣고 `서울 중구 → 11140`을 먼저 확인한다. 공유 DB lock 점유 시 이미 flock 아래 확보한 schema-only dump를 재사용한다. 정책 식별자는 synthetic이며 공개 플래그는 체크인된 정책 migration과 같다.

## 검증

| 검사 명령/범위 | 결과 | 증거 |
|---|---|---|
| `npm test -- --configLoader runner --no-cache` | **660 PASS / 165 SKIP**, 55 files PASS | `evidence/unit-final.txt` |
| `flock -w 30 /tmp/ci0926-db.lock env COMMUNITY_STACK=1 … vitest run` 네 DB suite (명령 전체는 REPRODUCE) | **39 PASS / 7 SKIP**, 4 files PASS, BEGIN/ROLLBACK | `evidence/integration-ci-final.txt` |
| `python3 scripts/benchmark/verify_ingest_precompute_isolated.py` (1 CPU/1GiB/2MB) | **38 PASS / 1 FAIL / 7 SKIP** — 동일 identity 100,001개 관측 갱신 timeout | `evidence/integration-complete.txt` |
| `PRECOMPUTE_FULL_MEASURE=1 … vitest run tests/integration/ingest-precompute.test.ts …` | **5 PASS / 15 SKIP** — 3.5만/10만 × 1년/전체 4패킷 + 동시 쓰기 후 1패킷 | `evidence/parity-final.txt`, `evidence/parity-*.json` |
| `python3 scripts/benchmark/verify_ingest_precompute_concurrency.py` | **2 PASS** — 동시 writer + 자동 COMMIT flush, STABLE 한 문장 스냅샷 | `evidence/concurrency.json` |
| `E2E_PORT=5198 node scripts/browser/verify_ingest_precompute.mjs` | 8 viewport/theme + 2 행동 묶음 PASS, screen **13/13 HTTP 200**, console/pageerror **0**. 표 가독성 P2는 별도 FAIL | [브라우저 검수](BROWSER.md), `evidence/browser/results.json` |
| `npm run build -- --configLoader runner` | PASS, 기존 chunk 크기/혼합 import 경고 있음 | `evidence/build.txt` |
| `npm run scan` | PASS, issues **0** | `evidence/scan-final.txt` |
| `python3 -m unittest discover -s tests/blueprint` / `tests/product` | **27 PASS / 12 PASS**. public snapshot 생성은 not-ready로 skip, 이를 통과로 세지 않음 | `evidence/blueprint.txt`, `evidence/python-product.txt` |
| `node scripts/integration/compose_supabase.mjs check --auth /home/better0101/projects/worktree/auth-perf` | PASS, **53 migrations / 7 functions** | `evidence/manifest-final.txt` |

DB suite는 날짜축 2종/카테고리/지역/기관/담당자/bbox/법규/빈 범위/전체 기간/모든 화면 패널/개인 비교, Unicode 주소/마스킹 충돌, 철회·재동의 계보·정지·삭제·disclosure, RLS/ACL, backfill 중단·재개·활성화, rollback을 검사한다. 앱 회귀는 현재 my-reports search, rankings 10행, public rollup 4종(agency/manager/laws/series)의 **전체 값**을 전후 비교한다.

제한 컨테이너의 실패를 공유 CI 통과로 상쇄하지 않는다. 조회 성능 목표와 쓰기 경계의 제한 환경 검증은 FAIL이다. 운영 ARM/실제 OS cold cache/운영 Edge·Kakao/독립 Muse는 NOT_RUN이다.

0건 실행/skip을 통과로 세지 않았다. 기존 기대값·검사·10만 history budget을 낮추거나 삭제하지 않았다. 기존 DB suite의 변경은 고정 일회용 로컬 컨테이너를 선택할 수 있는 test-only 환경 분기다. 운영 URL/DSN을 받을 수 없다. 공유 ci0926 잠금이 점유된 동안 대기 작업을 중단했으며 잠금을 삭제하지 않았다. 이후 잠금이 풀리고 기준 스키마임을 확인한 뒤, flock 아래 최종 네 suite를 실행했다. 종료 후 파생 테이블/함수가 없고 합성 사용자 0명임을 다시 확인했다 (`evidence/ci-rollback.json`).

첫 isolated 회귀는 37 PASS / 2 FAIL / 7 SKIP이었다. 새 테스트의 폐기된 my-reports RPC 호출을 현재 `internal_my_reports_search` 계약으로 고쳤다. 다음 실행에서는 두 문장의 `generated_at` 차이도 발견하여 같은 외부 DO 문장 안에서 전후 RPC를 비교하도록 했다. timestamp를 포함한 모든 필드를 그대로 비교한다. 기존 cohort 경계 테스트의 동일 identity 100,001개 관측 갱신 timeout은 SQL 선출 구현과 함수 내부 `enable_nestloop=off`로 대응했다. 호출자의 설정은 함수 종료 후 복원되며 work_mem/timeout을 올리지 않는다. 실패 원문은 `evidence/integration-isolated{,-final}.txt`에 보존하며 timeout/100,000 budget/기존 assertions는 완화하지 않았다. 두 실패 케이스의 재검증은 `evidence/regression-fixes.txt`의 2 PASS다. 선출 변경 전의 유효한 측정은 `evidence/development/before-large-identity-election-fix/`에 보존한다.

## 남은 문제와 채택 조건

1. 모든 scope를 소량 rollup으로 해결하지 못했다. candidate budget, 날짜 경계, 복합 region/agency/manager/bbox/law, 개인/참여자/차량 distinct/anchor 경로가 저장 관측 수에 의존한다. 기관/법규 전체 후보를 Edge로 보내 정렬/페이지하는 경로도 남는다.
2. 월 파티션 재계산은 20건 batching으로 줄였어도 fact·월 밀도가 늘면 쓰기 비용이 증가한다. 저장 rollup 행 수와 private 배열도 커진다. 단순 평균/상위5 병합으로 이를 숨기지 않았다.
   단일 identity에 100,001개 이력이 몰린 경계 테스트는 개별 재실행에서 통과했으나 전체 suite 뒤에는 timeout이 재발했다 (`integration-complete.txt`: 38 PASS / 1 FAIL / 7 SKIP). 기존 cohort 함수가 `set_config('statement_timeout','8000',true)`를 사용하므로 다음 쓰기도 그 제한을 받는 경로다. 이 제한을 올리거나 fixture trigger/기대값을 바꿔 통과시키지 않았다. 누적 fixture 실행 후 캐시·물리적 bloat 영향은 가능성이고, 독립 원인 분리는 미완료다.
3. 다음 구조에서는 각 패널의 가산 counter, weighted histogram, distinct refcount와 조회할 상위 집합/페이지를 저장·선택하는 방법을 다시 설계해야 한다. 이번 후보에 그 구조가 구현됐다고 주장하지 않는다.
4. 운영 aarch64, 진짜 OS cold cache, 지속 동시 ingest/철회·정책 변경의 최대 지연, 운영 lock/backfill 시간, 실제 Edge·Kakao·독립 Muse 검수는 미확인이다. 로컬 fixture와 구분한다.
5. 바인딩 `2026100611xx`의 실제 최신 결과와 병합한 뒤 deletion/ingest 회귀를 다시 확인해야 한다. 이 worktree에서 그 브랜치/다른 프로젝트를 수정하지 않았다.

## 변경 파일과 재현

- `supabase/migrations/202610061200_ingest_precompute.sql`: private 저장/트리거/backfill/opt-in read/manifest cascade 보완.
- `server/screenAggregate.ts`: 새 23열 내부 source decoder, 잘못된 행 fail closed. `screenHandler.ts` 기본 v1 선택 유지.
- `tests/integration/ingest-precompute.test.ts`, `tests/product/screenSnapshot.test.ts`: 패리티/공개 경계/자격/백필/롤백/동시성 export/잘못된 compact payload.
- `tests/integration/{cohort-timeout,screen-transport,screen-server-aggregate}.test.ts`: 고정 일회용 DB 선택만 추가, 기존 assertions 유지.
- `scripts/benchmark/{ingest_precompute,verify_ingest_precompute_concurrency,verify_ingest_precompute_isolated}.py`, `scripts/browser/{vite.ingest-precompute.config.ts,verify_ingest_precompute.mjs}`: 제한 DB·실제 SQL write/read·Chrome 재현.
- `docs/data-contract.md`, migration manifest, 이 폴더 REPORT/MIGRATION/REPRODUCE/rollback/evidence.

[적용·backfill·롤백](MIGRATION.md), [재현 명령](REPRODUCE.md), [브라우저 증거](BROWSER.md). 커밋하지 않았으며 총괄 검토용 변경을 지정 worktree에 남겼다.
