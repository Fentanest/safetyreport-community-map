# 적용 순서와 롤백

기준 main `0964d90`, `perf/screen-aggregate-sql`의 미커밋 후보. 운영 DB·Edge·Pages·push는 이 작업에서 접근/실행하지 않는다. 아래는 총괄 검토 후 적용 절차다.

1. **SQL**: manifest 202610060900까지 설치 여부를 확인한 뒤 `202610061000_screen_aggregate_opt.sql`을 적용한다. 기존 migration은 수정하지 않는다. 테이블·인덱스·저장 캐시는 추가하지 않는다. dataset_key ASC는 완전 동률의 최종 선출 규칙이다. 기존 private payload, v2 facts, rollup, viewer의 번호 fallback 및 screen v1/v2에 일관되게 적용한다.
2. **Edge**: `my-analytics`와 manifest의 공유 모듈을 갱신한다. 새 핸들러는 `screen-aggregate-v2`를 요청하고 v1·legacy facts를 모두 읽는다. SQL이 먼저 반영되어도 구 Edge의 v1 경로는 유지된다. 구 SQL에 신 Edge가 연결되면 같은 snapshot RPC에서 columns-v1로 fallback한다. 추가 조회·부분 성공·저장 캐시는 없다.
3. **Pages**: 공개 screen-v1 DTO와 UI 코드는 동일하므로 이 최적화만으로 Pages 배포는 불필요하다. 함께 배포한다면 SQL→Edge→Pages 순서다.
4. 총괄이 운영 12개월/전체, 기본/개인 비교, 실제 PostgREST/Edge/브라우저의 시간·bytes·503·메모리를 확인한다. 로컬 x86 시간으로 운영 aarch64의 5초 목표 달성을 판정하지 않는다.

성능 롤백은 우선 Edge 이전 artifact로 되돌리면 v1을 사용한다. DB v2를 제거하려면 [rollback.sql](rollback.sql)을 새 forward migration으로 적용한다. v2 요청도 v1 집계로 응답하도록 snapshot을 되돌린 후 v2 함수를 제거한다. 새 Edge는 v1도 읽으므로 SQL/Edge 순서가 바뀌어도 호환된다. 이 롤백은 결정적 선출 규칙과 차량 정규화의 의미를 보존한다. 데이터·동의·삭제·dataset_version·ledger는 과거 상태로 복구하지 않는다.

함수의 `work_mem`은 연산자당 한도이며 요청당 총 메모리 한도가 아니다. 동시 요청의 메모리 비용은 별도 운영 확인 대상이다. 세션·role·전역 설정을 바꾸지 않는다.
