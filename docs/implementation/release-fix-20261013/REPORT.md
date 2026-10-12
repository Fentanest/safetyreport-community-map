# map 릴리스 전 결함 수정 · 2026-10-13

대상: `fix-map`, 기준 HEAD `7858c13`. `/home/better0101/projects/worktree/astra-rel-fix-brief.md`와 검수 로그 마지막 보고의 P1 1건·P2 3건만 수정했다. 커밋·push·버전 변경·운영 DB 실행·배포는 하지 않았다. 기존 `node_modules` 심볼릭 링크와 package/lock은 그대로다.

## 결함별 수정과 회귀

| 결함 | 수정 | 수정 전 → 수정 후 증거 |
|---|---|---|
| P1 서로 다른 버전의 맞춤 통계 쪽 병합 | 첫 실행만 `consistency=latest`. 이후 표 쪽 넘김·그래프·엑셀 수집은 첫 응답 `dataset_version`을 `expected_version`으로 고정하고 `latest`를 보내지 않는다. 응답과 병합 단계 양쪽에서 버전 검사. 수집 세대 번호로 취소된 수집의 늦은 응답을 폐기한다. 409 뒤 ‘통계 다시 만들기’는 최신 첫 쪽으로 재시작한다. | all/mine/compare 요청·응답 검사 및 혼합 병합 거절. Chromium에서 10쪽 수집과 409→재생성 확인. |
| P2 빈 교차표의 `Infinity` 페이지 크기 | 열이 0개여도 나눗셈의 분모는 최소 1. 정상 0건 응답에 유한한 양의 limit을 제공한다. | all/mine/compare JSON 직렬화·Zod 및 실제 public handler HTTP 200 본문 검사. 수정 전 모두 실패. |
| P2 SQL 번호판 정규화 누락 | 신규 migration으로 NFKC·Cf/공백/하이픈 제거, 지역 약칭, 토큰 경계, 중복/다중 후보 판별, UTF-16 길이 상한을 이식했다. 기존 SQL 파일과 5분류 RPC 정의는 변경하지 않았다. 캐시의 projection/개인정보 revision을 올려 이전 결과를 무효화한다. | 공유 벡터 52개: 구 SQL의 공개 번호판 7개 실패 → 새 SQL 52개 정규화·공개 projection 모두 통과. 실제 PostgreSQL WASM 실행 + 일반 CI용 순수 모델 검사. |
| P2 제거한 지표로 정렬 요청 | 새 설정에 없는 정렬 지표는 기본 정렬로 초기화하고 0쪽에서 시작. 표시 정렬은 성공 응답과 함께 확정한다. | 순수 요청 검사 + Chromium에서 `fine_rate` 정렬→지표 제거→통계 만들기: 구 코드 HTTP 400 → 새 코드 HTTP 200, 정렬 필드 없음. |

SQL의 공개 경계는 `server/plate.ts`와 동일하게 유지했다. `screen_normalize_plate`는 `normalizePlate`와 같이 일반형·이륜형을 정규화하며, 화면 집계에서 쓰는 `screen_plate`는 `parsePlate`와 같이 **안전하게 마스킹 가능한 일반형만** 돌려준다. 이륜형을 기존 `screen_mask_plate`로 보내면 `INVALID_PLATE`가 나므로 공개 표시를 임의로 확대하지 않았다. 공유 fixture 파일은 수정하지 않았다.

## 변경 파일

- 제품: `server/statistics.ts`, `src/data/statistics.ts`, `src/state/statsPaging.ts`, `src/pages/StatisticsPage.tsx`.
- SQL: `supabase/migrations/202610130100_screen_plate_normalization.sql`.
- 회귀: `tests/product/releaseMapRegression.test.ts`, `tests/product/screenPlateSql.test.ts`, `tests/sql/verify-screen-plate.mjs`, `scripts/browser/verify_release_map_20261013.mjs`.
- 운영 리허설: `docs/implementation/plate-sql-20261013/verify.sql`.
- 계약/운영 문서: `docs/public-api-contract.md`, `docs/deployment.md`, 이 보고서와 evidence.

## 최종 검사 결과

- 전체 Vitest: **77 파일, 1,017 시험 통과 / 33 파일, 195 시험 건너뜀 / 실패 0**. 환경 조건부 integration 검사는 미실행으로 남았다. 최종 SQL의 collation/길이 가드 보완 뒤 해당 54개 시험과 실제 SQL 52개 벡터도 재통과했다.
- 신규 결함 회귀 9개: 수정 전 9개 실패 → 수정 후 전부 통과. SQL 구 구현은 7개 실패 → 새 구현 52개 통과.
- `tsc --noEmit`, Vite build, Deno 3함수 검사: 모두 exit 0. 빌드는 dynamic/static import 혼용 및 500kB chunk 경고를 출력했다.
- 공개 산출물 scan: PASS, issue 0. [검사 로그](evidence/vitest-final.log), [빌드 로그](evidence/build-final.log), [산출물 검사](evidence/scan-final.json).
- Chromium **154.0.8037.92**, 1440×900 dark: [수정 전 3개 실패](evidence/browser-before/report.json) → [수정 후 3개 통과](evidence/browser-after/report.json). 10행 전체 히트맵과 지표 제거 후 표 스크린샷을 직접 열어 확인했다. 콘솔은 의도한 HTTP 409 1건뿐이었다. 다중 해상도·실카카오 종합 검수로 확대해 보고하지 않는다.
- 후보 제품/시험 파일은 [SHA-256 명세](evidence/candidate-sha256.json)로 고정했다. 사용자 지시에 따라 새 commit은 만들지 않았다.

## 재현 명령과 환경

공유 node_modules가 다른 저장소를 가리키며 읽기 전용이다. 기본 Vite config loader는 그곳 `.vite-temp`에 쓰려다 EROFS로 막혀, Vitest/Vite에는 `--configLoader runner`를 사용했다. 개발 서버 cacheDir는 `/tmp/map-vite-cache`로 별도 지정했다. 사용자 파일·호스트 권한·자격 증명은 변경하지 않았다.

```sh
npx vitest run --configLoader runner
npx tsc -p . --noEmit
npx vite build --configLoader runner --outDir /tmp/map-release-dist
~/.local/bin/deno check supabase/functions/{public-analytics,my-analytics,community-ingest}/index.ts
python3 scripts/scan_public_dist.py --dir /tmp/map-release-dist
PGLITE_MODULE=/tmp/map-sql-test/node_modules/@electric-sql/pglite/dist/index.js node tests/sql/verify-screen-plate.mjs
# 구 SQL의 7개 실패를 재현하려면 위 명령에 --before 추가
```

PostgreSQL 서버 바이너리는 없었다. 별도 `/tmp` 의존성으로 PGlite 0.5.9 / PostgreSQL 18.6을 사용했고 운영 DB 연결은 하지 않았다. `verify.sql` 전체도 합성 projection/epoch 의존성만 둔 이 환경에서 실행하여 rollback 후 함수 미존재·revision=0을 확인했다. 운영 PostgreSQL에서의 리허설을 대신하지 않는다. PostgreSQL 정규식 의미는 [공식 문서](https://www.postgresql.org/docs/current/functions-matching.html)를 확인했다.

Supabase CLI의 migration 명령도 홈 telemetry 파일 쓰기에서 차단되었다. 그래서 새 migration 파일을 직접 작성했다. 기존 migration 수정이나 원격 schema introspection은 하지 않았다.

## 배포 인계 (실행하지 않음)

1. 운영자가 [verify.sql](../plate-sql-20261013/verify.sql)을 `psql -X -v ON_ERROR_STOP=1 -f ...`로 실행한다. 후보 함수/권한/캐시 revision 변경과 벡터 검증을 한 트랜잭션에서 수행하고 **ROLLBACK**한다. 기존 운영 함수·권한 백업 및 실제 PostgreSQL 버전 호환 확인은 운영자 단계다.
2. `202610130100_screen_plate_normalization.sql` 적용. helper 신설과 `screen_plate`만 교체하며 원본 fact·5분류 집계 함수는 바꾸지 않는다. projection/epoch 갱신으로 첫 요청은 다시 집계한다.
3. `public-analytics`, `my-analytics` Edge 재배포 (`server/statistics.ts` 빈 결과 수정). `community-ingest`는 검사만 했으며 이번 수정으로 재배포할 필요 없다.
4. 지도 정적 웹(현재 운영 Workers/Pages 배포 경로) 재배포. 기존 서버도 후속 페이지 expected_version 검사를 지원하지만 빈 결과 수정은 새 Edge가 필요하다.
5. 승인된 계정으로 빈 통계·정렬 지표 제거·업로드 중 페이지 수집 smoke. SQL rollback이 필요하면 백업한 `screen_plate`를 새 migration으로 복원하고 캐시 revision을 다시 올린다. 폐기된 데이터 버전을 복원하지 않는다.

## 검수 한계

Chromium 검사는 합성 신고 + 실제 프런트/Edge handler + MOCK Kakao SDK이다. 운영 Supabase·실카카오·운영 브라우저 검사는 NOT_RUN. Muse는 `opencode models`가 홈 로그 파일 쓰기 단계에서 실패하여 실제 모델을 확인/호출하지 못했다 (`MODEL_UNVERIFIED / UI_REVIEW_BLOCKED`). 다른 모델 검수로 대체했다고 주장하지 않는다. 로컬 결함 수정 검증과 운영 릴리스 승인은 구분한다.
