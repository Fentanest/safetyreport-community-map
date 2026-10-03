# 독립 검수와 수정 이력

Muse는 구현 branch/worktree에서 UI 커밋을 제출했고 Sol이 순차 통합했다. 이후 별도 고정 commit `7d25a9f`에서
`request_mode=review`로 제품 파일을 쓰지 않고 실제 Chromium 클릭/keyboard/console/network 검수를 했다.
실제 session `ses_efd7cb546ffeWpbPWumAPOOUOd`, provider/model `opencode-go/muse-spark-1.3-contributor`, variant `high`를
OpenCode export의 session 및 assistant model에서 확인했다. 원본 export의 대화·비용·token 정보는 공개하지 않는다.
[actual-model.json](evidence/muse-final/actual-model.json), [MUSE-FINAL-REVIEW](MUSE-FINAL-REVIEW.md), 행동 JSON와 실제 열린24개 screenshot을 회수했다.
초기 harness의 응답 waiter 등록 순서 race는 수정 후 재실행했고 최초 실패 증거도 유지했다.

고정 UI 검수는 APPROVE였다. OBS-01은 CSS `body.zoom=200%`의 유효 폭195px에서 topbar overflow였다.
실제 360/390px 정상 상태와 글꼴2배 확대는 별도 검사다. Sol은 Xvfb의 headed Chromium에서 격리 profile의
`partition.default_zoom_level.x`를 `log(2)/log(1.2)`로 설정해 **실제 페이지200%**를 추가 검증했다.
DPR2, CSS zoom1, layout384px, 실제768px viewport를 확인했다. 두 화면 × 두 테마의 overflow/keyboard 검사가 PASS다.
[결과](evidence/browser-zoom-cdp/results.json)의 screenshot 네 장을 실제로 열어 읽었다.
Chromium의 dictionary 형식은 [원본 구현](https://chromium.googlesource.com/chromium/src/+/caa5e0d1c9d58de7bbcf686857034253d0a26ac8/chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc)을 참고했다.
처음 잘못 지정한 float preference는100%에 머물러 FAIL로 확인했고 실제200%라고 합산하지 않았다.
Playwright fullPage가 실제 zoom viewport의 일부만 캡처한 자료 역시 최종 시각 증거로 사용하지 않고,
CDP `Page.captureScreenshot` viewport capture로 재생성 후 열었다. CSS195px OBS-01이 해결됐다고 주장하지 않는다.

production30회에서 랭킹 lazy boundary 진입이 느려졌다. 기존 locator polling 간격을 제거한 RAF 측정에서도 회귀가 남아
작은 RankingsPage module을 eager import로 복구했다. 화면 mount/API는 여전히 활성 랭킹에서만 실행되고 통계는lazy 유지다.
`2cd5442` 고정 worktree에서 Muse가 이 좁은 변경을 추가 검수해27/27 PASS, APPROVE를 제출했다. [MUSE-ENTRY-RECHECK](MUSE-ENTRY-RECHECK.md), 실제 session/model export evidence를 회수했다. 이후 실제 과거 월 검수에서 발견한 아래 두 결함을 작은 수정으로 추가했다.

Sol 자체 브라우저는 정확한 SQL/GoTrue ranking fixture와 Node synthetic statistics/mock SDK를 구분했다.
metadata503 재시도, 늦은 응답, 계정,20회 왕복, 실제 WASM Excel 생성/내용 검사가 있다. 상세 결과와 FAIL/SKIP 분리는 REPORT를 따른다.

## 마지막 두 조건 복원 수정의 독립 검수

29f836f의 native details 첫편집 초기화 제거,7542cde의 URL rk_min 숫자변환을 고정7542cde에서 Muse가 별도 worktree `.agent-runtime/mn`으로 검수했다. [MUSE-DRAFT-RECHECK](MUSE-DRAFT-RECHECK.md)는 좁은범위 APPROVE/37 checks를 제출했다. 그중1개(A2)는 fixture에 ranking API가 없음을 분류한 조건이며 실제 API/행 검사를 성공으로 합산하지 않는다. 나머지는 요청 signature와 실제React 컨트롤·빠른입력20회·URL/remount/history·keyboard/390양테마/1440의 검증이다. API 대신ViteHTML200으로 오류panel이 보이는 fixture이며 숫자/행/동률 자체는 이 검수에서 NOT RUN이다. Sol의 별도 최신실제GoTrue/SQL102+기간96 검사가 그 경로를 검증했다.

실제 session `ses_efcf5baabffenqaLB86SMogfsa` export의 directory 및 모든 assistant provider/model/variant가 opencode-go/muse-spark-1.3-contributor/high로 일치했고 product diff0을 확인했다. [actual-model](evidence/muse-draft/actual-model.json). Muse는4장 screenshot을 실제 열었고 Sol도2장을 열어 fixture오류panel/컨트롤을 확인했다. 처음 /tmp 및home profile 작성은 external_directory 자동거절로 browser승인 없이 종료됐다. Chrome의 긴 absolute TMPDIR가108-byte Unix socket 제한을 넘는 문제는 자기 worktree의 relative TMPDIR=.로 해결했고 같은 정확한 session으로 재개해 결과를 회수했다. host/global permissions/credentials 변경은 없다.
