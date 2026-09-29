# my-reports 측정 기록

환경: 로컬 합성 스택(Docker, Supabase Postgres 17.6 이미지, `work_mem` 기본값). **운영 측정이 아니다.**
데이터는 전부 합성이며 측정 후 삭제했다. 재현: `COMMUNITY_STACK=1 MY_REPORTS_MEASURE=1 MR_LABEL=<이름> MR_OWN=<건수>
npx vitest run tests/integration/my-reports-measure.test.ts` → `measurements.json`, `plans/*.txt`.

- DB 실행 = `EXPLAIN (ANALYZE)`의 Execution Time(RPC 전체). DB→Edge bytes = RPC가 돌려준 JSON 길이.
- Edge→확장 bytes = handler가 만든 실제 응답 본문 길이(커서·DTO 포함). 왕복 ms에는 getUser와 rate-limit RPC가 포함된다.
- 계획은 `auto_explain`(nested statements, ANALYZE, BUFFERS)으로 뽑았다. 1 ms 미만 하위 문장은 생략했다.

### heavy20k — 본인 신고 20,000건(관측 40,000행, PC+모바일 중복), 전체 fact 240,000행, 차량 일치 2,857건

| 호출 | DB 실행 중앙값(ms, 5회) | DB→Edge JSON bytes |
|---|---:|---:|
| `search_vehicle_first` | 666 | 18,007 |
| `search_address_first` | 674.5 | 15,103 |
| `search_vehicle_next` | 609.3 | 12,487 |
| `summary_first` | 602.7 | 13,270 |
| `numbers_page_500` | 598.1 | 10,691 |

| Edge 요청(handler, 실제 DB) | 왕복 ms | Edge→확장 bytes |
|---|---:|---:|
| `search_vehicle_first_20` | 713 | 19,526 |
| `search_vehicle_first_50_managers_50` | 678 | 58,037 |
| `search_address_first` | 675 | 16,671 |
| `summary_first` | 616 | 15,007 |
| `numbers_page_500` | 615 | 10,626 |

### typical500 — 본인 신고 500건(관측 1,000행, PC+모바일 중복), 전체 fact 201,000행, 차량 일치 71건

| 호출 | DB 실행 중앙값(ms, 5회) | DB→Edge JSON bytes |
|---|---:|---:|
| `search_vehicle_first` | 28.4 | 17,926 |
| `search_address_first` | 25.8 | 2,917 |
| `search_vehicle_next` | 24 | 12,448 |
| `summary_first` | 21.9 | 1,040 |
| `numbers_page_500` | 21.7 | 1,678 |

| Edge 요청(handler, 실제 DB) | 왕복 ms | Edge→확장 bytes |
|---|---:|---:|
| `search_vehicle_first_20` | 116 | 19,437 |
| `search_vehicle_first_50_managers_50` | 85 | 57,911 |
| `search_address_first` | 72 | 3,096 |
| `summary_first` | 85 | 1,156 |
| `numbers_page_500` | 71 | 1,771 |

시나리오 fixture(`search-vehicle-first-page`, 10건 범위) 첫 페이지 응답: 7,707 bytes.

## 튜닝 이력 (heavy20k, search_vehicle_first)

| 단계 | DB ms |
|---|---:|
| 최초 구현 | 1,564 |
| 동의 계보 확인을 grant 단위로 1회(materialized; 계획기가 fact 40,000행마다 호출하던 것 제거), 행 단위 SQL helper 인라인(SET 절 제거) | 812 |
| own 행을 필요한 열만, 범위 함수에 `work_mem = 32MB`(디스크 정렬 제거), 버전 해시를 레코드 텍스트로 | 680 |
| 16진 키 정렬을 `collate "C"` | 609–666 |

## 인덱스 판단

- 본인 범위 조회는 `(contributor_id, …)`로 시작하는 기존 기본키로 충분하다. `202609300200`의 owner 인덱스가 있는 경우와
  없는 경우(같은 트랜잭션에서 drop 후 rollback)의 최상위 실행 시간은 20k 사용자 기준 959 ms / 908 ms(auto_explain 부하 포함),
  500건 사용자 39 ms / 44 ms로 차이가 없었다(`plans/*.txt`). 그래서 v1 마이그레이션은 인덱스를 추가하지 않고, 초안 인덱스가
  이미 있으면 그대로 둔다(운영 적용 여부를 모르므로 drop하지 않는다).
- 차량 부분검색·주소 비교는 본인 범위에서 대표 관측을 먼저 뽑은 **뒤** 적용해야 한다(§5.3). 따라서 검색 조건으로 fact를 먼저
  고르는 trigram(pg_trgm) 인덱스는 이 순서와 맞지 않고, 본인 행 수 안에서 메모리 연산이다. `pg_trgm`은 로컬 이미지에서
  사용 가능하지만 설치하지 않았다(공유 프로젝트 확장 설치·전역 인덱스 부하 없이 목표 시간 안).
- 상한: 20,000건 사용자도 5초 예산의 약 1/8. 커질수록 선형으로 늘어나는 구조(본인 전체 이력 대표 선정)이므로, 본인 신고가
  십만 건 단위가 되면 개인 대표행 캐시 테이블이 필요하다(현재 불필요, 과설계 방지).

## 시간 제한

- Edge: RPC 호출에 5초 AbortSignal → `503 QUERY_TIMEOUT`(retryable). DB 문장은 PostgREST의 역할별 `statement_timeout`이
  상한이다. 함수 안 `set_config('statement_timeout')`는 이미 실행 중인 문장에 적용되지 않으므로 쓰지 않았다.
  공유 프로젝트의 `service_role` 설정은 바꾸지 않았다.
