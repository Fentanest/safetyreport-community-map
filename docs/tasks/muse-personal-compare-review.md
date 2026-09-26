# Muse 작업서 · 통합 commit 재검수(전체×내 신고 비교)
request_mode=review / policy_version=cm-2026-09-27
WORKTREE: __FILL__ (고정 commit에서 만든 검수 전용 worktree)
BASE_COMMIT: __FILL__ (Sol 통합 commit)
DATA_MODE: demo (합성 fixture). live 로그인은 Sol의 로컬 스택 E2E(scripts/integration/live_login_e2e.mjs)가 따로 확인한다.
DEV_URL: http://127.0.0.1:4175/

이번은 **검수**다. 제품 파일을 고치지 말고 증거와 이슈만 쓴다(작성 허용: docs/reviews/personal-compare-final.md,
docs/reviews/screenshots/personal-compare-final/**, .agent-runtime/**). 앞서 네가 구현한 branch와 Sol 통합 사이에 바뀐 점
(Sol이 데이터·접근성·문구를 고쳤을 수 있음)을 포함해 통합본 그대로 검수한다. 네 구현 branch 검사로 대체하지 않는다.

## 서버
```bash
VITE_DATA_MODE=demo npx vite build --outDir .agent-runtime/demo-dist && \
  npx vite preview --host 127.0.0.1 --port 4175 --strictPort --outDir .agent-runtime/demo-dist
```
Playwright: `/home/better0101/projects/safetyreport-community-auth/node_modules/playwright-core/index.mjs`, Chrome `/usr/bin/google-chrome`.
자기 preview PID만 종료.

## 검사(docs/personal-comparison.md §4–§6, docs/acceptance-matrix.md CMP01–CMP08)
1. viewport 1920×1080·1440×900·2560×1440·390×844 × dark/light × view both/map/stats 스크린샷을 열어 겹침·잘림·빈 칸·가독성 판정.
2. 비로그인 공개 화면 → 토글 → 로그인 안내 → 합성 로그인 → 비교 표 전체/내/차이. **전체 열 = 토글 끄고 본 공개 값**인지 숫자로 대조.
3. 지역 행 클릭 → URL `region_code`·칩·지도·표·내 값이 같은 조건으로 바뀌는지(내 값이 전체보다 크지 않은지). 별 → 새로고침 유지.
4. 담당자 비교 행 클릭 → 기관·담당자 조건 적용, 동명이인(김하늘 2명) 분리.
5. 지점 필터 전체/내 신고 포함/함께 기록한 지점/관심 지역: 개수·라벨·링 구분(색 외 텍스트), 통계 불변.
6. 추이: 내 점선·범례·표 보기 내 열. 결측 월 '—'.
7. 브리핑: 켜면 내 데이터 숨김·계정명 숨김 → `내 데이터 표시` → Esc 종료 후 원래 상태 복원.
8. 로그아웃: 공개 화면 유지, 내 값 사라짐, 안내 문구(앱 업로드 유지).
9. `?me=out|unconfigured|empty|expired|kakao|suspended|error|rate|stale`, `?fixture=one|empty|offline|rate|stale` 각 상태 문구·재시도.
10. 공유 버튼 URL에 비교/계정/me 값 없음. Tab/Enter/Space/Esc 키보드, focus 보임, 44px 터치, 390 페이지 가로 스크롤 0.
11. console error/warning, 4xx/5xx 0. 차이(%p)가 좋음/나쁨 색·평가 문구 없이 중립인지.

## 제출
REPORT_TEMPLATE 형식. 검수 commit, URL, browser/tool 버전, 결과표(viewport×theme×view), 행동표 PASS/FAIL, console/network,
이슈(id·severity·재현·기대/실제·스크린샷·file hint), BLOCKED(실 Kakao 지도·운영 인증)와 최종 판정.
