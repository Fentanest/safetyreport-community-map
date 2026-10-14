# 통계 10만 건 제한 제거 · 2026-10-14

사용자 보고: 첫 진입 screen 요청에서 RESULT_TOO_LARGE / HTTP 422.
후속 사용자 결정: “10만건제한을 왜 해. 하지마”. 통계 후보·결과 행 수의 100,000 제한을 제거한다.

## 작업 범위와 소유
- base: 236084e, branch: fix/screen-result-too-large-20261014.
- Sol 단일 writer: 새 migration, server/screenHandler.ts, server/personalHandler.ts, server/publicHandler.ts,
  supabase/functions/public-analytics/index.ts, 관련 테스트·문서.
- 별도 worktree `.agent-runtime/result-too-large`. 다른 작업트리는 수정하지 않는다.
- 원본/compact cohort, 구 v2 facts, screen v1/v2, split cache, precomputed 집계를 모두 포함한다.
- 대표 선정·기간·분모·마스킹·동의·열람 자격은 그대로다. 조용한 LIMIT/샘플링/기간 변경 없음.
- 출력 페이지 크기와 맞춤 통계 셀 수 제한은 신고 건수 제한과 별개다.

## 운영 적용
아직 적용하지 않음. SQL migration과 public-analytics / my-analytics Edge 배포가 필요하다.
운영 SQL·push·배포는 PROJECT_RULES.md의 별도 승인 경계를 따른다.

## 검증
진행 중. 로컬 합성 데이터 검사 결과를 아래에 기록한다.
