# 화면 결과 캐시 · 연속 업로드 대응 (2026-10-12)

브랜치 `astra/cache-stale`, 기준 HEAD `a4ef064`의 미커밋 변경이다. 이 worktree만 수정했다.
커밋·push·운영 DB 접속/쓰기·배포는 하지 않았다. 사용자가 전달한 운영 실측은 입력 근거이며 이번 에이전트의 운영 실측이 아니다.
이 문서가 이전 REPORT.md의 **exact-version만 허용 / cron 5초 보류 / UI 변경 불필요** 결정을 대체한다.

## 설계

- 공개 결과는 계산을 시작한 SQL statement의 시각으로 **180초 미만**만 재사용한다. 180초 경계부터 새로 계산한다.
  설정은 `private.screen_public_max_age()`(180초), cron 갱신 기준은 `screen_public_refresh_age()`(60초)다.
  전역 업로드 버전을 키에서 빼고, 개인정보 epoch + 전체 scope + 집계에 필요한 focus panel + 구현 버전을 사용한다.
  payload에는 그 집계의 state와 snapshot 시각을 함께 저장한다. 응답 시 최신 state를 옛 집계에 붙이지 않는다.
  `source_updated_at`, `generated_at`은 기존 의미를 유지하며 실제 화면 집계 시각은 별도 `meta.snapshot_at`이다.
- 삭제/TRUNCATE, 동의 DML, disclosure DML, 기여자 활성 상태 변경/추가/삭제,
  fact의 차량 원번호·동의 연결·공개 상태·소유자 변경은 epoch를 즉시 증가시킨다.
  금액·법규·별점 공개 정책도 같은 disclosure trigger에 포함된다. 일반 업로드는 epoch를 바꾸지 않는다.
  profile의 updated_at heartbeat는 무효화 사유가 아니다. 동의/정책 DML은 무변경 UPDATE도 보수적으로 무효화한다.
- 개인 키는 검증된 사용자 + 세션 + **사용자 자료 revision** + 개인정보 epoch + scope/패널이다.
  INSERT/UPDATE/DELETE statement trigger가 영향을 받은 계정만 증가시킨다. manifest generation은 payload 수정에 증가하지 않으므로 사용하지 않았다.
  같은 `source_report_key`를 가진 공동 기여자의 변경도 대표 날짜(D13)/번호 보완(R2)에 영향을 주므로 해당 사용자들을 무효화한다.
  관련 없는 타인 업로드는 개인 키를 바꾸지 않는다. updated_at/latest_receipt_id/source_revision/writer_epoch만 바뀌는 재전송은 무효화하지 않는다.
  개인 캐시의 기존 15분 보존 TTL과 매 요청 live viewer gate(카카오·세션·동의·10건)는 유지한다.
- STABLE resolve가 한 MVCC snapshot에서 자격·개인 버전·privacy epoch·lookup·미스 계산을 수행한다.
  VOLATILE save는 privacy epoch만 다시 확인한다. 계산 중 일반 업로드가 커밋되어도 결과를 저장해 prewarm 기아를 막는다.
  개인정보 변경이 커밋되면 저장하지 않는다. 개인 자료 변경 중 계산된 개인 결과는 옛 revision 키라 다음 요청에 적중할 수 없다.
  기존 슬롯별 try-lock/created_at 단조 갱신, 16MiB/4MiB 크기 한도와 161개 슬롯을 그대로 사용한다.
- cron의 5초 업로드 보류는 제거했다. 기본 답변일 전국 전체분류 × 최근12개월/전체기간을 매분 점검하고 60초 지난 결과를 갱신한다.
  같은 cron advisory lock으로 중복 실행을 건너뛰며, 기존 job의 **top-level `SET statement_timeout='55s'`**를 유지한다.
  함수에 있는 timeout 설정만으로 현재 statement 취소가 보장된다고 주장하지 않는다.
  metadata는 계속 전역 exact cache를 쓰므로 업로드 중 state_hit=false는 정상일 수 있다.

## 서로 다른 시점의 비교

2026-10-12 후속 사용자/Opus 결정: **공개/개인 시점이 달라도 차이·비중을 계산해 제공한다.**
`snapshots.comparable`은 자료 버전 일치 여부를 알려 주는 정보로만 유지한다. 요약 `diff`와 지역/기관/담당자 차이는
각 시점의 실제 수치로 계산한다. 0분모·결측의 null과 사유는 유지한다. 각 측의 건수·비율·기간·금액·월별·분포도 유지한다.
**mine > all도 그대로 표시**하며 100으로 자르거나 개인 값을 전체 값에 맞추지 않는다. 비중 스키마도 100% 초과를 허용하며, 해당 표 셀에 작은 `최근 업로드 반영 차이` 주석을 붙인다. 공개 시점 범위 밖의 새 개인 월도 보존한다.
개인 full tuple에 있던 최신 전체 참여자 수가 공개 overview를 덮어쓰지 않도록 공개 full을 우선한다.
같은 주소의 타인 참여 여부는 관련 없는 업로드에도 바뀌므로 v2의 `my_points.shared=null`로 두고 ‘나만 신고’라고 단정하지 않는다.

불변식/표시 호출자 감사:

| 경로 | 처리 |
|---|---|
| `consistentWithPublic` / Dashboard | compare.all과 화면 overview의 동일성 검사는 그대로 유지. 내 값의 포함 여부 검사가 아님 |
| `acceptCompare` / ScreenCoordinator / client readScreen | 공개 화면 version/scope가 패널 fence. 개인 시각은 별도 snapshots. 원자적 frame 교체와 계정 reset 유지 |
| Dashboard `bundledPersonal` | 공개 version이 그대로여도 새 frame의 개인 결과를 peek하므로 본인 자료 갱신을 놓치지 않음 |
| CompareKpis / KpiPanel | 차이·비중을 표시하고 두 기준 시각을 병기. 100% 초과 비중에 셀 주석 |
| RegionList / CompareEntities | 지역/기관/담당자 차이도 유지. 개인 값 정렬/표시 유지 |
| TrendCard / AnalyticsCharts / EntityTable | 두 시리즈 각각 표시, 측간 나눗셈/차감 없음. 각 측 내부 비율 분모는 그대로 |
| markPoints / MapPanel / PlaceDetailsPanel | shared null 전파. 불확정이면 타인 참여 문구 생략 |
| 독립 compare/statistics, 랭킹 | 이 stale RPC를 사용하지 않으므로 기존 한 snapshot 계약 유지 |

KPI 머리말과 상세 비교 표에 KST 월일·시분초를 표시한다. 예: `전체 10. 12. 17:01:00 · 내 신고 10. 12. 17:03:12 기준`.
실제 시각이 같으면 `전체 · 내 신고 10. 12. 17:01:00 기준`처럼 시각은 하나만 표시한다. 시각 비교는 버전 일치 정보와 독립적이다.
비교를 끄면 전체 기준 시각만 보인다. 차이·비중을 숨긴다는 안내는 제거했다.
초 단위 표시는 분이 같아도 다른 snapshot일 수 있기 때문이다. tooltip은 원 ISO 시각이다.

## 호환성과 롤백

새 웹만 `Accept: application/json; screen-cache=stale-v2`로 협상한다(기존 CORS 허용 Accept 사용).
새 Edge는 이 헤더가 있을 때만 새 RPC `internal_analytics_screen_stale`를 호출한다.

| 조합 | 동작 |
|---|---|
| 구 웹 + 새 Edge/DB | 기존 exact RPC/DTO. 추가 strict 필드나 null shared를 받지 않음 |
| 새 웹 + 구 Edge | 헤더는 무시됨. 기존 exact DTO를 수용 |
| 새 웹/Edge + 구 DB | 신규 RPC 부재(PGRST202/42883)만 기존 RPC로 fallback |
| 새 웹/Edge/DB | bounded 공개 + 독립 개인 캐시 + 기준 시각 |
| timeout/권한/기타 SQL 오류 | fallback 반복 계산 없이 기존 오류로 반환 |

구 RPC/resolve/save 함수는 수정하지 않았다. v1/v2가 같은 슬롯을 사용하므로 병행 시 서로 교체되어 적중률이 낮아질 수 있지만
키 prefix가 달라 서로의 payload를 잘못 해석하지 않는다. v2 shared/private table은 anon/authenticated/service_role direct SELECT 불가,
신규 public RPC는 service_role만 EXECUTE 가능하다. 응답은 계속 private,no-store이며 내부 revision/UUID/키/캐시 적중 정보는 브라우저에 보내지 않는다.

Opus 배포 순서:

1. 아래 rollback 시험을 운영자가 수행하고 결과·부하·잠금을 확인한다.
2. `202610121300`/`1301`이 적용된 환경에 **신규 `202610121400_screen_cache_stale.sql`만** 적용하고 migration 이력을 기록한다.
   기존 미채택 `202610061200_ingest_precompute.sql`은 적용하지 않는다.
   CLI는 호스트 현재 시각으로 `20261012080458`을 생성했으나 선행 migration보다 앞서므로 새 파일 순서를 `202610121400`으로 정했다.
3. 변경된 server 모듈들을 포함해 `my-analytics` Edge를 갱신한다. `public-analytics`, ingest, 앱은 변경할 필요가 없다.
4. 새 Pages 빌드/스캔을 배포한다. 구 Edge 먼저 롤백해도 새 웹은 exact 응답을 수용한다.
5. cron job command의 55초 timeout, 60초 이상 결과의 실제 갱신, 지속 업로드 중 hit, 철회 직후 gate,
   로그인 브라우저의 시각·비교 표시와 SQL/Edge/전송/화면 p95를 확인한다.

롤백은 우선 my-analytics Edge를 기존 캐시 배포 코드로 되돌린다. 선택적으로 Pages도 이전 산출물로 되돌린다.
cron은 `cron.unschedule('screen-result-cache-v1')`로 해당 job만 중지하거나, 이전 migration의 `screen_cache_maintain` 함수 본문을
새 forward migration으로 복원한다. stale 테이블/트리거는 무해하게 남길 수 있다. 완전 제거 시 신규 RPC/함수/트리거 의존성 순서에 맞춰
별도 forward migration으로 처리한다. **facts·dataset_version·철회된 동의를 과거로 되돌리지 않는다.**

## 운영 rollback SQL

[verify-stale-rollback.sql](verify-stale-rollback.sql)은 BEGIN → migration body → 시험 → ROLLBACK만 수행한다.
cron 설치/스케줄을 바꾸지 않는다. 본문 파일에 BEGIN/COMMIT이 있으면 바깥 rollback이 깨지므로 반드시 제거한다.

```bash
python3 - <<'PY'
from pathlib import Path
import re
p = Path('supabase/migrations/202610121400_screen_cache_stale.sql')
Path('/tmp/cm-stale-migration-body.sql').write_text(re.sub(r'^(begin|commit);\s*$', '', p.read_text(), flags=re.M))
PY
```

운영자의 기존 안전한 연결 방법과 eligible user/session을 사용한다. 연결 비밀과 UUID는 출력/보고에 포함하지 않는다.

```text
psql -X -v ON_ERROR_STOP=1 -v stale_migration=/tmp/cm-stale-migration-body.sql \
  -v cache_viewer=<eligible UUID> -v cache_session=<active session UUID> \
  -f docs/implementation/screen-result-cache-20261012/verify-stale-rollback.sql
```

실자료 fact를 바꾸지 않고 projection/user revision을 변경해 upload/own-change 무효화를 모사한다.
정책과 본인 동의는 savepoint에서 변경·검사·rollback한다. age 경계·warm·TTL·ACL·캐시 크기도 확인한다.
DDL/캐시/정책 row lock은 바깥 rollback까지 유지되므로 낮은 부하 시간에 실행한다. 55초 제한에 걸리면 성공으로 판단하지 않는다.
실제 fact mutation 및 두 세션 동시 커밋 시험은 아래 일회용 로컬 DB에서만 수행했다.

## 예상 효과와 위험

- 연속 업로드: 개인정보 epoch가 그대로이고 scope가 같으면 공개 hit 가능. 타인 업로드는 개인 캐시도 재사용한다.
  본인 자료 변경은 공개 hit/개인 miss. 새 scope·180초 경과·개인정보 변경은 계산이 필요하다.
- 잠잠할 때: 기존 운영에서 확인한 hit SQL 0.1~0.2초 경로와 비슷한 효과를 기대하지만 **새 코드 운영 실측은 없다**.
  개인 cold/충돌/15분 TTL은 여전히 miss이며 큰 payload(사용자 제공 운영 수치 5.6MB+1.6MB)는 줄이지 않았다.
  따라서 Edge 처리·전송·렌더 10초를 이 작업만으로 특정 초 이하로 보장하지 않는다.
- cron 두 범위 합산 17초/분을 가정하면 wall duty는 **28.3%**다. 1코어를 꽉 쓰는 계산이면 17 core-seconds/분,
  4 vCPU 총 용량의 약 **7.1%**에 해당한다. 실제 parallel worker/IO/업로드 경쟁은 별도라 CPU 사용량 측정 전 확정치가 아니다.
  55초 timeout에서 둘째 범위가 취소되면 같은 트랜잭션의 첫째 저장도 rollback된다.
- 동시 cold 요청은 여전히 중복 계산 가능(single-flight 미도입). try-lock은 저장을 기다리지 않게 할 뿐이다.
- `shared=null`이면 타인 참여 문구를 생략한다. 혼합 시점의 차이·비중은 동일 시점의 부분집합 비교가 아니므로
  100%를 넘을 수 있다. 원값과 양측 시각을 표시하며 해당 비중 셀에 주석을 붙인다.
- privacy epoch 무효화는 보수적 전역이다. 활성 동의/정책 자체를 업로드마다 다시 쓰는 구현이면 hit가 줄 수 있어 운영에서 확인해야 한다.
- 무효화는 다음 snapshot부터 적용한다. 철회 커밋 전에 시작한 진행 중 읽기/이미 전달된 브라우저 사본까지 소급 회수하지 않는다.
- 180초는 **서버 요청 시 재사용 허용 나이**다. 열린 탭을 3분마다 강제 재조회하는 기능은 추가하지 않았다. 화면은 실제 시각을 계속 표시한다.

## 검증과 파일

검증 결과는 아래 최종 기록 및 `evidence/stale/`를 참조한다. 합성 DB/모의 인증·Kakao와 운영을 구분한다.

변경 파일 그룹:
- DB: 신규 `supabase/migrations/202610121400_screen_cache_stale.sql` (기존 migration 수정 없음).
- 서버: `server/screenHandler.ts`, `screenAggregate.ts`, 신규 `screenSnapshots.ts`.
- 계약/클라이언트: `src/domain/{public,personal}.ts`, `src/data/{client,personal,schema}.ts`, `src/state/pointMarks.ts`.
- UI: `src/pages/Dashboard.tsx`, `src/components/{KpiPanel,CompareKpis,TopBar,MapPanel,PlaceDetailsPanel}.tsx`, 신규 `snapshotTime.ts`.
- 시험: `tests/integration/screen-stale-cache.test.ts`, `tests/product/screenStale.test.tsx`,
  `scripts/benchmark/screen_stale_concurrency.py`, `scripts/browser/{vite.screen-stale-cache.config.ts,verify_screen_stale_cache.mjs}`.
- 문서: 본 보고서, 기존 REPORT 머리말, verify-stale-rollback.sql, public API/개인비교/제품결정/acceptance/deployment 보완.

읽기 snapshot 근거: [PostgreSQL MVCC](https://www.postgresql.org/docs/current/transaction-iso.html).
Supabase 2026-10-12 changelog를 확인했으며 이번 SQL/RPC 변경에 관련된 breaking change는 확인되지 않았다.

## 선행 작업 실행 기록 (후속 비교 수정 전)

실제 실행 결과(운영 미접속):

- `npx vitest run --configLoader runner`: **68 files, 813 passed**, 194 opt-in tests skipped (추가 DB 연속 업로드 case 작성 직전 전체 실행).
- `SCREEN_CACHE_STACK=1 npx vitest run --configLoader runner tests/integration/screen-stale-cache.test.ts`: **7 passed**, 실제 로컬 PostgreSQL 17 / 각 시험 rollback.
  30회 연속 타인 fact 업로드 hit, 본인 수정/재전송, 공동 신고 대표 의존성, 179/181초 age, 만료/충돌, 업로드 직후 cron,
  삭제/차량/정책/동의/정지/세션, mine>all와 공개 범위 밖 개인 월, DTO/마스킹/ACL을 검사했다.
- 기존 `screen-result-cache.test.ts`: **7 passed**, 구 exact 경로의 전체 Edge packet 동등성 회귀 검사.
- `python3 scripts/benchmark/screen_stale_concurrency.py`: **PASS**, 일회용 `postgres:17.6` 컨테이너 생성/시험/삭제 완료.
  4개 동시 cold·2계정 격리, 잠긴 슬롯 nonblocking **0.309초**, 계산 중 타인 업로드 저장/적중,
  정책 변경 저장 차단, 본인 업로드 후 개인 miss를 확인했다. 운영 DB/기존 로컬 DB에는 합성 자료를 commit하지 않았다.
- `npx tsc -b`, `npm run build -- --configLoader runner`, `deno check supabase/functions/my-analytics/index.ts`: **PASS**.
  빌드에는 기존 dynamic-import/chunk-size 경고가 남는다. `python3 scripts/scan_public_dist.py --dir dist`: **PASS**, issues 0.
- `verify-stale-rollback.sql`의 실제 본문을 로컬 합성 seed에서 실행: **PASS**, 최종 ROLLBACK 완료. 운영 실행은 **NOT_RUN**.
- Chrome **154.0.8037.92**, 실제 앱 + 실제 screen handler + 로컬 SQL export, 모의 인증/모의 Kakao:
  390/1440/1920/2560 × dark/light 8개 화면, 모바일 개인 비교, 기관/법규 정렬·기간 변경·공개 fence·혼합 비교 표시,
  가로 overflow 없음·console error 0·screen network 응답 전부 200 **PASS**.
  [결과](evidence/stale/results.json), [1440 비교](evidence/stale/1440-dark-sorted-compare-all.png),
  [390 다크 비교](evidence/stale/390-dark.png), [390 라이트 비교](evidence/stale/390-light.png).
  스크린샷을 실제로 열어 문구 줄바꿈과 시각 표시를 확인했다. 실행 명령:
  `E2E_PORT=5198 npx vite --config scripts/browser/vite.screen-stale-cache.config.ts --configLoader runner --host 127.0.0.1 --port 5198`,
  `PLAYWRIGHT_PATH=<installed playwright-core> E2E_PORT=5198 node scripts/browser/verify_screen_stale_cache.mjs`.
- Muse **MODEL_UNVERIFIED / UI_REVIEW_BLOCKED**: `cm-sol-muse` doctor의 models/mcp 조회가 호스트 OpenCode 로그 파일 쓰기 제한으로 실패했다.
  실제 모델/variant를 추정하거나 다른 모델로 승인 대체하지 않았다. 코드 writer는 root 단독이었다.
  [doctor 요약](evidence/stale/muse-blocked.json). 고정 commit 검수는 사용자 커밋 금지에 따라 수행하지 않았으며 파일 SHA manifest로 후보를 기록한다.
- 운영 캐시 적중률·cron 실행량·CPU·브라우저 end-to-end 및 실제 Kakao/실세션 확인은 **NOT_RUN**.
  따라서 로컬 구현/검증 완료이며 Muse·운영 검수까지 완료한 release-ready 판정은 아니다.


## 후속 비교 표시 수정 · 최종 검증 (2026-10-12)

request_mode=implementation+review. 선행 미커밋 변경 위에서 root 단독 writer로 서버·계약·UI·공유 CSS·시험·문서를 순차 수정했다.
Muse와 동시 파일 쓰기는 없었다. 사용자 커밋 금지에 따라 HEAD `a4ef064` + `evidence/stale-fix/candidate-sha256.json`을 검수 후보로 기록한다.

- 서버 `screenSnapshots.ts`는 비교값을 지우지 않고 시각 정보와 `shared=null`만 붙인다. 요약 및 지역/기관/담당자 차이를 보존한다.
- `src/data/personal.ts`의 share 상한 100을 제거했다. 건수 비중·장소 비중·금액 비중은 100%를 넘을 수 있다.
  각 측의 수용률 등은 여전히 0~100, 차이는 −100~100%p로 검증한다. 음수 비중과 비정상 수치는 거부한다.
- KPI/상세 비교에 양측 시각을 표시하고, 같은 시각은 한 번만 표시한다. 100% 초과 비중 셀의 `최근 업로드 반영 차이` 주석과
  `shared=null`의 장소 문구 생략을 반영했다. 모바일 상세 표가 문서를 넘어가던 문제를 표 내부 가로 스크롤로 수정했다.
- 요청 문서 3개와 제품 결정·acceptance를 동기화했다. 이번 후속 작업에는 SQL 변경이나 추가 migration이 없다.

실행 결과(이번 수정 기준):

| 검사 | 결과 | 증거 |
|---|---|---|
| 전체 `npx vitest run --configLoader runner` | 68 files / 819 passed, 195 opt-in skipped | [vitest.log](evidence/stale-fix/vitest.log) |
| 최종 UI 수정 후 `screenStale.test.tsx` | 13 passed. 혼합 시점 값 보존, 0분모, 99/100/125% 주석 경계, 5개 share 필드 스키마, 시각 병기/중복 제거 | [focused.log](evidence/stale-fix/focused.log) |
| `SCREEN_CACHE_STACK=1 … tests/integration/screen-stale-cache.test.ts` | 7 passed. 실제 로컬 PostgreSQL, rollback, 혼합 시점 실제 차이 계산 회귀 | [postgres.log](evidence/stale-fix/postgres.log) |
| `npx tsc -b` | PASS | [tsc.log](evidence/stale-fix/tsc.log) |
| `npm run build -- --configLoader runner` | PASS. 기존 chunk-size/dynamic-import 경고 유지 | [build.log](evidence/stale-fix/build.log) |
| `deno check supabase/functions/my-analytics/index.ts` | PASS | [deno.log](evidence/stale-fix/deno.log) |
| `python3 scripts/scan_public_dist.py --dir dist` | PASS, issues 0 | [scan.json](evidence/stale-fix/scan.json) |
| Chrome 로컬 데모 | 390/1440/1920/2560 × dark/light, 비교 켜기·상세 펼치기·정렬·기간 변경, 전체 화면 가로 넘침 없음, console error 0, screen 응답 모두 200 | [results.json](evidence/stale-fix/results.json) |

브라우저는 기존 로컬 SQL 합성 자료 export + 실제 screen handler + 모의 로그인/모의 Kakao로 검사했다. 운영 검증이 아니다.
별도 390px 양 테마 case는 브라우저 route에서 내 신고 건수와 비중을 합성 200%로 바꿔 클라이언트 스키마·원값·주석을 확인했다.
[다크 200%](evidence/stale-fix/390-dark-over-share.png), [라이트 200%](evidence/stale-fix/390-light-over-share.png)를 실제로 열어 확인했다.
재현: 기존 `/tmp/cm-stale-browser-{year,all}.json` 합성 export를 사용해 아래 명령을 실행한다.

```bash
E2E_PORT=5198 npx vite --config scripts/browser/vite.screen-stale-cache.config.ts --configLoader runner --host 127.0.0.1 --port 5198
PLAYWRIGHT_PATH=/tmp/cm-cache-playwright/node_modules/playwright-core E2E_PORT=5198 node scripts/browser/verify_screen_stale_cache.mjs
```

Muse는 doctor를 다시 실행했으나 OpenCode의 호스트 로그 파일 접근 오류로 models/mcp 조회가 실패했다.
`MODEL_UNVERIFIED / UI_REVIEW_BLOCKED`이며 직접 수행한 Chrome 검사를 Muse 승인으로 기록하지 않는다.
근거: [doctor 요약](evidence/stale-fix/muse-blocked.json). 운영 실세션/실제 Kakao 검증은 NOT_RUN.

배포 절차는 위 절차 그대로: Opus rollback SQL 검증 → 기존 준비 migration `202610121400` → 수정된 `my-analytics` Edge → Pages.
이번 후속 수정으로 추가 SQL은 필요하지 않다. 이미 stale migration을 적용했다면 Edge와 Pages만 갱신한다.
커밋·push·운영 DB 접속/쓰기·배포는 실행하지 않았다.
