> r2 당시 기록. 현재 원인·수정·판정은 [r3 REPORT](REPORT.md)가 대체한다.

# 화면 스냅샷 지연 r2 — 내부 전송 개선, 운영 근본 원인 미확정

2026-10-06, 기준 `3731126`, 브랜치 `fix/screen-snapshot-timeout`, 지정 worktree만 수정했다.
**로컬 SQL·전송 비용은 개선했으나 운영 73.4초 장애를 근본 해결했다고 판정할 수 없다.**
운영 DB/Edge/Pages 접근, push, 배포는 하지 않았다. r1의 sandbox 실패 기록은 `evidence/`에 보존하고,
이번 실행 결과는 `evidence/r2/`에 분리했다. 이번 세션에서는 Docker·로컬 DB·브라우저를 사용할 수 있었으나 git metadata는 여전히 읽기 전용이었다.

## 원인과 실행 계획

사용자 제공 운영 실측은 wrapper 73.4초 / 17,086,774자, direct 26.8초 / 13,035 facts / 17,312,521자다.
이번 세션에서 운영 측정을 반복하거나 운영 계획을 얻지 않았다. 문자열 길이는 UTF-8 바이트와 다르다.

로컬 PostgreSQL 17.6에서 기준 SQL `060100`–`060600`을 적용한 뒤 30,000행을 시드했다.
동의 정책·철회·정지·공동 기여·누락 날짜/좌표를 포함하며, current+previous 창에 27,332 facts가 반환된다.
계측하지 않은 6회 반복(auto) 및 별도 `EXPLAIN (ANALYZE, BUFFERS)` + nested auto_explain을 실행했다.
한 사용자에게 30,000행을 집중한 분포에서도 force_generic_plan 2회씩 검사했다(29,284 facts 반환).

- **직접 호출:** 기준 계획의 `ranked` 출력은 586.600ms, 최상위 JSON Aggregate는 1,698.629ms다.
  행마다 34개 필드 이름을 붙이는 JSON 생성 단계의 추가 비용이 약 1.11초다. 대표 선출의 hash join,
  WindowAgg, 두 external merge 정렬도 남아 있다. 정렬의 임시 디스크 사용을 숨기거나 work_mem을 올리지 않았다.
- **래퍼:** nested cohort 1,715.422ms, state 28.632ms, wrapper 호출 2,291.708ms(계측 포함)였다.
  대형 JSON 포장/복사 비용이 추가되지만 운영의 약 2.7배 차이는 재현되지 않았다.
- **generic 가설:** 집중 분포 및 강제 generic 계획에서도 기존 `enable_nestloop=off`가 유지되고
  선출 조인은 hash join이다. 이번 기준 SQL에서 quadratic 중첩 루프 회귀는 확인하지 못했다.
- **수정 후:** compact 경로의 ranked 561.206ms, Aggregate 1,035.463ms로 JSON 생성 단계의 추가 비용은 약 0.47초다.
  입력·대표 선출·필터는 그대로이고 최종 표현만 바꿨다. 이것은 로컬 전송 비용에 관한 인과 증거이며
  운영의 27초/73초 원인을 확정하는 증거가 아니다.

계획 원문: [기준](evidence/r2/before-30000-auto-plans.txt), [수정](evidence/r2/after-30000-auto-plans.txt),
[집중 분포 generic](evidence/r2/before-30000-force_generic_plan-concentrated-plans.txt).
외부 EXPLAIN은 같은 stem의 `.txt`에, nested 노드는 `-plans.txt`에 있다. 실측 표는 계측을 끈 호출만 쓴다.

## 변경 파일과 계약

- `supabase/migrations/202610060700_screen_fact_transport.sql`: 새 forward migration.
  `private.analytics_cohort_payload`로 기존 선출/집계 구현을 공유한다. 기존 `internal_analytics_cohort_facts`는
  같은 ordered object array를 반환한다. 화면 RPC가 명시적으로 요청할 때만 `{encoding:'columns-v1',columns,rows}`로 반환한다.
  반복 필드명만 제거하며 모든 값·null·순서·이전기간을 보존한다. SQL timeout/인덱스/전역 GUC는 바꾸지 않았다.
- `server/screenFacts.ts`, `server/screenHandler.ts`: 내부 응답을 고정 필드 객체로 복원하고 기존 집계기에 전달한다.
  알 수 없는 encoding/열 순서/행 길이는 거절한다. 구 SQL object array도 읽으므로 SQL/Edge 순차 반영과 롤백이 호환된다.
- `docs/integration/community-ingest/migration-manifest.json`: migration 해시/의존성과 my-analytics 공유 파일 등록.
- `src/data/requestDeadline.ts`, `src/data/client.ts`, `src/data/refreshController.ts`: r1의 20초 read deadline,
  오류 코드/HTTP 표시, timeout 자동 재시도 금지를 유지했다. 로컬 정상 구성 요소의 합은 약 2.35초지만,
  운영 속도 보장은 없으므로 20초는 사용자 대기 상한이다. 서버 쿼리 취소를 보장하지 않는다.
- `scripts/benchmark/screen_snapshot_timeout.py`: rollback-only 기준/수정/분포/계획/전체 ordered JSON 동등 비교.
- `tests/integration/screen-transport.test.ts`, `screen-handler-measure.test.ts`: 실제 SQL encoding/권한/게이트,
  현재 기준과 48개 날짜·필터·동률 조합, SQL 응답을 읽은 전체 화면 패리티/성능 검사.
- `tests/product/{analyticsDeadline,accessClient,refreshController,screenSnapshot,screenTimeoutMeasure}.test.ts`:
  클라이언트 취소·오류·재시도 및 신/구 전송 형식·공개 DTO·3만 건 검증.
- `scripts/browser/verify_screen_timeout.mjs`, `vite.e2e.config.ts`: 실제 화면 RPC에 맞춰 로컬 harness를 연결하고
  기존 누락된 10건 gate fixture를 보완했다. timeout·수동 복구·반응형 UI 검사를 재현한다.
- `docs/data-contract.md`, 이 폴더의 REPORT/MIGRATION/REPRODUCE와 evidence를 갱신했다.

단일 STABLE RPC의 statement snapshot, state/viewer/facts 일치, rate limit, 10건 gate,
COHORT_POLICY_VERSION, 원번호 집계 후 마스킹, 동의별 공개, 공개 DTO는 유지한다.
서버 메모리에 원시 facts는 여전히 남는다. SQL rollup으로 전체 화면 집계를 재작성하거나 별도 SQL 결과를 합치지 않았다.

## 수정 전/후 실측

합성 30,000행 / 반환 27,332 facts. SQL은 6회 중앙값, Node handler는 3회 중앙값이다.
DB→Edge bytes는 실제 SQL 결과의 UTF-8 크기이며 네트워크 압축 전이다.

| 항목 | 전 | 후 |
|---|---:|---:|
| direct cohort SQL | 1,738.73ms | 1,807.78ms |
| wrapper, viewer 없음 | 1,999.50ms | 1,225.15ms |
| wrapper, viewer 포함 | 2,010.26ms | 1,237.44ms |
| viewer wrapper min–max | 1,962.83–2,190.70ms | 1,205.08–1,265.08ms |
| 내부 source bytes | 34,280,694 | 18,811,397 (**45.1% 감소**) |
| JSON.parse 1회 | 224.97ms | 71.01ms |
| compact 복원 1회 | 해당 없음 | 9.13ms |
| Node screen handler(복원 포함, DB 제외) | 1,049.01ms | 1,042.98ms |
| 브라우저용 화면 packet bytes | 99,494 | 99,494 |
| 전체 screen packet deep equality | 기준 | PASS |

기존 direct 호출은 최적화 목표가 아니며 중앙값이 약 4% 늘었다. 모든 경로가 빨라졌다고 주장하지 않는다.
SQL+parse+handler 중앙값/1회 값의 산술 합은 약 **3.28초 → 2.35초**지만 **실제 HTTP 첫 화면 실측은 아니다**.
네트워크·실제 인증·hosted Edge 제한은 포함하지 않는다. handler의 절대 CPU 시간도 hosted Edge 예산과 동일시하지 않는다.
[SQL 전](evidence/r2/before-30000-auto.json), [SQL 후](evidence/r2/after-30000-auto.json),
[실제 SQL source의 Node 재생](evidence/r2/sql-source-handler.json).

집중 분포 + 강제 generic(각 2회)에서 viewer wrapper 중앙값은 **2,241.84 → 1,463.40ms**,
payload는 **36,529,279 → 19,955,150 bytes**다. 수정 후 최대 1,528.46ms.
총 48개 timed sample 모두 성공, SQLSTATE 00000, ordered fact equality true.
이는 두 합성 분포의 로컬 검증이며 운영 분포·부하·p95 재현이 아니다.

## 검사 결과

- 전체 Vitest: **654 PASS / 127 SKIP / 0 FAIL**. 선택적 DB/대규모 검사는 이 기본 실행에서 skip되므로 아래처럼 따로 실행했다.
- 실제 DB `cohort-timeout` + `screen-transport`: 최종 **9 PASS**. 현재 기준 대비 48조합, legacy/compact 양 계획,
  불량 session·1–9건·동의 철회, 권한·STABLE·100,000행 예산/초과를 포함한다.
- 실제 SQL source Node replay + screen 단위: **11 PASS**(replay 1 + 단위 10), 전체 packet equality 및 4 strict DTO schema.
- 별도 r1 합성 30k Node 측정: **1 PASS**. 실제 DB 검사와 구분한다.
- TypeScript/Vite build PASS, dist scan PASS(issues 0). 기존 큰 chunk/dynamic-import 경고는 남아 있다.
- Python blueprint **27 PASS**, product **12 PASS**. product의 snapshot export는 skipped이며 export 성공으로 세지 않는다.
- compose manifest: **49 migrations / 7 functions PASS**.
- 실제 Chrome/Playwright: 390·1440·1920·2560px, 로컬 HTTP + 합성 인증/SDK.
  모바일 20.38초 timeout, 자동 재시도 없음, 수동 복구, 이전 화면 보존 안내, 가로 넘침 없음, console 오류 0.
  [브라우저 결과](evidence/r2/browser/results.json) 및 screenshots. 모바일 오류/복구 이미지를 실제로 열어 확인했다.

**발견한 기존 불안정 테스트도 보존한다.** 중간 실행에서 기존 `cohort-timeout`의 완전 동률 device 복제 fixture가
과거 `010100`과 `060100`의 ordered-array 비교에서 1회 실패했다. 독립 진단에서는 네 위치의 `fact_identity`
순서만 다르고, **060100과 이번 후보는 완전히 같았다**. 최종 원본 테스트 실행은 5/5 통과했으나
동률의 미정렬 순서에 의존한 기존 불안정성을 해결했다고 주장하지 않는다.
기존 테스트/기대값은 수정하지 않았다. [진단](evidence/r2/tie-diagnosis.json).
첫 handler 재생 실패는 places fixture에 필수 view_bbox를 빠뜨린 문제였으며 유효 인자를 넣어 재검증했다.

## 로컬 복구와 남은 BLOCKED

비공개 전체 DB 백업을 ignored `.agent-runtime/screen-r2/`에 보관했다.
모든 SQL 변경/시드는 BEGIN/ROLLBACK 안에서 실행했고 원래 schema/data/sequence를 전체 pg_dump로 비교했다.
psql 무작위 restrict nonce만 제외한 두 dump의 SHA-256이 같다.
[원복 확인](evidence/r2/local-restoration.json). migration ledger도 변경하지 않았고 컨테이너/볼륨을 중단·삭제하지 않았다.
직접 실행한 브라우저/Vite만 종료했다.

1. **운영 원인 BLOCKED:** 운영 실제 설치 함수/proconfig/플랜·자원·동시 부하·PostgREST 타임아웃·hosted Edge 종료 사유가 없다.
   현재 기준 로컬 계획에서 운영의 27초/73초는 재현되지 않았다. 이미 확보한 자료 경로를 요청했으며 새 운영 접근은 하지 않았다.
2. **첫 화면 목표:** 로컬 SQL+Node 구성 요소는 수 초 범위지만 실제 PostgREST→Deno/hosted Edge→모바일 전체 지연은 NOT_RUN.
   본 후보는 18.8MB raw facts가 여전히 필요하며 이 변경만으로 모든 운영 조건을 해결할 보장은 없다.
3. concurrent 실제 ingest snapshot probe, 실제 Kakao SDK, 독립 Muse 검수는 이번 r2에서 NOT_RUN.
   SQL volatility/권한/전송/수치 검증과 합성 브라우저 검사를 이를 대신한 승인으로 취급하지 않는다.
4. 운영 배포는 수행하지 않았다. [MIGRATION](MIGRATION.md)의 SQL → Edge → Pages 및 롤백을 검토해야 하며,
   운영 장애 해결 완료 릴리스로 판정하려면 1·2번의 증거가 추가로 필요하다.

## 커밋 BLOCKED

검증 후 요청 파일을 명시하여 `git add`와 conventional commit을 시도했지만 둘 다 exit 128이었다.
`/home/better0101/projects/safetyreport-community-map/.git/worktrees/safetyreport-community-map-screen-timeout/index.lock`:
`Read-only file system`. `findmnt`에서도 실제 metadata 디렉터리가 `ro` 마운트임을 확인했다.
사용자가 의도한 git 권한 해제와 현재 실행 환경이 다르다. 호스트 마운트·gitdir를 바꾸거나 Docker로 우회하지 않았다.
권한이 열린 환경으로 전환을 요청했으며, 신규 commit SHA는 없다. 기준 HEAD는 `3731126`이다.
수정·evidence는 같은 worktree에 모두 남아 있다. 기존 untracked `node_modules` symlink는 수정/stage하지 않았다.
권장 commit: `fix(analytics): compact screen snapshots and bound client reads`.
[실패 증거](evidence/r2/git-commit-blocked.json).
