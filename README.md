# 커뮤니티 신고 지도
`Fentanest/safetyreport-community-map` · 나만의 안전신문고 제품군의 공개 데이터 탐색 화면.

현재 포함된 것은 2026-09-24 구현 정본과 착수 도구다. 기존 v1 SQL는 보존되어 있으며
이 정본이 요구하는 v2 데이터/읽기 API와 웹앱은 구현·연동 검증이 필요하다. 실운영 완성을 주장하지 않는다.

## 제품
전국 카카오 지도, 선택 날짜 범위, 지도 범위와 연동되는 신고/처리/처분 통계,
기관·담당자 처리결과 비교, 마스킹 차량 TOP5, 상세 지점 패널, 라이트·다크, 브리핑 모드.
담당자 전체 성명·정확 좌표·1건 표본 공개는 확정 정책이다. 계정정보와 차량 원번호는 공개하지 않는다.

## 실행 착수
AGENTS.md와 docs/implementation/MASTER_PROMPT.md를 읽는다.
```bash
python3 -m unittest discover -s tests/blueprint -v
python3 scripts/cm_doctor.py
python3 -m http.server 4179 --bind 127.0.0.1
```
`/design/reference-ui/index.html`은 구현 전 UI 기준판이다. 합성 데이터와 지도 모형이라는 표시를 유지한다.

## 설계
- docs/product-decisions.md — 고정 요구와 이번 결정
- docs/architecture.md — Pages + 공개 읽기 API + Actions 초기 캐시
- docs/data-contract.md / metrics-catalog.md / public-api-contract.md — 정확한 계산·응답
- docs/ui-spec.md / screen-by-screen.md / design-system.md — 화면 구현 기준
- docs/agent-dispatch-runbook.md — Sol·Muse 협업
- docs/acceptance-matrix.md / deployment.md — 검증·운영 준비
- docs/repository-audit.md — 옛 데이터 모델과의 차이

공개 열람은 비로그인이다. 업로더의 Google Auth·세션 갱신·02~03시 자동 업로드는 기존 앱/서버의 별도 기능이며
그 계약은 docs/client-integration.md에 유지한다. 이 UI 작업을 핑계로 SMS 인증을 다시 넣지 않는다.
