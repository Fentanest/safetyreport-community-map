# 실행 방법

이 폴더 전체를 `safetyreport-community-map` 저장소에서 읽을 수 있는 위치에 둔다. 권장 위치는 `docs/implementation/dashboard-redesign/`이다. 참고 PNG는 디자인 검토 자료이지 제품 번들 자산이 아니다.

개발 에이전트에게 다음을 전달한다.

```text
이 저장소의 AGENTS.md와 PROJECT_RULES.md를 먼저 읽고,
docs/implementation/dashboard-redesign/IMPLEMENTATION_PROMPT.md를 이번 작업의 구현 지시서로 사용해.
같은 폴더의 ACCEPTANCE_TESTS.md와 references/approved-dashboard.png, references/current-dashboard.png도 확인해.

승인 시안대로 레이아웃을 재구성하면서 R01~R10과 A01~A06을 모두 구현해.
지도 반복 조회와 날짜 포커스의 원인부터 수정하고,
주소별 핀·계도 건수·장소별 기관/담당자 상세·신규 차트를 서버 집계부터 화면까지 연결해.
CSS만 바꾸거나 mock 데이터만 연결한 시안으로 끝내지 마.

현재 작업 변경을 보존하고, 저장소 규칙에 따라 Sol/Muse가 협업해.
검토·계획만 제출하지 말고 구현·자동검사·실제 브라우저 검수를 진행해.
운영 권한이 필요한 변경만 별도로 정리하고 로컬에서 가능한 작업은 완료해.
마지막에는 인수 기준별 코드/검사/화면 증거와 실제 운영 적용 여부를 구분해 보고해.
```

폴더를 다른 위치에 두었다면 위 세 경로만 실제 위치로 바꾼다. 이미지의 수치·원본 차량번호·예시 기관명은 구현할 데이터가 아니라는 점이 본문에 명시되어 있다.
