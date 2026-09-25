# 디자인 자료
토큰·브라우저 기준판·기존 보드·재사용용 로고 crop을 함께 제공한다.
기준판 URL: /design/reference-ui/index.html. 모든 수치/이름은 합성 예시, 지도는 모형이다.
원본 참고 보드 PNG(design/references/)는 실제처럼 보이는 차량번호·이름·주소가 들어 있어 2026-09-26 저장소에서 삭제했다. 기준은 design/tokens, design/reference-ui, docs/ui-spec.md다.
구현물은 design/tokens와 허용된 assets만 필요한 부분을 source에 옮기고 기준판을 그대로 live app으로 납품하지 않는다.
폰트 binary 미포함. 별도 디자인 방향 질문 없이 docs/ui-spec.md를 기준으로 Muse와 구현한다.

## 브라우저 검증 자료
`reference-ui/screenshots/`에 1920 다크/라이트, 1440·2560 다크, 390 다크/라이트, 브리핑 모드 스크린샷을 포함한다.
이것은 합성 데이터 기준판의 실제 Chromium 렌더링이며 live Kakao 지도나 Muse 검수 결과가 아니다.
인라인 테스트 경위·검증 한계는 ZIP 루트 `PACKAGE_TEST_REPORT.md`에 있다.
`python3 scripts/capture_reference.py`로 로컬 기준판을 다시 검사할 수 있다(Playwright 별도 준비).
