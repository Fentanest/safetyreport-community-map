# 화면 쿼리 최적화 · 2026-10-18 (운영 적용 완료 — 결과는 docs/deployment.md 2026-10-18 절)

사용자 지시("서버 쿼리 슈퍼 최적화 검토" → "다 반영"). 기준 main `f1e129e`. 운영 DB·Edge·Pages에는 접근하지 않았다.
수치는 모두 **로컬 합성 데이터**(`supabase_db_ci0926-int`, PostgreSQL 17.6, x86_64)이고 운영 측정이 아니다.

## 무엇이 느렸나 (로컬 프로파일, auto_explain)

12만 건·고유 주소 약 10만 개 합성에서 `analytics_screen_parts` 전체 기간 공개 집계 23초 중:
주소 정규화+장소 키 약 8초, 지역 좌표 판정 약 9.6초, 번호판 약 1초 — 요청마다 같은 IMMUTABLE 함수를 고유 입력 수만큼 다시 실행했다.
대표 선출 약 1.3~2.2초(정렬 3개가 54/57/20MB 디스크로 넘침), 집계·JSON 나머지.
캐시 쪽에서는 (1) 지도 핀(`places/pl1:…`)이 캐시 키에 들어가 핀 하나에 전체 재집계, (2) 공개 결과가 캐시돼 있어도 개인 비교 miss는 전체 신고를 다시 선출,
(3) 매분 cron이 데이터 변화가 없어도 60초마다 기본 두 범위를 다시 계산했다.

## 바꾼 것

| 파일 | 내용 |
|---|---|
| `202610180100_screen_fact_norm.sql` | `private.screen_fact_norm`: 사실 행 PK별 정규화 결과(주소·장소 키·번호판·법규·지역)와 그 입력값. facts 쓰기 트리거가 행 단위로 채우고, FK `on delete/update cascade`로 사실과 함께 지워진다(철회·삭제·계정 삭제). 읽을 때 **입력·버전이 정확히 같은 행만** 쓰고 나머지는 예전처럼 그 자리에서 정규화한다. 선출은 좁은 열로만 하고 표시 열·보조 표는 선출 뒤 PK로 붙인다(`ord`는 선출 순서 그대로). `analytics_screen_parts`에 `p_keys`(source key 제한) 5인자 판을 추가하고 4인자는 그 래퍼다. |
| `202610180101_screen_fact_norm_backfill.sql` | 보조 표 채우기. 별도 트랜잭션이라 facts 쓰기를 막지 않는다. 다시 실행해도 된다. |
| `202610180200_screen_cache_reuse.sql` | stale-v2 경로: ① 저장된 결과의 자료 revision이 지금과 같으면 나이와 무관하게 적중, 시각만 지금으로 옮긴다(페이로드 재기록 없음) ② 공개 키에서 핀을 빼고, 핀 행은 그 장소의 source key만으로 계산해 붙인다 ③ 공개 적중·개인 miss이면 내 key와 내 장소의 key만으로 개인 결과를 계산한다. ②③은 모든 완료 사실에 유효한 보조 행이 있을 때만 쓰고(`screen_norm_complete`, revision별로 슬롯 161에 캐시) 아니면 예전 전체 계산이다. |
| `202610180300_personal_source_columns.sql` | `internal_my_analytics_cohort_columns`: 개인 비교·맞춤 통계 원천을 columns-v1로. 같은 게이트·state·35개 필드. |
| `server/personalHandler.ts` | 새 원천을 먼저 부르고, **새 RPC가 없을 때만**(PGRST202/42883) 옛 원천으로 되돌아간다. |
| `supabase/functions/public-analytics/index.ts` | `statistics/*` 등 facts 경로가 `fact_encoding: columns-v1`을 요청하고 `decodeScreenFacts`로 푼다(운영 SQL에 이미 있는 형식). 옛 SQL의 객체 배열도 받는다. |

바꾸지 않은 것: 선출 규칙, 자격(동의·정지·공개 정책), 180초 상한, 프라이버시 revision, 공개/개인 Edge 응답 계약, 화면 UI.

## 동등성·안전 검증

- `SCREEN_CACHE_STACK=1 npx vitest run tests/integration/screen-query-opt.test.ts` — **7 통과**. 같은 트랜잭션에서 운영 경로(121400까지)로 만든 패킷과
  새 경로의 전체 miss / 공개 적중+개인 제한 계산 / 전부 적중 패킷을 실제 `createScreenHandler`로 재생해 비교(시각 필드만 제외)한다.
  시나리오: 기본+비교+핀 2개, 신고일·주차+비교+핀, 법규 필터+비교, 핀만. 그 밖에 핀 적중 시 기본 항목 재사용·저장된 기본에 핀 행 없음,
  revision 같음→시각만 갱신·업로드→재계산·cron 0/2, 보조 표 삽입·수정·key 이동·삭제 추적과 API 역할 권한 닫힘,
  오래된/손상된 보조 행 무시(결과 동일), 개인 columns 원천 = 객체 원천(state·viewer·facts), **rollback.sql 적용 뒤 함수 정의·owner·ACL·설정·표·트리거가 적용 전과 같음**.
- `tests/product/personalHandler.test.ts` 28 통과(새 원천·옛 원천 되돌림·timeout은 되돌리지 않음·알 수 없는 인코딩 거부).
- 전체 Vitest 1212 통과(203 skip), `npx tsc -p . --noEmit`, `deno check`(public-analytics·my-analytics), `npm run test:sql` 통과.
- 로컬 스택의 다른 통합 파일 중 `query-audit`·`snapshot-contract`·`screen-server-aggregate`(7)·`my-analytics-stack`(준비 실패)은
  **변경 전 main에서도 똑같이 실패**한다(스택 DB가 202610040800 상태이거나 실제 HTTP 스택이 필요). 이번 변경과 무관함을 `git stash`로 확인했다.

## 측정 (로컬, 12만 건, 장소 2만 곳, 사용자 30명)

| 경우 | 운영 경로 | 새 경로 |
|---|---:|---:|
| 전체 기간 공개 miss | 16.1초 | 7.9초 |
| 핀 클릭(기본 화면 적중 상태) | 15.5초 | 0.9초(같은 revision 두 번째부터 0.6초) |
| 개인 비교 첫 진입(공개 적중) | 10.2초 | 1.2~1.3초 |
| 180초 경과·자료 변화 없음 | 15.3초 | 0.2초 |
| 전부 적중 | 0.19초 | 0.20초 |
| `statistics/*` facts 원천(전체 기간) | 148.8MB · 6.0초 | 80.8MB · 4.6초 |

보조 표 backfill은 12만 행에 약 35초(행당 plpgsql 정규화), 업로드 시 행당 약 0.3ms가 늘어난다.
재현: `perf/build.sh 120000 perf/new-paths.sql`(새 경로는 `MIGS="202610180100_screen_fact_norm.sql 202610180200_screen_cache_reuse.sql"`), `perf/deployed-paths.sql`, `perf/fact-encoding.sql`, 프로파일 `perf/explain.sql`.
합성 주소를 10만 곳으로 늘리면 공개 결과가 23MB가 되어 기존 16MiB 슬롯 한도에 걸려 아예 캐시되지 않는다(이번 변경 전후 동일, 운영 결과는 약 9MB).

## 하지 않은 것 (검토 문서의 B·C)

- 대표 선출 결과 저장(B): 남은 miss 7.9초 중 선출은 약 1.3초다. 자격(동의 철회·정지) 변경마다 다시 선출해야 하는 쓰기 경로라 이번에 넣지 않았다.
- 날짜별 가산 집계(C): 필터 조합마다 저장 구조가 필요해 설계 비용이 크다. 기본 범위는 이미 캐시·시각 갱신으로 처리된다.
- viewer 게이트 건수 상한: 로컬 4천 건 사용자 17~24ms라 효과가 작아 바꾸지 않았다.
- 남은 miss 비용은 펼친 약 80만 행의 FILTER 집계(약 2초)와 JSON 생성이다.

## 운영 적용 (별도 승인 필요)

순서: Edge `my-analytics`·`public-analytics`(둘 다 옛 SQL과도 동작) → `202610180100` → `202610180101`(backfill, 수십 초) → `202610180200` → `202610180300`.
SQL만 먼저 올려도 옛 Edge가 그대로 동작한다(공개 RPC 이름·응답 형식 불변). `supabase db push --include-all` 금지는 그대로다.

- `202610180100`은 facts에 트리거·FK를 거는 짧은 잠금이 필요하다(`lock_timeout=3s`, 실패하면 전체 롤백 후 재시도).
- 이후 `community_report_facts` TRUNCATE에는 CASCADE가 필요하다. 트리거를 끈 대량 적재(replica 모드 등) 뒤에는 `202610180101`을 다시 실행한다
  (안 하면 느려질 뿐 결과는 같다. 단 같은 revision에 캐시된 완전성 판정은 그 파일이 지운다).
- 정규화 함수나 지역 사전을 바꾸는 migration은 `private.screen_norm_version()`을 올리고 `202610180101`을 다시 실행한다.
- 운영에서 볼 것: backfill 시간, 업로드 p95, 기본 화면 cron 소요(자료 변화 없을 때 거의 0), 핀/개인 비교 응답 시간, 보조 표 크기.

되돌리기: [rollback.sql](rollback.sql)(저장소의 121300·20261014·121400 본문에서 생성, 로컬 검증 완료). Edge는 이전 파일로 복원(새 Edge도 옛 SQL과 동작하므로 필수 아님).

미검증: 운영 데이터 분포(고유 주소·좌표 수)와 운영 CPU에서의 실제 시간, 실제 Edge 런타임·PostgREST·브라우저 왕복, 동시 요청.
UI는 바뀌지 않았고 Edge 응답 동등성은 위 재생 비교로 확인했다. 운영 로그인 브라우저 검수는 하지 않았다.
