# 재검수 보고서 — FINAL-01~03 수정 확인 (Muse)
- request_mode: review (제품 파일 수정 금지 — 본 검수에서 제품·테스트 파일 손대지 않음)
- worktree / commit / dirty: /home/better0101/projects/safetyreport-community-map-compare-review (detached) / a09adc7 (Sol 수정 commit, `git rev-parse HEAD` 일치) / 검수 후 dirty 없음(허용 경로 신규 파일만).
- URL / data_mode: http://127.0.0.1:4175/ (`VITE_DATA_MODE=demo` build → `.agent-runtime/demo-dist` preview) / demo 합성 fixture.
- browser/tool: Google Chrome 154.0.8037.57, playwright-core 1.63.0 (node 직접 실행, 스크립트 `/tmp/opencode/recheck.mjs` — repo에 기록하지 않음), vitest 5.0.1 (읽기 전용 실행).
- Sol 수정 범위(읽기 전용 `git show` 확인): `src/components/MapPanel.tsx` 비활성 사유(title+aria-describedby+가시 힌트), `src/components/ViewControls.tsx` 중복 문장 삭제, `src/auth/mapAuth.ts` 만료 문구에 업로드 영향 없음(live+demo), `tests/product/authBoundary.test.ts` 회귀 테스트 추가.

## 항목별 결과
| id | 재현 절차 | 기대 | 실제(브라우저 실측) | 증거 | 판정 |
|---|---|---|---|---|---|
| FINAL-01 | `?me=signed` 비교on·관심없음 → 지점 필터행 확인 | 비활성 버튼 사유 표시 | `관심 지역` 버튼 `disabled`+`title="지역 목록에서 ★로 관심 지역을 지정하면 사용할 수 있습니다."`+`aria-describedby="point-filter-hint"`, 가시 힌트 `관심 지역: 지역 목록의 ★로 지정` 표시됨 | final01-filters.png, `/tmp/opencode/recheck.json` f01 | PASS |
| FINAL-01b | `?me=out` 비교on(미로그인) | mine/shared 비활성 사유 | 두 버튼 `title="내 데이터 함께 보기를 켜고 로그인하면 사용할 수 있습니다."`, 가시 힌트 `내 지점 필터: 내 데이터 함께 보기 + 로그인 · 관심 지역: 지역 목록의 ★로 지정` | recheck.json f01b, final03-expired.png 필터행(동일 힌트 노출) | PASS |
| FINAL-02 | `?me=unconfigured` 비교on | 토글 비활성 + 한 문장 안내 | note `이 배포에는 지도 로그인이 설정되지 않았습니다. 공개 지도는 그대로 볼 수 있습니다.` 중복 없음(dup:false), switch disabled | final02-unconfigured.png, recheck.json f02 | PASS |
| FINAL-03 | `?me=expired` 비교on | 만료+재로그인+업로드 영향 없음(§6) | note `지도 로그인이 만료되었습니다. 다시 로그인해 주세요. 앱·서버의 자동 업로드 연결에는 영향이 없습니다.` + 카카오로 로그인, 공개 288 유지 | final03-expired.png, recheck.json f03 | PASS |
| FINAL-03t | `npx vitest run tests/product/authBoundary.test.ts` | 12 tests incl. 신규 회귀 테스트 | 12 passed (신규 `session-expired guidance` 포함) | 터미널 출력 | PASS |

## 회귀 확인
| 화면 | 스크린샷 | console/network | 판정 |
|---|---|---|---|
| 1920 dark both 비교on (`?me=signed`, 288/31/10.8% 정상) | reg-1920-dark-both.png | error 0, warn 0, 4xx/5xx 0, overflowX 0 | PASS |
| 390 dark both (비교표·필터·지역·추이, 페이지 가로스크롤 0) | reg-390-dark-both.png | error 0, overflowX 0 | PASS |
| 1440 light stats (미니지도·2열 그리드·라이트 토큰, 겹침 없음) | reg-1440-light-stats.png | error 0, overflowX 0 | PASS |

## 새로 발견한 문제
없음. 이번 수정 범위 내 추가 결함·회귀 없음. (참고: 이전 보고서의 메모 — 추이 결측 '—' 렌더 NOT_RUN, 실 Kakao SDK·운영 인증 BLOCKED — 는 본 재검수 범위 밖으로 그대로 유지.)

## 최종 판정
FINAL-01 / FINAL-02 / FINAL-03 모두 **PASS** (수정 확인). 회귀 3화면 **PASS**. 미리보기 서버는 본 보고서 작성 후 자기 preview PID만 종료.
