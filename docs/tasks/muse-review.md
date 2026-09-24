# M3 · 통합 브라우저 UI/UX 검수
request_mode=review, policy_version=cm-2026-09-24. Sol은 후보 commit/URL을 본문에 명시해서 발주한다.
검수 대상이 고정되지 않았으면 대상 확인부터 하고 pass를 쓰지 마라.

1. 1920×1080·1440×900·2560×1440·390×844, dark/light를 실제 브라우저로 열어라.
2. command filter, 날짜 apply/reset, map pan/scope commit, point/detail, table sort,
   agency/manager tabs, masked TOP5, chart brush, URL back, keyboard/Esc, briefing mode를 조작해라.
3. empty/one sample/missing completion/date zeros/long Korean names/map failure/API failure fixture를 확인해라.
4. console errors·failed network와 렌더 폭·잘림·overflow·모바일 터치·대비를 확인해라.
5. docs/reviews/M3-uiux.md와 screenshots를 남겨라. sample/live/실제 Kakao 키 성공을 정확히 구분해라.
6. 결함을 severity·재현·expected/actual·screenshot으로 보고하고 hard gate 미통과 상태에서 pass 금지.
검수 worktree의 제품 파일은 변경하지 않는다. 수정은 별도 구현 job으로 넘긴다.
