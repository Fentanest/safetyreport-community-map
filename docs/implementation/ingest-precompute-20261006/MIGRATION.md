# 적용 준비 · 운영 미적용

이 후보는 조회 성능 목표와 제한 컨테이너의 전체 DB 회귀를 통과하지 못했다. 공유 ci0926 회귀 39건 통과와 구분한다. 총괄의 운영 읽기 전용 검증과 별도 적용 승인 전에는 실행하지 않는다. 운영 DB/Edge/Pages/스토어 접근, push, commit을 하지 않았다. 기존 Edge의 `screen-aggregate-v1` 선택은 유지한다. **Edge를 v1로 유지해도 이 SQL을 적용하는 순간 유지 트리거의 쓰기 비용은 발생한다.** opt-in을 사용하지 않는다는 이유로 이 migration을 운영에 미리 적용해서는 안 된다.

## SQL → backfill → Edge → Pages

1. 선행 map `202610061000` 및 auth manifest를 확인한다. 바인딩 작업의 `2026100611xx`와 병합할 때 ingest 본문은 이 후보에서 바꾸지 않는다. 새 트리거와 바인딩 migration의 삭제·fence 경로를 통합 환경에서 재검증한다.
2. `202610061200_ingest_precompute.sql`을 한 트랜잭션으로 적용한다. `lock_timeout=3s`로 장기 잠금 대기를 실패 처리한다. CTAS는 `WITH NO DATA`이고 기존 fact 테이블의 column 추가/rewrite나 전체 backfill을 이 트랜잭션에서 하지 않는다. 보조 테이블의 빈 인덱스만 만든다. 트리거 설치에는 원본 테이블의 짧은 DDL lock이 필요하며 실제 운영 lock 시간은 미측정이다. 실패 시 전체 트랜잭션이 롤백되므로 같은 migration을 재시도한다. 성공한 DDL은 migration ledger를 따라 한 번만 적용한다. 이미 적용된 DDL을 임의로 재실행해 테이블을 초기화하지 않는다.
3. dual write가 먼저 시작된다. 한 트랜잭션의 여러 fact statement는 dirty 월을 모으고, DEFERRABLE constraint trigger가 COMMIT 전에 한 번씩 재집계한다. 외부 읽기에 비동기 지연은 없다. 같은 쓰기 트랜잭션에서 flush 전에 screen을 읽으면 dirty 여부를 검사해 v2를 사용하므로 낡은 rollup을 섞지 않는다. `screen_observations`는 영향받은 `source_report_key`만 교체한다. 번호 없는 관측의 fallback 및 같은 payload의 `answer_time` 때문에 단일 report_identity보다 이 단위가 안전하다. backfill 전 읽기는 기존 v2로 응답하며 부분 저장 결과를 읽지 않는다.
4. postgres/supabase_admin으로 아래 함수를 **호출마다 별도 트랜잭션**에서 실행한다. service_role/브라우저 역할에는 backfill 실행 권한이 없다.

```sql
select private.screen_precompute_backfill(250);
```

   `keys`는 이번 트랜잭션의 source key 처리량, `months`는 이번 트랜잭션의 월 집계 처리량이다. 먼저 source key 순서대로 최대 250개를 처리하고, 이후 dirty 월을 한 개씩 처리한다. `done=true`까지 반복한다. key 하나에 여러 관측이 있을 수 있으므로 250은 fact 행 수 상한이 아니다. 매우 큰 단일 key와 단일 월은 별도 점검 대상이다.

   커서와 결과는 동일 트랜잭션에 저장된다. 중단·실패하면 해당 배치만 롤백되며 같은 호출로 재개한다. 초기 커서보다 작은 새 key도 이미 설치된 트리거가 처리한다. backfill 중 쓰기는 dirty 월을 표시하고, 마지막 활성화는 동일 잠금 아래 dirty 월이 없을 때만 한다. source date 변경은 이전·새 월을 모두 표시한다. live 쓰기가 계속 dirty 월을 만들면 활성화가 늦어질 수 있으므로 트래픽/배치 시간을 실측해야 한다.
5. 모든 writer와 backfill은 기존 `analytics_state` → precompute control 순으로 잠근다. fact/동의/프로필 행 변경은 기존 함수 순서를 유지한다. READ COMMITTED의 volatile 유지 함수가 잠금 획득 후 최신 상태를 읽는다. REPEATABLE READ/SERIALIZABLE 충돌은 control epoch 갱신으로 직렬화 오류가 나도록 한다. 교차 계정 다중 statement 트랜잭션의 모든 deadlock 가능성을 제거했다는 보장은 없다. 기존 재시도 계약을 유지하며 부하 검증이 필요하다.
6. 준비 상태와 private 저장량·표본 패리티·권한을 확인한다. `ready=true`만으로 성능·정확성 승인하지 않는다. backfill은 `dataset_version`을 변경하지 않는다. fact mutation의 기존 버전 갱신과 자격/공개범위 trigger의 버전 갱신은 유지한다.
7. 채택 후에만 별도 Edge 변경으로 `p_options.screen_encoding='screen-precompute-v1'`을 선택한다. 현재 이 저장소의 `screenHandler` 기본 선택은 v1 그대로다. 새 decoder는 기존 v1/v2/facts와 새 compact source 모두 처리한다. 신규 SQL opt-in과 decoder를 먼저 검증한 뒤 선택을 바꿔야 한다. public-analytics/user-rankings/my-reports/앱의 RPC 계약은 바꾸지 않는다.
8. 공개 `screen-v1` DTO와 UI는 동일하므로 이 변경만으로 Pages 배포는 필수가 아니다. 함께 배포한다면 SQL/backfill → Edge → Pages 순서다.

## 실제 유지 범위와 경계

- 관측 INSERT/UPDATE/DELETE, consent grant INSERT/UPDATE/DELETE(양쪽 user/lineage), profile INSERT/UPDATE/DELETE, disclosure INSERT/UPDATE/DELETE(양쪽 version의 lineage)를 처리한다.
- 사용자 철회 후 새 lineage 동의만으로 옛 fact는 돌아오지 않는다. 같은 lineage 정책 승계는 유지되고, explicit reshare가 fact의 grant를 옮기면 다시 선출된다.
- 삭제 API의 fence/tombstone은 오래된 업로드 재진입을 막는 admission 규칙이다. 공개 제거는 같은 트랜잭션의 fact DELETE로 처리한다. fence만 임의 갱신해 기존 fact를 비공개로 만드는 새 규칙은 도입하지 않는다.
- Auth cascade의 기존 manifest DELETE 트리거는 삭제된 사용자의 manifest를 재생성하지 않도록 수정한다. 살아 있는 계정의 generation 증분은 동일하다.
- 원본/파생 테이블 TRUNCATE는 명시 오류로 거절한다. 트리거를 끄고 원본을 변경하는 운영자 작업, 정규화 함수/지역 registry 의미 변경은 자동 추적하지 않는다. 그런 작업은 읽기 전환을 해제하고 새 포맷으로 전체 backfill/검증해야 한다.
- 월 집계는 **영향받은 월 파티션 재계산**이다. 모든 cell의 O(1) 가감 유지가 아니므로 쓰기 비용을 REPORT에서 확인해야 한다. 임의 교차 필터/bbox/경계일/개인·좌표·차량의 남은 관측 경로도 REPORT에 명시한다.

## 롤백

기본 Edge 선택을 유지한 상태에서는 사용자 화면을 바꾸지 않고 후보를 제거할 수 있다. opt-in을 배포했다면 Edge 선택을 v1로 되돌린 뒤 [rollback.sql](rollback.sql)을 새 forward migration으로 등록한다. decoder는 v1/v2를 계속 읽을 수 있다.

SQL은 snapshot 함수와 manifest delete 함수를 선행 정의로 되돌리고 이번 trigger/helper/private 보조 테이블만 제거한다. CASCADE로 외부 의존성을 강제 제거하지 않는다. fact, consent, fence, tombstone, dataset_version 및 migration ledger 과거 기록을 되돌리지 않는다. 파생 테이블을 과거 dump로 복원해 철회된 자료를 다시 노출해서는 안 된다. 오래 실행되는 읽기/쓰기 때문에 DDL lock timeout이 나면 전체 롤백 후 재시도한다.
