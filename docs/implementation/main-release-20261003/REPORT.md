# main 통합 및 운영 배포 · 2026-10-03

사용자의 main 통합·Supabase·Pages 배포 명시 요청에 따라 수행했다. 과거 보고서의 ‘미적용’은 해당 작업 종료 시점 기록이며, 이번 운영 적용 상태는 이 문서가 정본이다.

## 통합과 운영 적용

- 기준 원격 main `8cfacb2`, 기존 dev `6132e4b`, 랭킹 기간 확장 `d473ed7`을 보존해 merge commit `f9f653741cf5c48c35ee1d2633f58713b62679cf`로 통합하고 origin/main에 push했다. 변경 전 미커밋 파일은 없었다.
- 모든 로컬 작업 브랜치를 main에 포함한 뒤 정상 `git branch -d`로 dev·feat/ranking-periods를 삭제했다. 작업 폴더는 원래 저장소 하나이며 local branch는 main 하나다. force push/reset/clean은 사용하지 않았다.
- 운영 프로젝트 `nxdcxccixoswvqgjeprh`에 필요한 선행 migration은 이미 적용돼 있었다. 정본 composed migration33개를 확인한 dry-run에서 신규 두 개만 대상이었다.
- `npx supabase db push --linked --skip-vault --yes --workdir .agent-runtime/releases/20261003-main`으로 `202610030100_user_rankings.sql`, `202610030200_user_ranking_periods.sql`을 실제 적용했다. 적용 후 dry-run은 upToDate=true, migrations/seeds/roles 빈 목록이다. 운영 reset/seed/계정·secret·Auth 설정 변경은 없었다.
- `npx supabase functions deploy public-analytics my-analytics community-ingest my-reports user-rankings --project-ref nxdcxccixoswvqgjeprh --jobs 1`을 실제 실행했다. Docker bundling으로 기존 registry를 포함했다. 5개 함수 모두 ACTIVE/verify_jwt=true다. public-analytics v15·my-analytics v13 갱신, user-rankings v1 신규 배포; community-ingest v8·my-reports v1은 CLI가 동일 코드임을 확인해 기존 버전을 유지했다. auth 소유 community-account/community-auth-relay는 수정하지 않았다.
- main에서 수동 Pages workflow를 실행했다. [Actions37107584086](https://github.com/Fentanest/safetyreport-community-map/actions/runs/37107584086)의 build/deploy가 모두 success이며 배포 commit은 위 f9f6537이다. 서비스는 [safemap.worklazy.net](https://safemap.worklazy.net/). 배포 후 기록·검수 스크립트만 추가한 커밋은 런타임 제품 코드를 변경하지 않는다.

## 집계와 화면

완료 신고의 기존 실제 facts·활성 동의 계보·기여자 UUID를 사용하며 사용자별 신고 identity의 대표 관측을 먼저 정한 뒤 날짜·분류를 적용한다. `private.ranking_representatives()` → `public.internal_user_rankings(uuid,uuid,jsonb)` → 인증 전용 user-rankings Edge → 런타임 랭킹 페이지 순서다. 전체 후보를 DB에서 집계·정렬하며 페이지와 검증 JWT 사용자의 전체 순위를 반환한다.

누적/월별 신고자·과태료·불운자 여섯 진입점, 세 테마 공통 전체/직접 기간/임의 연월, 기본 답변일 및 신고일을 지원한다. N은 accepted/partial/rejected/completed_unknown; F는 수용·일부수용 중 실제 과태료 처분, R은 불수용, P는 일부수용이다. 비율은 F/N·R/N·P/N이며 분자/분모 표시·정확한 분수 공동순위·표본 기본1건을 유지한다. [구현·기존 실 DB/브라우저 증거](../ranking-periods/REPORT.md), [API 계약](../../../contracts/user-rankings/README.md), [migration과 보안 설명](../../user-rankings.md)을 참조한다.

## 검증 범위

이번 배포에서 다시 실행한 로컬 검사: blueprint27개, Python product12개, Vitest609개 PASS/조건부100개 skipped, `npm run build`, `npm run scan` PASS. Pages Actions에서도 Python·전체 Vitest·live build·scan·정적 data 디렉터리 없음 검사를 통과했다. 과거 로컬 실제 DB13개·실 Edge2개·50만 고유 신고/60만 관측 성능 검사는 위 구현 보고서에 있으며 운영 데이터를 넣은 검사가 아니다.

운영 RPC 메타데이터 조회에서 SECURITY DEFINER/빈 search_path를 확인했다. public RPC는 anon/authenticated 실행 불가, service_role 실행 가능이다. private 대표 함수는 세 외부 역할 모두 실행 불가이며 definer 내부 호출용이다. [권한 증거](evidence/production-rpc-permissions.json).

운영 API5개에 토큰 없는 요청을 보내 모두401/UNAUTHORIZED_NO_AUTH_HEADER, 집계 필드 없음 확인. [응답 상태](evidence/production-anonymous-api.json), [배포 함수 버전](evidence/production-functions.json). 실제 사이트 HTML·JS·CSS200과 새 누적/월별 UI 코드 제공을 확인했다. [자산 해시·상태](evidence/production-assets.json).

실제 Chrome154 운영 검수는 로그인하지 않은 live 사이트에서 수행했다. PC1920/1440/2560 및 모바일390 × light/dark8개 화면, 랭킹 과거월 직접 URL·새로고침, 로그인 버튼 키보드 포커스, 가로 넘침 없음, 보호 API 요청·랭킹 행 없음, 실제 테마·자산 응답을 확인했다. 8개 모두 PASS, JS/console 오류·network 실패0이며 screenshot8개를 실제 열어 가독성·잘림을 확인했다. fixture/SDK mock/토큰 주입/OAuth 실행을 사용하지 않는다. 재현: `node scripts/browser/production_release_smoke.mjs`. [브라우저 결과](evidence/production-browser.json), [모바일 dark](evidence/390-dark.png), [PC light](evidence/1920-light.png).

운영 로그인 세션을 이용한 랭킹200/실 사용자 순위·페이지 이동, 운영 철회/삭제/정지 시나리오, 실카카오 지도 상호작용은 **NOT_RUN**이다. 운영 계정을 생성·변경하거나 합성 신고를 올리지 않았다. 해당 기능의 로컬 실 DB/Edge 및 Muse 브라우저 검증과 구분한다. 실제 UUID·신고·토큰·secret은 이 증거에 넣지 않았다.

## 복구

직전 Pages 성공 run36678832729와 원격 main `8cfacb2`가 코드 복구 기준이다. 익명 공개·철회된 데이터 snapshot으로 되돌리지 않는다. Edge 복구는 해당 commit의 지도 소유 함수 소스를 별도 checkout에서 redeploy하며 현재 인증 gate와 새 클라이언트 호환성을 먼저 확인한다. CLI functions download는 repo 외부 shared module 추출을 경로 보호가 거부해 완전한 운영 bundle 백업을 얻지 못했다. 부분 다운로드를 전체 백업으로 간주하거나 CLI 보호를 우회하지 않았다.

이번 SQL은 읽기 전용 추가/교체 함수다. 필요시 202610030200 이전 본문을 새 forward migration으로 적용한다. 랭킹 기능을 내릴 때 Edge/클라이언트를 먼저 정리하고 의존성 확인 후 public.internal_user_rankings·private.ranking_representatives를 별도 migration으로 제거한다. 운영 DB reset이나 기존 facts 삭제는 복구 방법이 아니다.
