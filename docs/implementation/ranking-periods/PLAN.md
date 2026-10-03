# 랭킹 기간 확장 계획 · 2026-10-03

기준dev6132e4b, 작업feat/ranking-periods. 현재 origin/main8cfacb2를 포함한다. 미커밋 변경없음.

1. 모든 theme에 all/range/month 허용. 기존7지표/분모/대표선정/UUID/JWT/열람 gate와페이지버전 유지.
2. 누적·기간별: 최다신고자/최다과태료수용자/최다불운자, 월별: 월별최다신고자/월별최다과태료수용자/월별불운자.
   기본조회월 KST이번달. 과거월 선택하면 실제년월 제목. 선택월/기준일/분류/표본은 월별테마변경에유지.
   예시2023-07 세테마는 모두동일한2023-07-01~31 N을 사용한다. 불수용/일부수용 각각건수·비율 유지.
3. 기존RPC공개서명·DTO 유지, 추가형202610030200 migration으로월전용조건만해제. 운영미적용.
4. 계약+단위, 실제LOCALDB 과거월/누적/대표선정/페이지버전/월말·연말/날짜기준, Chrome실제조회와테마/기간/이력 검증.
5. 고정통합커밋 Muse검수, 문서·CHANGELOG·로컬커밋. push/SQL운영적용/Edge·Pages배포안함.

## 파일 소유
Sol: contracts/, src/domain/rankingPeriods.ts, migration/manifest, tests/, scripts/browser/, 문서/통합.
Muse: 별도 ranking-periods-muse worktree의src/pages/RankingsPage.tsx, src/styles/rankings.css만제품수정.
Muse실제브라우저증거/보고: docs/implementation/ranking-periods/evidence/muse-implementation/**, docs/reviews/ranking-periods-muse-implementation.md.
공통계약은Sol단독작성. Muse완료diff/commit회수후Sol순차통합. 검수worktree는고정통합commit.
