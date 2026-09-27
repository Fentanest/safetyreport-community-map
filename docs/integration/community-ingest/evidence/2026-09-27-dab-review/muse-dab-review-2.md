# 이어서: 카카오 SDK 차단 원인과 남은 검수 (같은 작업서 .agent-runtime/muse-dab-review.md)

카카오 차단 원인: 주소에 포트를 붙여 `http://safemap.worklazy.net:4176/`로 열어서, 출처(origin)가 등록 도메인 `http://safemap.worklazy.net`과 달라졌다.
포트는 resolver 규칙에만 넣고 주소에는 붙이지 않는다. Sol이 이 방법으로 실제 카카오 지도·경계를 띄우는 것을 확인했다.

```js
args: ['--host-resolver-rules=MAP safemap.worklazy.net 127.0.0.1:4176', ...]
await page.goto('http://safemap.worklazy.net/?...')
```
4176 서버(python http.server, .agent-runtime/demo-dist)는 떠 있다. 내려가 있으면 네 것만 다시 띄운다.

할 일:
1. `.agent-runtime/dab-review.mjs`를 고쳐 다시 실행하고, 작업서의 검사 1~8을 끝낸다(지도 영역은 반드시 `카카오 지도` 상태로).
   이미 찍은 뷰포트 스크린샷 중 지도가 목록 대체 상태로 나온 것은 다시 찍는다.
2. 스크린샷을 직접 열어 판정한다.
3. **반드시** `docs/reviews/dab-review.md`를 REPORT_TEMPLATE 형식으로 작성하고 끝낸다. 시간이 부족하면 끝낸 항목만 PASS/FAIL로, 나머지는 NOT_RUN으로 적는다.
제품 파일은 고치지 않는다.
