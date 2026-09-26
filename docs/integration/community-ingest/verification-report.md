# community-ingest 검증 보고 (2026-09-26, Opus5.5)

범위: 사용자 원문 v2 프롬프트(필수 카카오 인증·신고내용 공유 동의 게이트, 1회 초기화 크롤링, 불변 capture/journal/outbox, 실시간·"지금 업로드"·00:00 KST 업로드,
`community-ingest` Edge 함수, 보안 행렬, projection, env/secret 주입, auth+map migration 합성, 병렬 구현, 통합 검토, 머지·정리, 최근 7일 감사).
판정 용어: **passed** = 같은 테스트로 실제 실행해 통과, **failed**, **blocked**(환경·권한·할당량으로 실행 불가), **not-run**(실행하지 않음).
"로컬 실제 스택" = 합성 로컬 Supabase(`ci0926-int`, auth+map migration 5개·함수 4개) + mock Kakao. 운영 Supabase·호스팅 Kakao·실기기는 쓰지 않았다.

## 1. 저장소와 최종 상태

| repo | 목표 branch | 작업 시작 HEAD | 1차 merge | 최종 merge | 원격 |
|---|---|---|---|---|---|
| safetyreport (PC 서버) | `dev` | `cb4b027` | `4023f64` | `823ab38` | 2026-09-26 `origin/dev` push (`cb4b027..823ab38`) |
| safetyreport-mobile | `dev` | `af2ae809` | `9bf23e9d` | `90810843` | 2026-09-26 `origin/dev` push (`af2ae809..90810843`) |
| safetyreport-community-map | `main` | `a829079` | `ec3142c` | `e7cff5e` + 이 문서 병합 `2ce57e9` | 2026-09-26 `origin/main` push (`a829079..2ce57e9`, 이 정정 포함 이후 commit 도 push) |
| safetyreport-community-auth | `main` | `558ed6b` | `c71602d` | `0872fa1` | 2026-09-26 `origin/main` push (`558ed6b..0872fa1`) |

## 2. 실행 결과 (최종 코드 기준)

| 영역 | 결과 | 근거 |
|---|---|---|
| PC 단위(409) / DB 왕복 / 실스택 / 브라우저 스모크(chromium+firefox 128) | passed / passed(diff 0) / passed / passed | `evidence/2026-09-26-final/`, `…-audit11/` |
| mobile 단위(528) / analyze / 실스택 | passed / passed(0건) / passed | `…-final/`, `…-audit10/` |
| map 단위(88)+tsc+build / 실스택 21 / Deno 4함수 / compose check / migration 4경로+legacy 가드 | passed | `…-final/`, `…-audit3/`, `…-r5/` |
| auth 단위(38) / relay 실스택 24 / 브라우저 11 | passed | `…-final/`, `…-audit3/`, `…-audit2/` |
| 지도 화면 live(기관 표 전체 조회) | passed(콘솔 오류 0, 캡처) | `…-audit2/map-*.png` |
| 브라우저 스모크 간헐 실패 2회(외부 CDN 폰트·스크립트 `ERR_NETWORK_CHANGED`/Pretendard) | 원인 기록 후 해당 스펙 재실행 passed | `…-audit4/`, `…-audit10/` 원인 파일 |
| 음성 대조(감사 수정마다 되돌려 목표 단언 실패 확인) | passed(각 회차 `neg-*.log`; 1차 반영분은 로그 미보존) | `audit-resolution.md` |

## 3. 협업 실행 증거
- 계획 검토: GPT-6-Sol 6회 + final(`plan-review-sol-*.md`). 통합 후보 검토 5회(`integration-review-sol-01..05.md`, 5차 "목표 브랜치 병합 가능").
- 병렬 구현: Muse Spark Contributor(OpenCode `opencode-go/muse-spark-1.3-contributor`) T3b·T4·T5·T6·T7 + 감사 AF-MAP·AF-MAP2, Opus T0~T3a·T8·통합·감사 수정 — 세션·worktree·commit 은 `parallel-work-manifest.json`.
- Gemini(agy `gemini-3.1-pro-high`): 조사·diff 검토(초기 단계) passed. 7일 감사 보조는 **blocked**(구독 할당량 소진, 429) — 다른 유료 API 로 바꾸지 않았다.
- 7일 감사: 창 `audit-window.md`(2026-09-19T13:10:08+09:00~2026-09-26T13:10:08+09:00, 네 저장소 commit 260·파일 1047). 최초 findings 10건(높음 3) → 재검증 11회 → 11차 "감사 수정 병합 가능".
  수정·재검증 이력과 각 finding 의 commit·테스트·음성 대조는 `audit-resolution.md`.

## 4. 구현됨 / 로컬 실제 스택 검증됨 / 미검증 / 운영 미반영
- **구현됨·로컬 실제 스택 검증됨**: 필수 게이트(PC 관리자 로그인 뒤·모바일 권한 전), 초기화 크롤링, capture/journal/outbox, 업로드(실시간·수동·자정), 중앙 ingest·권한·projection·공개 API, 공유 자료 삭제 두 단계, DB 교환 무결성 보강, 대기 큐 안전성(감사 수정).
- **실제 provider 미검증(not-run)**: 호스팅 Kakao OAuth, 실제 안전신문고 로그인·크롤(fixture·mock 만), Android/iOS 실기기(권한 순서·딥링크·백그라운드·자정 실행), iOS 빌드, PyInstaller 번들 산출물(이번 감사 추가 모듈 포함 — 정적 import 사슬만 확인).
- **부분·not-run 수용 항목**: E08(fork/PR 워크플로), I06(trigger 만 다른 재전송 테스트), S-18(IP 헤더 위조), N-03(정책 불변 HTTP) — `acceptance-matrix.md`.
- **원격 push**: 최종 병합 뒤 사용자 지시로 네 목표 branch 를 fast-forward push 했다(force 없음, PR·태그 없음). push 전 보낼 commit 비밀 패턴 검사(PC 5건은 거부 시험용 가짜 값 `sb_secret_abcdefghijklmnop`), 도달 불가 `804a30b` 는 전송 대상 아님.
  PC·mobile 빌드 workflow 는 `main` push 에서만, map·auth Pages 는 수동 `workflow_dispatch` 라 push 로 빌드·배포가 돌지 않았다(Actions 목록 확인).
- **운영 미반영**: 운영 Supabase migration·Edge 배포·인증 설정·Pages/DNS·스토어 배포 없음.

## 5. 운영 전 조건 (Sol 11차 + 통합 검토)
1. 운영 DB 에 읽기 전용 preflight(`scripts/integration/preflight_counts.sql`), migration 순서 auth `202609260100` → map `202609260200` 와 SHA 대조, `deployment-and-rollback.md` 순서·무삭제 롤백.
2. 호스팅 Kakao 리디렉션·JWT/CORS·키·rate limit·Realtime/Storage 정책, PC 번들·모바일 빌드 변수·동의문 포함 검사.
3. 직접 시작 크롤의 로그인·목록 실패와 미해결 기록 저장 실패를 운영자가 확인·재요청하는 절차, 남은 실행 파일 정리 기준(R9-02·R9-04).
4. 운영 목록 규모에서 전체 목록 받기의 시간·호출 수·메모리와 재시도 부하 측정(R7-04).
5. 모바일 미해결 표시의 위젯·실기기 검증, 구앱은 대기열 거부 이유를 일반 문구로 보임.
6. 외부 CDN(폰트·DataTables) 실패가 섞인 브라우저 스모크 재확인.
