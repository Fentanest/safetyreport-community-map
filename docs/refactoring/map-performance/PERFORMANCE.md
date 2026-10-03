# 측정 범위와 해석

숫자는 아래 연결된 JSON의 실제 표본에서 nearest-rank p50/p95로 산출한다. 일반30회/대규모10회, 첫 표본 포함이다.
10회 p95는 사실상 최댓값이며 신뢰구간이나 운영 개선율로 확대하지 않는다. 합성 고정 seed, 동일 호스트/DB/브라우저,
cache/no-store/환경은 각 파일과 [environment](evidence/environment.json)에 기록했다. 다른 Docker 프로젝트는 변경하지 않았고 배경 잡음 가능성이 있다.
원본/후보를 독립 실행한 값과 같은 seed/connection 원본 alias를 비교한 paired 값을 구분한다.

- Node CPU: `public-analytics-measure.test.ts`, index-distribution-v1,0/1/500/58,388/100,001/500,000.
  원시 facts가 이미 메모리에 있고 auth/rate fixture이다. HTTP/DB transport/운영 검증이 아니다.
- SQL 랭킹: 기존 `user-rankings-measure.test.ts` 재사용. 사용자별 고유50만/중복10만/1,000명, rollback seed.
  원본 alias는 대표/RPC/viewer의 기존 migration 본문에서 만든다. plan_cache_mode=force_generic_plan을 양쪽에 명시한다.
  응답은 generated_at만 제외하고 전체 비교하며 version/정확한 통계/전역 me/tie/page가 일치해야 한다.
  source key가 계정 사이에 겹치는 기존 fixture라 **지도 글로벌50만 대표 증거가 아니다**.
- Native 집계: 동일 seed를 user-qualified source key로 바꿔 글로벌50만 대표/60만 관측을 검증한다.
  기존 raw RPC의10만 cap RESULT_TOO_LARGE를 직접SQL로 호출해 기록하고(계약상422, 실제HTTP상태 아님), manager/law/month만 DB→Edge aggregate DTO로 보낸다.
  계획 실패와 diagnostic budget180s는 성능 PASS로 합산하지 않는다. 제품 work_mem/timeout은 그대로다.
- Normal HTTP: real GoTrue/getUser + SQL viewer/rate/state + PostgREST + actual Deno function. 카카오 identities는 합성이고
  Supabase edge-runtime gateway JWT검증/실OAuth/hosted network는 재현하지 않는다. 원본 viewer/state alias까지 포함하고
  매 사용자·route·variant30회,동시1/3/5를 검사한다. rate limit은 끄지 않는다.
- Production frontend: 같은 demo seed/mock SDK/ranking DTO,30 fresh contexts per route. 개발 Profiler는 시간표본에 쓰지 않는다.
  JavaScript bytes는 uncompressed 로컬 응답 body이고 gzip build size와 별개다. code/HTTP cache 상태를 명시한다.
  locator의 exponential polling은 최대500ms 확인 지연을 만들므로 최종값은 visible rows를 RAF polling으로 확인한다.
  로그인/SQL이 완료된 운영 UI 지연으로 부르지 않는다.
- DEV 진단: actual React Profiler와 chart/map/observer counters, 늦은 응답 forced delays,20회 왕복.
  Abort는 DB취소를 증명하지 않는다. 서버 취소·RUM INP·실사용 field 지연은 미검증이다.

정량 표는 measurements-summary.md에 생성하며 REPORT에 목표·회귀·잔여 병목과 연결한다.

최종HTTP040800 재측정은 `http-1/3/5-verified`다. 이전500-own-key 기관 회귀와 첫 cold503은 별도 디렉터리에 보존한다. `binary-ranking`은 원본과 후보 모두 nested auto_explain analyze가 켜진 교대10회다. `binary-ranking-timing-final`은 양쪽 계측을 끈 primary timing으로 구분하며 같은 최종 partial index가 원본/후보 모두에 존재한다. 비교가 다른 실행을 섞지 않는다.

최종 비계측SQL first p50/p9514565/15181→5522/6111ms, rates14620/16182→5504/6056ms.25s 첫원본 실패는 로그에 남겼고60s outer진단으로 재실행했다. 제품/HTTP timeout 확대가 아니다. 이 실행의 함수본문md5와7542cde HEAD를 JSON에 기록했다. candidate4개 다른모드 호출로 공용heap을 먼저 읽은 후 원본/후보를 교대로10회 측정하며 함수plan 초기화순서 차이는 남는다. 숫자는 이 측정 조건의 값이고 운영 capacity/SLO 검증이 아니다.

최종 frontend는 production-latest의180cold contexts/공유browser 실행에서 세화면 p95회귀가 있었다. production-isolated는 화면/variant별 독립browser30contexts로 dashboard/통계 재측정했고 회귀가 재현되지 않았다. 두 실행 모두 보존한다. 외부 widgets 요청량도 달라 원인을 확정하지 못하며 일반회귀없음으로 결론내리지 않는다.

커밋한 텍스트 증거는 SQL/로그 말미 공백과 EOF 빈 줄만 정리했다. 수치·SQL·응답·표본을 바꾸지 않았고 원본 실행 로그는 ignored .agent-runtime에 유지한다.
