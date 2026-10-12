# 느린 회선 첫 화면 — 로컬 구현 보고

사용자 브리프 `/home/better0101/projects/worktree/astra-fewer-trips-brief.md`, 2026-10-12.
작업트리 `map-trips`, 브랜치 `astra/fewer-trips`, 기준 HEAD `32437a88d3e2595a5864f8d03fffd9e5474a8a2a` + 미커밋 diff.
제품 파일은 이 worktree에서 한 writer가 수정했다. 커밋·push·배포·운영 DB 쓰기·호스트 설정 변경 없음.
후보 파일 해시는 [candidate.json](evidence/candidate.json). 이 보고서는 운영 성능/배포 완료를 뜻하지 않는다.

## 바뀐 동작

- 이전: 유효한 로그인 세션 확인 → meta OPTIONS/GET → screen OPTIONS/GET. 이후: 세션 확인 → screen OPTIONS/GET 1묶음.
  처음 데이터 요청은 2 GET → 1 GET, 콜드 preflight 포함 4 → 2 HTTP 요청이다. screen의 meta로 기간 한계·capability도 검증한다.
- 동일 URL 재방문: 해시 자산은 브라우저 캐시, screen preflight는 최대 600초 재사용. screen의 JSON GET은 매번 실행한다.
  URL의 scope/panels가 달라지면 새로운 preflight가 필요할 수 있다. 브라우저의 Max-Age 제한도 적용된다.
- Chromium에서 `fetch(cache:'no-store')`는 별도 CORS preflight 캐시까지 우회함을 실제 재현했다. screen 요청만 `cache:'default'`로
  바꾸고 응답의 `private, no-store, max-age=0`는 유지했다. GET 2번 모두 서버에서 받았고 OPTIONS만 2→1회가 됐다.
- 접힌 ‘그래프 더 보기’ 5개 차트의 데이터는 `screen-detail=deferred-v1` Accept 옵션에서 생략(analytics:null).
  펼치면 dashboard-analytics panel을 추가한 **전체 화면 교체 요청** 하나를 보낸다. 새 화면과 차트는 같은 버전·범위여야 한다.
  이 옵션 없는 구 웹의 응답은 그대로다. 새 웹도 구 서버가 전체 analytics를 반환하면 그 데이터를 바로 사용한다.
- 차트 코드 AnalyticsCharts도 lazy chunk로 분리했다. 기존 맞춤 통계/ECharts 분할을 유지하고, 첫 화면에서 필요한 지도는 미루지 않았다.
- 409 재시도 상한 1회, abort/generation, 계정 전환 시 메모리 초기화, 자격/10건 gate, stale-v2 비교 시각, 429/장애 cooldown 유지.
  추가 차트 대기/오류/명시 재시도를 구현했다. screen 429/503 Retry-After(60/30초)를 노출 헤더·본문으로 전달한다.

인증 경로를 확인했다. 정상 저장 세션의 `settled()`와 `accessToken()`은 supabase-js의 getSession을 사용하며 불필요한 getUser HTTP를
프런트에서 선행 호출하지 않는다. 만료 임박 세션 갱신, OAuth code 교환, 401 뒤 한 번의 refresh는 필요할 때 유지한다.
서버의 getUser·자격 검사도 생략하지 않는다. 합성 브라우저의 정상 세션에서는 auth HTTP 없이 첫 screen으로 진행했다.

## 응답과 JS 크기

운영 브리프의 ~1.8MB / gzip ~309KB는 **사용자 제공 기존 실측**이다. 이번에 운영 개인 응답을 읽지 않았으므로 운영 감소율을 추정하지 않는다.
아래는 6,000건·500기관·6,000담당자·6,000주소의 결정적 **합성 원천을 실제 handler에 통과시킨 JSON**이다.
synthetic 값이 반복되어 gzip 비율이 운영보다 좋으며, 내 신고 비교 사용 여부에 따라 감소폭이 다르다. 단위 byte, gzip은 Node 기본 압축이다.

| 응답 | 전 원문 | 후 원문 | 전 gzip | 후 gzip |
|---|---:|---:|---:|---:|
| 첫 화면, 비교 끔 | 419,680 | 109,302 | 15,185 | 4,307 |
| 첫 화면, 비교 켬 | 665,061 | 354,683 | 32,897 | 21,772 |

추가 차트 원문 310,382byte가 첫 응답에서 빠졌다. 생략 외 모든 첫 화면 필드 동등성을 검사했다. 기관/담당자/지점/개인 비교는 그대로이며,
‘그래프 더 보기’를 열면 그 데이터를 받는다. 서버 내부에서 기존 집계·dashboard projection은 여전히 계산하므로 DB CPU 절감이라고 주장하지 않는다.
실측 원본: [sizes](evidence/sizes.json), [comparison-sizes](evidence/comparison-sizes.json).

같은 로컬 공개 설정을 넣은 production entry JS: 675,113→648,298byte, gzip 199,860→191,814byte(Python gzip level 9).
별도 auth/ECharts/이미지/경계 파일은 이 entry 수치에 포함하지 않는다. [번들 해시](evidence/bundles.json).
스로틀 빌드 뒤 마지막 변경은 접힌 차트의 로컬 완료/오류 상태 초기화 1줄이며 초기 네트워크 경로는 같다. 최종 후보는 그 뒤 build/tsc/전체 Vitest/브라우저를 재검사했다.

## 느린 회선 실측

| 조건 | 변경 전 중앙값 | 변경 후 중앙값 | 단축 |
|---|---:|---:|---:|
| cold | 15.950초 | 13.938초 | 12.6% |
| warm | 8.532초 | 3.414초 | 60.0% |

최종 12개 실행 원본: [throttle.json](evidence/throttle.json). 콜드 API 요청 OPTIONS 포함 4→2; warm 4→1.


측정 도구는 Chrome 154.0.8037.92 / Playwright / CDP Network.emulateNetworkConditions.
설정: latency 1,500ms, download/upload 51,200byte/s(50KiB/s). 1440×900, before/after 각 3회 콜드 컨텍스트와 같은 컨텍스트 재방문.
실제 production build, 실제 handler가 만든 합성 응답을 gzip으로 로컬 HTTP 제공. 별도 API origin으로 OPTIONS도 실제 실행한다.
‘첫 화면’은 navigation 시작부터 첫 KPI의 aria-busy=false 값이 보일 때까지이며 지도 타일·모든 차트 완료 시간은 아니다.
실제 Kakao SDK·OAuth/갱신·운영 DB·Cloudflare 회선은 제외하고 광고 iframe도 양쪽 동일하게 차단했다.
정적 서버는 Workers의 기본 ETag/304 재검증과 신규 immutable 규칙을 재현한다. 응답 JSON은 양쪽 no-store다.
Chrome request cache 수정 전 중간 측정과 진단 중 추가 브라우저가 끼어 assertion에 실패한 실행은 최종 표에 넣지 않았다.

## 검증과 브라우저 증거

- 전체 Vitest: 69 files / 834 tests PASS, 33 files / 195 tests SKIP(환경 의존 통합 검사). 최종 UI·request cache 수정 뒤 전체 834 tests 재통과. 인증/새 계약 관련 26 tests 별도 통과.
- Python blueprint 27 / product 12 tests PASS. tsc -b, production build, deno check my-analytics, scan_public_dist PASS. [검사 로그](evidence/vitest-full.txt), [후속 검사](evidence/vitest-targeted-final.txt), [Deno](evidence/deno.txt).
- 실제 로컬 handler + 합성 원천 + fake auth + mock Kakao: 390/1440/1920/2560 × light/dark 8조합 PASS.
  meta 0 / 첫 screen 1, 최초 추가 차트 미조회, 펼친 뒤 같은 버전의 차트, 접기→범위 변경→펼치기, 비교 토글, 법규 탭, 추가 차트 오류→명시 재시도,
  문서 가로 overflow 없음, console/pageerror 0. [행동 기록](evidence/browser.json).
- 별도 demo mode: 390/1440 × light/dark, 내 비교·추가 차트·기관표, API HTTP 0, 오류/overflow 없음. [기록](evidence/demo.json).
- screenshot을 실제 열어 배치·가독성과 차트 표시를 확인했다. mock 지도와 키 없는 demo fallback을 실제 Kakao 연동 성공으로 분류하지 않는다.
  [390 dark](evidence/browser-390-dark.png), [390 light](evidence/browser-390-light.png), [1440 dark 차트](evidence/browser-1440-dark-charts.png),
  [demo dark](evidence/demo-390-dark.png), [demo light](evidence/demo-390-light.png).
- Wrangler 4.149.0 `dev --local`: _headers 1개 규칙 parse, 자산 1년 immutable; `/`, `/index.html`, `/deep/link`는 max-age=0,must-revalidate 및 ETag. [실제 헤더와 CORS 실험](evidence/headers.json).
- Muse: `opencode models` / `opencode mcp list`가 `/home/better0101/.local/share/opencode/log/opencode.log` 열기에서 파일시스템 제한으로 실패.
  run --help만 확인. 모델/provider/contributor variant 미확인, 호출하지 않았고 다른 모델로 대체하지 않았다.
  **MODEL_UNVERIFIED / 독립 Muse UI_REVIEW_BLOCKED**. 커밋 금지여서 미커밋 diff/hash로 본인 Chrome 검수 대상을 고정했다.
- 운영 로그인 응답 재측정·실카카오·호스팅된 Edge·DB 통합·독립 Muse 검수는 미실행이며 출시 최종 승인을 뜻하지 않는다.

## 재현

```bash
# 최초 기준본: 신규 커밋 없이 현재 저장소의 시작 HEAD를 ignored 폴더에 추출한다.
mkdir -p .agent-runtime/fewer-trips/baseline
git archive 32437a88d3e2595a5864f8d03fffd9e5474a8a2a | tar -x -C .agent-runtime/fewer-trips/baseline
ln -s ../../../node_modules .agent-runtime/fewer-trips/baseline/node_modules
npx vitest run tests/product/fewerTrips.test.ts
# playwright 또는 PLAYWRIGHT_PATH가 필요. Chrome 경로 /usr/bin/google-chrome.
PLAYWRIGHT_PATH=/tmp/cm-cache-playwright/node_modules/playwright-core node scripts/browser/measure_fewer_trips.mjs
# 위 스크립트는 합성 로컬 설정으로 before/after production build를 만들고 5220~5222 포트를 사용한다.
# 배포용 빌드는 이후 실제 공개 VITE 환경값으로 별도 생성해야 한다.

E2E_PORT=5218 npx vite --config scripts/browser/vite.e2e.config.ts
# 별도 셸
E2E_PORT=5218 PLAYWRIGHT_PATH=/tmp/cm-cache-playwright/node_modules/playwright-core node scripts/browser/verify_fewer_trips.mjs
VITE_DATA_MODE=demo npx vite --host 127.0.0.1 --port 5223 --strictPort
# 별도 셸
PLAYWRIGHT_PATH=/tmp/cm-cache-playwright/node_modules/playwright-core node scripts/browser/verify_fewer_trips_demo.mjs
# Wrangler는 로컬 실행만; 별도 셸에서 헤더 검증
wrangler dev --local --port 5225
PLAYWRIGHT_PATH=/tmp/cm-cache-playwright/node_modules/playwright-core node scripts/browser/verify_fewer_trips_headers.mjs
```

환경의 기존 node_modules는 다른 프로젝트로 향하는 symlink여서 Vite 임시 config 쓰기가 EROFS로 막혔다.
원래 링크를 ignored 실행 폴더에 보존하고 이 worktree에 동일 의존성을 복사해 검사했다. package/lock/호스트 설정은 변경하지 않았다.

## 배포할 항목과 위험

1. **my-analytics Edge**: `server/screenHandler.ts`. 신규 Accept projection과 panel path, CORS Max-Age 및 오류 Retry-After.
   기존 shared 서버 모듈/entrypoint도 통상 패키징에 포함한다. 기존 RPC가 산출하는 analytics를 사용하므로 이번 신규 DB 변경 없음.
2. **정적 웹(현재 Cloudflare Workers assets)**: 프런트 변경 전체를 production build하고 dist/_headers 포함 배포.
   빌드 워크플로 이름에 Pages가 남아 있어도 `_headers`는 Workers assets에서 해석되며 GitHub Pages 자체 헤더 기능은 아니다.
   Edge를 먼저 반영하는 순서를 권장한다. public-analytics/ingest/랭킹 Edge의 신규 변경은 없다.
3. 운영 DB migration, DNS, Cloudflare 우회 공개 API, 계정 설정 변경은 없음. 정적 자료나 사용자 응답을 새 공개 캐시에 넣지 않는다.
4. 접힌 차트 클릭은 추가 GET 및 lazy JS가 필요하다. 펼친 채 범위를 바꾸면 새 snapshot 차트 조회가 필요하며 기존 whole-screen coordinator 특성상
   상세 동작 때 기본 화면 DTO도 재전송된다. 대규모 개인 비교/지도/지역 자료는 첫 응답에 남는다.
5. immutable은 파일명 해시 자산에만 쓴다. 해당 경로에 같은 이름으로 바뀌는 파일을 넣으면 1년 동안 구본이 남을 수 있다.
   HTML 재검증과 콘텐츠 해시 변경을 유지해야 한다. 코드를 되돌릴 때 구 API/새 웹의 진행 중 chart 요청이 실패할 수 있으므로 화면 새로고침을 확인한다.

Cloudflare [Workers static assets headers](https://developers.cloudflare.com/workers/static-assets/headers/)의 public/_headers·fingerprinted cache 규칙을 확인했다.
Supabase [CORS 문서](https://supabase.com/docs/guides/functions/cors) 및 2026-10-12 changelog를 확인했으며 이 변경에 SDK/schema 업그레이드는 없다.
