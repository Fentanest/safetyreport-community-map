# 랭킹 기간 확장 계획 · 2026-10-03

기준 `dev`의 `6132e4b`, 작업 브랜치 `feat/ranking-periods`. 현재 `origin/main`의 `8cfacb2`를 포함한다.
작업 시작 때 미커밋 변경은 없었다. 기존 dev 작업을 보존하며 운영 적용·push는 하지 않는다.

1. 모든 theme에 `all/range/month`를 허용한다. 기존 일곱 지표, 분모, 대표 선정, UUID/JWT, 열람 gate, 페이지 버전을 유지한다.
2. 누적·기간별 세 진입점과 월별 세 진입점을 제공한다. 기본 조회월은 KST 이번 달이며 과거월 제목은 실제 연월이다.
   월별 테마 전환에서 선택월·날짜 기준·분류·표본을 유지한다. 예를 들어 2023년 7월의 세 테마는 모두
   같은 7월 1~31일 완료 신고 집합을 쓴다. 불수용·일부수용 각각의 건수·비율을 유지한다.
3. 기존 RPC 서명·DTO를 유지하고 추가형 `202610030200` migration으로 불운자 테마의 월 전용 조건만 해제한다.
4. 계약·단위 테스트, 실제 로컬 DB의 과거월/누적/대표 선정/페이지 버전/월말·연말/날짜 기준,
   실제 Chrome의 조회·테마·기간·브라우저 이력을 검증한다. 50만 고유 신고 성능도 확장 기간으로 재측정한다.
5. 고정 통합 커밋에서 Muse 검수 후 문서·CHANGELOG를 갱신하고 로컬 커밋으로 정리한다.

## 파일 소유

- Sol: contracts/, src/domain/rankingPeriods.ts, migration/manifest, tests/, scripts/browser/, 문서·통합.
- Muse: 별도 worktree의 src/pages/RankingsPage.tsx, src/styles/rankings.css만 제품 수정.
- Muse 증거·보고: docs/implementation/ranking-periods/evidence/muse-implementation/**,
  docs/reviews/ranking-periods-muse-implementation.md.

공통 계약은 Sol 단독 작성. Muse의 완료 diff/commit 회수 후 Sol이 순차 통합한다. 검수 worktree는 고정 통합 커밋에서 만든다.
