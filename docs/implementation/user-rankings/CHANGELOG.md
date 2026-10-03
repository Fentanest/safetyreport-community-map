# 2026-10-03 · user-rankings-v1

- 같은 날 기간 확장: 누적 불운자·월별 신고자/과태료·임의 과거 연월 조회, 공통 모집단 유지.
  추가 migration202610030200, 여섯 UI 진입점, 실제 글꼴 줄 간격 개선.
  최신 검사/측정/미검증 범위는 [기간 확장 보고](../ranking-periods/REPORT.md)와 [CHANGELOG](../ranking-periods/CHANGELOG.md).

- UUID 유저 랭킹: 세 테마·일곱 지표·단일 날짜 기준·전체/범위/월·표본1·공동순위·전역 내 순위·페이지.
- 기존 facts/활성 공유 계보에 연결한 set-wise 대표 선출, DB 전체 집계/정렬 RPC와 추가형 migration.
- 실제 fine 처분 확인 건수(일부수용·금액 미상 포함), completed_unknown 포함 N, 날짜 결측·모순 진단.
- 검증 JWT 본인, 기존 지도10건 gate, per-user rate limit, strict UUID/집계값 DTO, no-store·범위/version 페이지.
- 라이트/다크·모바일·UUID 전체/복사·나 강조·빈 상태/거절/오류/재시도·직접진입/새로고침/뒤로가기.
- 단위/실제 로컬 SQL·세션 통합/50만 고유 신고 측정/Chrome 브라우저 증거와 적용 절차.
- push·운영 SQL·Edge·Pages 배포·계정 설정 변경 없음. 운영 연동은 미검증.

- 검증: 단위599, SQL/실제 로컬 Deno 통합11, 50만 성능1, 브라우저43, Pages 하위 경로 통과.
- 상세 결과·제약·재현: [REPORT.md](REPORT.md).
- Muse가 확인한 비로그인 라이트 테마 누락 수정, 공통 테마 함수 재사용. 실제 텍스트200%·대비·익명 테마·로그아웃 이력7검사 통과.
