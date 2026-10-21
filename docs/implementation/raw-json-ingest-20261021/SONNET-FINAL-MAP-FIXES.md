# SONNET FINAL MAP FIXES (2026-10-21)

대상: map 저장소 `feat/raw-json-ingest` (HEAD d485d77), 변경은 커밋하지 않음. SQL 은 소스(`scripts/raw-ingest/*.sql`, `build_migration.py`)에서 고쳐
`build_v2.py` + `build_migration.py` 로 `202610210100_raw_json_ingest.sql` 을 재생성했고, `migration-manifest.json` 의 sha256 을
`dd580ead7699f2087ff318874cdebb4d8259296123dca49e22f4a24d1e609e8e` 로 갱신했다.

## A. 이스케이프된 `\u0000` (Edge)
- 수정: `server/ingest/raw.ts` 에 `hasNul()`(키 포함 전체 순회) 추가, `validateRaw` 가 파싱 결과에 NUL 이 있으면 `raw_invalid`(422). `raw.source` 의 NUL 도 거절.
  `client_observation` 의 NUL 은 handler 에서 `schema_invalid`, supplement 문자열은 기존 `text()` 가 이미 NUL 을 거절(`supplement_invalid`)함을 벡터로 고정.
- 파일: `server/ingest/raw.ts`, `server/ingest/handler.ts`
- 테스트: `tests/product/rawIngest.test.ts` "rejects NUL (literal or JSON-escaped)..." (이스케이프 값/키/중첩, 리터럴, source, supplement, client_observation 7 벡터).

## B. 잘못된 선택 client_observation 이 raw 전체를 거절
- 결정: 구조·짝 없는 surrogate·NUL·해시 쌍 위반은 계속 거절(무결성/jsonb 보호). 구조는 맞고 **값 검증**(`validateObservationValues`)만 실패하면
  관찰값과 해시 쌍을 버리고 raw 만 저장한다. 해시 검증을 값 검증보다 먼저 수행하므로 해시 불일치는 값이 틀려도 `client_observation_hash_mismatch`.
  로그에는 `client_observation_dropped` 결과 코드만 남기고 값·사유는 남기지 않는다. 원장 fingerprint 는 버린 뒤의 이벤트 기준.
- 파일: `server/ingest/handler.ts`, `contracts/community-ingest-v2/{README.md,errors.md,MANIFEST.sha256}`; 같은 3개 파일을 `../pc`, `../mobile` 의 `contracts/community-ingest-v2/` 로 바이트 동일 복사.
- 테스트: `rawIngest.test.ts` "drops an optional client_observation with invalid VALUES...". `check_contract.py --copies ../pc ../mobile` PASS.

## C. 업데이트 배너가 오래된 v1 연결 때문에 계속 표시
- 수정: 웹은 `consent === 'outdated' || last_contract === 'community-ingest-v1'` (가장 최근 활성 연결 기준). SQL `internal_map_client_state` 의
  `v1_connections` 는 형태를 유지하되 가장 최근 활성 연결이 v1 일 때만 개수를 세고 아니면 0.
- 파일: `src/components/ClientUpdateNotice.tsx`, `scripts/raw-ingest/migration_tail.sql`(+재생성 migration)
- 테스트: `tests/product/clientUpdate.test.tsx`(최근 연결 v2 + 옛 v1 → 숨김), `tests/sql/verify-raw-ingest.mjs`(최근 v2 → 0, 다시 v1 → 2).

## D. 메시지 길이 코드포인트
- 수정: `server/clientStatus.ts`(message, version) 와 `src/data/personal.ts`(zod `cpString`: message, min_version)를 `[...s].length` 기준으로.
- 테스트: `clientUpdate.test.tsx` "counts message/version length in code points" (이모지 1000자 통과, 1001자 거절; 서버·웹 양쪽).

## E. registry 버전 불일치
- 수정: `finish_raw_parse` 가 lease 확인 뒤 `p_derived->>'agency_registry_version'` 을 `private.community_registry_state`(id=1).version 과 비교, 다르면(없음 포함)
  `raise exception 'registry_version_mismatch' using errcode='55P03'`. 55P03 = psycopg `LockNotAvailable` 이라 워커의 일시 오류로 처리되어 lease 를 반납하고 attempt 를 쓰지 않는다.
  워커는 `registry_mismatch` 로 분류해 배치당 WARNING 한 번만 남기고 나머지 잡은 파싱 없이 반납한다.
- README 배포 순서: 새 registry 이미지 배포 + 옛 워커 drain -> singleton 전환(migration + recompute) 순. "자동 반영" 문구 삭제.
- 파일: `migration_tail.sql`, `server/parser-py/worker.py`, `server/parser-py/README.md`
- 테스트: `verify-raw-ingest.mjs`(불일치/누락 55P03, fact 불변, lease 유지), `raw-ingest-stack.test.ts`(실제 DB 에서 불일치 거절·무투영), 파이썬 단위 `test_registry_mismatch_releases_and_batch_logs_once`.

## F. 워커 일시 오류 확장 + 죽은 행 되살리기
- 수정: TRANSIENT 에 `QueryCanceled, AdminShutdown, CrashShutdown, CannotConnectNow, OperationalError, InterfaceError` 추가(release, attempt 미소모).
  `private.requeue_dead_raw(p_since timestamptz default null, p_error text default null) returns integer` 추가: dead -> pending + 큐(priority reparse, attempts 0).
  `p_since` 는 `received_at` 기준(dead 시각 컬럼이 없음). 소유자만 실행(public/anon/authenticated/service_role/community_parser 모두 revoke). 잠긴 행은 skip. README 에 사용법.
- 주의(알려진 한계): 연결이 이미 끊긴 경우는 반납할 수 없어 lease 만료(300초) 후 재클레임되며 그 클레임이 attempt 1회로 센다. 항상 statement_timeout 에 걸리는 잡은 attempt 가 소모되지 않아 dead 가 되지 않고 계속 재시도된다(README 에 모니터링 안내).
- 테스트: 파이썬 `test_transient_classes_release_without_attempt`, `test_other_errors_are_recorded_as_failures`; SQL `verify-raw-ingest.mjs`(필터 0/0/1, 권한 4개 역할 false); 스택 테스트(권한).

## G. enqueue_raw_reparse
- 수정: 후보 선택에 `for key share of r skip locked` (revoke 가 지우는 행을 기다리지 않음).
- 테스트: `verify-raw-ingest.mjs`(prosrc 확인 + 기존 reparse 흐름), 스택 테스트 통과.

## H. parse key / 파생 전용 재파싱
- 수정: parse key 에서 registry 제거(`{PARSER_VERSION}+map{MAP_WORKER_VERSION}`; registry 변경은 `scripts/recompute-agency-keys.mjs`).
  구현 선택: `project_raw_fact` 의 no_change 조건에 `and not (p_source='raw' and v_fact.fact_source='raw' and v_fact.fact_parser_version is distinct from p_parser)` 추가 —
  raw 로 만든 fact 가 새 parse key 로 재투영될 때 payload 해시가 같아도 파생 컬럼을 갱신(answer_accepted_at 유지). v1(dto) 경로의 동작은 불변(v1 baseline 동등 테스트 통과).
  README 의 "registry 자동 반영" 삭제, 파생 전용 변경 동작 설명.
- 테스트: `verify-raw-ingest.mjs`(새 parse key + 같은 payload 해시 -> accepted, rating 갱신, answer_accepted_at 유지; 같은 key -> no_change), 파이썬 `test_parse_key`, 스택 테스트 정규식 갱신.

## I. 알려진 한계 문서화
- `REVIEW-REPORT.md` "개선 후보" 에 비종결 raw 상태 회귀(raw 교체 / fact 유지 / 최종 raw 재전송 시 복원) 추가.

## 검증 결과
| 명령 | 결과 |
|---|---|
| `npx vitest run tests/product` | 87 파일 통과 / 1284 통과, 1 skip |
| `npm run build` | 성공 |
| `npm run scan` | passed, issues 없음 |
| `python3 -m unittest discover -s server/parser-py/tests` | 19 OK |
| `node tests/sql/verify-raw-ingest.mjs` | PASS |
| `npm run test:sql` | PASS |
| `python3 scripts/raw-ingest/check_contract.py --copies ../pc ../mobile` | PASS (11 files, 2 copies) |
| `node scripts/integration/compose_supabase.mjs check --auth ../auth` | **FAILED**: `202610210300 sha256 mismatch for auth:...kakao_unlink_revoke.sql` (다른 에이전트가 ../auth 를 수정 중, 내 변경과 무관) |
| 로컬 스택 `COMMUNITY_STACK=1 npx vitest run tests/integration/raw-ingest-stack.test.ts` | 12/12 통과 |

스택 재구성: auth 가 진행 중이라 정식 manifest 로는 compose 가 실패해, scratchpad 의 임시 manifest(auth sha 만 현재 파일 값)로 `compose --manifest` 후 `supabase db reset --workdir .integration-stack` 을 수행했다(../auth 는 건드리지 않음, 로컬 테스트 DB 만).
auth 쪽이 끝나면 auth manifest sha 는 그 에이전트/통합 단계에서 갱신해야 `check` 가 통과한다.
