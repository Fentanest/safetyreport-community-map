# 지도 성능 리팩터링 main 통합·운영 적용

사용자의 후속 명시 요청으로 main 통합, 필요한 Supabase DB/함수와 Pages 배포를 승인받았다.
이전 [로컬 보고](../../refactoring/map-performance/REPORT.md)의 운영 미적용은 당시 종료 상태다.

현재 준비: 원격 main cf900966, 후보 eae2096. main에 fast-forward 통합했다.
운영 프로젝트 nxdcxccixoswvqgjeprh, pending migration040100~040800 총8개만 dry-run 확인했다.
변경 전 public/private schema와 기존 map 함수 본문은 .agent-runtime에 백업했다(자료 dump 아님).
운영 테이블 추정2872행/5365760bytes, 대기 lock0. 신규 index는 일반 transactional CREATE INDEX다.
Auth/secret/계정 설정·다른repo·auth 소유 함수는 변경하지 않는다.

진행 상태: DB8개 적용 완료, after dry-run pending0/seed0/role0. Edge public-analytics v16·my-analytics v14 갱신; ingest v8·my-reports v1·user-rankings v1은 동일 코드로 유지. 지도 소유5개 모두 ACTIVE/verify_jwt=true, auth 소유2개 불변. 익명 API5개401 확인. Pages/실사이트 smoke는 아직 미실행이다.
성능 전체 목표 미달과 실제 로그인 후 검증 한계는 로컬 보고에서 이어진다.

운영 SQL 추가 비교44개 PASS: 전체 대표 rows1·cohort state1·기존 session viewer14·랭킹28(7지표×두날짜축×전체/2023-07).
원본 function을 pg_temp에만 복제하고 repeatable-read snapshot에서 전체 body/version/rank/tie/me를 비교한 뒤 rollback했다.
실제 auth/session 식별자는 DB 안에만 남으며 응답증거는 검사명·boolean·수뿐이다. 실제 사용자 JWT/OAuth UI200 검증과 구분한다.
최초28조회 단일DO는 statement timeout으로 실패했다. 제품20s/각 SQL budget은 늘리지 않고 독립 SQL문으로 나눠 재실행했다.
새 map 함수10개는 운영/검증local 본문md5·설정·권한이 모두 일치하며 anon/authenticated execute를 거절한다.
