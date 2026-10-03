# muse-m0 evidence — reference review (actually viewed)

- Date (KST): 2026-10-03, request_mode=plan, HEAD `cf9009666a164ca91f694fd5a4164bffbe29ef0b`.
- Tool: Read-tool image viewing (no MCP, no dev server in this turn).
- Files actually opened and read pixel-content:
  1. `docs/implementation/ranking-periods/evidence/browser/390-dark-july.png` — mobile dark, `2023년 7월의 최다 신고자`, six-preset form (누적·기간별/월별), period `월별` selected, `July 2023` month input, `적용/초기화` global buttons, `내 순위` block, `2023년 7월의 최다 신고자 표 / 참여자 26명`, joint `1위 공동 6명` rows with short UUID + per-row `전체 UUID 보기`, pager `1페이지 · 20명씩`, `지표를 읽는 기준` with N/F/진단 terms visible.
  2. `docs/implementation/ranking-periods/evidence/browser/july-fines-rate.png` — desktop dark `2023년 7월의 최다 과태료 수용자`, same six-preset + global 적용 structure, `내 순위 1위 값 50.0% 1/2건 완료 신고 2건 공동 7명`, columns `순위/사용자/값/신고` (generic `값` header — one of the items the new spec removes), joint-rank rows, self row highlighted with `나` badge, pager `1페이지 · 20명씩`.
- Reference board: `design/reference-ui/index.html` read as source (53 lines); map area is an explicit design mock (`실제 Kakao 지도 아님`), not a functional requirement source.
- What this confirms for the plan: current UI = six shortcuts + single 적용 + generic `값` column + per-row details UUID + `N페이지 · 20명씩` pager + on-screen N/F/진단 terms — i.e. exactly the §8 delta items listed in MUSE-M0.md §3–§4.
- Not done here: live dev-server interaction, keyboard walkthrough, console/network capture (deferred to the implementation lane with the Playwright harnesses).
