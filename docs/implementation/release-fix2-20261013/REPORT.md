# map 릴리스 재검수 2차 수정 · 2026-10-13

사용자 `astra-rel-fix2-brief.md`의 map 대상만 수정했다. 기준 HEAD는
`7858c13c32cdb354ebb6539fb399c11aae0609a0`이며, 1차 미커밋 수정을 보존했다.
커밋·push·버전 변경·운영 SQL·배포는 실행하지 않았다.

## 결함과 수정

**P2 재조회 실패 후 기존 그래프 소실**: `execute()`가 요청 시작 시 완료된 `collect`까지 idle로
비워 버렸다. 이제 이전 수집의 generation을 무효화하고 미완료 수집은 초기화하되, 완료된 그래프는
현재 적용 결과와 함께 유지한다. 새 요청이 성공하면 기존 성공 처리에서 결과·조건·페이지 캐시·그래프를
함께 교체한다. 실패 시 기존 조건의 결과라는 안내와 실제 그래프가 일치한다.

추가 변경 파일:

- `src/pages/StatisticsPage.tsx`: 완료된 그래프 보존 및 설명 주석.
- `scripts/browser/verify_release_map_20261013.mjs`: 422·네트워크 오류 회귀 2개 추가.
- `docs/implementation/work-ledger.md`, 본 보고서 및 evidence: 소유 범위·검증 기록.

1차 수정의 서버·SQL·계약 파일은 이번에 추가 수정하지 않았다.

## 재현과 검증

브라우저 시험은 실제 프런트/로컬 Edge handler, 합성 신고, MOCK Kakao를 사용한다.
1440×900 dark, Chromium **154.0.8037.92**, URL `http://127.0.0.1:5198`.

1. 한 쪽 1행으로 응답을 제한해 10쪽을 모은 실제 히트맵을 표시한다.
2. 지표를 제거하고 새 요청을 보류한 뒤 422 또는 네트워크 오류를 주입한다.
3. 대기 중·실패 후 그래프 존재 및 실패 전후 축/series 데이터 동등성을 확인한다.
4. 재시도 성공 응답과 새 지표의 차트 데이터 교체를 확인한다.

수정 전 **두 회귀 모두 실패**: 오류 안내 아래 차트 0개.
[수정 전 로그](evidence/browser-before.log), [증거](evidence/browser-before/report.json).
수정 후 **5개 모두 통과**: 신규 2개와 기존 버전 고정·409 처리·제거된 지표 정렬 3개.
[최종 로그](evidence/browser-final.log), [요청·콘솔 기록](evidence/browser-final/report.json).
중간 `browser-after` 실행은 네트워크 쿨다운 후 성공 응답을 기다리지 않은 시험의 조기 판정으로
새 차트 교체 검사가 실패했다. 실제 page-zero 응답과 차트 갱신을 기다리도록 시험을 보완한 뒤 재통과했다.

오류 상태와 재시도 성공 스크린샷을 직접 열어 확인했다:
[422 오류 후](evidence/browser-final/P2-chart-survives-422-error.png),
[네트워크 오류 후](evidence/browser-final/P2-chart-survives-network-error.png),
[재시도 성공 후](evidence/browser-final/P2-chart-survives-network.png).
콘솔 오류는 의도한 409·422·ERR_FAILED 각 1건뿐이며 pageerror는 없었다.

| 검사 | 실행 결과 |
|---|---|
| `npx vitest run --configLoader runner` | 77 파일 / 1,017 통과, 33 파일 / 195 건너뜀, 실패 0 |
| `npx tsc -p . --noEmit` | exit 0 |
| `npx vite build --configLoader runner --outDir /tmp/map-fix2-dist` | exit 0 |
| `~/.local/bin/deno check supabase/functions/{public-analytics,my-analytics,community-ingest}/index.ts` | 3함수 exit 0 |
| `python3 scripts/scan_public_dist.py --dir /tmp/map-fix2-dist` | PASS, issue 0 |
| `git diff --check` | exit 0 |

전체 로그: [Vitest](evidence/vitest.log), [타입](evidence/types.log),
[빌드](evidence/build.log), [Deno](evidence/deno.log), [산출물](evidence/scan.json).
빌드의 500kB chunk 및 dynamic/static import 혼용 경고는 남아 있다.
공유 node_modules의 읽기 전용 경계를 지키기 위해 Vite configLoader=runner,
개발 서버 cacheDir=`/tmp/map-fix2-vite-cache`를 사용했다. dependencies/lockfile 변경 없음.

브라우저 재현:

```sh
E2E_PORT=5198 node --input-type=module -e 'import { createServer } from "vite"; const s = await createServer({configFile:"scripts/browser/vite.e2e.config.ts",configLoader:"runner",cacheDir:"/tmp/map-fix2-vite-cache"}); await s.listen(); s.printUrls();'
E2E_PORT=5198 PLAYWRIGHT_PATH=/tmp/map-browser-test/node_modules/playwright-core PW_CHROMIUM=/opt/google/chrome/chrome node scripts/browser/verify_release_map_20261013.mjs /tmp/map-fix2-browser
```

## 배포 인계와 한계

이번 2차 수정은 **지도 정적 웹 재배포**가 필요하다. 1차 수정 전체를 반영할 때 필요한 신규
SQL migration과 `public-analytics`·`my-analytics` Edge 재배포는
[1차 보고서](../release-fix-20261013/REPORT.md)의 순서를 따른다.

Muse는 `opencode models` 및 `opencode mcp list` 모두
`FileSystem.open (/home/better0101/.local/share/opencode/log/opencode.log)`에서 실패했다.
모델/variant 확인과 독립 검수는 `MODEL_UNVERIFIED / UI_REVIEW_BLOCKED`이며 호출했다고 주장하지 않는다.
운영 Supabase·실카카오·운영 로그인 검사는 NOT_RUN. 다중 해상도/테마 종합 검수도 수행하지 않았다.
이번 결과는 해당 로컬 결함과 회귀 검증의 완료이며 운영 릴리스 승인과 구분한다.
