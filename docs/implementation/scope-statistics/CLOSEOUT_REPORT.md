# scope-statistics closeout 보고 (C01–C08)

- **지시서:** `CLOSEOUT_PROMPT.md`
- **시작 커밋:** `39552e3`(브랜치 `claude/gallant-darwin-7ldkbl`, main `67e35c6`보다 앞섬). 시작 시 미커밋 변경은 없었다.
- **검증 주체:** 이 세션의 Claude(Opus) 혼자 구현·검수했다. 외부 모델의 독립 검수는 없다.
- **환경 구분:**
  - **browser-mock** = 로컬 Vite + 실제 핸들러 코드 + 합성 자료 + MOCK 카카오 SDK
  - **sql-local** = 로컬 Supabase의 실제 migration 체인(Docker)
  - **실제 SDK·운영** = 미실행(BLOCKED)

## 검사 요약

| 검사 | 결과 |
|---|---|
| `npm test` | 441 passed / 41 skipped. skip은 Docker 전용이며 아래 C04 참고 |
| 신규 테스트 | `viewerBoundary`, `compareHeatmap`, statistics C05 3건, scrollspy, controller 단계 |
| `npm run build` | 통과 |
| `npm run scan` | `passed: true` |
| dist 확인 | `__chart` hook 없음 |
| assertion 브라우저 실행 | `closeout-evidence/local-mock/runs/<run_id>.json` — **60개 ID 모두 PASS, exit 0**. run_id·commit은 파일에 기록 |
| 자가 검증 | `SELFTEST_WRONG='MT-01:default rate series'`로 기대값 하나를 뒤집으면 **exit 1**(MT-01 FAIL) |
| 이전 코드 재현 | `39552e3` worktree에서 **C01 3건 FAIL**, C02 히트맵 `all`만 그림 → `closeout-evidence/before-39552e3/` |
| 기존 관찰 스크립트 회귀 | `verify_redesign` P04·R10, `verify_followup` R7 — 관찰값 일치. 이 스크립트들은 판정 스크립트가 아니다 |

## C01–C08

| 항목 | 수정 파일 | 재현 전 결과 | 수정 후 assertion | 환경 | 증거 | 운영 적용 여부 | 남은 항목 |
|---|---|---|---|---|---|---|---|
| **C01** 계정 구분 | `auth/mapAuth.ts`(`viewerId`, `viewerKey`, `sessionKeyOf`), `pages/Dashboard.tsx`, `hooks/usePersonal.ts`, `data/refreshController.ts`, `pages/StatisticsPage.tsx`, `state/statistics.ts`, 테스트 fixture 3개 | 같은 닉네임의 A→B(다른 탭 로그인)에서 세 가지가 재현됐다. ① A의 늦은 내 신고 응답(12건)이 B 화면에 남음 ② B가 A의 맞춤 통계 초안(시도 행)을 받음 ③ 같은 계정의 닉네임만 바뀌어도 초기화·재조회 발생 | C01-AB: B 화면 = B 토큰으로 직접 조회한 값, 로딩 잔존 없음. C01-RESTORE: B에게 A의 초안 없음(새로고침 후 포함). C01-NICK: 닉네임 변경 시 요청 0. 단위: 키가 닉네임과 무관, 늦게 온 A의 meta 무시 | browser-mock (BroadcastChannel로 다른 탭 로그인 재현), unit | `closeout-evidence/local-mock`, `before-39552e3/C01-repro.json` | 프런트 전용 변경이라 Pages 배포 필요, 서버 변경 없음 | 로그아웃 후 새로고침은 코드만(signed_out에서 session 삭제), 실제 Supabase 계정 두 개로는 미실행 |
| | | | | | | | 동의 철회는 서버 gate 기존 경로(P04 관찰 회귀). 실제 테스트 계정으로는 BLOCKED |
| | | 추가로 찾은 결함: controller가 reset 이후에 도착한 A의 meta를 내부에 캐시했다 → 수정 | | | | | |
| | | 수정 방식 | | | | | |
| | | — 닉네임 대신 auth user id의 해시를 계정 경계로 쓴다(원 id·JWT는 저장·URL·로그에 쓰지 않음) | | | | | |
| | | — 계정이 바뀌면 선택 주소, 주소 상세, refine, 이름 캐시, handoff, 범위 차트, 활동 표시를 비운다 | | | | | |
| | | — `StatisticsPage`를 계정별 key로 remount해서 이전 draft를 새 계정 소유로 저장하는 경로를 없앴다 | | | | | |
| | | — v1(닉네임 키) sessionStorage와 저장 레시피는 이관하지 않고 삭제한다. 저장 레시피는 계정별로 나눴다 | | | | | |
| **C02** 비교 히트맵 | `components/stats/PivotChart.tsx`(`HeatmapPair`/`HeatmapSide`/`heatmapCells`/`heatmapAxes`), `scope-statistics.css` | compare인데 표에는 "내 신고" 열 28개가 있고 그래프는 `heatmap:fine_rate:all` 하나만 그림 | 단위 4건: 같은 축·순서, 전체 50%(1/2) 대 내 100%(1/1), 내 신고 없는 칸은 칸 없음(0도 전체 값도 아님), 분모 0은 null, 같은 값 유지, off·mine 단독 분리 | unit, browser-mock | CH-CMP: `heatmap:fine_rate:all`과 `:mine` 두 개, 캡션 2개. `closeout-evidence/local-mock/shots/CH-compare-heatmaps.png` | Pages | 금액·건수는 두 집단 공통 0~max 척도를 쓰고 그 사실을 캡션에 적었다. 다른 분기(막대·선·누적·요약)는 이미 sides를 순회했고, 산점도는 compare에서 제외(이유 표시) |
| **C03** 판정 스크립트 | `scripts/browser/assert.mjs`(신규), `verify_scope_statistics.mjs`(재작성), `harness.mjs`(uid·DSF 옵션), `vite.e2e.config.ts`(같은 닉네임의 계정 B) | 이전 스크립트는 관찰값만 기록했다. 예외를 삼키고 exit 0으로 끝났으며, 이전 JSON에 결과를 덧붙였다 | ID별 assertion. 실패하면 exit 1, BLOCKED만 있으면 exit 2 | browser-mock | `closeout-evidence/local-mock/runs/*.json`. 이전 관찰 기록은 `evidence-legacy-observation/`로 분리 | — | 이 과정에서 테스트 자체 결함 3건을 찾아 고쳤다(측정 타이밍 2건, `<select>` 옵션 텍스트 오판 1건 — 이전 NV-10 판정이 이것 때문에 잘못 PASS였을 수 있음) |
| | | | 각 실행마다 새 run 파일에 run_id, commit, dirty 여부, 브라우저, viewport, SDK 종류, 데이터 종류를 기록한다 | | | | |
| | | | ONLY로 부분 실행하면 나머지는 NOT_RUN. step 예외는 그 step의 ID를 FAIL로 만든다 | | | | |
| | | | 예상한 콘솔 오류(주입한 429)만 허용한다. waitFor로 조건을 polling한다 | | | | |
| | | | 자가 검증: 기대값 하나를 뒤집으면 exit 1 | | | | |
| **C04** 실제 SDK·통합 | `scripts/browser/verify_real_sdk.mjs`(신규), `docs/integration/community-ingest/migration-manifest.json`(shared 목록과 202609300100 추가), **`src/domain/statistics.ts`(Deno import 확장자)** | 실제 SDK: 세션 네트워크 정책이 `dapi.kakao.com`을 거부한다(proxy CONNECT 403) | 실제 SDK 스크립트는 실제 마우스·휠·드래그·버튼·클러스터·빠른 재클릭·Esc를 쓰고 `__click`을 쓰지 않는다. 실행 결과는 **BLOCKED 11건, exit 2** | 실제 SDK: BLOCKED | `closeout-evidence/real-sdk/runs/*.json` | — | 실제 SDK 조작 검수 전체 |
| | | 로컬 통합 스택: compose 검사에서 manifest가 오래된 것을 발견했다(서버 공유 파일 4개, 지난 라운드 migration 누락) | **sql-local PASS:** migration 28개 체인 적용, 12년 facts 호출이 배열 반환, facts 함수는 anon·authenticated 거부·service_role만 허용 | sql-local | | | Docker 통합 40건(community-stack, my-analytics-stack)은 **BLOCKED**. Edge 런타임 컨테이너가 TLS 가로채기 proxy를 신뢰하지 않아 `npm:@supabase/supabase-js`를 받지 못했다(UnknownIssuer). CA를 넣어 봤지만 런타임이 시스템 저장소를 쓰지 않아 실패했다 |
| | | **배포를 막는 결함 발견:** `src/domain/statistics.ts`가 `./public`을 확장자 없이 import해서 Deno 번들이 실패한다. 즉 지난 보고의 Edge 배포 절차는 그대로는 실패했을 것이다 → 수정 | 수정 후 compose 검사 통과(28 migrations, 5 functions) | | | | 실제 SDK에는 네트워크 허용과 등록된 도메인·JS 키가 필요하다. 통합 테스트는 CA를 신뢰하는 네트워크나 proxy 없는 환경에서 다시 실행해야 한다 |
| | | | 빠른 재클릭은 blank-click 무시 창(400/300ms)의 영향을 받지 않는다. 그 창은 지도 click에만 적용되고 마커 click에는 없다(코드). 실제 SDK로는 미검증 | | | | |
| **C05** 0건과 확인 불가 구분 (MS-10) | `server/statistics.ts`, `domain/statistics.ts`, `data/statistics.ts`(Zod), `MemberPicker.tsx`, `StatisticsPage.tsx`, CSS | 선택 대상이 0건이면 모두 "현재 조건 0건"으로 보였다(정책 제외·임의 key도 마찬가지) | 상태 3단계를 서버가 판정한다. ok / zero(이번 기간·권한 데이터에는 있고 다른 조건만 제외) / unconfirmed(권한 범위 안에서 확인 불가 — 이유와 라벨은 노출하지 않음) | unit, browser-mock | unit 3건: 임의 key, 비대표 행(다른 계정), 분류 조건으로 0건, mine 모집단에서 다른 계정 key. MS-10: 저장된 key를 주입하면 "예전에 저장한 기관 (확인할 수 없음)" 표시, 제외 안내 배너, 결과는 3개 기관 유지(전체로 바뀌지 않음) | Edge + Pages | 실제 동의 철회 계정으로는 BLOCKED. 후보 조회 실패는 "확인 실패", 응답 전은 "확인 중"으로 표시(코드, 단위 없음) |
| **C06** scrollspy·확대·복원 | `pages/Dashboard.tsx`(scrollspy, 스크롤 기억·복원), `lib/navigation.ts`(`currentSection`) | scrollspy 없음(클릭 기준), 뒤로가기 시 스크롤 복원을 측정한 적 없음 | NV-SPY: 수동 스크롤로 기관·추이가 활성화되고, 통계 화면에서는 대시보드 섹션이 활성 0개. NV-10: 뒤로가기 시 스크롤 ±30px 복원, 필터 유지, 앞으로가기, 초안 유지. SC-05: 주소 패널 경로를 실제 클릭 | browser-mock | ZOOM-EMU: 125·150·200% 에뮬레이션에서 제목 가림 없음, 넘침 없음 | Pages | 브라우저 확대 자체(NV-04)는 **BLOCKED**(headless에 없음). 에뮬레이션은 같은 검사로 기록하지 않았다 |
| | | | 프로그램 이동 중에는 spy를 1.2초 멈춘다 | | | | 지도 중심·줌은 지도 인스턴스 유지로 보존된다(PG-06 2→2). 좌표값 자체는 비교하지 않았다 |
| **C07** 판정 재분류 | `REPORT.md` | PARTIAL에 미구현·미실행이 섞여 있었고, 범례·CSV·공유 링크를 선택 기능으로 묶어 두었다 | PASS / FAIL / PARTIAL / NOT_RUN / NOT_IMPLEMENTED / BLOCKED / N/A로 나누고 방식을 적었다 | — | `REPORT.md` '인수 테스트 판정' | — | **판단 요청:** 공유 링크(S08.3)는 NOT_IMPLEMENTED. 범례 토글(CH-10)은 NOT_IMPLEMENTED(읽기 전용 범례). CSV는 선택 기능이라 제외. 부분 결과 경로는 N/A(결과가 항상 complete, 한도 초과는 422) |
| **C08** 통합·배포 | — | — | DB 변경: 이번 라운드 **없음**(새 migration 없음). 이전 라운드 `202609300100`은 sql-local 체인에서 적용 확인 | — | — | **운영 미적용**(배포·머지·운영 DB 변경 안 함) | 아래 순서 참조 |

## 운영 적용 순서 (승인 필요, 실행하지 않음)

1. **DB:** 이번 라운드 변경 없음. 이전 라운드 `202609300100`은 이미 적용됨(사용자 보고).
2. **Edge:** `npx supabase functions deploy public-analytics`와 `npx supabase functions deploy my-analytics`.
   - **반드시 이번 커밋 이후에 배포한다.** 이전 커밋은 `src/domain/statistics.ts`의 확장자 없는 import 때문에 번들이 실패한다.
   - 이번 라운드에서 C05 상태가 추가되었고, 계약은 additive라 구 클라이언트와도 호환된다.
3. **Pages:** 이번 라운드의 C01·C02·C06과 프런트 쪽 C05. Edge 없이 Pages만 먼저 올려도 된다. 구 서버가 status를 보내지 않으면 ok/zero로 판단하고 확인 불가를 구분하지 못할 뿐 오류는 없다.
4. **배포 후 smoke:**
   - catalog / candidates / query
   - 전체/내 신고 compare 히트맵
   - 같은 닉네임의 다른 테스트 계정 전환
   - 지역 상세, 월별 복수 지표
   - **실제 카카오 SDK 지도 조작** — `verify_real_sdk.mjs`를 등록 도메인과 테스트 계정으로 실행
