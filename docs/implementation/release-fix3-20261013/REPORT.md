# map 릴리스 재검수 3차 수정 · 2026-10-13

사용자 `astra-rel-fix3-brief.md`의 map 잔존 P2만 수정했다. 기준 HEAD는
`7858c13c32cdb354ebb6539fb399c11aae0609a0`이며 기존 1·2차 미커밋 변경은 보존했다.
커밋·push·버전 변경·운영 SQL·배포는 실행하지 않았다.

## 결함과 수정

**P2 취소된 그래프 수집이 재조회 실패 후 재개되지 않음**: 수집이 idle인 상태에서 새 조회가
실패하면 `runRef`만 비워지고, 적용 조건·결과·캐시·수집 상태는 그대로여서 자동 수집 effect가
다시 실행되지 않았다. 이제 effect가 `run.status` 변화도 관찰하고, loading 중에는 시작하지 않는다.
실패 후에는 이전에 적용한 조건·정렬·자료 버전과 캐시로 빠진 쪽을 모으거나, 모든 쪽이 캐시에 있으면
즉시 병합해 그래프를 복구한다. 완료된 그래프 보존과 새 요청 성공 시 원자적 교체는 유지한다.

이번 추가 변경 파일:

- `src/pages/StatisticsPage.tsx`: 수집 effect의 실행 상태 의존성과 loading 보호.
- `scripts/browser/verify_release_map_20261013.mjs`: 아래 두 경계 조건 회귀 시험.
- `docs/implementation/work-ledger.md`, 본 보고서 및 evidence: 소유·검증 기록.

서버·SQL·계약·패키지 파일은 이번 3차에서 추가 수정하지 않았다.

## 재현 및 검증

실제 React 프런트와 로컬 Edge handler, 합성 신고·인증 및 MOCK Kakao를 사용했다.
Chromium **154.0.8037.92**, `http://127.0.0.1:5198`, 1440×900 dark.
한 쪽을 1행으로 제한해 10쪽 전체 수집을 검증한다.

| 시나리오 | 수정 전 | 수정 후 |
|---|---|---|
| 그래프 수집 중 2번 offset 응답 보류 → 지표 제거·재조회 → 422 실패 | 그래프 복구 timeout | 이전 조건·버전으로 수집 재개, 10행 그래프 복구 |
| 완성된 그래프 → 재조회 보류 → hidden/visible → 재개 요청 422 실패 | 그래프 복구 timeout | 재개 요청 1회, 캐시로 원래 축·series 데이터 복구 |

두 번째 시나리오는 headless 브라우저에 `document.hidden/visibilityState`와 `visibilitychange`를
주입하여 실제 컴포넌트의 탭 복귀 핸들러를 실행한다. OS의 실제 탭 전환을 자동화한 검사는 아니다.

- [수정 전 결과](evidence/browser-before/report.json): 기존 5개 PASS, 신규 2개 FAIL.
- [수정 후 결과](evidence/browser-after/report.json): **7개 모두 PASS**, 기존 버전 고정·409 처리·정렬 초기화·422/네트워크 오류 보존 포함.
- 신규 두 시나리오의 [수집 재개 화면](evidence/browser-after/P2-interrupted-collection-resumes-after-failure.png)과
  [탭 복귀 실패 후 화면](evidence/browser-after/P2-visibility-resume-failure-restores-chart.png)을 직접 열어
  이전 조건 안내와 실제 그래프가 함께 표시되는지 확인했다.
- 콘솔에는 의도적으로 주입한 409 1건·422 3건·ERR_FAILED 1건만 있었다. pageerror 없음.

| 검사 | 결과 |
|---|---|
| `npx vitest run --configLoader runner` | 77 파일 / 1,017 PASS, 33 파일 / 195 SKIP, 실패 0 |
| `npx tsc -p . --noEmit` | exit 0 |
| `npx vite build --configLoader runner --outDir /tmp/map-fix3-dist` | exit 0 |
| `~/.local/bin/deno check supabase/functions/{public-analytics,my-analytics,community-ingest}/index.ts` | 3함수 exit 0 |
| `python3 scripts/scan_public_dist.py --dir /tmp/map-fix3-dist` | PASS, issue 0 |
| `git diff --check` | exit 0 |

[Vitest](evidence/vitest.log), [타입](evidence/types.log), [빌드](evidence/build.log),
[Deno](evidence/deno.log), [산출물 검사](evidence/scan.json).
SKIP 검사는 통과로 계산하지 않았다. 빌드의 큰 chunk 및 dynamic/static import 혼용 경고는 남아 있다.
공유 node_modules 쓰기를 피하려고 기존 검증과 동일하게 configLoader=runner와 `/tmp` Vite cache를 사용했다.
미커밋 후보의 [파일 해시](evidence/candidate.sha256)로 검사 대상을 기록했다.

재현 명령:

```sh
E2E_PORT=5198 node --input-type=module -e 'import { createServer } from "vite"; const s = await createServer({configFile:"scripts/browser/vite.e2e.config.ts",configLoader:"runner",cacheDir:"/tmp/map-fix3-vite-cache"}); await s.listen(); s.printUrls();'
E2E_PORT=5198 PLAYWRIGHT_PATH=/tmp/map-browser-test/node_modules/playwright-core PW_CHROMIUM=/opt/google/chrome/chrome node scripts/browser/verify_release_map_20261013.mjs /tmp/map-fix3-browser
```

## 배포 인계와 한계

이번 수정은 **지도 정적 웹 재배포**가 필요하다. 1차 수정 전체를 포함할 때 필요한 신규
SQL migration `202610130100_screen_plate_normalization.sql`과 `public-analytics`·`my-analytics`
Edge 재배포는 [1차 보고서](../release-fix-20261013/REPORT.md)의 인계를 따른다.

Muse의 `opencode models`와 `opencode mcp list`는 모두
`FileSystem.open (/home/better0101/.local/share/opencode/log/opencode.log)`에서 실패했다.
독립 검수는 MODEL_UNVERIFIED / UI_REVIEW_BLOCKED다. 위 Chromium 증거를 Muse 승인으로 표시하지 않는다.
운영 Supabase·실카카오·운영 로그인·다중 해상도/테마 종합 검사는 NOT_RUN이다.
