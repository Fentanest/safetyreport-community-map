# 통계 10만 건 제한 제거 · 2026-10-14

사용자 보고: 첫 진입 screen 요청에서 RESULT_TOO_LARGE / HTTP 422.
후속 사용자 결정: “10만건제한을 왜 해. 하지마”. 통계 후보·결과 행 수의 100,000 제한을 제거한다.

## 작업 범위와 소유
- base: 236084e, branch: fix/screen-result-too-large-20261014.
- Sol 단일 writer: 새 migration, server/screenHandler.ts, server/personalHandler.ts, server/publicHandler.ts,
  supabase/functions/public-analytics/index.ts, 관련 테스트·문서.
- 별도 worktree `.agent-runtime/result-too-large`. 다른 작업트리는 수정하지 않는다.
- 원본/compact cohort, 구 v2 facts, screen v1/v2, split cache, precomputed 집계를 모두 포함한다.
- 대표 선정·기간·분모·마스킹·동의·열람 자격은 그대로다. 조용한 LIMIT/샘플링/기간 변경 없음.
- 출력 페이지 크기와 맞춤 통계 셀 수 제한은 신고 건수 제한과 별개다.

## 운영 적용
**운영 적용 완료** — 사용자 “적용해. 배포까지 다 해” 승인, 2026-10-14 22:44–22:47 KST.
- 운영 DB migration `20261014132612` 적용·이력 기록. 함수 5개, owner/ACL/SET 유지, 남은 10만 건 제한 0개.
- `public-analytics` / `my-analytics`의 변경 파일 5개만 배포. 배포 전 기준 commit과 운영 파일 일치 확인, 원본 바이트·권한 백업, 교체 후 SHA-256 확인. functions 컨테이너 재시작 후 healthy.
- main `fd303a4` push 및 [Cloudflare 배포 workflow 38574485274](https://github.com/Fentanest/safetyreport-community-map/actions/runs/38574485274) **success**.
- Cloudflare version `df7ce242-d5d2-4126-a7ef-83caf8d3f9df`, 운영 도메인 `safemap.worklazy.net`.
- CI: Python 40개·Vitest 1,186개 통과(환경 의존 197개 skipped), live build·dist scan 통과.
- 운영 read-only 집계: 기본 답변일 `2025-10-15..2026-10-14` **80,389건**, 비교 기간 **27,794건**, 9.739초. 전체 기간 `2019-04-23..2026-10-14` **126,535건**, 12.233초. 업로드가 계속되므로 앞선 126,452행 조사와 조회 시각이 다르다.
- 외부 API 두 경로의 익명 요청은 정상 401. 브라우저는 저장된 사이트 권한 차단으로 최초 시도와 사용자 요청에 따른 재시도 모두 거절됐다. 우회하지 않았으며 운영 로그인 브라우저 검증은 **BLOCKED**다.
- 상세 결과 `release-verification.json`. 서버 변경/백업/원본 권한·해시·검증·복구 절차는 Git 제외 `.agent-runtime/analytics-row-limit-release-20261014/` 및 기존 server-changes/journal.jsonl에 보존. 신고 데이터를 되돌리는 작업은 없다.


## 검증
- `SCREEN_CACHE_STACK=1 npx vitest run tests/integration/analytics-row-limit.test.ts --maxWorkers=1`: **2 passed**, 실제 로컬 PostgreSQL, 모든 변경 rollback.
- 120,000개 합성 관측 중 적격 고유 신고 **110,846건**. 변경 전 `RESULT_TOO_LARGE`, 변경 후 raw/compact/legacy/screen 모두 **110,846**, Edge **HTTP 200**, cold/warm 일치.
- 작은 cohort는 두 날짜 기준·3분류에서 전체 split aggregate deep equality. 함수 owner/ACL/SET 옵션 유지 및 migration 재실행 확인.
- `npx vitest run tests/product/personalHandler.test.ts tests/product/screenSnapshot.test.ts tests/product/publicHandler.test.ts --maxWorkers=1`: **55 passed**. 개인 통계 100,001건과 legacy 오류 안내 포함.
- `npx tsc -b`, Vite build, 두 Edge `deno check`, dist 공개 경계 scan: **PASS**. 기존 번들 크기·dynamic import 경고 유지.
- Chrome + 실제 프런트/handler + 위 SQL 집계 export: **390/1440/1920/2560 dark/light PASS**. 110,846건 표시, 정렬·개인 비교·기간 변경, 모든 screen HTTP 200, console error 0, 가로 overflow 없음. desktop/mobile screenshot을 직접 열어 확인했다.
- 브라우저 인증은 fake, Kakao는 MOCK이다. 운영 사용자 세션의 실제 화면 검증은 미실행.
- 검사 중 raw RPC의 transaction-local 8초 설정이 뒤의 별도 probe에 남아 발생한 timeout은 각 probe 전 기존 screen 기준 55초로 분리했다. 제품의 timeout 설정은 변경하지 않았다.
- optional precompute 함수는 현재 운영에 없다. migration은 존재하는 배포에서 같은 입장 조건·예외만 제거한다. precompute 전용 대량 실행은 미실행.

## 운영 원인 확인
현재 배포 번들은 `supabase.worklazy.net` 셀프호스트를 사용한다. 구 클라우드 Supabase는 현재 지도 운영 검증과 구분했다.
셀프호스트에서 `BEGIN READ ONLY` 안의 catalog/count SELECT로 현재 `analytics_screen_parts` 등 5개 구현에 10만 건 제한이 남아 있음을 확인했다.
적격 이력은 **126,452행**(조회 시점 전체 이력이며, 선택 기간의 고유 신고 건수로 표기하지 않는다).
`production-readonly.jsonl`에 함수별 확인을 기록했다. 운영 데이터·함수·설정을 변경하지 않았다.

## Muse 독립 검수
- `90cf3c8` 고정 detached worktree, OpenCode 구독 `opencode-go/muse-spark-1.3-contributor`, session `ses_ec562c0a3ffeo7k9I65TQadXJM`.
- export의 실제 assistant providerID/modelID를 Sol이 확인했다(`muse/provenance.json`). Muse 자체 보고서의 MODEL_UNVERIFIED 표시는 이 별도 검증으로 해소한다.
- 최초 /tmp 외부 디렉터리 권한 거절 후, fresh 합성 fixture를 검수 worktree 안에 배치하고 같은 세션으로 1회 재시도했다. 권한 변경 없음.
- **PASS**, 8 viewport/theme 조합, 정렬·개인 비교·기간 변경, screen 12회 모두 200, console error 0, 실제 screenshot 열람.
- Muse 원문과 요약 증거는 `muse/REPORT.md`, `muse/results.json`에 보존한다. 제품 파일은 수정하지 않았다.
