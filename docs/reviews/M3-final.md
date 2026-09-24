# M3-F · targeted final browser re-review (fixed commit)

- request_mode: review / policy_version: cm-2026-09-24
- 실제 model/provider: 호스트 `opencode` 세션 구독 모델, providerID=`opencode-go`,
  model.id=`muse-spark-1.3-contributor` (호스트 프로세스 인자 `--model opencode-go/muse-spark-1.3-contributor` 실측. 추정 ID 박아넣지 않음)
- worktree: `/home/better0101/projects/safetyreport-community-map-review-final`
  / branch: `feat/community-map-m3-final`
  / checked commit: `56c7a3ad15356d6e9e4e52618c36275e7e9f2d39` (고정, 제품 변경 없음)
  / first-M3 commit: `d05033469ca30480718b6345c8ff05f50b3a0810`, 제품 변경분: `c4c3cd5` + `7dabd20`
  / dirty (검수 시작 시): clean. 소유 범위 외 수정 없음
- 일시: 2026-09-24 (UTC) / dev URL: `http://127.0.0.1:4180/` (`vite --port 4180`, `VITE_DATA_MODE=demo`)
  / data_mode: demo synthetic (`dataset_version: synthetic-2026-09-24` 실측)
  / subpath URL: `http://127.0.0.1:4181/safetyreport-community-map/` (로컬 정적 호스팅, 아래 §4)
- browser/tool: Google Chrome `154.0.8037.57` (`google-chrome --version` 실측)
  / playwright-core `1.63.0` (격리 설치 `/tmp/opencode/m0/node_modules`, 레포 의존성 무수정)
- 스크립트: `.agent-runtime/m3f-review.cjs` (19 checks) + `.agent-runtime/m3f-subpath.cjs`
  (모두 git-ignored 임시 스크립트. 결과: `.agent-runtime/m3f-results.json`)
- 소유 범위 준수: `docs/reviews/M3-final.md` + `docs/reviews/screenshots/m3-final/**`만 신규 작성.
  제품 소스·spec·workflow·package/lock·첫 M3 보고서(`M3-integration.md`) 미수정.
  `npm run build`는 읽기 전용 검증으로 1회 실행 (`dist/`는 gitignored, commit 없음).

## 1. 레이아웃 (실측·육안 열람, 전량 PASS)

| viewport | theme | KPI | overflowX | console err | 4xx/5xx | screenshot |
|---|---|---|---|---|---|---|
| 1920×1080 | dark | 6 | 0px | 0 | 0 | `screenshots/m3-final/m3f-1920-dark.png` |
| 390×844 | light | 6(2열) | 0px | 0 | 0 | `screenshots/m3-final/m3f-390-light.png` |
| 1440×900 | dark | 6 | 0px | 0 | 0 | `screenshots/m3-final/m3f-1440-dark.png` |
| 2560×1440 | light | 6 | 0px | 0 | 0 | `screenshots/m3-final/m3f-2560-light.png` |

육안: 1920 dark 데이터 상황판 전체 계층(TopBar 합성 배지·KPI 6·지도 대체+지점 목록·인사이트·하단 카드) 정상,
첫 M3 대비 회귀 없음. 390 light는 KPI 2열·command 줄바꿈·bottom nav, 문서 가로스크롤 0.
회귀가 없어 1440/2560은 축소 재확인(스크립트 실측+스크린샷 저장)만 수행, 이상 없음.

## 2. 히스토리·엔티티 (dev 서버 실측, 전량 PASS — M3-D1 해소 확인)

| # | 동작 | 결과 | 증거 |
|---|---|---|---|
| H1 | 분류 `교통위반` 적용 1회 → `history.length` 2→3 (정확히 +1) | PASS | URL `?start=2025-09-25&end=2026-09-24&category=traffic` 실측 |
| H2 | Back 1회 → base URL/scope 복원 (`category=traffic` 제거) | PASS | `m3f-history-category.png` + URL 실측 |
| H3 | Forward 1회 → 선택 분류 URL 복원 | PASS | URL 실측 |
| H4 | 기관 행 적용 → URL `agency_key=a1` 단독 (manager_key 없음) | PASS | `m3f-entity-agency.png` |
| H5 | Back 1회 → 이전 scope 복원 (`agency_key` 제거) | PASS | URL 실측 |
| H6 | 담당자 행(김하늘·예시 서울 기관) 적용 → URL `agency_key=a1&manager_key=m1` 독립 필드, `history.length` 2→3, 표시용 `key=` 파라미터 없음 | PASS | `m3f-entity-manager.png` (배너+토스트 포함) |
| H7 | Back 1회 → `manager_key` 제거, Forward → 양 키 복원 (격리 재측 `dbg2`: 2→3·back→base·fwd→manager URL) | PASS | URL 실측 |

M3-D1 판정: **FIXED**. 원인 패치(`c4c3cd5`, `pushUrl`을 `setScope` updater 밖으로 이동)가
dev 서버에서 의도대로 동작. 정적 demo 빌드(§4)에서도 apply +1·Back 1회 복원 재확인.

## 3. fixture·오류 상태 (dev 서버 실측, 전량 PASS)

| # | 조건 | 결과 | screenshot |
|---|---|---|---|
| F1 | `?fixture=empty` → `결과가 없습니다`+초기화 CTA, KPI `0건`, 수용비중 `분모 0건 · 비율 없음` | PASS | `m3f-fixture-empty.png` |
| F2 | `?category=traffic` → 전 KPI `집계 미지원`, 처리결과 카드 `선택 범위의 처리결과 집계가 제공되지 않습니다`, fabricated outcome 0 없음 | PASS | `m3f-category-traffic.png` |
| F3 | `?fixture=one` → `표본 1건` 배지, KPI `1건`, 지점 1·표 행 유지 | PASS | `m3f-fixture-one.png` |
| F4 | `?fixture=offline` → `네트워크 연결을 확인한 뒤 다시 시도해 주세요` + 재시도, demo 대체 없음 | PASS | `m3f-fixture-offline.png` |
| F5 | `?fixture=rate` → `요청이 많아 잠시 후 다시 시도해 주세요 (60초 후 다시 시도)` retry-after 60, demo 대체 없음 | PASS | `m3f-fixture-rate.png` |
| F6 | `?fixture=stale` → `데이터 버전이 변경됐습니다. 다시 조회해 주세요`, demo 대체 없음 | PASS | `m3f-fixture-stale.png` |

세 오류 뷰는 메시지·재시도 버튼이 서로 구분되고, KPI 월이 통째로 사라진 순수 오류 화면(자동 demo fallback 없음)임을 육안 확인.

## 4. demo 서브패스 빌드 (로컬 증거 — 실제 Pages 배포 아님, PASS)

- `VITE_BASE_PATH=/safetyreport-community-map/ VITE_DATA_MODE=demo npm run build` 성공.
  산출물 `index.html`의 js/css/icon 경로가 `/safetyreport-community-map/assets/*` prefix 실측.
- `dist/`를 `/tmp/opencode/m3f-subpath/safetyreport-community-map/`에 복사 후
  `python3 -m http.server 4181` 로 루트 호스팅. curl 실측:
  `app 200`, `index-*.js 200 text/javascript`, `index-*.css 200 text/css`,
  `family-mark-*.png 200 image/png` (favicon 실 이미지 응답).
- 브라우저 실측: 부팅 KPI 6·overflow 0·cerr 0·4xx 0, `?fixture=one` 로드+reload 유지,
  분류 적용 `history.length` 4→5·Back 1회 복원. screenshots:
  `m3f-subpath-boot.png` / `m3f-subpath-one.png` / `m3f-subpath-back.png`
  (dev 1920 dark와 동일 렌더임을 육안 확인).
- 실제 GitHub Pages 배포 smoke는 미승인·미실행이므로 **live smoke는 BLOCKED**. 서버 프로세스는 검수 후 종료.

## 5. 매니저·지점·처리결과 회귀 (첫 M3 대비, PASS)

- 지점 선택: `서울특별시 중구 예시 지점` 선택 시 인사이트 `선택 지점`, 신고 5건/75.0% vs 전체 9건/83.3%
  (선택≠전체 분리 유지, 첫 M3 I8 수치와 동일). exact 좌표 `37.566535, 126.977969` 표시.
  `m3f-point-selected.png`.
- 마스킹 충돌: `1*가*4*6` 계열 6건 렌더(독립 행, 합산 없음). `—%` 문자열 0건(미지원은 `—`+사유).
- 합성 고지: TopBar `demo · 합성 데이터`, 인사이트 `합성 예시 · demo`, 푸터 표본 고지 실측.
- 노출 검사: DOM·URL에서 미마스킹 번호 패턴·`service_role`·`eyJh`·`vehicle_hash`·계정 이메일 0건.
  공유/북마크 URL은 start/end/category/region_code/agency_key/manager_key/bbox/fixture만 포함.

## 6. 관찰 1건 (결함 아님 — Sol triage용)

| id | severity | 재현 | expected 후보 | actual | evidence |
|---|---|---|---|---|---|
| M3F-O1 | 관찰 (낮음) | base scope에서 기관 행 적용 → `?agency_key=a1` (demo 미지원 범위) | 테이블 빈 상태 문구가 scope 미지원 취지였으면 더 명확 | 기관·담당자 표에 `조건에 맞는 기관·담당자가 없습니다. 검색어·필터를 확인해 주세요` 표시. 단 scope 배너(`선택 범위의 합성 집계가 준비되지 않았습니다`)+`전국으로 초기화` CTA+토스트는 함께 표시됨 | `m3f-entity-manager.png`, `m3f-entity-agency.png` |

demo fixture가 기본 범위 집계만 지원하는 설계상(`src/data/demo.ts` `supported` 조건) 일관된 동작이며,
배너·토스트·초기화 CTA가 함께 제공되므로 출시 차단은 아니라고 본다. 문구 조정 여부는 Sol 판단.
제품 파일은 검수 worktree에서 수정하지 않았음.

## 7. console·network

- dev 매트릭스+상호작용 전체(19 checks): console error 0, pageerror 0, 4xx/5xx 0.
- subpath 정적 호스팅: console error 0, 4xx/5xx 0.
- 판정은 프로세스 exit이 아니라 위 실측값 기반.

## 8. 최종 판정

- M3-D1 (dev history +2): **FIXED** — dev·정적 빌드 모두 apply +1·Back 1회 복원 실측.
- UI01/02/04/05/06/07 (fixture 범위): PASS. UI03 실제 Kakao SDK: **BLOCKED** (키 없음.
  실패 카드+재시도+지점 목록 대체·`window.kakao` 미삽입은 첫 M3에서 확인, 본 재검수에서 대체 카드 육안 재확인).
- UI08 키보드/aria-sort: 첫 M3 범위 유지, 본 재검수 NOT_RUN. REL01: 로컬 서브패스 PASS,
  **실제 Pages live smoke는 BLOCKED**. REL02 (실패 시 demo 자동전환 없음): PASS.
  live 공개 API·운영 DB 관련: NOT_RUN/BLOCKED.
- NOT_RUN: 스크린리더 전체 탐색, reduced-motion 실측, 10k perf, aggregate 저줌 노드 시각 확인,
  390 drawer/브리핑 재측(첫 M3에서 PASS, 본 targeted 재검수 범위 밖).

## 부록 · 재현 정보

- `git rev-parse HEAD`: `56c7a3ad15356d6e9e4e52618c36275e7e9f2d39`.
- `git status` (보고서 작성 시점): `?? docs/reviews/M3-final.md`, `?? docs/reviews/screenshots/m3-final/` 외 clean.
- 총 19 checks PASS 19 FAIL 0 + subpath 6/6 PASS. screenshots 17개(위 표 경로).
