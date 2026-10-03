# 커뮤니티 신고 지도
`Fentanest/safetyreport-community-map` · 나만의 안전신문고 제품군의 공개 데이터 탐색 화면.

React/TypeScript 상황판, 합성 데이터 모드, 비공개 사실 집계 함수, 공개 읽기 API와 정적 snapshot
exporter의 로컬 구현이 있다. 기존 v1 SQL은 보존했다. 현재 운영 v2 사실·Kakao 키·공개 API 설정이
없어 실제 데이터와 실지도 연동은 검증되지 않았다.

## 제품
전국 카카오 지도, 선택 날짜 범위, 지도 범위와 연동되는 신고/처리/처분 통계,
기관·담당자 처리결과 비교, 마스킹 차량 TOP5, 상세 지점 패널, 라이트·다크, 브리핑 모드.
담당자 전체 성명·정확 좌표·1건 표본 공개는 확정 정책이다. UUID 랭킹 전용 집계 이외의 계정정보와 차량 원번호는 공개하지 않는다.

## 전체 × 내 신고 비교 (2026-09-27)
같은 기간·지역·기관·담당자 조건에서 전체 통계와 내 신고 통계를 나란히 보는 커뮤니티 지도다. 정본은
`docs/personal-comparison.md`. 2026-09-27부터 지도는 **공유자 전용**(카카오 로그인 + 공유 동의 + 지도에 올라간 본인 신고 1건 이상, docs/public-api-contract.md §열람 조건)이고, `내 데이터 함께 보기`를 켜면 비교 KPI·지역 목록·
담당자 비교·지도(내 지점/함께 기록한 지점/관심 지역)·월별 추이에 내 값이 붙는다. 개인 자료는 `my-analytics`(verify_jwt, private/no-store)로만
오고 공개 API·정적 snapshot·공유 URL에 섞이지 않는다. 지도 로그아웃은 이 브라우저 세션만 끝내며(`scope: 'local'`) 앱·서버 자동 업로드는 계속된다.
데모의 합성 로그인: 헤더 `카카오 로그인 (합성)` 또는 `?me=signed|out|unconfigured|empty|expired|kakao|suspended|error|rate|stale`,
보기 전환 `?view=map|stats`.

## 유저 랭킹 (2026-10-03)

‘유저 랭킹’ / `?screen=rankings`에서 공유 완료 신고의 UUID별 신고·실제 과태료·월별 불수용·일부수용 건수/비율을 봅니다.
DB가 사용자별 중복 제거와 전체 순위를 계산하고, 동일 지도 열람 게이트(공유 10건)를 적용합니다.
[구현·검증·운영 적용 절차](docs/user-rankings.md). 로컬 구현이며 push/운영 SQL/Edge/Pages 배포는 하지 않았습니다.

## 로컬 실행

```bash
npm ci
VITE_DATA_MODE=demo npm run dev -- --port 4173
npm test
python3 -m unittest discover -s tests/product -p 'test_*.py' -v
python3 -m unittest discover -s tests/blueprint -v
VITE_DATA_MODE=live npm run build
npm run scan
# 선택: 합성 로컬 Supabase 스택(tests/integration/*.test.ts 머리말 절차) 위에서 개인 비교·인증 경계 검사
COMMUNITY_STACK=1 npx vitest run tests/integration/my-analytics-stack.test.ts
```

데모 화면은 `http://127.0.0.1:4173/`이다. `?fixture=one`과 `?fixture=empty`로 1건·무자료,
`?fixture=offline`, `?fixture=rate`, `?fixture=stale`로 연결 실패·429·버전 변경 상태를 확인할 수 있다.
데모는 합성 공개 DTO만 사용하며, 임의 범위에는 지원하지 않는 집계를
만들어 표시하지 않는다. Kakao JavaScript 키가 없으면 지도 오류 안내와 지점 목록이 표시된다.
`design/reference-ui/index.html`은 디자인 기준판이며 제품 화면과 별개다.

## 커뮤니티 계정 연결

카카오 계정 연결 중앙 페이지(`https://safeauth.worklazy.net/`)와 relay는 별도 저장소
`Fentanest/safetyreport-community-auth`에서 관리한다. 이 저장소는 지도(`https://safemap.worklazy.net/`)만 다룬다.

## 데이터·배포 경계

운영 UI는 `VITE_DATA_MODE=live`, `VITE_PUBLIC_ANALYTICS_URL=https://<project>.supabase.co/functions/v1`,
`VITE_KAKAO_MAP_JS_KEY`(공개 JS 키), `VITE_BASE_PATH=/`를 사용한다(공개 주소 `https://safemap.worklazy.net/`).
임의 날짜·복합 필터·차량 TOP5는 `supabase/functions/public-analytics/`의 공유자 인증 GET API가
private v2 사실에서 정확히 집계한다. 차량은 지역 접두어를 내부 동일성에 보존하고, 공개 시 지역명은
그대로 두고 그 뒤 번호의 2·4·6번째 글자를 마스킹한다(경기76자3623 → 경기7*자*6*3). API에는 계정·원번호·전역 차량 키를 내보내지 않는다.

`supabase/migrations/202609240001_analytics_v2.sql`은 **운영 미적용** 로컬 제안이다. 기존 연간
집계에서 없는 일자·담당자 결과 교차·차량 후보를 재구성하지 않는다. 초기 `ready=false`여서 upstream
v2 사실이 적재·검증되기 전에는 API가 준비 상태를 표시한다. 정적 첫 화면 캐시는 공개 API에서만
`PUBLIC_ANALYTICS_URL=... npm run data:export`로 생성하며, API version이 다르면 사용하지 않는다.
`product-check.yml`은 검증 전용이다. `publish-pages.yml`은 main에서 수동 실행할 때만
공개 API snapshot 검증 후 Pages 배포를 시도하며, 아직 실행하지 않았다.

## 설계
- docs/personal-comparison.md — 전체×내 신고 비교 개편 정본(인증 경계·계산·배치·상태)
- docs/product-decisions.md — 고정 요구와 이번 결정
- docs/architecture.md — Pages + 공개 읽기 API + Actions 초기 캐시
- docs/data-contract.md / metrics-catalog.md / public-api-contract.md — 정확한 계산·응답
- docs/ui-spec.md / screen-by-screen.md / design-system.md — 화면 구현 기준
- docs/agent-dispatch-runbook.md — Sol·Muse 협업
- docs/acceptance-matrix.md / deployment.md — 검증·운영 준비
- docs/repository-audit.md — 옛 데이터 모델과의 차이
- docs/upstream-gaps.md — 실제 v1 필드와 v2 필요 필드
- docs/implementation/verification-status.md — 통과·차단·남은 구현 항목
- docs/reviews/ — Muse의 M0/M1/M2/M3/M3-F 브라우저 검수·스크린샷

지도 열람은 공유자 전용이다(위). 업로더의 카카오 계정 연결·필수 공유 동의·실시간/수동/00:00 KST 업로드는 기존 앱/서버의 기능이며(`contracts/community-ingest/`, `supabase/functions/community-ingest/`)
그 계약은 docs/client-integration.md에 유지한다. 이 UI 작업을 핑계로 SMS 인증을 다시 넣지 않는다.
