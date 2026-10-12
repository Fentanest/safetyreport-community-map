# 추정 과태료 · 로컬 구현 보고 (2026-10-12)

기준 HEAD `96ff0d03b508b797a463bf1d3f8742387aac3681`, 브랜치 `astra/fine-estimate`.
작업 트리에만 변경을 남겼다. 커밋·push·배포·운영 DB 실행은 하지 않았다. 시작 시 있던
untracked `node_modules` 심볼릭 링크도 유지했다. 실제 SQL 및 브라우저 검증은 아래 환경 제약으로 **BLOCKED**다.

## 구현

- observation-v5 이름과 envelope를 유지하며 선택 `fine_estimate={won,rule,rule_version}`를 추가했다.
  정수 1..100000000·9개 규칙 ID·버전 ≤40자·추가 키 없음·null 금지를 검증한다.
  과거 v1~v5 payload와 기존 canonical hash를 유지하며 새 벡터/해시를 추가했다.
- private fact에 nullable 3열을 추가한다. 기본값·백필·기존 행 스캔 없이 `NOT VALID` 제약으로
  신규/갱신 행을 검사한다. 짧은 DDL 트랜잭션과 함수 갱신 트랜잭션을 두 migration으로 분리했다.
  내용이 바뀐 관측에서 추정 필드가 사라지면 기존 추정을 지운다. 확정 금액이 생긴 관측은 추정 집계에서 제외한다.
- `screen-aggregate-v2`의 기존 대표 선출·동의·날짜·전체/본인 코호트를 유지하고, 이미 읽는 행에서
  추정 count/sum을 계산한다. 원본 사실을 추가 조회하거나 합계용으로 다시 스캔하는 경로는 없다.
  기본 답변일, 신고일 선택 시 기존 single-date 규칙을 따른다. 완료일 결측을 신고일로 채우지 않는다.
- `disposition=fine`, 확정 금액 없음, `amounts_public` 동의인 완료 사실의 앱 추정만 센다.
  확정 0원도 제외한다. 마스킹되어 금액이 null이 된 사실은 `amount_stated`로 재확인한다.
  전체와 내 신고에 `fine_estimate={count,sum_won,mean_won}`를 따로 제공한다. 0건의 합계/평균은 null이다.
- service-only raw JSON/compact 전송에도 동의로 가린 금액만 추가했다. 규칙/규칙 버전은 공개 DTO에 없다.
  새 decoder는 기존 34열과 신규 35열을 모두 읽는다. v2의 빈 응답은 0건, 구 SQL 필드 없음은 미제공으로 구분한다.
- KPI 하단·상세 비교·이용 안내에 별도 금액/건수/평균을 넣었다. 기존 원 단위 표기를 재사용했다.
  개인 비교가 켜졌을 때 본인 금액/건수도 보인다. 390px에서 새 항목의 제목/값이 줄바꿈하도록 했다.
  라이트/다크 기존 토큰을 그대로 쓴다. 실제 시각 검수는 미완료다.
- 기관·담당자·법규·월별 표에는 이번에 추정 열을 추가하지 않았다. 첫 응답의 행별 공개 필드를 늘리지 않는다.
  summary/focus 충분통계와 전체/내 비교만 확장했다. `screen-precompute-v1`/구 v1 최적화 경로로 전환하지 않았다.

## 변경 파일

| 범위 | 파일 |
|---|---|
| 업로드 계약 | `contracts/community-ingest/observation.schema.json`, `observation.md`, `vectors/observations.json`, `MANIFEST.sha256` |
| 수신 | `server/ingest/observation.ts`, `server/ingest/handler.ts` |
| DB | `supabase/migrations/202610121200_fine_estimate_columns.sql`, `202610121201_fine_estimate_ingest_aggregate.sql` |
| 집계/전송 | `server/amount.ts`, `aggregate.ts`, `compare.ts`, `screenAggregate.ts`, `screenFacts.ts` |
| 공개 계약/검증/데모 | `src/domain/public.ts`, `personal.ts`, `src/data/schema.ts`, `personal.ts`, `demoEngine.ts` |
| 화면 | `src/components/KpiPanel.tsx`, `CompareKpis.tsx`, `DataGuide.tsx`, `format.ts`, `src/styles/layout.css` |
| 시험 | `tests/product/fineEstimate.test.tsx`, `ingestHandler.test.ts`, `refactorEquivalence.test.ts` |
| 문서 | `docs/metrics-catalog.md`, `docs/implementation/work-ledger.md`, 이 보고서와 `evidence/` |

기존 마이그레이션은 수정하지 않았다. 과거 회귀 oracle JSON은 보존했다. 비교 테스트만 새 추정 요약을
별도 검증한 뒤 기존 모든 필드를 원래 oracle와 비교한다.

## 검증 결과

| 검사 | 실제 결과 |
|---|---|
| Vitest 전체 | **791 PASS / 181 SKIP / 11 FAIL**, 66 suites 통과·31 skip·1 fail. 실패 11개는 기존 `composeScript.test.ts`의 자식 프로세스 `spawnSync EPERM` |
| 신규 기능 | 수신 handler/검증·옛 payload/hash·범위/규칙 오류·동의 마스킹·확정 0원 분리·내 신고·대표 중복 제거·날짜·SQL 모양 v2 응답·신/구 compact·화면 문자열/없음/평균 통과 |
| `npx tsc -p . --noEmit` | exit 0 |
| Vite production build | exit 0, `/tmp/map-estimate-build`; 기존 큰 chunk 및 ineffective dynamic import 경고 |
| Deno check | community-ingest / public-analytics / my-analytics 모두 exit 0 |
| public dist scan | PASS, issues=[] |
| 계약 MANIFEST | 18개 파일 hash 일치 |
| PostgreSQL 실행/성능 | BLOCKED: Docker socket 접근 거부. 로컬 PostgreSQL 서버 바이너리도 없음. 새 SQL 실행/EXPLAIN/시간 비교 미검증 |
| 브라우저 | BLOCKED: Vite `listen EPERM 127.0.0.1:5311`, 지정 Playwright+Chromium 실행도 종료. screenshot/console/network/행동 증거 없음 |
| Muse | BLOCKED: `opencode models`/`mcp list`가 호스트 로그 디렉터리 쓰기 제한으로 실패. 모델·variant 미확인, 검수 발주/승인 없음 |

원래 Vite 명령은 공유 `node_modules/.vite-temp` 쓰기가 거절되었다. 제품 설정/공유 의존성을 바꾸지 않고
임시 `/tmp/fine-vite.config.mts`에서 기존 config를 가져와 `cacheDir=/tmp/fine-vite-cache`와
`--configLoader runner`로 build/Vitest를 실행했다. Vitest의 실패는 같은 spawnSync 호출의
`error.code=EPERM`, 빈 stderr를 별도로 재현했다. 실패 테스트를 삭제하거나 skip으로 바꾸지 않았다.
`official-binding`은 COMMUNITY_STACK 미설정으로 건너뛰었고 외부 auth 레포를 읽지 않았다.

재현 명령(정상 로컬 권한 환경에서는 기본 config로도 가능):

```sh
npx vitest run --config /tmp/fine-vite.config.mts --configLoader runner
npx tsc -p . --noEmit
npx vite build --outDir /tmp/map-estimate-build --config /tmp/fine-vite.config.mts --configLoader runner
DENO_DIR=/tmp/fine-deno-cache ~/.local/bin/deno check supabase/functions/community-ingest/index.ts supabase/functions/public-analytics/index.ts supabase/functions/my-analytics/index.ts
python3 scripts/scan_public_dist.py --dir /tmp/map-estimate-build
```

임시 config 내용:

```ts
import config from '/home/better0101/projects/worktree/map-estimate/vite.config.ts';
export default (env) => ({ ...config(env), cacheDir: '/tmp/fine-vite-cache' });
```

## Opus 적용 순서와 파일 목록 (미실행)

실제 DB/브라우저 검증을 먼저 마친 뒤 적용한다. 새 기능 앱의 재전송은 아래 단계가 끝난 뒤 시작해야 한다.
기존 strict 프런트는 새 응답 필드를 거부할 수 있고, 구 Edge는 신규 compact 35열을 읽지 못하므로 순서를 지킨다.

1. 선택 필드를 수용하는 이번 지도 프런트를 빌드·배포한다(구 서버 응답도 허용).
2. 새 nullable 열 migration **`202610121200_fine_estimate_columns.sql`**을 적용한다.
   lock_timeout=3초이며 실패하면 이 migration 트랜잭션 전체를 정상 재시도한다. 테이블 백필은 없다.
3. **`community-ingest`, `public-analytics`, `my-analytics`**를 다시 올린다.
   진입 `supabase/functions/{community-ingest,public-analytics,my-analytics}/index.ts`는 그대로지만
   아래 변경 의존 파일을 포함한 전체 import closure로 번들을 다시 만들어야 한다.
   - `server/ingest/handler.ts`, `server/ingest/observation.ts`
   - `server/amount.ts`, `server/aggregate.ts`, `server/compare.ts`, `server/screenAggregate.ts`, `server/screenFacts.ts`
   - 이들이 참조하는 `src/domain/public.ts`, `src/domain/personal.ts` 및 기존 shared/server 의존 파일
   - 인증/JWT·기존 환경 설정은 유지. 새 Edge 함수 이름이나 secret은 없다.
4. 함수 migration **`202610121201_fine_estimate_ingest_aggregate.sql`**을 적용한다.
   수신 RPC, raw 사실 전송 함수, 화면 v2 집계 함수를 `CREATE OR REPLACE`한다. 기존 함수 권한을 유지한다.
   단계 2~4 동안 새 앱의 estimate 업로드는 시작하지 않는다(구 수신 SQL은 필드를 저장하지 않음).
5. 수신→private 3열→동의/확정금액 제외→화면 전체/내 요약을 작은 합성 자료로 검증한다.
   이후 PC/모바일 업데이트의 기존 로컬 자료 hash 변경분 재전송을 진행한다. 사용자 초기화 크롤링은 필요 없다.

배포 전 로컬 SQL 검증은 기존 rollback-only 스택 방식과 동일하게 독립 테스트 DB에서 두 migration을 적용해
수신 신규/갱신/키 생략, 값 제약, 동의 공개/비공개, 확정 금액(0원 포함), all/mine 대표 선출을 확인해야 한다.
기존 v2와 같은 범위의 EXPLAIN ANALYZE/응답 크기도 비교해야 한다. 구조상 count/sum 추가지만 실측 통과를 뜻하지 않는다.

브라우저 재검증: `VITE_DATA_MODE=demo npx vite --host 127.0.0.1 --port 5311 --strictPort` 후 `/?me=signed`.
브리프에 지정된 Playwright/Chromium으로 1440px·390px 각각 라이트/다크에서 비교 토글, 상세 펼치기, 안내,
페이지 가로 넘침, console/network를 확인한다. 요청 screenshot 경로 `../map-estimate-shots/`는 이번 sandbox
쓰기 허용 범위 밖이고 브라우저도 실행되지 않아 생성하지 않았다. 정상 권한 환경에서 그 경로에 저장·실제 이미지 검수한다.
Vite는 실행한 PID로 종료한다. 이번 실패한 서버/브라우저 프로세스는 종료되어 지속 실행 서비스는 없다.

롤백 시 저장한 추정 열/데이터를 삭제하지 않는다. 함수 정의를 종전 버전으로 되돌리면 예전 집계로 복귀한다.
compact 전송 함수를 되돌리기 전에는 35열 호환 Edge를 유지한다. 재전송된 추정 자료를 다시 받기 위한 앱의
버전별 완료 표시는 이 저장소의 범위 밖이므로 앱 담당자와 조율한다.

## 남은 위험

실제 SQL 문법/실행·성능 및 390px 라이트/다크 시각 검수를 통과하지 않았으므로 release-ready가 아니다.
클라이언트 법정 최저 규칙 자체의 정확성, 앱 재전송 완료 여부, 운영 데이터 보급률은 여기서 검증하지 않았다.
추정값이 없는 기존 신고는 계속 제외되며, 실제 과태료 전체 규모나 확정·납부 금액으로 해석하지 않는다.
