# my-reports 구현 보고 (map 백엔드)

기준 지시: `SOL_MAP_MY_REPORTS_PROMPT.md`. 확장 인계: `EXTENSION_HANDOFF.md`. 측정: `MEASUREMENTS.md`.
브랜치 `claude/gallant-darwin-7ldkbl` (main 501a84d 병합 포함). 운영 DB·Edge에는 아무것도 적용하지 않았다.

## 1. 상태 구분

| 단계 | 상태 | 근거 |
|---|---|---|
| 코드 구현 | 완료 | 아래 §2 파일 |
| 로컬 통합 검증 | 완료(로컬 합성) | 실제 Postgres 17·GoTrue·PostgREST + Deno Edge 진입점(deno-local), mock Kakao OAuth |
| 운영 DB 적용 | **미적용** | 사용자 승인·실행 필요(§6) |
| Edge 배포 | **미배포** | 사용자 승인·실행 필요(§6) |
| 확장 연동 | **미완료** | 확장 dev(4c87550)는 main의 offset 초안에 맞춰져 있음 → 인계서 §10대로 v1 전환 필요 |

## 2. 변경

- 계약(정본): `contracts/my-reports/` — `README.md`, `my-reports-v1.schema.json`, `types.ts`, `fixtures/*.json`(성공 9 + 오류 6), `MANIFEST.sha256`
- SQL: `supabase/migrations/202610020100_my_reports.sql` (신규). `internal_my_reports_search/summary/numbers` 3개 RPC(service_role만),
  private helper, 복합형 `private.my_reports_row`. main 초안의 `public.internal_my_reports`를 drop. 테이블·트리거·업로드·동의·공개 조회 변경 없음.
- `202609300200_my_reports.sql`(main 초안)은 이력 보존을 위해 **수정하지 않음**. 순서: 202609300200 → 202610010100 → 202610020100.
- Edge: `supabase/functions/my-reports/index.ts`, `server/myReports/handler.ts`, `server/myReports/cursor.ts`; `supabase/config.toml`(`verify_jwt = true`)
- 삭제: `server/myReportsHandler.ts`(main 초안 handler). `docs/my-reports.md`는 계약 안내로 교체.
- 구성: `docs/integration/community-ingest/migration-manifest.json`(202609300200·202610010100·202610020100, my-reports 함수·shared,
  그리고 이전부터 빠져 있던 `src/domain/tableSort.ts` staging), `scripts/integration/compose_supabase.mjs`(커서 비밀값 생성),
  `deno_functions.mjs`(함수 목록), `sync_contract_copy.py`(`--contract my-reports`, `--manifest`), `mock_kakao.mjs`(J·K 계정)
- 테스트: `tests/product/myReportsHandler.test.ts`, `myReportsContract.test.ts`, `helpers/jsonSchema.ts`, `functionAuthConfig.test.ts`;
  `tests/integration/my-reports-sql.test.ts`, `my-reports-edge.test.ts`, `my-reports-measure.test.ts`, `helpers/myReports*.ts`

### 결정 기록

- **정본 계약**: main 초안(offset)과 v1(서명 커서)이 같은 경로에서 충돌 → 사용자 결정으로 v1. 변경점은 인계서 §10.
- **공식 링크**: PC `web/templates/base.html` `safetyWebUrl(id)` = `https://www.safetyreport.go.kr/#mypage/mysafereport/` + `encodeURIComponent(source_report_id)`.
  모바일은 기본 URL만 쓴다. `source_report_id`가 `^[0-9A-Za-z_-]{1,40}$`(ingest 계약)에 안 맞으면 null.
- **주소 비교**: PC `/api/v1/address`는 `위반장소 LIKE %q%`(부분 포함)였다. `예시로 1`이 `예시로 12`를 포함하므로 v1은 “같은 주소”
  = NFC·공백 정리 후 끝의 ` (…)` 참고항목 하나를 뺀 값이 완전히 같을 때로 정했다.
- **수용률**: 지시대로 `accepted / 전체 완료`(0~100, 소수 1자리). 지도(map)의 “결과가 나온 신고” 분모와 다름을 인계서에 명시.
- **본인 자료 공개 마스킹**: 공개 지도용 금액·법규·별점 공개 동의 마스킹은 본인 조회에 적용하지 않는다(본인이 올린 값).
  접근 허용 = 완료 4상태 + 활성 동의 계보. 정지 기여자는 403, 동의 없음/철회는 `account.contributor`로 구분한 정상 응답.
- **verify_jwt**: 같은 프로젝트의 기존 사용자 함수(my-analytics·community-ingest)와 같게 `true`. handler는 게이트 여부와 무관하게
  getUser + claims + DB identity/session을 검사한다. 프로젝트가 비대칭 JWT 서명키로 바뀌어 게이트가 사용자 토큰을 거부하면
  이 함수만 `false`로 바꾸는 것을 검토한다(handler 검증은 유지).
- **시간 제한**: Edge 5초 AbortSignal. 공유 프로젝트의 역할 `statement_timeout`은 바꾸지 않았다.

## 3. 실행한 검사

| 검사 | 환경 | 결과 |
|---|---|---|
| `npm test` (product 전체) | node | 544 passed |
| `npx tsc -b` | node | 통과 |
| `compose_supabase.mjs check` | node | ok (31 migrations, 6 functions) |
| 새 DB 설치(31개 마이그레이션 전체) | 로컬 스택 `db reset` | 통과 |
| 기존 DB 업그레이드(202609300200 초안 적용 후 202610020100) | 로컬 스택 | 통과, `internal_my_reports` 제거 확인 |
| `my-reports-sql.test.ts` | 실제 Postgres/GoTrue/PostgREST + in-process handler | 20 passed |
| `my-reports-edge.test.ts` | Deno CLI Edge 진입점 + gateway + mock Kakao OAuth | 5 passed |
| `date-basis-sql` / `my-analytics-stack` / `statistics-edge` / `agency-recompute-stack` | 같은 스택 | 11 / 7 / 6 / 1 passed |
| `my-reports-measure.test.ts` | 같은 스택, 합성 대량 | 측정 완료(MEASUREMENTS.md) |

### 지시 §10 항목 대응 (map 쪽)

| 항목 | 테스트 |
|---|---|
| 토큰 없음·공개키만·위조 토큰·비카카오·폐기 세션·정지 기여자·banned | sql `auth:`; handler `auth failures`; edge `preflight…` |
| 익명 사용자 | handler(`is_anonymous` → KAKAO_REQUIRED) |
| A가 B만의 차량·주소·번호 검색, 담당자·링크 비노출 | sql `isolation`; edge `A/B isolation` |
| user_id 주입, 다른 계정·필터·엔드포인트·part 커서, 변조·만료 커서 | sql `cursors`; handler `cursors`, `strict fields`; edge |
| 원천 테이블·내부 RPC anon/authenticated 직접 접근 | sql `grants` |
| writer 등록 없이 새 세션, 기존 세션 불변 | sql `a new extension session…` (connections 0건 확인) |
| 0/1/9/10건, 10건 gate 미적용, 동의 없음/철회 | sql `0 / 1 / 9 / 10` |
| 페이지 중 철회 → 다음 페이지 차단 | sql `consent revoked while paging` |
| 0~5·6·64·65 코드포인트, 한글·공백·NFC, `%`·`_`·`\` 리터럴 | sql `literal search`, `SQL normalisation equals…`; contract 테스트 |
| 같은 주소/인접 주소, 지역 확장 없음 | sql `address` |
| 미완료 제외, completed_unknown 분리, 좌표 없음 포함 | sql `vehicle search` (R9, R4) |
| PC/모바일 중복, 같은 키·다른 번호, 레거시 번호 없음, 번호 후행 보완, 답변 최신성, 옛 관측 부활 방지 | sql `vehicle search`, `pages` (R1, R10, R8, R12, R2) |
| 20행 밖 신고의 총수·담당자 반영, 동명이인 분리 | sql `pages`, `managers` |
| 금액 null/0/확정/범칙금, 별점 null/유효 | sql `vehicle search`, `managers`; handler DTO |
| KST 자정·월말·연말, 자정 넘어 커서 유지, 답변일 null | sql `summary`, `recent window…`; handler `summary` |
| 별점·금액·기관·번호 보완·삭제 시 버전 감지, 타인 업로드는 무효화 안 함 | sql `version`; edge `data change` |
| 번호복사 여러 페이지·결측 수·중복 제거·상한 초과·작업 중 변경 | sql `numbers`, `version` |
| preflight, 허용/비허용 Origin, Origin 없음, 인증 오류 CORS | handler `CORS`; edge `preflight` |
| rate limit·본문·페이지·응답 상한·timeout·upstream 장애가 0건 성공으로 안 바뀜 | handler `method…`, `DB gate…`, `256 KiB`; sql `rate limit` |
| DTO·로그에 제외 본문·타인·내부 ID 없음 | handler `DTO allowlist`, `logs`; sql `logs`, `isolation` |
| 기존 public/my-analytics/ingest·기관·마스킹 회귀 | product 544, stack suites 위 표 |

### 실행하지 못한 것 (NOT RUN)

- `tests/integration/community-stack.test.ts`(33건): Realtime websocket이 필요하나 이 로컬 스택은 Realtime 컨테이너 없이 기동됨 → 시작 단계 실패. 이번 변경과 무관한 환경 제약.
- Supabase **edge-runtime** 컨테이너 실행: 이 환경의 TLS 프록시로 npm 다운로드가 실패해 Deno CLI(deno-local)로 같은 진입점을 실행했다. gateway의 `verify_jwt` 단계는 재현되지 않는다.
- 실제 Kakao·운영 Supabase 로그인, 운영 DB, 운영 Edge: 미실행.
- `official_url` 실제 사이트 이동: 안전신문고 로그인 계정이 없어 미실행(URL builder 단위 테스트만).
- 실제 확장(설치된 Chrome) 연동: 확장 세션 몫, 미실행.

## 4. 성능·전송량 요약 (로컬 합성)

| 사용자 규모 | DB 실행(검색 첫 쪽) | DB→Edge | Edge→확장(20행) |
|---|---:|---:|---:|
| 본인 500건 | 28 ms | 17.9 KB | 19.4 KB |
| 본인 20,000건(관측 40,000행) | 666 ms | 18.0 KB | 19.5 KB |

전송량은 페이지 크기로 제한되어 본인 신고 수와 거의 무관하다(50행+담당자 50명 ≈ 58 KB, 상한 256 KiB). 상세는 MEASUREMENTS.md.

## 5. 남은 위험

- 본인 신고가 수만 건을 넘는 계정은 요청당 본인 전체 이력의 대표 선정 비용이 선형으로 는다(20k ≈ 0.6 s).
- `202609300200`이 이미 운영에 적용됐는지 모른다. 적용됐든 아니든 `202610020100`이 초안 함수를 제거한다. 다만 `202610010100`이
  이미 적용된 DB에 `202609300200`을 나중에 넣으면 버전 순서가 뒤집히므로, 적용하지 않았다면 **202609300200은 건너뛰고
  `migration repair --status applied 202609300200`으로 기록만** 한다(§6).

## 6. 사용자 조치 (순서)

1. PR 생성·검토·main 병합(요청 시 PR을 만든다).
2. 운영 DB — `db push` 금지(auth 레포와 공유 프로젝트):
   - `202610010100_single_date_cohort.sql`이 아직이면 먼저 적용 + `npx supabase migration repair --status applied 202610010100`
   - `202609300200_my_reports.sql`: **적용하지 않는다.** 이미 적용했다면 그대로 두고, 아니면 `npx supabase migration repair --status applied 202609300200`만 실행
   - `psql "<운영 DB 연결 문자열>" -v ON_ERROR_STOP=1 -f supabase/migrations/202610020100_my_reports.sql`
   - `npx supabase migration repair --status applied 202610020100`
3. Edge 비밀값(값은 직접 생성, 커밋·공유 금지):
   `npx supabase secrets set MY_REPORTS_CURSOR_SECRET=<32바이트 이상 임의 문자열> MY_REPORTS_ALLOWED_ORIGINS=chrome-extension://<배포 ID>[,chrome-extension://<개발 ID>]`
4. `npx supabase functions deploy my-reports`
5. Supabase Dashboard → Authentication → URL Configuration → Redirect URLs에 `https://<확장 ID>.chromiumapp.org/supabase-auth` **추가**(기존 유지).
6. 확장 세션에 인계서 §10 전달 → 확장 v1 전환 후 smoke(인계서 §8-5).
7. 문제 시 `npx supabase secrets set MY_REPORTS_ENABLED=false`(즉시 503, DB 접근 없음).
