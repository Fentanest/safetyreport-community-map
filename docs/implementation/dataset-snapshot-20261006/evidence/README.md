# 증거 목록

- `before-fix-{before,after}-audit.json`: 이전 Edge, 쿼리 감사 SQL 전후, 실제 연속 ingest + 첫/재시도 409 재현.
- `after-fix-{before,after}-audit.json`: 새 화면 API, SQL 감사 전후, 각각 3분, 성공 응답의 버전/건수 불일치 0.
- `final-continuous-ingest.json` + `browser-final/`: 고정 f8d68e7, 306초/1,225건 및 그 안의 실제 브라우저 180초.
- `final-transition-ingest.json` + `browser-transition/`: 최종 5f8ef04, 215초/860건 및 그 안의 실제 브라우저 180초. 필터 요청 지연·취소→표 검색 포함. API 56개 모두 200, 오류/혼합 0.
- `sql-snapshot-probe*.json`: STABLE 함수 안에서 3초 사이 실제 ingest가 커밋돼도 state/facts 스냅샷 고정; 함수 밖 version 변경.
- `browser-console/`: 별도 계정 콘솔 포함 추가 기능 검사 40초, 14개 API 모두 200. 연속 ingest 구간으로 합산하지 않는다.
- `subpath-browser.json`: 최종 제품 live build, /community-map/ 미로그인 URL/새로고침/asset 검사. 외부 광고는 차단된 mock 응답이다.
- `muse-review-blocked.json`: OpenCode Go 구독 한도 거절, 실제 export의 provider/model/session과 오류 증거. 독립 Muse 승인은 없다.
- `local-restoration.json`: 원본 백업과 서비스 재시작 후 DB·컨테이너 대조.
- `logs/`: 실제 단위/통합/부하/build/scan/복원 로그. JWT·로컬 비밀값을 제거했다.

초기 `browser/`, `browser-second/`, `browser-console-first/`, `subpath-browser-first.json` 및 실패 로그는 재현 도구/fixture 보완 이전 실패이며 최종 PASS와 구분한다. `browser-third/`는 중간 수정본의 성공 기록이다. PNG는 실제 로컬 Chrome screenshot이다. 인증/SQL/Edge는 로컬 실제 서비스이고 지도 SDK/OAuth 신원/신고 내용은 합성 fixture다. 운영 DB·실제 Kakao·hosted Edge·Pages 결과로 해석하지 않는다.
