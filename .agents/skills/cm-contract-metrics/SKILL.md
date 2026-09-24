---
name: cm-contract-metrics
description: Define and test community-map metric denominators, date axes, and upstream capabilities.
---
# cm-contract-metrics

## 읽기
PROJECT_RULES.md, docs/data-contract.md, docs/metrics-catalog.md, docs/upstream-gaps.md.
## 실행
실제 원천 필드/날짜/교차차원 확보 여부를 확인하고 metric×field capability matrix를 쓴다.
report_date와 completed_date를 별도 axis로 유지하고 strict scalar/count schema를 먼저 만든다.
0분모·incomplete month·KST 월 경계·weighted rates·distinct contributor·monthly TOP5 trap fixture를 만들고
scripts/cm_spec.py와 tests/blueprint의 expected result를 실제 TypeScript/SQL 테스트로 이식한다.
## 출력
contracts, metrics tests, upstream gap와 모든 metric의 time_basis/numerator/denominator.
## 금지
marginal counts 비례분배, 결측을0/신고일로 대체, 평균의평균, TOP5리스트 합산.
