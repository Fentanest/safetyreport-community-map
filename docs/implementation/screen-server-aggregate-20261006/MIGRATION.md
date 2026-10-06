# 적용 및 롤백

기준 `1d846aa`, 브랜치 `fix/screen-server-aggregate`, 미커밋 후보다. 이 작업에서 운영 DB·Edge·Pages·push에 접근하지 않는다. 운영 반영과 운영 수 초 목표 판정은 총괄 담당이다.

1. **SQL**: manifest 선행 `202610060800`까지 설치를 확인한 뒤 `202610060900_screen_server_aggregate.sql`을 transaction으로 적용한다. 기존 snapshot RPC의 이름·인자·json 반환형·postgres 소유자·service_role ACL을 유지한다. 새 테이블·인덱스·저장 캐시·데이터 수정은 없다. `screen_encoding=screen-aggregate-v1`일 때만 새 helper를 호출한다. helper는 STABLE/SECURITY DEFINER/빈 search_path이며 browser role 실행을 회수한다. 주소·법규·차량·분위수 helper도 PUBLIC/anon/authenticated 실행 권한이 없다. `NOTIFY pgrst,'reload schema'`는 COMMIT 후 전달된다.
2. **Edge**: `my-analytics`를 갱신한다. manifest의 공유 파일 `server/screenAggregate.ts`를 포함한다. 원번호/UUID 없는 집계 source를 DTO로 조립하며 동일 인증·게이트·rate limit을 통과한다. source가 구 SQL의 columns-v1/객체 배열이면 한 번 받은 그 source만으로 기존 집계를 수행한다. DB를 다시 읽는 fallback/retry는 없다. public-analytics·user-rankings·개인 독립 compare·앱 API는 기존 RPC를 사용하며 재배포가 필요 없다.
3. **Pages**: 응답은 기존 `screen-v1`/내부 v2 DTO 그대로여서 이번 변경만을 위한 Pages 배포는 필요 없다. 통합 배포를 할 경우 기존 검사된 UI artifact를 SQL→Edge 다음에 반영한다. UI·비밀 환경 설정 변경 없음.

운영 smoke: 카카오/세션/활성 동의/공개 10건, 1–9건 거절, 429, 양 날짜축, 최근 12개월/전체기간/빈 범위, 기관·법규·bbox·주소 상세·개인 비교, 동일 scope/version을 확인한다. 같은 scope를 여러 번 측정하여 DB 직접/실제 PostgREST/hosted Edge/로그인 브라우저 시간을 구분한다. 운영 원시 fact 반환 행수가 0인지, RPC bytes, Edge CPU·메모리, 범위 변경 중 중첩 요청도 측정한다. 운영 결과는 **배포 후 총괄 측정**이며 로컬 시간으로 통과 처리하지 않는다.

## 순서 호환성

| 조합 | 결과 |
|---|---|
| 구 Edge + 신 SQL | `screen_encoding`을 보내지 않으므로 기존 columns-v1/객체 배열 유지 |
| 신 Edge + 구 SQL | 추가 옵션이 무시되고 기존 facts 반환; 새 Edge의 기존 decoder/집계 경로 사용 |
| 신 Edge + 신 SQL | 단일 RPC에서 state/viewer/집계 source, 원시 facts 없음 |
| 알 수 없거나 손상된 집계 encoding | 503; 부분 집계/빈 성공으로 바꾸지 않음 |

## 롤백

UI를 함께 바꿨다면 Pages→my-analytics Edge 순으로 이전 검증 artifact를 반영한다. SQL을 먼저 되돌려도 새 Edge는 구 source를 읽는다. SQL 복원이 필요하면 [rollback.sql](rollback.sql)을 새 forward migration으로 검토·등록해 적용한다. snapshot 함수만 060700 정의로 복원하고 이번 private helper만 CASCADE 없이 제거한다. 반환형 변경이나 DROP/CREATE는 없다. service_role timeout 30s, 기존 facts/personal/rollup/rankings 함수는 유지한다.

데이터·동의·철회·dataset_version·migration ledger의 과거 기록은 되돌리지 않는다. 롤백하면 원시 전송과 JS 집계 비용이 돌아온다. 로컬 transaction 내 SQL 롤백→신 Edge 패킷 equality와 권한을 검사했다.
