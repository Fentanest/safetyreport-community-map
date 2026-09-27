# 구현 검증 상태 · 2026-09-24

범위는 로컬 구현과 명시적 합성 fixture다. `PASS_LOCAL`은 운영 승인이나 실데이터 검증을 뜻하지 않는다. `BLOCKED`는 필요한 운영 키·원천·배포가 없어서 통과 판정할 수 없다는 뜻이다. Muse M3-F가 재검수한 제품 코드는 `56c7a3ad15356d6e9e4e52618c36275e7e9f2d39`에 고정됐고, 증거는 `docs/reviews/M3-final.md`에 있다. 이후 커밋은 검수 보고서와 상태 문서만 더한다.

| acceptance ID | 상태 | 확인 근거와 남은 경계 |
|---|---|---|
| DATA01 | PASS_LOCAL | v1 원천 결손을 `docs/upstream-gaps.md`에 명시, v2 `ready=false`, demo 임의 범위는 `null` |
| DATA02–04 | PASS_LOCAL | 신고일/완료일 월 분리, D/unknown, 0분모·신규 비교를 `aggregate.test.ts`로 확인 |
| DATA05 | PASS_LOCAL | KST 연말·윤일·동일 길이 이전 기간 함수 테스트. 운영 원천의 부분월 대조는 BLOCKED |
| DATA06–08 | PASS_LOCAL | 전체 기간 TOP5 재계산, 접두어 보존 후 마스킹, snapshot 중복제거 테스트 |
| DATA09–10 | PASS_LOCAL | 교차 원천 없는 v1에 대한 추정 없음, 완료일 결측 대체 없음 |
| PRIV01 | PASS_LOCAL | 정확 좌표·전체 성명·1건 반환 단위 테스트와 UI fixture. 실데이터 공개 승인 절차는 별도 |
| PRIV02–04 | PASS_LOCAL | strict public schema, raw 필드 거부, 배포 산출물 스캔, 마스킹 충돌 독립 행 테스트 |
| SEC01 | BLOCKED | 로컬 PostgreSQL 16에서 anon/authenticated 권한 차단과 service_role RPC를 확인. CI 전용 권한 및 운영 Supabase 실제 grant 검사는 미실행 |
| SEC02 | PASS_LOCAL | `VITE_DATA_MODE=live npm run build` 후 `npm run scan`; 실제 Pages artifact는 미생성 |
| SEC03 | BLOCKED | allowlist/429/DB rate RPC 단위·로컬 검증. 실제 Edge gateway, 공격성 부하·timeout 검증은 미실행 |
| SEC04 | PASS_LOCAL | 악성 기관명·담당자명·주소를 React 서버 렌더에 넣어 HTML escape 확인. 운영 응답의 브라우저 공격성 검사는 미실행 |
| SEC05 | BLOCKED | 로컬 DB 철회 시 version 변경·ready=false 및 클라이언트 version 일치 검사. 운영 API/정적 캐시 긴급 재생성은 미실행 |
| UI01–02 | PASS_LOCAL | M3 8개 화면/테마 셀, M3-F 4개 회귀 셀과 390px overflow 0 확인 |
| UI03 | BLOCKED | 실제 Kakao JS 키·등록 도메인 없음. mock SDK 경로는 실지도 통과로 계산하지 않음 |
| UI04–05 | PASS_LOCAL | M3/M3-F에서 1건·0건·미지원, 선택 지점과 전체 수치, 범위·분모 표시를 실제 Chrome으로 확인 |
| UI06–08 | PASS_LOCAL | M3에서 1440/2560·브리핑/Esc·light·정렬·표 대안 확인. 스크린리더 전체 탐색과 reduced-motion 실측은 NOT_RUN |
| UI09 | BLOCKED | 실패 카드가 attribution 영역을 가리지 않는 것은 확인. 실제 Kakao 로고·축척·dark 지도 동작은 키가 없어 미검증 |
| PERF01 | PASS_LOCAL | 10,000개 원 지점을 1,000개 이하 표시 노드로 묶고 원건수/지점수 보존하는 테스트. 실제 패닝 성능은 BLOCKED |
| PERF02 | BLOCKED | 초기 JS gzip 약 115 KB, 차트 지연 로드. 운영 장시간 task·메모리 측정은 미실행 |
| REL01 | BLOCKED | M3-F가 로컬 `/safetyreport-community-map/` 정적 호스팅의 assets/파비콘·새로고침·Back을 통과. 실제 GitHub Pages 배포 smoke는 미실행 |
| REL02 | PASS_LOCAL | live 실패 시 demo 자동 대체 없음, sample 배지 분기. 실제 live endpoint 검사는 BLOCKED |
| REL03 | PASS_LOCAL | M0/M1/M2/M3/M3-F Muse 호출, M3-F 세션 export에서 `opencode-go/muse-spark-1.3-contributor` 확인. 제품 코드 고정 커밋과 보고서 commit은 문서 추가로 구분 |
| REL04 | PASS_LOCAL | 운영 DB·push·배포 없음. 로컬 migration 제안과 검증만 수행 |

아직 구현하지 못한 명세 항목: 지역 A/B 비교 슬롯, 최근 증가 지점 목록, `map`의 별도 zoom/resolution·상태 조건, 기관 전체 페이지 탐색과 서버 정렬, 운영 취소 요청의 정적 캐시 긴급 재발행 자동화. 현재 화면이 이 기능을 제공한다고 표시하지 않으며 `docs/public-api-contract.md`에 계약 차이를 적었다.

재현 명령: `npm test` (23개), `python3 -m unittest discover -s tests/product -p 'test_*.py'` (3개), `python3 -m unittest discover -s tests/blueprint` (27개), `VITE_DATA_MODE=live npm run build`, `npm run scan`. 전체 실행 결과는 최종 작업 기록에 남긴다.

## 전체 × 내 신고 비교 개편 · 2026-09-27
범위: docs/personal-comparison.md. 통합 후보 `ec5a847` → Muse 최종 검수 결함 수정 `a09adc7`(feat/personal-comparison). 합성 fixture와 로컬 합성 Supabase 스택만 사용했다.
운영 DB·Edge·Auth·Pages에는 적용·배포하지 않았다.

| ID | 상태 | 근거 |
|---|---|---|
| CMP01 | PASS_LOCAL | `tests/product/compare.test.ts` 8개 scope에서 전체=공개 overview, 내⊆전체, 내=내 사실만 공개 집계. 스택: 전체=익명 dashboard, 같은 dataset_version, 409(버전 불일치) |
| CMP02 | PASS_LOCAL | %p/내 비중, 0분모 null+이유, n=1, 지역·담당자·월 합계와 공개 키 일치(compare.test.ts) |
| CMP03 | PASS_LOCAL | handler 20개 테스트 + 스택 5개: 비로그인·키 bearer·위조 claims·익명·비카카오 거부, viewer id는 검증 토큰만, RPC ACL `{postgres,service_role}` |
| CMP04 | PASS_LOCAL + 운영 preflight | private/no-store·Vary, exporter 개인 필드 거부, share URL 검사, dist 스캔. 운영 gateway: safemap Origin 정확 에코·다른 Origin 403 확인(로컬 Kong의 `*` 덮어쓰기는 운영에 없음) |
| CMP05 | PASS_LOCAL | 스택: 지도 세션 `logout?scope=local` 후 지도 401·앱 ingest 200 accepted, global은 앱 세션을 끊음(대조). 브라우저 E2E: supabase-js가 `scope=local` 호출, 지도 저장 키만 삭제 |
| CMP06 | PASS_LOCAL | 브라우저 E2E(live build + 로컬 스택)에서 비로그인 공개 화면, 공개 요청 Authorization 없음. 개인 API 오류 fixture에서도 공개 화면 유지(Muse) |
| CMP07 | PASS_LOCAL(합성) | Muse 구현 검수 `docs/reviews/personal-compare-impl.md`(e3b05fc), 통합본 최종 검수 `docs/reviews/personal-compare-final.md`(ec5a847, 24셀·행동 전수 PASS, 하 3건) → 수정 `a09adc7` → 재검수 `docs/reviews/personal-compare-recheck.md` PASS |
| CMP08 | PASS_LOCAL(합성) | 동상. 실 Kakao 지도 위 링 표시는 BLOCKED(키 없음) |
| 운영 인증 | PARTIAL | 2026-09-27 운영 반영: migration 6개·함수 5개·Pages 배포, 익명 smoke 통과(deployment-and-rollback.md §6). 실제 카카오 로그인·내 비교는 `ready=true`와 사용자 계정 확인 전 NOT_RUN |
| 실데이터 대조 | BLOCKED | 운영 사실 없음. 합성 스택 사실로만 대조 |

재현(`a09adc7`): `npm test`(150 통과·26 skip=스택 전용), `python3 -m unittest discover -s tests/product -p 'test_*.py'`(9),
`python3 -m unittest discover -s tests/blueprint`(27), `VITE_DATA_MODE=live npm run build && npm run scan`(통과, live dist에 demo chunk 없음).
스택: `node scripts/integration/compose_supabase.mjs compose --auth ../safetyreport-community-auth` → `supabase start` →
`supabase migration up --local` → mock_kakao → `functions serve` → `COMMUNITY_STACK=1 npx vitest run tests/integration`(26/26: my-analytics 5 + 기존 ingest 21 회귀, `a09adc7`에서 재실행),
live build(VITE_* = 로컬 스택)를 127.0.0.1:56490에 preview 후 `node scripts/integration/live_login_e2e.mjs <out> C`(17 PASS).
증거: `docs/integration/community-ingest/evidence/2026-09-27-personal-compare/`.
호스트 제약: inotify 한도로 `vite` dev 서버가 ENOSPC — 호스트 설정은 바꾸지 않고 build+preview로 검수했다.
Muse 호출: 구현 `ses_f214b7118ffexztRXRYUR7fGYp`, 검수·재검수 `ses_f212f5abfffeks1bKCm1JOUAj1` — 두 세션 모두 `opencode export`로
provider `opencode-go`, model `muse-spark-1.3-contributor`, variant `default`, 각 worktree directory 확인(보고서 본문의 MODEL_UNVERIFIED는 Muse 자기 보고 시점 표기).
검수 1차 호출은 시작 직후 SIGTERM(원인 불명, inotify ENOSPC 경고 동반)으로 끝나 같은 세션으로 1회 재개했다.
성능 메모: live 초기 JS gzip 약 126 KB(이전 약 115 KB). 지도 로그인 SDK는 별도 lazy chunk(약 55 KB gzip)로 로그인하거나 저장된 지도 세션이 있을 때만 받는다.
남은 NOT_RUN: 추이 결측 월 '—' 렌더의 브라우저 확인(단위 로직만), 스크린리더 전체 탐색.

## 과태료 금액 · 답변까지 걸린 기간 · 행정구역 경계 · 2026-09-27

| 항목 | 구현 | 로컬 검증 | 배포 | 실데이터 검증 |
|---|---|---|---|---|
| processing_duration | 완료 (`server/duration.ts`, 공개·개인·표·추이) | PASS_LOCAL: 단위(KST 달력일·윤년·제외 사유·중앙값/p90·그룹 재계산), 스택 | 아래 운영 반영 기록 | BLOCKED: 운영 사실 0건 |
| fine_amount | 완료 (`server/amount.ts`, 동의 정책 게이트, 개인 비교) | PASS_LOCAL: 분류·0원/미기재·부분 합산·정밀도, 스택에서 공개 허용 끄기→값 0건·켜기→합계 일치 | 〃 | BLOCKED: 운영 사실 0건 |
| 동의 2026-09-28.1 | 동의문·auth `202609280200`·map `202609280300`·PC/모바일 필수 버전 | PASS_LOCAL: 스택 27, PC 479(기존 실패 1 — 아래), 모바일 community 262 | 〃 | 앱 배포 뒤 실제 동의 흐름 NOT_RUN |
| region_boundaries | 완료 (코드표·경계·필터·목록·지도 레이어) | PASS_LOCAL: 지역 단위 9·경계 4, 실제 카카오 SDK에서 hover·클릭·목록·뒤로·확대·끄기·옛 URL·390(Sol), Muse PASS | 〃 | 실제 신고 지역키 분포 대조 BLOCKED |

- Muse 검수: `docs/reviews/dab-review.md`(commit `1566e6a`, 세션 `ses_f1ee4b3fbffeCn82Wwni2OFDzm`, export로 `opencode-go`/`muse-spark-1.3-contributor`/variant default·검수 worktree 확인).
  판정 PASS. 후속: DAB-01·02(경계 hover 카드·클릭→필터)는 Muse의 합성 mousemove가 폴리곤을 맞혔는지 불확실해 조건부로 적었고,
  Sol이 실제 포인터 이벤트(Playwright `page.mouse`)로 `경기도 · 신고 50건` 카드와 클릭 뒤 `region_code=41`을 확인했다.
  DAB-03은 결함 아님: 비교 토글은 의도적으로 `role="switch"`라 checkbox 역할 조회에 안 잡힌다(`getByRole('switch')`). DAB-04는 작업서 예시 오류(`?me=signed`가 맞음).
- Muse 호출은 두 번 중간 문장으로 턴을 끝내 같은 세션으로 두 번 재개했다(원인: 포트를 붙인 주소로 열어 카카오 출처 불일치).
- PC dev 기존 실패: `tests.test_db_backup_regression …restore_from_mobile_db…`는 dev 원본 `9a6662b`에서도 같은 `LegacyDatabaseRefused`로 실패(이번 변경과 무관).
- 모바일 전체 테스트의 골든 4건 실패도 dev 원본 `82efd333`에서 같게 실패.

## 지도 공유자 전용 전환 · 2026-09-27 (로컬 브랜치 `dev`, push 전)

| 항목 | 구현 | 로컬 검증 | 배포 | 실데이터 |
|---|---|---|---|---|
| 열람 조건: 카카오 로그인 + 공유 동의 + 지도에 올라간 본인 신고 1건 이상 | `server/viewerAuth.ts`, `publicHandler` PublicAccess, migration `202609280500`, `AccessGate` | 단위(handler 8·client 4), 로컬 스택(익명 401·동의 없음 403·업로드 없음 403·다른 Origin 403), 브라우저 E2E `access_gate_e2e.mjs` 10/10(`docs/integration/community-ingest/evidence/2026-09-27-access-gate/`) | 안 함(push·운영 적용 전) | NOT_RUN |
| 정적 통계 snapshot 중단 | `publish-pages.yml`에서 export 제거, 산출물 `data/` 없음 검사, 클라이언트 snapshot 읽기 제거 | live 빌드 산출물에 `data/` 없음, dist 스캔 통과 | 안 함 | — |

`upload_required`(동의했지만 올라간 신고 없음) 단계는 단위 테스트까지 확인했고, 로컬 스택 재실행은 다른 세션이 스택을 쓰는 중이라 이후에 한다.
