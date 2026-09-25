# safeauth 인수 결과 (2026-09-25)

기준: kit v2 `04_TESTS_AND_ACCEPTANCE.md`. 환경 열: **L** = 로컬 스택(실제 Supabase Auth v2.197.0 + Postgres 17 + PostgREST, 모의 카카오),
**U** = 컨테이너 없는 단위/Mock, **H** = hosted Supabase + 실제 카카오. H는 전부 **NOT RUN**(운영 설정·실계정 필요).

| 저장소 | 브랜치 | 커밋 (로컬 전용, push 안 함) |
|---|---|---|
| safetyreport-community-map | `feat/safeauth` | `cb9b1be`, `7a38713`, `216e36f` + 이 문서 커밋 |
| safetyreport | `feat/community-account` | `5b76918`, `ca57ed8`, `28c26f1` |
| safetyreport-mobile | `feat/community-account` | `4e5454a6`, `42836dca` |
| WorklazyTools | (변경 없음) | 패치만: `integration-patches/worklazytools/` |

## 실행한 명령과 결과

| 명령 | 결과 |
|---|---|
| `npx vitest run` (community-map 전체) | 48 pass, 37 skip(스택 필요) |
| `npx vitest run tests/safeauth/unit.test.ts` | 25 pass |
| `SAFEAUTH_STACK=1 … relay.integration.test.ts` (Node relay) | 24 pass |
| 같은 테스트를 Deno Edge 엔트리 경유 (`denoland/deno:2.5.6`) | 24 pass |
| `deno check` 두 Edge 함수 | pass |
| `SAFEAUTH_STACK=1 SAFEAUTH_BROWSER=1 … browser.e2e.test.ts` (Chromium) | 13 pass → `qa/browser-results.json`, `qa/screenshots/` |
| `npm run build:safeauth` + `verify-artifact` | pass (미설정 빌드는 `--require-config`에서 의도대로 fail) |
| 지도 `npm run build` + `npm run scan`, python blueprint/product | pass (회귀 없음) |
| WorklazyTools CI 단계 모사: 깨끗한 clone `7a38713` → `npm ci` → build → compose → 경로 검사 | pass, 기존 1066 파일 해시 동일 |
| actionlint (패치된 `deploy-pages.yml`, `safeauth-check.yml`), `git apply --check` | pass |
| safetyreport `unittest discover` | 196 OK (3 skip = live) · 기존 142 |
| safetyreport `tests.test_community_auth_live` (로컬 스택) | 3 OK |
| mobile `flutter test` | 313 pass, 2 skip (기존 218) |
| mobile `flutter analyze` | error 0 / warning 2 / info 36 = 기존과 동일 |
| mobile `flutter build apk --debug` | pass (에이전트 실행) |

## 항목별

| ID | 결과 | 근거 |
|---|---|---|
| P01 원기기만 교환 | PASS (L) | relay P01, safetyreport live full flow |
| P02 중앙 선교환 없음 | PASS (L) | 브라우저 E2E: 페이지 발 `/auth/v1/token` 0건 |
| P03 다른 verifier 거부 | PASS (L) | 400 `bad_code_verifier`; 실패해도 코드가 소모되지 않음 |
| P04 코드 1회 | PASS (L) | 재교환 404 `flow_state_not_found` |
| P05 고정 callback·맥락 없는 callback | PASS (L) | P05, P05b(허용 목록 밖 redirect는 Site URL로 감), E2E U03 |
| S01–S17 | PASS (L/U) | relay integration, unit |
| S18 로컬 API 권한·CSRF | PASS (U) | safetyreport tests (CSRF·Origin·권한 없는 API 키 403) |
| U01–U08, U11 | PASS (L) | 브라우저 E2E |
| U09 광고·CDN·분석·SW 요청 없음 | PASS (L) / 실제 응답 헤더 NOT RUN | 요청 호스트 = 사이트·relay·모의 카카오. Pages 헤더는 미배포 |
| U10 공식 카카오 버튼·데모 잔재 없음 | PASS | 공식 SVG 해시 검증, verify-artifact |
| U12 키보드·live region·reduced motion·axe | PASS(자동) / 스크린리더 수동 NOT RUN | axe serious/critical 0 |
| U13 모든 상태 다음 행동 | PASS (L) | 상태별 스크린샷 |
| A01 localhost·변경 포트 | PASS (L) | 픽스처 서버 18731에서 브라우저 흐름 |
| A02 두 설치 동시 | PASS (L) | live test |
| A03 Docker LAN·사용자 도메인·프록시 | 부분: 설계상 사용자별 URL 불필요 · 실제 Docker/프록시 NOT RUN | |
| A04 폰 브라우저 NAS UI | NOT RUN | |
| A05 비교코드 일치 | PASS (L) | E2E, 설정 화면 스크린샷 |
| A06 계정 바뀜 확인 | PASS (L) | live test, 스크린샷 09/10 |
| A07 저장 전 완료 불가·complete 재시도 | PASS (L/U) | E2E(교환 후에도 대기), unit |
| A08 재시작 후 복원·refresh | PASS (L) | 에이전트 재시작 확인, live refresh 회전 |
| A09 동시 refresh 직렬화 | PASS (U) | 스레드 테스트 |
| A10 오프라인/5xx/철회 구분 | PASS (U) | |
| A11 해제 = scope=local | PASS (L) | 다른 설치 세션 유지 확인 |
| A12 백업·로그·설정응답 비밀 없음 | PASS (U) | 백업 export·로그 스캔 |
| A13 기능 OFF 회귀 없음 | PASS (U) | 기존 142 테스트 포함 196 OK |
| M02, M05–M08, M10 | PASS (U) | flutter tests |
| M01, M03(기기), M04, M09 | NOT RUN | 실기기/에뮬레이터 미사용 |
| D01–D06, D08, D10–D13 | PASS | compose/verify 스크립트, CI 모사 |
| D07 루트 서비스워커·기존 경로 | PASS (L) | 로컬 복사본. 실제 worklazy.net 과거 SW 설치 사용자 NOT RUN |
| D09 기존 storage 불간섭 | PASS (L) | `worklazy_lang` 유지 |
| D14 Cloudflare | NOT APPLICABLE | 사용 안 함 |
| §6 hosted Kakao E2E 1–7 | NOT RUN | 운영자 수동 (deployment.md §7) |

## 출시 판단

production-ready로 표시하지 않는다. 남은 필수 항목: hosted E2E, 운영자 개인정보처리방침에 커뮤니티 계정 처리 추가,
실제 응답 헤더 확인, 모바일 실기기 검수, 독립 보안 검토. 알려진 잔여 위험은 `security-review.md` §3–5.
