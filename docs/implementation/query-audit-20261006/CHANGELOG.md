# Query audit · 2026-10-06

기준 커밋 `5cf45c6`과 앞선 `202610060100` migration은 그대로 유지했다.

- `202610060200_query_read_paths.sql`: v2/state 및 viewer의 fact별 동의 함수 호출을 grant 조인으로 바꾸고, cohort metadata의 두 날짜 경계를 한 번에 계산한다. 레거시 v2 facts는 같은 날짜 합집합·선별 순서·공개 필드·100,000행 제한을 유지하며 generic plan의 중첩 루프를 함수 내부에서만 피한다. 개인 통계의 존재 검사와 랭킹 grant 검사도 조인으로 바꾼다. ranking의 own CTE가 1행으로 추정되는 재현 사례에도 함수 범위의 nested loop 억제를 적용한다.
- `202610060300_manifest_statement_batches.sql`: INSERT/DELETE 전이 테이블의 completed 행 수를 데이터셋별로 합산한다. manifest generation의 정확한 증가량을 보존하며 UPDATE의 키 이동 판정은 원래 행 트리거를 유지한다.
- `202610060400_agency_recompute_batch.sql`: 같은 registry lock과 compare-and-set 조건으로 기관 보정을 한 번에 UPDATE한다. 빈 배치에는 projection 갱신이 없고, 비어 있지 않은 배치는 적용 건수와 관계없이 version을 무효화한다.
- `202610060500_rollup_region_inputs.sql`: 지역 필터의 같은 입력을 쿼리 내에서 한 번 해석한다. 좌표 없는 해석이 가능한 지역명과 좌표가 필요한 분할 구역을 구분하며 경계 지오메트리·NULL 처리 결과를 유지한다.
- 74개 유효 함수, RLS/트리거/인덱스, Edge 호출 경로의 목록 및 3천/3만 fact·custom/generic 합성 측정 도구를 추가한다. 이전 정의와의 JSON 동등성, manifest 증가량, CAS 오류, 역할별 접근 검사를 실행 가능하게 남긴다.

새 인덱스·제품 Edge 코드·응답 DTO·권한·타임아웃 변경은 없다. 최종 수치와 미해결 항목은 REPORT.md, 운영 명령은 MIGRATION.md에 기록한다.

검사 도구는 서로 공유하던 mock 계정 F를 개인 접근 거절 검사 전용 L과 분리한다. viewer without-index 측정은 롤백 안에서 기존 인덱스를 제거해 fixture를 복원하며, 내 신고/브라우저 산출물 및 rollup 계획 원문의 경로를 선택할 수 있게 한다. 검증 조건·반복 수·제품 timeout은 완화하지 않는다.

50만 건 공용 seed의 동일 JSON record 복제를 LATERAL 한 번 평가로 표현해 준비 단계에서 열마다 함수를 재평가하는 비용을 줄였다. 합성 값·건수·측정 쿼리·기본 반복 수·assertion은 유지한다.
