# 화면 스냅샷 지연 r3 — 운영 jsonb 생성 병목 수정

2026-10-06 / HEAD `3731126` / `fix/screen-snapshot-timeout` / 지정 worktree의 미커밋 후보.
운영 원인은 총괄이 제공한 실측으로 확정됐고, 큰 결과의 생성·포장을 `json`으로 바꿨다.
단일 STABLE 스냅샷·대표 선출·공개 DTO·동의·열람 gate를 유지한다.
**운영 재측정은 배포 후 총괄이 수행**한다. 운영 접근·배포·push는 하지 않았고 **커밋하지 않았다**.
r2의 과거 판단은 [HISTORY-r2](HISTORY-r2.md), 기존 증거는 `evidence/r2/`에 보존한다.

## 원인: 운영 aarch64에서 jsonb 결과 생성과 재포장이 비쌈

아래는 **사용자 r3 지시서에 제공된 총괄의 2026-10-06 읽기 전용 운영 측정**이다.
이 세션에서 운영에 접속하거나 원본 운영 EXPLAIN을 다시 수집하지 않았다.
운영 PostgreSQL 17.6 aarch64, work_mem 2184kB, shared_buffers 224MB, max_connections 60.
설치 함수 구조는 HEAD setwise 버전과 같고 enable_nestloop=off / 함수 내부 statement_timeout=8000이다.

| 운영 측정 | 결과 |
|---|---|
| 15,973행 내부 EXPLAIN ANALYZE BUFFERS | 총 16.4초. ranked까지 ≈1.9초, 최상위 jsonb Aggregate ≈14.2초 |
| 같은 내부 쿼리 jsonb_agg(jsonb_build_object), 2회 | 19.7 / 22.3초, ≈22.2M chars |
| 최종 집계만 json_agg(json_build_object)로 교체, 2회 | 2.2 / 2.6초, ≈22.8M chars |
| 합성 16,000행×36키, 운영 jsonb / json | 2.8–4.2초 / 0.5초 |
| 같은 PostgreSQL 17.6 로컬 x86_64 jsonb | 0.78초 |
| 단순 CPU 루프 운영 / 로컬 | 0.64 / 0.61초 |
| 이전 직접 cohort / snapshot wrapper | 26.8 / 73.4초 (범위/표본은 위 15,973행 실험과 같다고 가정하지 않음) |

heap 15MB, toast 8kB, 통계 최신·bloat 없음. 일반 CPU 전체가 같은 배율로 느린 것보다
jsonb의 구성·정규화·메모리 작업이 운영에서 특히 비싼 것이 주 병목이다.
래퍼도 17MB facts를 jsonb_build_object로 다시 포장해 큰 구조를 재순회한다.
기존 로컬 x86_64에서 27초/73초가 재현되지 않았던 이유를 설명하며, generic-plan 회귀를 주 원인으로 보던 가설은 대체한다.
특정 allocator/명령어 수준의 aarch64 내부 원인까지 규명한 것은 아니다.

## 구현과 단순화 판단

- `supabase/migrations/202610060700_screen_fact_transport.sql`: 미배포 r2 후보를 정리했다.
  helper 최종 집계는 json_agg + json_build_array/object, 큰 v_rows/data와 반환형은 json이다.
  cohort_facts/read_snapshot/**개인 cohort source**의 세 public RPC를 json으로 전환한다.
  개인 source도 CASE의 jsonb 빈 배열 및 재포장을 제거해야 타입 충돌·재정규화를 막을 수 있다.
  같은 transaction의 DROP/CREATE, postgres 소유자·service_role 전용 ACL 복원, schema reload를 포함한다.
- r2 columns-v1은 유지한다. json 객체 배열만으로 CPU 병목을 줄일 수 있어도 34개 반복 키와 약34MB source가 남는다.
  기존 고정 열 decoder 하나로 약18.8MB까지 줄이므로 이 전송 개선은 여전히 필요하다.
  구현/선출 쿼리를 이중 유지하지 않고 helper의 최종 표현만 분기한다. 브라우저 DTO에는 노출하지 않는다.
- 작은 state/viewer/options/rollup 결과는 jsonb 그대로다. hot facts를 jsonb로 다시 감싸는 호환 wrapper는 두지 않는다.
- 인자·이름·기본값, representative 순서, D13/R2, 이전 기간, 100,000행 예산, 공개 항목/null,
  COHORT_POLICY_VERSION, rate limit, JWT/카카오/10건 gate와 한 화면=한 statement snapshot은 유지한다.

전체 변경 파일:

- SQL/서버: `060700_screen_fact_transport.sql`, `server/screenFacts.ts`, `server/screenHandler.ts`.
- 클라이언트(r2 유지): `src/data/{requestDeadline,client,refreshController}.ts`.
- 검사: `tests/integration/{screen-transport,screen-handler-measure,date-basis-sql,snapshot-contract}.test.ts`,
  `tests/product/{analyticsDeadline,accessClient,refreshController,screenSnapshot,screenTimeoutMeasure}.test.ts`.
- 도구: `scripts/benchmark/screen_snapshot_timeout.py`, `scripts/browser/{verify_screen_timeout.mjs,vite.e2e.config.ts}`.
- 계약/운영: `docs/data-contract.md`, migration manifest, 이 폴더 REPORT/MIGRATION/REPRODUCE/CALLERS/rollback.sql 및 evidence.

## 호출자 전수 확인·JSON 의미

[CALLERS.md](CALLERS.md)에 SQL/Edge/앱 API/테스트/도구/과거 migration/manifest와 다른 jsonb 생성 경로를 전수 기록했다.
현재 SQL caller catalog도 검사했다. public-analytics는 snapshot/cohort의 객체 배열을 그대로 파싱하고,
my-analytics는 screen compact와 개인 객체를 각각 처리한다. rankings/rollup은 자체 relational 원천을 사용해 cohort 반환형과 무관하다.
rollup4종 snapshot 분기와 랭킹 페이지+내 순위를 실제 SQL로 실행했다. 앱 ingest/account/relay/my-reports 계약은 변경 없다.

[PostgreSQL JSON 문서](https://www.postgresql.org/docs/17/datatype-json.html)처럼 json/jsonb는 객체 키 순서·중복 키 보존·숫자 표기가 다를 수 있다.
본 payload는 고정 34키가 유일함을 json_each로 검사했고, native json을 **jsonb로 재포장하지 않고** Node에서 파싱해 기준값과 비교했다.
키 순서가 실제 달라도 값은 같으며 한글/인용부호/역슬래시/emoji, 정밀 좌표, 0/null/bool, 지수 표기,
정수 2^53−1 및 decimal trailing zeros를 확인했다. 사용자 제공 임의 중복 키 JSON을 출력에 병합하는 경로는 없다.
48개 범위·필터·previous·동률 조합과 generic/custom plan에서 ordered array 동등성, 전체 공개 screen packet deep equality도 통과했다.
배열을 정렬하거나 기대값을 약화해 동등성을 맞추지 않았다. 공개 원번호·UUID 비노출/strict DTO 검사는 유지한다.

## 로컬 3만 건 전/후

PostgreSQL 17.6 x86_64, 합성 fact 30,000행 → 27,332행 반환.
completed_date, 2025-10-07..2026-10-06 + 이전 동기간. SQL 각 경로 6회 중앙값, Node handler 각3회 중앙값.
다른 빌드/테스트/브라우저와 겹치지 않은 최종 SQL 재측정이다. 최초 겹친 after 실행은 `initial-overlapped/`에 보존하고 표에서 제외했다.
타이머 내 result 변수는 json: 후보를 jsonb로 변환해 제거한 비용을 다시 넣지 않는다. 기준 jsonb→text 직렬화는 포함하므로 r2 표와 시간 정의가 다르다.
패리티 검사/길이 계산/EXPLAIN 계측은 타이머 밖이다. bytes는 UTF-8·압축 전이며 chars와 다르다.

| 항목 | 전 | 후 |
|---|---:|---:|
| direct cohort SQL | 2,016.20ms | 1,300.80ms |
| wrapper, viewer 없음 | 2,258.42ms | 917.19ms |
| wrapper, viewer 포함 | 2,263.90ms | 937.64ms |
| viewer wrapper min–max | 2,213.23–2,345.49ms | 909.07–969.92ms |
| 내부 source bytes | 34,280,694 | 18,811,403 |
| JSON.parse 1회 | 186.78ms | 73.92ms |
| compact 복원 1회 | 해당 없음 | 9.17ms |
| Node handler (복원 포함, DB 제외) | 1,075.50ms | 1,089.56ms |
| 공개 screen packet bytes | 99,494 | 99,494 |
| 전체 screen packet deep equality | 기준 | PASS |

내부 source는 **45.1% 감소**, viewer 래퍼 중앙값은 **58.6% 감소**했다.
직접 객체 배열 bytes는 34,279,872→35,209,160으로 조금 늘었다(json 공백/키 표기 차이).
화면은 compact로 줄인 값을 사용한다. 정규화 제거는 CPU 개선, compact는 전송량 개선으로 각각 효과를 구분한다.

계측 별도 실행에서 직접 경로 ranked까지 574.325→561.821ms, Aggregate 1,676.160→1,154.760ms였다.
compact 래퍼 안에서는 ranked까지 566.271ms, Aggregate 841.654ms이고 전체 래퍼 계획은 982.889ms였다.
선출 이전 비용은 비슷하고 최종 결과 생성 비용이 감소했다.


증거: [전](evidence/r3/before-30000-auto.json), [후](evidence/r3/after-30000-auto.json),
[Node 재생](evidence/r3/sql-source-handler.json), nested plans는 각각 `-plans.txt`.
각 phase 18개 성공 표본 모두 SQLSTATE 00000 / parity=true다. Node는 실제 SQL 합성 source를 사용하지만
인증/RPC는 stub이고 hosted Deno Edge/HTTP 왕복 시간은 포함하지 않는다.

## 8초 SQL 설정과 20초 클라이언트 deadline

총괄의 운영 json 실험 2.2–2.6초 + state/viewer/포장과 로컬 측정에 비추어 **8초 예산을 늘릴 이유가 없다**.
기존 `perform set_config('statement_timeout','8000',true)`는 그대로 둔다.
단, 이것은 현재 최상위 statement가 확실히 8초에 취소된다는 보장이 아니다.
로컬 probe에서 statement 시작 전 2초 제한 아래 함수 내부를 30ms로 바꿔도 100ms sleep이 완료됐다.
[PostgreSQL timeout 설명](https://www.postgresql.org/docs/17/runtime-config-client.html#GUC-STATEMENT-TIMEOUT)과 같이 외부 statement의 시작 경계가 중요하다.
실제 PostgREST/session/role의 외부 deadline은 총괄이 배포 후 확인해야 한다. 이번 변경은 timeout을 높이지 않는다.

20초 클라이언트 deadline도 유지한다. 예상 SQL 2–3초 + 포장/전송/Edge 집계/auth/모바일망에 여유를 주면서
무한 대기를 끝내는 상한이다. 정상 응답 SLA나 DB 취소 보장은 아니다.
auth 준비·refresh·body를 포함하며 REQUEST_TIMEOUT은 자동 재시도하지 않고 이전 정상 화면/수동 retry를 유지한다.
브라우저 실제 지연 시험은 20.357초에 오류가 표시됐고 자동 retry 없이 수동 복구가 성공했다.

## 검사 결과·실패의 범위

- 최종 screen-transport: **9/9 통과**. 권한/반환형/48조합/native JSON/개인/rollup/ranking/rollback/SQL callers/timeout probe 포함.
- SQL-source Node replay + screenSnapshot: **11/11 통과**, 모든 공개 필드 동등, 99,494 bytes.
- 전체 npm test: **654 통과, 132 skip**(80파일). skip은 미설정 통합·벤치마크이며 통과로 세지 않음.
- build 통과, 기존 큰 chunk·혼합 정적/동적 import 경고 남음. dist scan 통과.
- Python blueprint **27**, product **12** 통과. manifest **49 migrations / 7 functions** 검증 통과.
- 기존 `cohort-timeout.test.ts`: **4 통과 / 1 실패**. 과거 010100→060100에서 완전 동률 두 기기 행의 배열 순서 비교가 실패했다.
  해당 suite는 060700을 적용하지 않는다. r2에서도 동일 증상을 기록했다([기존 진단](evidence/r2/tie-diagnosis.json)).
  이 작업은 대표 선출 tie-breaker를 바꾸지 않았고 테스트를 수정/삭제/느슨하게 만들지 않았다.
  현 HEAD 060100→후보의 48개 조합 패리티 통과와 구분한다. 모든 검사가 통과했다고 보고하지 않는다.
- 브라우저 Chrome/Playwright: dark 390×844 및1440/1920/2560×1080, 가로 overflow 없음,
  26초 지연 주입→20초 오류/이전 조건 안내→수동 복구. 수집 console error 0, 복구 screen HTTP200.
  [브라우저 증거](evidence/r3/browser/results.json), screenshot을 직접 열어 확인했다.
  합성 HTTP/auth·MOCK Kakao SDK이며 실제 운영/실제 Kakao/Muse 승인은 아니다.

## 복구·운영 반영·미확인

비공개 before/after pg_dump 비교로 원래 로컬 schema/data/sequence/ACL/ledger가 유지됨을 확인한다.
결과: [원복 증거](evidence/r3/local-restoration.json). 모든 DB 작업은 BEGIN/ROLLBACK이었다.
이번에 시작한 Vite/Chrome만 종료하고 기존 Supabase 스택은 유지했다.

운영 순서는 **SQL 060700 → my-analytics Edge → Pages**. public-analytics/user-rankings/앱은 재배포 불필요.
구 Edge는 객체 배열을 받고 새 Edge도 구 SQL을 수용한다. [MIGRATION](MIGRATION.md)의 schema reload/권한/운영 smoke를 따른다.
롤백은 Pages→Edge→[새 forward SQL](rollback.sql); 세 반환형을 DROP/CREATE로 jsonb로 복원한다.
데이터·동의·dataset_version을 되돌리지 않는다. 롤백하면 jsonb 병목이 되돌아온다.

미확인/제한:

1. 수정 후 운영 SQL·PostgREST schema reload/전송·hosted Edge CPU/메모리/wall-clock·모바일 전체 지연은 **NOT_RUN**.
   실제 응답이 수 초로 줄었는지는 총괄의 배포 후 측정으로 판정한다. 운영 원인 자체는 더 이상 BLOCKED가 아니다.
2. 원시 facts 전송은 18.8MB 남는다. 대규모/동시 부하/전체 기간에서 20초 이내라는 보장은 없다.
3. 실제 concurrent ingest snapshot probe, 실제 Kakao SDK, 독립 Muse 고정 commit 검수는 r3 **NOT_RUN**.
   STABLE 계약과 함수의 읽기 구조는 유지하고 로컬 검증을 운영 승인으로 대신하지 않는다.
4. 기존 완전 동률 배열 테스트 실패는 남아 있다. 이번 병목 수정 범위에서 선출 규칙을 바꾸지 않았다.

사용자 지시대로 git add/commit을 시도하지 않았다. 기준 HEAD는 3731126이고 신규 commit SHA는 없다.
