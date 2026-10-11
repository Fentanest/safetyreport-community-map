# 셀프호스트 Supabase 읽기 성능 측정 · 2026-10-11

사용자 결정("측정 먼저"): 셀프호스트 Postgres 설정 확인·ANALYZE → 같은 화면 쿼리를 v1/v2 로 실측 → 빠른 쪽 채택,
60초 클라이언트 대기는 실측 뒤 판단. 업로드 시점 사전계산은 범위 밖.
브랜치 `opus/selfhost-perf`(기준 9237550). **push·Edge 배포·DB 설정/함수 변경 없음.**

## 안전 범위

- DB 쓰기는 `ANALYZE`(전체 DB, 2.6초; 권한 없는 시스템 카탈로그 9개는 건너뜀) 하나뿐이다. 실행 전 auth 27개 중 20개,
  private 32개 중 20개 표가 통계가 한 번도 없었고 실행 뒤 0개가 됐다(`community_report_facts` 는 autoanalyze 가 이미 돼 있었다).
- 측정한 함수(`internal_analytics_read_snapshot`, `private.analytics_screen_aggregate(_v2)`, `internal_analytics_viewer`,
  `internal_analytics_cohort_state`, `internal_user_rankings`)는 모두 `STABLE` 이고 정의에 INSERT/UPDATE/DELETE 가 없다.
  Edge 가 먼저 부르는 rate limit RPC(쓰기)는 부르지 않았다.
- v2 의 work_mem 민감도만 v2 함수 정의를 그대로 복사해 `SET work_mem` 값만 바꾼 `pg_temp` 함수로
  `BEGIN … ROLLBACK` 안에서 실행했다(남는 것 없음). v1 은 SET 절이 없어 세션 `SET work_mem` 만 썼다.
- `202610061000_screen_aggregate_opt.sql` 은 다시 실행하지 않았다. DB 의 v1·v2 함수는 `202610110100` 패치로
  5분류(`'all','traffic','parking','safety','living','other'`)가 반영돼 있음을 `pg_get_functiondef` 로 확인했다
  (마이그레이션 파일 원본은 3분류).
- 결과 파일에 URL·비밀·사용자/세션 id 가 없다. Node 재생에 쓴 실제 source JSON 은 저장소 밖 임시 폴더에만 두었다.

## 서버 사양·설정 (raw/settings.txt)

| 항목 | 값 |
|---|---|
| 호스트 | x86_64 AMD EPYC 7352, vCPU 4, RAM 15 GiB(측정 전 사용 2.0 GiB, 가용 12 GiB), swap 4 GiB, 디스크 여유 456 GB |
| 컨테이너 | supabase-db 메모리·CPU 제한 없음, shm 64 MB. Edge 워커 `memoryLimitMb=150`, `workerTimeoutMs=60s`(functions/main) |
| Postgres | 17.6 x86_64, DB 386 MB, `community_report_facts` 89,237행(heap 68 MB, 인덱스 포함 130 MB) |
| shared_buffers | **128 MB** (설정 파일) |
| effective_cache_size | **128 MB** (설정 파일) |
| work_mem / hash_mem_multiplier | 4 MB / 2 |
| maintenance_work_mem | 64 MB |
| max_connections | 100 |
| statement_timeout | 전역 0 · authenticator 8s · authenticated 8s · anon 3s · **service_role 30s** |
| 함수 설정 | v1 집계 `enable_nestloop=off, enable_sort=off`(work_mem 미지정 → 4 MB) · v2 집계 같은 값 + `work_mem=16MB` · rollup/rankings `work_mem=32MB, statement_timeout=20s` |
| 기타 | jit on, max_parallel_workers_per_gather 2, random_page_cost 4, effective_io_concurrency 1 |

## 측정 방법

`measure.py`(이 폴더). 이 PC 에서 같은 LAN 의 DB 로 `psql` 컨테이너를 띄워 측정했다.

- 화면 조건: Edge 와 같은 `internal_analytics_read_snapshot(scope, p_previous=true, null, {fact_encoding: columns-v1, screen_encoding, panels})`.
  scope 는 완료일 기준, 지역·기관·법규 없음(기본), 기간 = 전체(2019-04-23~2026-10-10) / 최근 12개월(2025-10-12~2026-10-11),
  분류 = all / parking. panels 는 이전 최적화 측정과 같은 5개(기관 표, 법규, 개인 비교, 지도 view_bbox, 기관 prefix).
- 보는 사람: 게이트를 통과하는 카카오 세션 중 공개 신고가 가장 많은 기여자(14,354건, 개인 비교가 가장 무거운 경우).
  중앙값 기여자(771건)로도 전체기간을 재봤고 차이는 4% 이내였다(raw/median-viewer.json: v1 10,700 / v2 8,112 ms).
- cold = 매번 새 연결(새 backend: 계획·카탈로그 캐시 없음, PL/pgSQL 컴파일 포함), 8개 조건을 번갈아 3회.
  warm = 한 연결에서 1회 버린 뒤 5회. 둘 다 `EXPLAIN (ANALYZE, BUFFERS)` 의 서버 시간, 그리고 전체 JSON 을 이 PC 로
  받아오는 시간(fetch, cold 2회·warm 3회)을 따로 쟀다. 데이터가 shared_buffers 안에 다 들어 있어 cold 에서도
  shared read 는 0 이었다 — **디스크까지 식은 상태(재부팅 직후)는 측정하지 않았다.**
- spill = `pg_stat_database.temp_bytes` 증가분.

## 화면 집계 v1 vs v2 (raw/screen.json, ms)

| 조건 | 인코딩 | source 크기 | cold 서버 중앙/최대 | cold fetch 중앙/최대 | warm 서버 중앙/최대 | warm fetch 중앙/최대 | temp spill |
|---|---|---:|---:|---:|---:|---:|---:|
| 전체기간·all | v1 | 11.98 MB | 10,885 / 10,967 | 11,304 / 11,677 | 10,796 / 10,900 | 10,893 / 10,955 | 601 MB |
| | **v2** | 9.16 MB | **8,409 / 8,476** | 8,676 / 8,797 | **8,424 / 9,802** | 8,658 / 8,830 | 402 MB |
| 전체기간·parking | v1 | 2.00 MB | 2,685 / 2,732 | 2,793 / 2,853 | 2,724 / 2,752 | 2,757 / 2,779 | 130 MB |
| | **v2** | 1.64 MB | **2,241 / 2,247** | 2,262 / 2,268 | **2,279 / 2,309** | 2,251 / 2,273 | 46 MB |
| 12개월·all | v1 | 9.31 MB | 8,697 / 8,747 | 8,835 / 8,996 | 8,797 / 9,162 | 8,710 / 8,859 | 498 MB |
| | **v2** | 7.00 MB | **6,928 / 7,330** | 7,168 / 7,202 | **7,164 / 7,204** | 7,281 / 7,394 | 348 MB |
| 12개월·parking | v1 | 1.35 MB | 2,141 / 2,244 | 2,212 / 2,226 | 2,164 / 2,291 | 2,261 / 2,265 | 111 MB |
| | **v2** | 1.05 MB | **1,876 / 1,903** | 1,847 / 1,855 | **1,941 / 2,008** | 1,930 / 2,083 | 27 MB |

v2 는 8개 비교 모두에서 빨랐다: 서버 중앙값 10–23% 감소(전체기간·all −22%), source 18–25% 감소, spill 30–75% 감소.
cold 와 warm 차이는 거의 없다(새 backend 비용은 수십 ms 수준). 옛 aarch64 클라우드에서 v2 가 느렸던 결과와 반대다.

### Edge 핸들러 재생 (raw/handler.json)

위 4개 조건의 실제 v1·v2 source 를 현재 `createScreenHandler` 에 넣었다(Node 22, auth/RPC 스텁, Deno Edge 아님,
`tests/integration/selfhost-perf-replay.test.ts` — 환경변수가 없으면 건너뜀).
**4개 조건 모두 v1·v2 공개 packet 이 deep equal** 이다. 파싱+핸들러 중앙값: 전체기간·all v1 95+464 ms → v2 68+403 ms,
12개월·all v1 68+303 → v2 34+276 ms, parking 조건은 둘 다 100 ms 이하. 공개 packet 은 0.65–1.81 MB.

### work_mem·JIT 민감도 (raw/workmem.json, 집계 함수 직접 호출, 3회 중앙값 ms)

| work_mem | v1 전체기간 | v2 전체기간 | v1 12개월 | v2 12개월 | v2 전체기간 temp 기록 블록 |
|---|---:|---:|---:|---:|---:|
| 4 MB | 10,854 | 8,548 | 9,290 | 7,284 | 70,595 |
| 16 MB (v2 현재값) | 10,881 | 8,992 | 8,267 | 7,122 | 49,331 |
| 32 MB | 10,598 | 8,825 | 8,144 | 7,120 | 44,135 |
| 64 MB | 10,019 | 8,032 | 8,556 | 7,761 | 12,114 |
| 128 MB | 10,154 | 8,155 | 8,316 | 7,045 | 0 |

work_mem 을 32배 올려 spill 을 없애도 시간은 5–10% 안팎(측정 흔들림과 비슷)만 줄었다. temp 파일이 OS 페이지 캐시에
머물러 디스크 비용이 거의 없기 때문이다. JIT off(4·16·64 MB)도 일관된 이득이 없었다(±10% 흔들림).
**병목은 메모리·I/O 가 아니라 요청당 CPU 한 코어**(8–11초)다. Postgres 설정만으로 전체기간 화면을 수 초로 줄일 수는 없다.

## 다른 화면 (raw/other.json)

| 읽기 | warm 서버 중앙 ms (cold 중앙) | 결과 크기 |
|---|---:|---:|
| 통계 `statistics/query` 원천(facts 전체, 12개월) | 2,423 (2,458) | **84.9 MB** |
| 통계 원천(전체기간) | 4,049 (3,897) | **129.8 MB** |
| 공개 법규 rollup(12개월) | 1,030 (1,019) | 9 KB |
| 랭킹 `internal_user_rankings` 기본 조건 | 882 (872) | 5.6 KB |

화면(대시보드) 묶음은 위 표의 v1 값이 현재 운영 시간이다(Edge 가 v1 요청). 랭킹은 문서의 "DB 기준 약 8초"(클라우드)보다
훨씬 빠른 0.9초다. 통계 원천은 SQL 은 빠르지만 85–130 MB JSON 을 Edge 로 넘긴다. 셀프호스트 Edge 워커 메모리 한도가
150 MB 라 **통계 화면(특히 전체기간)은 Edge 메모리 한도에 걸릴 위험이 크다**(이번에는 Edge 를 호출하지 않아 확인하지
못함 — 후속 확인 필요).

## 동시 요청 (raw/concurrency.json, 전체기간·all, fetch ms)

| 인코딩 | 동시 | 중앙 | 최대 | DB CPU 최대 | 호스트 used 최대 |
|---|---:|---:|---:|---:|---:|
| v1 | 1 | 9,901 | 9,902 | 104% | 2.9 GB |
| v1 | 2 | 10,541 | 11,250 | 204% | 3.2 GB |
| v1 | 4 | 13,186 | 15,823 | 395% | 3.5 GB |
| v2 | 1 | 8,758 | 8,867 | 105% | 3.7 GB |
| v2 | 2 | 9,124 | 9,182 | 204% | 3.7 GB |
| v2 | 4 | 10,471 | 13,626 | 396% | 4.2 GB |

각 연결은 1회 데운 뒤 2회 측정. 호스트 used 의 측정 전·후 기준선은 2.1 GB(측정 뒤 원래대로 돌아옴).
요청 하나가 코어 하나를 다 쓴다. 4개 동시에서 4코어가 포화돼 지연이 1.2–1.6배가 된다. 5개 이상이면 대기열이 생겨
대략 (동시 수 ÷ 4) × 9초로 늘어난다고 봐야 한다. 메모리는 4개 동시에서도 호스트 사용량이 기준선보다 약 2 GB 늘어난
정도이고 가용 12 GB 에 비해 여유가 크다. 늘어난 양의 상당 부분은 요청마다 쓰는 temp 파일(v2 400 MB)의 캐시다.
이론상 한도: v2 는 해시 노드 하나에 16 MB × hash_mem_multiplier 2 = 32 MB 이고, 노드 십여 개가 겹쳐도 요청당 수백 MB
이하다. **현재 동시 4개 수준에서 work_mem 메모리 위험은 낮고, 먼저 드러나는 한계는 CPU 다.**

## 결론

1. **v2 채택.** 셀프호스트에서 모든 조건이 v1 보다 빠르고(10–23%), 내부 전송이 작고, 공개 packet 이 같다.
   `server/screenHandler.ts` 를 `screen-aggregate-v2` 요청으로 바꾸고 `tests/product/screenSnapshot.test.ts` 를 c53d44e 이전으로
   되돌렸다. `docs/data-contract.md` 의 v2 문장은 이제 코드와 맞고, 되돌림·재채택 경과를 덧붙였다.
2. **클라이언트 대기: 20초 복원 기준 미충족 → 30초 제안(코드는 60초 그대로).** 가장 무거운 화면(전체기간·all, v2)의
   단건 최악은 SQL 9.8초 + Edge 핸들러 약 0.4초 + PostgREST·브라우저 전송(미측정, 1초 안팎으로 추정) ≈ 11초다.
   2배 여유는 22초로 20초를 넘는다. 동시 4개에서 최악 13.6초(+1.5초) ≈ 15초 → 2배 30초. service_role 의
   `statement_timeout` 30초를 넘으면 서버가 어차피 취소하므로, 30초보다 길게 기다려도 얻을 것이 없다.
   v2 Edge 배포 뒤에 30초로 줄이는 것을 제안한다(사용자 결정 필요).
3. 지금 셀프호스트 `my-analytics` Edge 는 저장소 HEAD 와 같은 v1 요청 코드다(배포 파일 해시 일치 확인). **v2 효과는
   `my-analytics` Edge 를 다시 배포해야 나타난다.** SQL 은 이미 적용돼 있어 DB 변경은 필요 없다.

## 제안하는 Postgres 설정 (적용은 사용자 승인 필요, 아무것도 적용하지 않음)

| 설정 | 현재 | 제안 | 근거 |
|---|---|---|---|
| shared_buffers | 128 MB | 1 GB | DB 전체 386 MB 가 들어가고 ingest_events(225 MB)·facts 가 같이 커져도 버퍼에 남는다. 지금은 facts 가 다 들어가 shared read 0 이라 **당장의 속도 이득은 작다**(성장 대비). 재시작 필요. 다른 서비스 합계 ~2 GB 라 15 GB 호스트에 여유 있음 |
| effective_cache_size | 128 MB | 8 GB | 메모리를 잡지 않는 플래너 추정값. 128 MB 는 실제 페이지 캐시(3.4 GB+)보다 훨씬 작아 큰 인덱스 경로를 비싸게 본다. reload 로 적용 |
| v2 집계 함수 `work_mem` | 16 MB | (선택) 64 MB | spill 402 MB → 약 100 MB, 시간은 −5~10%(흔들림 수준). 동시 4개 × 해시 노드 여럿이어도 1 GB 안팎. 함수 변경이라 새 마이그레이션(`alter function private.analytics_screen_aggregate_v2(jsonb,uuid,jsonb) set work_mem='64MB'`)이 필요하며 우선순위 낮음 |
| 전역 work_mem | 4 MB | 그대로 | 무거운 함수는 함수 단위로 이미 올려 두었다. 전역으로 올리면 max_connections 100 전체에 적용된다 |
| service_role statement_timeout | 30 s | 그대로 | 최악 측정 15.8초(v1, 동시 4개)의 약 2배 |
| jit | on | 그대로 | off 에서 일관된 이득 없음 |

설정으로는 화면 집계 시간이 크게 줄지 않는다(CPU 가 병목). 전체기간 화면을 수 초로 줄이려면 범위 밖으로 둔
업로드 시점 사전계산이나 SQL 구조 변경이 필요하다.

## 배포가 필요한 것

- `my-analytics` Edge(셀프호스트): 이 브랜치의 `server/screenHandler.ts`(v2 요청). SQL 변경 없음, Pages 변경 없음.
  되돌리기는 이전 Edge 파일로 복원(구 Edge 는 v1 을 요청하고, 신 Edge 도 v1·legacy source 를 읽는다).
- (선택, 승인 후) 위 Postgres 설정, 클라이언트 대기 30초(Pages 배포 필요).

## 남은 위험·미측정

- 통계 원천 85–130 MB 와 Edge 150 MB 메모리 한도(위). 실제 Edge 호출은 하지 않았다.
- PostgREST 의 응답 포장, Deno Edge 실행 시간, 브라우저까지의 네트워크는 측정하지 않았다(DB→이 PC LAN 전송까지만 포함).
- 디스크까지 식은 상태(재부팅 직후)는 측정하지 않았다. 데이터가 작아 페이지 캐시에서 금방 데워진다.

## 재현

```bash
cd docs/implementation/selfhost-perf-20261011
python3 measure.py settings      # raw/settings.txt
python3 measure.py screen        # raw/screen.json        (~25분)
python3 measure.py workmem       # raw/workmem.json       (~20분, v2 는 BEGIN…ROLLBACK 안의 pg_temp 복사본)
python3 measure.py other         # raw/other.json
python3 measure.py median        # raw/median-viewer.json
python3 measure.py concurrency   # raw/concurrency.json   (ssh 로 free·docker stats 표본)
SELFHOST_PERF_SOURCE_DIR=<저장소 밖 임시 폴더> python3 measure.py export
# 저장소 루트에서
SELFHOST_PERF_SOURCE_DIR=<같은 폴더> SELFHOST_PERF_OUT=docs/implementation/selfhost-perf-20261011/raw/handler.json \
  npx vitest run tests/integration/selfhost-perf-replay.test.ts
```

`.env.supabase.local` 의 `LOCAL_SUPABASE_DB_URL` 은 환경으로만 넘긴다. 검사: `npx vitest run` 672 통과/146 건너뜀,
`npx tsc -p . --noEmit` 통과.
