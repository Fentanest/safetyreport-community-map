# r3 운영 반영 준비와 롤백

운영 접근·적용·배포·push는 하지 않았다. 사용자 지시대로 **커밋하지 않았고** 검토용 변경을 지정 worktree에 남긴다.
총괄의 운영 실측으로 jsonb 생성/재포장 병목을 확정했다. **운영 재측정은 배포 후 총괄이 수행**한다.

## SQL → Edge → Pages

1. 운영자가 기존 설치 정의/소유자/ACL과 선행 manifest(~`202610060600`)를 보관·확인한다.
   새 `202610060700_screen_fact_transport.sql`을 하나의 transaction으로 적용한다.
   이 파일은 r2에서도 미배포였으므로 r3에서 정리했다. 만일 별도로 r2 후보를 이미 설치한 환경이면 이 파일을
   재실행하지 말고 실제 설치 타입부터 확인해 별도 forward migration을 만든다.
2. 세 public RPC(cohort_facts, read_snapshot, my_analytics_cohort_source)의 반환형을 json으로 바꾸므로
   DROP/CREATE가 필요하다. 이름·인자·기본값은 동일하다. CASCADE 없음: 예상 밖 의존성이 있으면 전체 롤백된다.
   새 helper와 기존 public RPC는 STABLE/SECURITY DEFINER/빈 search_path이고 public RPC owner는 postgres로 복원한다.
   PUBLIC/anon/authenticated 실행 회수, service_role 실행 허용을 같은 transaction에서 한다.
   helper는 postgres만 명시 허용한다. 실행 중 트랜잭션/잠금이 길면 적용 지연 가능성이 있으므로 운영자가 상태를 확인한다.
3. COMMIT 뒤 `NOTIFY pgrst, 'reload schema'`가 전달된다. schema cache 갱신과 서비스 RPC 응답을 확인한 뒤 다음 단계로 간다.
   JSON 결과가 문자열로 이중 인코딩되지 않고 객체/배열인지, anon/authenticated가 RPC에 접근하지 못하는지 확인한다.
   테이블·인덱스·전역 GUC·운영 데이터·ledger의 과거 기록을 고치지 않는다.
4. `my-analytics` Edge를 `server/screenFacts.ts` 포함 manifest대로 갱신한다.
   `screenHandler`만 `fact_encoding=columns-v1`을 요청하며 기존 personal handler도 새 json 반환을 그대로 파싱한다.
   `public-analytics` 및 `user-rankings`는 호출 계약이 유지되어 재배포 불필요하다. 기존 앱/ingest/my-reports도 변경 없음.
5. Pages를 마지막으로 반영한다. r2에서 준비한 20초 read deadline, 오류 코드/HTTP 표시, timeout 자동 재시도 금지를 포함한다.
   기존 dist allowlist·공개 환경 설정·scan을 따른다.
6. 총괄이 같은 운영 범위·3종 직접/래퍼/viewer 호출을 반복 측정한다. 양 날짜축·기본/전체/빈 범위·개인 비교·기관/법규/지도와
   버전 일치·1–9건 gate·잘못된 session·철회·429·모바일 timeout/수동 retry를 확인한다.
   DB 시간, PostgREST bytes/시간, Edge CPU/wall-clock/메모리, 브라우저 end-to-end를 구분한다.
   정상 응답이 20초 이내인지 확인한다. SQL 개선만으로 hosted Edge/네트워크 성능을 통과 처리하지 않는다.

구 Edge + 신 SQL은 기존 object array를 받는다. 신 Edge + 구 SQL도 배열을 읽는다.
columns-v1은 opt-in이고 public DTO가 아니다. 모르는 encoding/열 순서/행 길이는 503이다.
8초 설정은 유지하나 함수 내부 `set_config`가 현재 최상위 statement의 타이머를 재설정하지 않는 점은 REPORT를 따른다.
실제 RPC 외부 제한은 운영자가 확인한다. 이번 작업은 설정을 늘리거나 새로운 운영 설정을 적용하지 않는다.

## 롤백

Pages → my-analytics Edge → SQL 순서로 검토된 이전 산출물을 반영한다. 필요하면 SQL 먼저도 전송 호환된다.
SQL은 [rollback.sql](rollback.sql)의 내용을 **새 forward rollback migration**으로 검토·등록한다.
로컬 transaction 안에서 실행해 세 함수 jsonb 반환/원래 결과/owner/ACL과 helper 제거를 검증했다.

- 세 public RPC를 CASCADE 없이 DROP한 뒤 060100 cohort / 060200 personal cohort / 060600 snapshot 정의를 복원한다.
- PostgreSQL은 CREATE OR REPLACE로 json→jsonb 반환형을 바꿀 수 없으므로 DROP/CREATE를 생략하지 않는다.
- postgres 소유권과 service_role 전용 ACL, snapshot comment를 복원하고 private helper를 제거한다.
- PostgREST schema cache를 갱신하고 서비스 RPC 및 권한을 확인한다.
- rankings 정의는 재적용하지 않는다. 데이터·동의·철회·dataset_version·과거 ledger를 되돌리지 않는다.

롤백하면 jsonb 병목도 되돌아온다. Pages까지 복원하면 사용자 대기 상한·오류 진단 보완도 사라진다.
