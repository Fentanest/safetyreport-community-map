# 화면 SQL 집계 최적화 · 2026-10-06

request_mode=구현. 브랜치 `perf/screen-aggregate-sql`, 기준 main `0964d903199eb447f744005acf1b6d129a2693a7`. **미커밋 후보이며 운영 접근·배포·push 없음.** 사용자 지정 로컬 스택만 BEGIN/ROLLBACK으로 사용했다.

## 결과와 병목 근거

기존 v1 집계는 fact 수보다 distinct 차원 수에 민감했다. 운영 유사 다양성의 3만 합성 시드에서 기존 source가 4.25–5.01MB이고 Node의 기존 핸들러가 0.41–0.66초였다. 새 opt-in `screen-aggregate-v2`는 source를 1.75–2.28MB로 줄이고 SQL을 약 34–40%, Node 핸들러를 약 74–85% 줄였다. 공개 screen-v1 DTO는 배열 순서까지 legacy facts 및 0964d90 SQL 경로와 deep equal이다.

총괄이 제공한 운영 PostgreSQL 17.6 aarch64 소형의 SQL 8.0/8.6초, 브라우저 8.9–17.7초는 이 작업에서 재측정하지 않았다. **운영 첫 화면 5초 안팎 목표는 미확인**이다. 로컬 절대시간을 운영 end-to-end 시간으로 합산하거나 환산해 성공으로 판정하지 않는다.

| 발견 | 근거 | 최종 결정 |
|---|---|---|
| heatmap의 모든 교차 셀에 미사용 분위수·금액·별점 분포가 실림 | 초기 3.19MB 시드에서 heat 1,616셀 약 0.95MB, 담당자 약 0.95MB. 최종 다양성 시드는 더 많은 교차 셀 | 전체 heat 행·법규 건수로 40행/16법규를 SQL에서 선정하고 해당 셀만 반환. 분모·total_rows/total_laws는 전체 모집단 유지 |
| 모든 dimension에 summary용 43개 histogram/rating counter 계산 | 기존 expanded 그룹의 13개 기간 bucket 및 6×5 별점 counter | summary 전용 CTE로 분리. place/heat는 가벼운 count 집계만 수행. 나머지 행에 summary 분포 필드를 직렬화하지 않음 |
| 넓은 중간 행 저장 및 spill | 3만/12개월 v1 분석 plan: HashAggregate 25 batches, Disk 7,192kB, 여러 external merge. statement temp read=25,253 / written=14,177 blocks | expanded를 NOT MATERIALIZED로 projection pushdown; v2 함수만 work_mem=16MB. 최종 동일 범위 plan은 temp I/O 없음 |
| 차량마다 prefix 목록을 정렬하고 순회 | screen_plate의 jsonb_each_text + ORDER BY length + PL/pgSQL loop가 모든 distinct 차량에 반복 | 정규화 후 첫 숫자 앞 한글 prefix를 한 번 추출해 dictionary lookup. 유효 번호 문법과 마스킹은 그대로 |
| Edge의 O(장소²) anchor 탐색과 반복 통계·full 탐색 | 각 place에 anchors.find, compare마다 stats.find/full.find | 요청 수명 Map 인덱스. 별도 저장 캐시/TTL/무효화 규칙 없음 |

EXPLAIN 근거는 `evidence/sql-30000-production-{year,all}.stderr.txt`다. `auto_explain.log_analyze=on`, `log_buffers=on`, `log_timing=off`로 함수 내부 실행계획까지 수집했다. 계획 수집 호출은 시간 표본에서 제외했다. 실제 PostgREST HTTP/네트워크는 측정하지 않았다.

`work_mem=2MB` 대조에서 새 v2 SQL은 1,856.1ms, 16MB에서는 1,821.4ms(3회 중앙값)로 로컬 시간 차이는 작았다. 그러나 2MB에서는 temp read=31,413 / written=14,431 blocks가 남고 16MB에서는 사라졌다. CPU가 주 병목인 로컬 x86과 느린 디스크/작은 ARM 운영의 차이를 고려한 함수 한정 설정이다. **16MB는 연산자당 한도이지 요청당 총 메모리 상한이 아니다.** 동시 요청 메모리·60k 이상에서의 spill은 운영 검증 대상이다. 설정 복귀는 통합 테스트로 검사한다.

## 전후 수치

PostgreSQL 17.6 로컬 x86_64, 세션 work_mem=2MB. 전=0964d90 screen v1/원본 핸들러, 후=후보 v2/후보 핸들러. 모든 시간은 ms, 크기는 MB(1,000,000 bytes), 각 3회 중앙값. Node replay는 실제 JSON.parse와 createScreenHandler를 실행하고 auth/RPC만 stub한다. 기준 핸들러는 `git show 0964d90`로 생성하며 소스 해시는 `evidence/baseline.json`에 기록했다.

| fact / 기간 | RPC MB 전→후 | 직접 SQL 전→후 | PostgREST 모양 전→후 | source parse 전→후 | Node handler 전→후 | 공개 packet bytes (동일) |
|---|---:|---:|---:|---:|---:|---:|
| 30,000 / 전체 | 5.013 → 2.280 | 3228.6 → 1944.8 | 3219.7 → 1938.4 | 45.6 → 19.3 | 659.2 → 97.4 | 848,210 |
| 30,000 / 12개월 | 4.255 → 1.749 | 2609.3 → 1772.9 | 2755.0 → 1821.4 | 44.6 → 14.8 | 410.4 → 106.1 | 711,317 |
| 60,000 / 전체 | 5.265 → 2.563 | 5744.4 → 3743.2 | 5580.7 → 3849.6 | 47.0 → 18.4 | 652.3 → 99.4 | 855,368 |

시드는 장소 4,507, 기관 127, 기관+담당자 1,016, 법규 31, 차량 8,000 distinct다. 날짜·동의·철회·공개 상태·중복 기여는 기존 합성 시드를 보존한다. 결과 크기 4.25/5.01MB는 제공된 운영 3.55/4.81MB와 유사하고 전체기간은 약간 크다. 공개 DTO 약 0.71/0.85MB도 운영 제공 범위와 유사하다. 운영 자료를 수집/복제한 시드가 아니다. 6만에서는 fact 증가를 검사하며 distinct 후보 수 자체는 고정한다. distinct가 fact와 같이 계속 증가하는 최악 분포는 검증하지 않았다.

원본은 [summary.json](evidence/summary.json), `sql-*.json`, `handler-*.json`. `development/`는 초기/실패 증거이며 최종 판정 표본에 넣지 않았다. raw fact source와 DB dump는 ignored `.agent-runtime/screen-aggregate-opt/` 안에만 있다.

## 범위·계약·변경 파일

- `supabase/migrations/202610061000_screen_aggregate_opt.sql`: additive migration. 공개/개인 source·rollup의 최종 dataset_key ASC, viewer의 번호 fallback, 기존 v1 유지 및 v2 집계·snapshot opt-in·private ACL.
- `server/screenAggregate.ts`, `server/screenHandler.ts`: v2 요청과 v1/legacy 호환, SQL heat DTO, 요청 내 Map 조회. 공개 DTO·인증·10건 gate·no-store·단일 statement snapshot·10만 history budget은 유지.
- `tests/integration/{screen-server-aggregate,screen-aggregate-opt,cohort-timeout,screen-transport}.test.ts`, `tests/product/screenSnapshot.test.ts`: 세 경로 deep equality, v2/구 SQL 및 최적화 rollback, work_mem 복귀, 결정적 a dataset winner. 역사 oracle에는 명시된 dataset_key tie key만 추가하고 기대값/검사를 삭제하지 않았다.
- `scripts/benchmark/screen_aggregate_opt.py`, `scripts/browser/{vite.screen-aggregate-opt.config.ts,verify_screen_aggregate_opt.mjs}`: 고정 로컬 스택 측정, immutable baseline handler, 실제 Chrome 증거.
- `docs/data-contract.md`, `docs/product-decisions.md`: 폐기된 계정 간 fact 이전/최초 기여 고정 대표를 현재 기여자 보존 및 answer_time→completed_date→first_accepted_at→contributor_id→dataset_key 규칙으로 동기화.
- migration manifest 및 본 REPORT/MIGRATION/REPRODUCE/rollback/evidence.

대표 선출의 마지막 dataset_key는 같은 contributor·같은 채택 시각·같은 완료일·같은 최초 기여 시각인 완전 동률만 바꾼다. 순위 모듈은 이미 dataset_key를 쓰므로 그 계약은 바꾸지 않는다. 원번호·해시·기여 UUID·신고번호는 집계 source와 공개 DTO에 추가하지 않는다. 마스킹 충돌·n=1·원 좌표·결측 분모를 보존한다.

기관·담당자 전체 그룹은 동명이인과 검색/정렬/페이지/비교를 위해 남긴다. 장소도 원 좌표 anchor와 가벼운 count를 보내고 기존 JS의 mapNodes/view_bbox/부동소수점 누적 순서를 유지한다. **모든 패널의 SQL 페이지화·지도 SQL 압축까지 완료한 구현은 아니다.** heatmap의 정확한 상위 집합과 불필요한 통계 제거가 이번 결과 크기 최적화 범위다. 전체 목록을 잘라서 검색·정렬 의미를 바꾸지 않는다.

## 검사와 UI 증거

| 검사 | 결과 |
|---|---|
| 전체 단위 | 658 passed / 145 skipped. skip을 통과로 세지 않음 |
| 화면 SQL integration | 11 passed / 1 benchmark skipped (`integration-screen.txt`) |
| cohort / transport integration | 5 passed + 9 passed (`integration-cohort.txt`, `integration-transport.txt`) |
| 대량 replay | 30k 12개월/전체 + 60k 전체, 세 경로 whole-packet deep equal. 공개 schema/개인 schema/비공개 키 canary 검사 |
| Python | blueprint 27 / product 12 통과. exporter snapshot은 public projection 미준비로 skip |
| build / scan | 성공. scan passed=true, issues=[]; 기존 dynamic import/chunk 크기 경고 유지 |
| manifest | 52 migrations / 7 functions 통과; 추가 migration SHA `38048f777c4ea7df9f4159c3f17e431a7988eee6b1da36080a020e8e01cc7239` |
| DB 보존 | 전후 전체 SQL dump 4,275,923bytes, SHA `adcb305b483759bc3699f2d63a2fd66d0d85da388a66c4af6c28a1676c0305af` 동일 |

통합 범위는 양 날짜축의 20개 scope, 카테고리·지역·기관/담당자·bbox·법규·빈/전체/1건, 모든 패널·개인 비교·주소 상세/없음·prefix·정렬/검색, Unicode·마스킹 충돌·정확 좌표·권한·철회·generic/custom plan·중복 dataset·10만 상한 및 SQL 롤백이다. 기본 화면의 optional panel 없는 경우도 세 경로 equality다.

개발 중 cohort 개인 RPC oracle의 jsonb=json 캐스트 누락 1건을 수정했다. 최종 transport matrix의 48쌍 실제 SQL 호출은 기본 runner 5초 제한에서 5.26/5.04초 timeout이 발생했다. 해당 case의 runner 허용시간만 30초로 명시하고 48쌍 결과/개수/NULL/순서 기대값은 그대로 유지했다. 이는 개별 SQL latency assertion 변경이 아니다. 다른 통합 묶음 한 번은 종료 신호 143으로 중단됐으며 원인은 확정하지 못했다. `development/`에 모두 보존하고 최종 suite별 실행 결과로 판정한다.

Chrome 154.0.8037.92, 로컬 `http://127.0.0.1:5197`에서 390/1440/1920/2560 × dark/light 8종, 법규 오름차순·개인 비교·전체기간 적용, heatmap 40행/16법규/640셀·표 보기까지 실행했다. screen 응답 13건 모두 200, console/page error 0, 가로 overflow 0. [browser/results.json](evidence/browser/results.json), 같은 폴더 screenshot 참조. 390 dark, 1440 상호작용 후, 2560 light, heatmap 표 이미지를 직접 열어 확인했다.

시각 관찰: 16개 법규를 표로 볼 때 기존 좁은 카드에서 열 제목/숫자가 여러 줄로 갈라져 가독성이 낮다(`1440-dark-heatmap-table.png`). 데이터/패리티 실패는 아니지만 UI 개선 여지는 남는다. UI 파일은 이번 최적화 범위에서 변경하지 않았다. 실제 Chrome·핸들러·SQL 결과를 사용하며 인증은 합성, 카카오는 MOCK이다. 독립 Muse·고정 커밋·실제 카카오·운영 UI 승인을 뜻하지 않는다. 커밋 금지 지시에 따라 `candidate.json`의 파일 해시로 미커밋 후보를 식별한다. Vite는 해당 실행 세션 Ctrl-C(exit 130), Chrome은 finally에서 종료했다.

## 반영·롤백·미확인

[적용/롤백](MIGRATION.md): **SQL→my-analytics Edge→Pages(필요시)**. 이번 공개 UI/DTO가 같아 Pages 갱신은 필수가 아니다. [rollback.sql](rollback.sql)은 v2 요청도 v1 source로 응답하도록 되돌리고 v2 함수를 제거한다. 결정적 선출 규칙·자료·동의·삭제·version은 유지한다. 신 Edge+구 SQL은 legacy fallback, 구 Edge+신 SQL은 v1을 사용한다.

남은 위험은 운영 aarch64 CPU/메모리·동시 요청·실제 네트워크/Edge 시간과 5초 목표, 계속 증가하는 distinct 그룹이다. 상위 heat 정렬은 PostgreSQL ICU ko/en과 Node localeCompare의 동일 의미를 사용하며 현 환경 전체 패킷으로 검증했다. 운영 ICU 버전의 극단적 Unicode 동률은 미확인이다. 10만 history 후보 상한은 그대로이며 초과를 truncate하지 않는다. 운영/실제 카카오/독립 Muse 검수는 이 작업의 로컬 회귀 증거와 별개다.

커밋하지 않았다. 운영 DB·Edge·Pages 접근/배포, push, 다른 컨테이너/볼륨 변경은 수행하지 않았다.
