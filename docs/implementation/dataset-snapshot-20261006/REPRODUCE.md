# TASK3 로컬 재현

화면 묶음 구현은 `f8d68e7`, 빠른 범위 전환 보완을 포함한 최종 제품 소스는 `5f8ef04`다. PostgreSQL 17.6, 실제 로컬 GoTrue/PostgREST, Deno CLI Edge 엔트리, 로컬 mock Kakao OAuth를 사용한다. hosted Edge gateway/JWT 설정·실제 Kakao SDK·운영 DB·Pages는 검증하지 않는다. 기존 `ci0926-int` 스택을 재사용하며 새 Docker 스택을 만들거나 기존 볼륨을 삭제하지 않는다.

DB 검사는 전역 consent/rate/auth/facts 상태를 바꾼다. **먼저 로컬 DB 전체를 비공개 백업하고 테스트 종료 후 원복한다.** 비밀값이 있는 dump, 함수 환경 파일, 세션 JSON은 ignored `.agent-runtime`에만 둔다. 다른 DB 검사와 동시에 실행하지 않는다. 단, 아래 연속 ingest와 읽기 SQL probe/브라우저만 의도적으로 함께 실행한다.

1. `node scripts/integration/compose_supabase.mjs check --auth ../auth-perf`로 48 migration/7 function manifest를 확인한다. 원본 설치 SQL 상태는 map `202610040800`까지 41개 migration이었다. auth `202610050100` 및 map `060100`–`060600` 파일은 로컬에서만 적용한다(이 실험에서는 migration ledger를 변경하지 않았다).
2. 감사 전후 행렬은 원본 함수/trigger 정의 복원으로 감사 전 상태를 만들고, 감사 후에는 `060100`–`060500`을 적용한다. 새 화면 실험에는 양쪽 모두 `060600`이 필요하다. 이전 Edge는 TASK2 `e133f44` 소스를 별도 composed directory에 고정한다. 새 소스와 디렉터리를 섞지 않는다.
3. map A–L mock Kakao는 기존 Auth 컨테이너의 현재 mock secret과 일치해야 한다. secret은 메모리에서 읽고 로그에 출력하지 않는다. 현재 compose가 생성한 임의 secret을 이미 실행 중인 Auth 컨테이너에 그대로 쓰면 OAuth signature 검사가 실패한다.
4. 56999에서 이전 Edge 전체 7개를 실행하고, 56998에서는 후보 읽기 Edge 3개만 실행한다. `--functions-root` 아래 `.env`는 비공개 로컬용이고, wrapper는 기존 `--stack` 환경값을 우선한다. `DENO_CERT=/etc/ssl/certs/ca-certificates.crt`를 사용한다.

```bash
# 각각 별도 터미널. baseline에는 e133f44의 frozen composed 소스를 사용한다.
DENO_CERT=/etc/ssl/certs/ca-certificates.crt node scripts/integration/deno_functions.mjs --stack .integration-stack
DENO_CERT=/etc/ssl/certs/ca-certificates.crt node scripts/integration/deno_functions.mjs \
  --stack .integration-stack --functions-root . \
  --functions public-analytics,my-analytics,user-rankings --port 56998 --function-port-base 8201
```

각 단계는 다음 명령을 사용하며 `SNAPSHOT_PHASE`, 읽기 주소, 시간, 출력 이름을 바꾼다. `before`는 56999/120초, `after`는 56998/180초, 첫 고정 커밋은 56998/300초, 범위 전환 보완 커밋은 56998/210초다. 각각 4건/초 목표로 **실제 account/consent/connections/ingest HTTP**를 실행한다. 쓰기 배치는 5건/1.25초로 기존 60 batch/분 한도 이하다. `SNAPSHOT_BROWSER_SESSION`을 주면 별도 viewer 계정 H의 실제 세션을 0600 파일로 생성한다. 세션/토큰을 stdout에 출력하지 않는다.

```bash
COMMUNITY_STACK=1 COMMUNITY_API_URL=http://127.0.0.1:56999 \
  SNAPSHOT_READ_API=http://127.0.0.1:56998 COMMUNITY_MOCK_KAKAO_HOST=127.0.0.1 \
  SNAPSHOT_PHASE=after SNAPSHOT_SECONDS=300 \
  SNAPSHOT_BROWSER_SESSION=.agent-runtime/dataset-snapshot-20261006/browser-session.json \
  SNAPSHOT_OUT=docs/implementation/dataset-snapshot-20261006/evidence/final-continuous-ingest.json \
  npx vitest run tests/integration/dataset-snapshot-load.test.ts

# 위 ingest가 실제로 실행 중일 때만 SQL snapshot probe를 실행한다.
COMMUNITY_STACK=1 SNAPSHOT_CONCURRENT_PROBE=1 \
  SNAPSHOT_PROBE_OUT=docs/implementation/dataset-snapshot-20261006/evidence/sql-snapshot-probe.json \
  npx vitest run tests/integration/snapshot-contract.test.ts
```

웹은 local public 환경 설정(데이터 모드 live, API 56998, Supabase 56321, 기존 로컬 publishable key)으로 build하고 56480에서 preview한다. 비밀 service key는 웹에 넣지 않는다. 연속 ingest 시작 후 새 세션 파일이 준비되면:

```bash
SNAPSHOT_BROWSER_SESSION=.agent-runtime/dataset-snapshot-20261006/browser-session.json \
  SNAPSHOT_TRANSITION=1 SNAPSHOT_BROWSER_SECONDS=180 \
  SNAPSHOT_BROWSER_OUT=docs/implementation/dataset-snapshot-20261006/evidence/browser-final \
  node scripts/browser/verify_dataset_snapshot.mjs
```

브라우저는 SDK만 mock하고 외부 요청을 차단하며 실제 local API 응답을 쓴다. 비교 켜기, 기관 표 확장/검색, 통계 설정/실행, 랭킹, 대시보드 복귀/새로고침, 390/1440/1920/2560 viewport를 검사한다. 성공 assertion은 HTTP 전부 200, 화면 오류 0, 응답 묶음의 dataset_version 불일치 0, 가로 넘침 0이다. 통계의 의미상 건수 일치는 별도 workload/단위 테스트에서 검사한다. screenshots는 자동 PASS에 더해 실제로 열어 확인한다.

기존 회귀 검사는 ingest 종료 후 후보 composed 7개 함수를 56999에서 실행하고 순차 수행한다. `user-rankings-edge`는 해당 포트에 자체 Deno를 띄우므로 wrapper 종료 후 단독 실행한다.

```bash
npm test
npm run build
npm run scan
python3 -m unittest discover -s tests/blueprint
python3 -m unittest discover -s tests/product
COMMUNITY_STACK=1 COMMUNITY_API_URL=http://127.0.0.1:56999 \
  COMMUNITY_MOCK_KAKAO_HOST=127.0.0.1 COMMUNITY_STACK_DIR=.integration-stack \
  npx vitest run tests/integration --no-file-parallelism --maxWorkers=1 \
  --exclude tests/integration/user-rankings-edge.test.ts
# 위 wrapper를 정상 종료한 뒤:
COMMUNITY_STACK=1 npx vitest run tests/integration/user-rankings-edge.test.ts
```

최종 브라우저 명령의 `SNAPSHOT_TRANSITION=1`은 traffic 화면 요청을 3초 지연시킨 뒤 A→B→A 취소와 표 검색을 겹친다. 예전 개별 public-analytics 패널 요청이 발생하지 않음을 검사한다. 기능/계약이 바뀌지 않은 서버·SQL은 앞의 전체 로컬 회귀 결과가 그대로 적용되며, 이 클라이언트 보완 뒤 단위 638개/build/scan/연속 ingest/브라우저/SQL probe를 다시 실행했다.

종료 시 소유한 Deno/mock/preview/브라우저만 종료한다. 원본 56개 auth/private/public 테이블과 4개 시퀀스, 함수/trigger/FK/ACL을 복구하고 새 `internal_analytics_read_snapshot` 및 batch trigger helper를 제거한다. 원본과 행 해시·catalog·publication·migration ledger 41개·컨테이너 ID/health를 대조한다. 전체 컨테이너나 볼륨을 삭제하는 방식으로 복원하지 않는다. 실제 복원 결과는 `evidence/local-restoration.json`에 기록한다.
