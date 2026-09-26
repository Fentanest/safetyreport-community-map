# Muse 작업서 · 전체×내 신고 비교 UI 공동 구현 + 실제 브라우저 검수
request_mode=implementation / policy_version=cm-2026-09-27 / 발주자: Sol 역할(통합 담당)
WORKTREE: /home/better0101/projects/safetyreport-community-map-muse-compare
BRANCH: muse/personal-compare
BASE_COMMIT: 9ab2631
DATA_MODE: demo (합성 fixture — 실제 신고·계정 아님)
DEV_URL: http://127.0.0.1:4174/  (아래 '서버' 절차. 이 호스트는 inotify 한도 때문에 `vite` dev 서버가 ENOSPC로 죽는다.
호스트 설정을 바꾸지 말고 build + preview를 쓴다.)

## 먼저 읽기(실제로 열 것)
AGENTS.md, MUSE.md, PROJECT_RULES.md, **docs/personal-comparison.md(이번 정본, 특히 §4–§6)**, docs/ui-spec.md(토큰·타이포·상태 규칙),
design/tokens.css, .agents/skills/cm-cinematic-ui/SKILL.md, .agents/skills/cm-browser-review/SKILL.md, docs/reviews/REPORT_TEMPLATE.md.
기존 화면(공개 지도·차트·표)의 동작은 보존한다. 과거 기준판 배치와 충돌하면 docs/personal-comparison.md §5를 따른다.
"더 세련되게" 식으로 전면 재설계하지 말고 §5의 배치·비교 방식을 구현한다.

## 소유 파일(이 범위만 수정)
- src/components/** (새 컴포넌트 추가 가능)
- src/pages/Dashboard.tsx — **레이아웃 JSX와 표시 로직만**. 데이터·인증·버전 검사 로직(usePersonalCompare, consistentWithPublic,
  compareDisabledReason, briefingHidden, pushUrl/share, pickRegion)은 의미를 바꾸지 말 것
- src/styles/app.css
- src/lib/kakao.ts (마커 표시만: 내 지점 링·함께 기록 점선 링·관심 별. SDK 로딩/좌표/이벤트 계약 유지)
- docs/reviews/personal-compare-impl.md, docs/reviews/screenshots/personal-compare-impl/**

## 권한 밖(수정 금지 — 필요하면 보고서 'Sol 요청'에 적기)
src/data/**, src/domain/**, src/auth/**, src/hooks/**, src/state/**, server/**, supabase/**, scripts/**, tests/**, contracts/**,
package.json, package-lock.json, design/tokens.*, .github/**, 호스트 설정, 다른 worktree.
git push·reset --hard·clean 금지. 작업 끝에 이 worktree에서 **로컬 commit**만 한다(메시지 영어 한 줄 + 본문).

## 구현할 것 (Sol 기준선은 기능만 되어 있고 시각 구현은 비어 있다)
1. **두 열 대시보드**(§5.1): `.compare-layout` 좌(지도+짧은 지역 목록) / 우(선택 지점 카드·비교 KPI 표·담당자 비교·추이).
   1920 좌1.35fr/우1fr(min420), 2560 1.5/1, 1440 1.2/1(우 min380), ≤1100 한 열. 하단 분석 행은 이제 카드 2개(처리결과·차량TOP5)이므로
   빈 칸 없이 2열로 맞춘다. 기존 6 KPI 행은 없앴다(비교 KPI 표가 대신함) — 숫자 중복 금지.
2. **보기 전환**(§5.2): both/map/stats 배치를 CSS와 JSX로 실제로 구현(현재 map/stats는 한 열로만 떨어짐).
   map: 지도 크게 + 지역 목록 오른쪽 좁은 열 + 통계는 지도 위 한 줄 요약(전체/내 R·C·수용%). stats: 통계 2열 그리드 + 지도 미니(280) + [지도 크게] 버튼(view=both로).
   전환 후 지도 relayout(MapPanel이 resize 이벤트 사용 — 필요하면 window resize dispatch 또는 prop).
3. **비교 KPI 표**(CompareKpis): 지표 × 전체/내 신고/차이. 내 값은 `--brand-ink` 글자, %p는 중립색(좋음/나쁨 색 금지), 분모·기준일 small 유지.
   로그아웃/미설정/오류/로딩/공유 없음 상태(§6)를 내 열 자리 안에서 보기 좋게. 390에서는 3열 고정, 가로 스크롤 없이.
4. **지역 목록**(RegionList §5.4): 짧은 목록, 관심 지역 고정, 전체/내 정렬, 행=지역 조건 적용, 별=관심 토글(44px).
5. **담당자·기관 비교**(ManagerCompare): 전체 성명+기관, 표본 1건 배지, %p 중립. 평가·순위 문구 금지.
6. **지도**(MapPanel·kakao.ts §5.3): 지점 필터 segmented, 범례에 `내 신고 포함(청색 링)`/`함께 기록한 지점(점선 링)`/`관심 지역(★)`.
   실지도 키가 없으므로 fallback 지점 목록에서도 같은 구분(텍스트 배지 + 링 모양)을 보이게. 색만으로 구분 금지.
   fallback 오류 카드가 지도 영역을 과도하게 차지하지 않게(현재 큼).
7. **계정·토글**: AccountMenu(로그인 버튼/내 계정 메뉴/로그아웃 안내 "앱 업로드 연결은 유지"), ViewControls(스위치 + segmented).
   브리핑 모드: 내 데이터 기본 숨김 + 브리핑 바의 `내 데이터 표시` 버튼(이미 연결됨) 시각 정리, 계정명 숨김.
8. **추이**(TrendCard): 내 신고 점선 시리즈 + 범례(점선 표시) + 표 보기의 내 열. 단위 다른 dual-axis 금지.
9. **모바일 390·라이트·다크**: 토큰만, 라이트에서 dark 잔존 금지, 페이지 가로 스크롤 0, 터치 44px, bottom nav 유지.
10. EntityTable 비교 열(내 완료/내 수용·일부/차이)을 모바일에서도 접근 가능하게.

## 서버(포트 4174, 자기 프로세스만 종료)
```bash
cd /home/better0101/projects/safetyreport-community-map-muse-compare
VITE_DATA_MODE=demo npx vite build --outDir .agent-runtime/demo-dist && \
  npx vite preview --host 127.0.0.1 --port 4174 --strictPort --outDir .agent-runtime/demo-dist
```
코드를 고칠 때마다 다시 build. preview 프로세스는 끝날 때 **자기가 띄운 PID만** 종료(broad pkill 금지).
합성 로그인/상태: 헤더 `카카오 로그인 (합성)` 클릭 또는 URL `?me=signed|out|unconfigured|empty|expired|kakao|suspended|error|rate|stale`.
공개 상태: `?fixture=one|empty|offline|rate|stale`. 보기: `?view=map|stats`.

## 브라우저 검수(필수, 소스 읽기로 대체 금지)
Playwright: `import { chromium } from '/home/better0101/projects/safetyreport-community-auth/node_modules/playwright-core/index.mjs'`,
`executablePath: '/usr/bin/google-chrome'`. 스크립트는 `.agent-runtime/` 아래에 둔다(커밋하지 않음).
- viewport 1920×1080 / 1440×900 / 2560×1440 / 390×844 × dark/light, 각 both/map/stats.
- 행동: 합성 로그인 → 토글 on → KPI 내 열 표시, 지역 행 클릭(범위 변경·URL), 별 토글(새로고침 후 유지),
  지점 필터 4종, 담당자 행 클릭(기관·담당자 조건 칩), 추이 표 보기, 브리핑(숨김→표시→Esc 복원), 로그아웃(공개 화면 유지),
  `?me=` 오류 상태 전부, `?fixture=one|empty`, 키보드 Tab/Enter/Esc, 390 가로 스크롤 0.
- console error/warning, 4xx/5xx 네트워크 0 확인. 스크린샷을 **직접 열어** 겹침·잘림·가독성 확인 후 수정 → 재검수.

## 제출
- 로컬 commit(해시 보고). docs/reviews/personal-compare-impl.md: REPORT_TEMPLATE 형식 + 검수 commit, URL, fixture 명시,
  browser/tool 버전, viewport×theme×view 결과표, 행동 검사표(PASS/FAIL), console/network, 이슈(id·severity·재현·기대/실제·스크린샷·file),
  남은 문제, 'Sol 요청'(권한 밖 변경 필요 사항).
- 실지도(Kakao 키 없음)와 운영 인증은 BLOCKED로 적고 PASS로 쓰지 않는다. 합성 fixture 범위만 판정한다.
