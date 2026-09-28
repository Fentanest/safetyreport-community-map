# 배포·롤백 (운영 반영은 이번 작업에서 하지 않음 — 승인 경계)

## 1. rollout 순서
1. 운영자: `scripts/integration/preflight_counts.sql`(읽기 전용) 실행 → §2 결정표.
2. 중앙 SQL: manifest 순서로 auth `202609260100` → map `202609260200`(합성 이력, `node scripts/integration/compose_supabase.mjs check --auth <배포할 safetyreport-community-auth checkout>` 통과본만 — 인증 경로는 필수, 기본값 없음). `db push`·repair·reset 금지.
3. Edge Functions: `community-account`(verify_jwt=true), `community-ingest`(verify_jwt=true), `public-analytics` 재배포(공개 RPC 교체 반영), relay 는 변경 없음(verify_jwt=false 유지).
4. auth 사이트 문구(도움말·개인정보) 배포.
5. 앱 배포(PC·Docker·Android): 공개 설정 Variables 주입본만. **중앙 capability 확인 전 앱 배포 금지**(필수 게이트가 영구 잠김 방지) — 확인: 테스트 계정으로 `community-account/status` 200, `consent` 성공, `community-ingest/manifest` 200.
6. 제한 업로드(운영자 테스트 계정) → 익명 공개 API 로 held 확인.
7. `analytics_state.ready=true` 전환(공개 projection 활성화) → 익명 지도 확인.

## 2. 구 자료 결정표 (S-10)
| preflight 결과 | 조치 |
|---|---|
| `v2_facts_public = 0` | 그대로 적용(가드 통과). staged/expired snapshot 행은 공개되지 않으므로 보존만 한다 |
| `v2_facts_public > 0` | 적용 중단(가드가 막음). 구 자료를 지우지 않는다. 운영자가 (a) 구 공개 자료를 계속 보일지, (b) 사용자별로 ingest 로 대체할지 결정하고, 결정에 맞는 **별도 전환 migration** 을 작성·검토(Sol)한 뒤 다시 시도. 결정 전에는 BLOCKED 로 보고 |
| map v2 미적용(`map_v2_applied=false`) | 1→2(map v2)→… 순서 그대로. v2 표는 비어 생성되므로 가드 통과 |

## 3. rollback
- 새 업로드 중단: `community-ingest` 함수 비활성(또는 `COMMUNITY_INGEST_ENABLED=false`), 공개 중단: `analytics_state.ready=false`.
- 앱 쪽 journal·outbox·개인 DB 는 삭제하지 않는다(재개 시 그대로 전송). 중앙 원장·fact 는 삭제하지 않는다.
- SQL 되돌리기는 새 migration 으로만(이미 적용한 SQL 수정 금지).

## 4. 필요한 운영 입력(값은 문서에 적지 않음)
| 저장소 | 이름 | 종류 |
|---|---|---|
| safetyreport | `COMMUNITY_SUPABASE_URL`, `COMMUNITY_SUPABASE_PUBLISHABLE_KEY` | GitHub Actions Variables |
| safetyreport-mobile | 같은 2개 | Variables |
| community-map | `PUBLIC_ANALYTICS_URL`, `KAKAO_MAP_JS_KEY`(기존) | Variables |
| community-auth | `SAFEAUTH_PUBLIC_SUPABASE_URL`, `SAFEAUTH_PUBLIC_PUBLISHABLE_KEY`, `SAFEAUTH_PUBLIC_PRIVACY_POLICY_URL`, `SAFEAUTH_PUBLIC_OPERATOR_CONTACT`(기존) | Variables |
| Supabase 함수 secret | `AUTH_RELAY_HASH_PEPPER`, `AUTH_RELAY_ENCRYPTION_KEY`(기존), `ANALYTICS_RATE_SALT`(기존), `AUTH_JWT_ISSUER`, `COMMUNITY_ALLOWED_ORIGINS` | Supabase secrets |
| Supabase Auth | Kakao provider client id/secret, Redirect URLs(`https://safeauth.worklazy.net/callback.html`, `com.fentanest.mysafetyreport://auth/callback`) | 대시보드 |

## 5. 운영 점검 기록 (2026-09-27, 읽기 전용) · 전체×내 신고 비교 포함 절차
- 프로젝트 `nxdcxccixoswvqgjeprh`(ap-northeast-2). 원격 migration 이력 없음. `public`/`private` 스키마 덤프(스키마만): 플랫폼 기본값과
  `public.rls_auto_enable` 이벤트 트리거뿐 → §2 결정표의 **map v2 미적용(신규 설치)** 경로. 공개 구 자료 없음.
- Edge Functions 배포 0개(`public-analytics`·`community-ingest`·`community-account`·`community-auth-relay`·`my-analytics` 모두 404).
  Edge secrets: relay용 5개만(`AUTH_BROWSER_ORIGIN`, `AUTH_RELAY_ENABLED`, `AUTH_RELAY_ENCRYPTION_KEY`, `AUTH_RELAY_HASH_PEPPER`, `AUTH_SITE_URL`).
- 이 프로젝트의 기본 권한은 `public` 새 함수에 anon/authenticated EXECUTE를 준다. 모든 `internal_*` migration은 생성 직후 명시 revoke하며,
  적용 후 `supabase db dump --linked --schema public`의 GRANT로 anon/authenticated EXECUTE가 없는지 확인한다.
- migration 적용 방법: 두 저장소 이력을 합친 `compose_supabase.mjs compose` 결과(해시 check 통과본)에서만 `db push`한다(auth 저장소
  docs/deployment.md §2의 방법 2와 같다). 개별 저장소에서의 push·repair·reset은 여전히 금지. 먼저 `--dry-run`으로 6개 버전만 나오는지 확인.
- secrets 추가: `ANALYTICS_RATE_SALT`(무작위 생성), `AUTH_JWT_ISSUER=https://nxdcxccixoswvqgjeprh.supabase.co/auth/v1`,
  `MY_ANALYTICS_ALLOWED_ORIGINS=https://safemap.worklazy.net`. `COMMUNITY_ALLOWED_ORIGINS`는 코드 기본값(safemap, safeauth).
- 함수 배포는 합성 디렉터리에서 5개(`public-analytics`, `my-analytics`, `community-ingest`, `community-account`, `community-auth-relay`).
- Pages: `MAP_SUPABASE_URL`, `MAP_SUPABASE_PUBLISHABLE_KEY`(공개 publishable) 저장소 변수. snapshot export는 `ready=true` 전에는 거부하므로
  지도 Pages 공개는 §1의 6→7단계(실제 카카오 테스트 계정 업로드 후 `ready=true`) 뒤에 실행한다.

## 6. 운영 반영 기록 (2026-09-27, 사용자 승인)
- DB: 합성 디렉터리(해시 check 통과)에서 `db push --linked` — `202608150001`·`202609240001`·`202609251200`·`202609260100`·
  `202609260200`·`202609270100` 6개 적용(dry-run으로 목록 확인 후). 적용 후 스키마 덤프: `internal_*` 27개 함수 모두 EXECUTE는
  `service_role`만, private 표와 `public.public_map_points`에 anon/authenticated 권한 없음. `analytics_state.ready=false` 유지.
- Edge Functions 5개 배포(ACTIVE): `public-analytics`(verify_jwt=false), `my-analytics`(true), `community-ingest`(true),
  `community-account`(true), `community-auth-relay`(false). secrets: `ANALYTICS_RATE_SALT`, `AUTH_JWT_ISSUER`,
  `MY_ANALYTICS_ALLOWED_ORIGINS` 추가(사용자 입력), relay 5개 기존.
- smoke(익명): public `meta` 200, `dashboard` 503(not ready), `my-analytics` 토큰 없음 401, safemap preflight 204(정확한 Origin 에코·
  private no-store), 다른 Origin 403, `community-ingest`·`community-account/status` 토큰 없음 401. 운영 gateway는 CORS를 `*`로 덮지 않음.
- Pages: PR #1·#2 병합 후 `community-map-pages` 실행 성공, `https://safemap.worklazy.net/` 200. not-ready 안내 표시, 지도 로그인 버튼
  노출(로그인 설정 반영), console·4xx/5xx 0. snapshot은 `SNAPSHOT_ALLOW_NOT_READY=1`로 생략(부분 snapshot 없음).
- 남은 운영 단계: §1의 5(앱 배포)·6(본인 카카오 계정 시험 업로드)·7(`ready=true`). ready 전에는 지도 영역이 그려지지 않아
  Kakao JS SDK 도메인 등록은 ready 뒤에 확인한다. 실제 카카오 로그인·내 통계 비교는 사용자 계정으로만 확인 가능.

## 7. 운영 반영 기록 (2026-09-27, 과태료 금액·기간·행정구역·동의 2026-09-28.1)
- DB: 합성 디렉터리(manifest check 9개 통과)에서 dry-run으로 3개만 나오는 것 확인 후 `db push --linked`:
  map `202609280100`(금액 projection·disclosures 표), auth `202609280200`(정책 2026-09-28.1 추가·현재 지정), map `202609280300`(2026-09-28.1 금액 공개 등록).
  스키마 덤프: `internal_analytics_v2_facts` EXECUTE는 service_role만, `private.community_policy_disclosures`는 service_role SELECT만.
- Edge Functions: `public-analytics`, `my-analytics` 재배포(공유 모듈 amount·duration·regions와 코드표 JSON 포함). 다른 3개는 코드 변경 없음.
- smoke: meta 200(capabilities 모두 supported — 운영 `analytics_state.ready=true` 상태였음, 이번 작업에서 바꾸지 않음), dashboard 200(사실 0건: 기간 count 0, 금액 fine_count 0, regions 없음),
  옛 지역 키 `서울 중구` 200, my-analytics 토큰 없음 401.
- Pages: PR #9 병합(`87798d4`) 후 `community-map-pages` 수동 실행 성공. 실제 도메인에서 카카오 지도·서울 중구 경계 맞춤·새 표 행, console·4xx/5xx 0.
- auth: PR #1 병합(`ecdbcba`). CI local-stack은 지도 스키마 없이 도는 relay 전용이라 새 정책 migration을 계정 레지스트리와 함께 건너뛰게 했다(적용된 migration은 수정하지 않음).
- 앱: PC·모바일 dev에 필수 동의 2026-09-28.1 반영(로컬 커밋, push·릴리스 전). 앱을 배포하기 전에는 운영 현재 정책(2026-09-28.1)과 배포된 앱의 필수 버전이 다르면 동의 단계에서 policy_mismatch가 난다 — 운영 동의 0건이라 현재 영향 없음.
- 롤백: disclosures 행 삭제(금액 즉시 비공개), `community_policy_current`를 2026-09-26.1로 되돌림(정책 행은 지우지 않음), 함수는 이전 배포 재배포.
- 동의문 2026-09-28.1 덮어쓰기(사용자 결정, 같은 날): 삭제 요청·문의를 이 저장소 공개 Issues로 안내하도록 문구를 바꾸고 같은 버전을 유지했다.
  auth `202609280400`은 그 버전을 참조하는 동의가 있으면 실패하고 없을 때만 해시를 바꾼다 — 운영 적용 성공(당시 동의 0건), 운영 정책 표 해시 `a775cc34…8670` 확인.
  Issues 템플릿 `.github/ISSUE_TEMPLATE/`(삭제 요청·문의, 공개 게시판이라 개인정보를 적지 말 것). 운영자 삭제 처리는 `internal_community_delete_contributions(user, session)`.

## 8. 운영 반영 기록 (2026-09-27, 동의문 중앙 제공 — 사용자 승인)
- DB: auth `202609280600_policy_consent_text.sql` 하나만 적용. 지도 dev 의 `202609280700_analytics_viewer`(미승인)는 뺀 임시 manifest·지도 worktree 로
  합성해 dry-run 목록이 0600 하나인 것을 확인한 뒤 `db push --linked`. 적용 전 운영 동의 0건(2026-09-28.1 포함) 확인 — migration 은 그 버전에 동의가 있으면 실패한다.
- 결과: `private.community_policy_texts` 본문 3개(2026-09-26.1, 2026-09-28.1 이전 문구 `a775cc34…`, 운영자 새 문구 `ce460475…`),
  2026-09-28.1 해시 → `ce460475…`. `internal_account_policy()` 가 돌려주는 본문을 DB 안에서 다시 해시해 일치 확인.
  EXECUTE·SELECT 는 service_role 만(anon·authenticated 없음).
- Edge Function: `community-account` 재배포(version 3, verify_jwt=true, 새 액션 `policy`). 토큰 없는 `policy`·`status` 401 확인.
  실제 카카오 계정으로 `policy`·`consent` 는 운영자가 새 dev 빌드로 확인한다.
- 앱: PC·모바일은 동의문을 번들에 두지 않고 `policy` 로 받는다(각 dev). 이 배포 뒤부터 동의문 변경은 migration(본문 추가·정책 행) + 적용만으로 앱이 새 본문을 보인다.
- 롤백: `community-account` 이전 배포 재배포, `community_policies` 2026-09-28.1 해시를 `a775cc34…`로 되돌림(트리거 해제 → update → 재설정, 동의가 없을 때만).
  `community_policy_texts` 는 남겨 둔다(불변).

## 9. 위반법규(observation-v2)·동의 2026-09-28.2 배포 순서 (2026-09-28 — §11 에서 운영 반영)
1. **중앙 SQL**(합성 디렉터리, `compose_supabase.mjs check` 통과본, dry-run으로 목록 확인): auth `202609281000_policy_2026_09_28_2`(동의문 본문·정책 행·현재 지정)
   → map `202609281100_violation_law`(fact 열, disclosures `violation_law_public` 열과 2026-09-28.2 행, `internal_community_ingest`·`internal_analytics_v2_facts` 교체).
   map은 auth 정책 행을 외래키로 참조하므로 순서가 반대면 실패한다. 한 합성 이력에 같은 버전 둘을 둘 수 없어 map은 `…1100`이다.
   아직 운영에 없는 이전 버전(예: `202609280700`)이 dry-run 목록에 섞이면 따로 승인받는다.
   SQL만 먼저 올라가도 안전하다: 구 Edge 함수는 derived에 `violation_law`를 넣지 않아 null로 저장되고, 사실 JSON의 새 키는 구 함수가 무시한다.
2. **Edge Functions**: `community-ingest`(v1·v2 둘 다 받음), `public-analytics`·`my-analytics`(`law` 인자, `laws[]`, `scope.law`).
   이 단계 뒤부터 **구 지도 Pages는 새 응답을 strict schema로 거절**해 ‘통계를 불러오지 못했습니다’가 뜬다 — 3단계를 바로 이어서 한다.
3. **앱**: 지도 Pages(`VITE_DATA_MODE=live npm run build && npm run scan`) → PC·모바일(v2 payload·동의 2026-09-28.2). 2단계 전에 v2 앱이 올리면
   구 ingest가 13키 payload를 `schema_invalid`로 거절한다(앱은 journal에 남겨 재시도).
4. 운영자: 중앙 공유 자료 초기화 후 앱이 새로 올린다(사용자 결정, 별도 절차·승인). 초기화 전 사실은 ‘법규 미상’으로 보인다.
- 롤백: Edge 함수 이전 배포 재배포(구 지도 Pages와 함께), SQL은 새 migration으로만 — `202609281100` 헤더의 되돌리기 순서
  (함수 본문 재실행 → 2026-09-28.2 disclosures 행 삭제 → 두 열 drop). `community_policy_current`는 auth 절차로 2026-09-28.1로 되돌린다.
- 로컬 검증(2026-09-28): 합성 순서 14개를 일회용 로컬 Postgres(supabase/postgres 17.6.1.171, 네트워크 없음)에 적용 성공,
  v2 ingest insert/update·v1 null·28.1 계보 법규 null·28.2 계보 법규 공개·길이 check·권한(service_role만) 확인. 운영 적용 아님.


## 10. 숫자 별점(observation-v4)·동의 2026-09-28.3 (§11 에서 운영 반영)
로컬 합성 확인 순서: AUTH `202609281700_policy_2026_09_28_3.sql` → MAP `202609281800_rating.sql` → MAP Edge 함수·공개 API → PC·모바일 v4 캡처. 기존 .1/.2 동의는 별점 공개 플래그가 거짓이고 새 동의가 필요하다. 이전 세대 앱의 v1/v2/v3 관측은 계속 수신하며 숫자 별점이 없으면 null이다. 장애 시 current 정책을 .2로 돌리고 1600 함수 정의로 되돌린 뒤 rating disclosure/열을 제거한다. 미배포 migration이므로 실제 운영 적용·push·배포는 별도 승인 경계에 남긴다.

## 11. 운영 반영 기록 (2026-09-28, 사용자 승인) — 위반법규·답변 완료만·계정별 기여·기관코드·별점
- 사전: 사용자 지시로 운영 공유 자료 초기화(`community_report_facts`·`community_ingest_events` 1,991건씩 삭제 → 0, 계정·연결·동의·정책 유지).
- DB: 지도 main `6a14127` + auth main `4d68420` 합성 디렉터리(manifest check 22개 통과)에서 dry-run 목록이 새 10개
  (`202609280800`~`202609281800`, auth `…1000`·`…1700` 포함)뿐인 것을 확인한 뒤 사용자가 `db push --linked` 실행. 적용 후 dry-run `upToDate`.
  확인: `community_policy_current`=2026-09-28.3, disclosures 3행, `public.internal_*` 에 anon/authenticated/PUBLIC EXECUTE 0건.
- Edge Functions 5개 재배포(합성 디렉터리, `--use-api`): public-analytics v7·my-analytics v5·community-ingest v3·community-account v4(verify_jwt=true),
  community-auth-relay v3(false). 새 secret 없음.
- smoke(익명): 다섯 경로 토큰 없음 401(참여자 전용), safemap preflight 204. Pages `community-map-pages` 수동 실행 성공, `https://safemap.worklazy.net/` 200,
  배포 번들에 위반법규 표·별점 UI 포함. auth 사이트는 화면 변경이 없어 재배포하지 않음.
- 앱: PC·모바일 dev(observation-v4, 필수 동의 2026-09-28.3). 기존 동의(2026-09-28.1)는 outdated → 앱에서 재동의 필요. 실제 카카오 계정 업로드·지도 확인은 운영자 몫.
- 롤백: §9·§10 의 순서(함수 이전 배포 재배포와 구 Pages 함께, SQL 은 새 migration 으로만, current 정책은 auth 절차로 되돌림).

## 12. 지도 열람 10건 기준 배포 순서 (2026-09-28 — §13 에서 운영 반영)

1. **새 `public-analytics` Edge Function과 지도 Pages를 함께 배포한다.** 새 Edge는 모든 통계 경로에서
   `public_fact_count >= 10`을 검사한다. 이 시점의 구 SQL(`202609280700`)은 그 키를 돌려주지 않으므로
   새 Edge는 `upload_required`와 `{required: 10, current: null}`로 거부한다(fail closed). 일시적인 열람 중단은
   있지만 1~9건 계정이 구 Edge를 통해 통계를 읽는 정책 공백은 없다. 구 Pages는 새 Edge의 `details`가 붙은
   오류 응답을 strict 스키마로 거절할 수 있으므로 두 배포를 같은 단계에서 진행한다.
2. **그다음 중앙 SQL `202609281900_viewer_threshold.sql`을 적용한다.** 합성 이력의 manifest check와
   dry-run을 확인한 뒤 진행한다. 이 SQL이 사용자별 공개 `report_identity` 고유 수를 `public_fact_count`로
   반환하면 새 Edge에서 9건은 403(`upload_required`, `required=10`, `current=9`), 10건은 200이 된다.
3. 실제 카카오 시험 계정으로 거부 화면의 `지금 9건 / 10건` 안내와 10건 지도 진입을 확인한다.
   `my-analytics`·`community-ingest`·PC·모바일 앱은 이 변경으로 재배포하지 않는다.

되돌릴 때도 접근 기준이 낮은 구 Edge만 먼저 올리지 않는다. 새 Edge를 유지한 채 SQL을 새 migration으로
되돌리면 건수 키가 사라져 모든 지도 조회가 거부된다. 지도 Pages와 Edge의 버전 호환을 함께 확인하고,
10건 정책을 유지할 수 있는 구성으로 복구한다. 이 절은 절차 기록이며 운영 적용 기록이 아니다.

## 13. 운영 반영 기록 (2026-09-28, 사용자 승인) — 지도 열람 공개 신고 10건 이상
- 순서(§12): 사용자가 Edge `public-analytics`(v8)·`my-analytics`(v6)를 합성 디렉터리(지도 main `7bb1419` + auth main)에서 재배포 → `community-map-pages` 수동 실행(성공) → `db push --linked`로 `202609281900_viewer_threshold` 1개 적용.
- 확인: dry-run `upToDate`, `internal_analytics_viewer` 존재·anon/authenticated/PUBLIC EXECUTE 0건, 익명 `public-analytics/meta` 401, `https://safemap.worklazy.net/` 200, 배포 번들에 10건 안내·건수 미상 문구 포함(‘한 건 이상’ 문구 없음).
- 로컬 검증: 별도 스택(`rsc0928-int`)에 migration 23개 적용, `community-stack` 33/33(9건 403 `required:10,current:9`, 10건 200, 두 dataset 같은 신고 1건). `my-analytics-stack` 6/7 — 무토큰 401 의 `auth_required` 코드 누락은 main 과 같은 기존 결함.
- 롤백: Edge 두 함수 이전 배포 재배포와 구 Pages 를 함께, SQL 은 새 migration 으로 `internal_analytics_viewer` 를 이전 본문으로 재정의.

## 14. registry 2026-09-29.2(현행 기관 표시명 '경찰청 ' 제거) 배포 순서 (2026-09-29 — 운영 반영 전)

사용자 결정(ADR-203): 기관코드로 찾은 현행 기관 표시명은 공식 '전체기관명'에서 맨 앞의
'경찰청 ' 접두어만 한 번 뗀다. registry는 표시명과 공식 전체기관명을 별도 조회값으로
보존하고 세 resolver가 두 이름을 같은 코드 후보로 찾는다. 원문 컬럼은 그대로이며,
스냅샷 `2026-09-29.2`를 담은 Edge 번들과 singleton 버전 상향이 함께 가야 한다.

1. **Edge Functions 재배포를 먼저 한다**(`community-ingest` 등 새 스냅샷 번들 포함).
   새 Edge는 `2026-09-29.2` 기준으로 파생값을 계산한다. 이 시점의 DB singleton은
   아직 `2026-09-29.1`이므로 재계산 스크립트는 버전 불일치로 중단된다(fail closed).
   구 Edge가 먼저 내려가면 새 표시 규칙이 적용되지 않은 파생값이 계속 쌓이므로,
   Edge 재배포 전에 중앙 SQL을 적용하지 않는다.
2. **그다음 중앙 SQL `202609290200_agency_registry_display_2026_09_29_2.sql`을 적용한다.**
   합성 이력의 manifest check(`compose_supabase.mjs check`, 25개)와 dry-run을 확인한 뒤
   진행한다. 이 migration은 singleton 버전만 `2026-09-29.2`로 올린다(facts 값 변경 없음).
3. **저장된 사실의 파생값을 재계산한다.** `scripts/recompute-agency-keys.mjs --dry-run`
   (변경 대상·건수 확인) → `--apply`. 코드 있는 행은 새 표시명으로 갱신되고, 코드 없는 행은
   REVIEW4 보존 규칙(저장된 `inst:` 유지, `a1:` + 유일 별칭 적중만 승급)을 따른다.
   코드 없이 공식 전체기관명(접두어 포함) 또는 표시명으로 저장된 행도 유일한
   별칭에 적중하면 같은 `inst:` 키와 접두어를 뗀 표시명으로 승급한다.
4. 지도 Pages·`public-analytics`는 DB의 재계산된 이름·집계 키를 읽으므로
   이 수정만을 위한 재배포 없이도 동작한다.
   PC·모바일 앱은 같은 스냅샷(`2026-09-29.2`, 바이트 동일)을 담은 뒤 배포한다.
   순서가 어긋난 동안에는 앱과 중앙의 표기가 일시적으로 다를 수 있다.
   세 소비자가 이 스냅샷을 쓰고 재계산을 마치면 코드 있는 행과 위 두 이름으로
   유일하게 찾은 코드 없는 행은 같은 `inst:` 키로 집계된다. 동명이 기관이거나
   다른 이유로 유일 후보가 없으면 기존대로 `src:`/`a1:` 키를 유지하므로
   그 행까지 합쳐진다고 보장하지 않는다.

- 롤백: Edge 이전 배포 재배포와 구 Pages를 함께, SQL은 새 migration으로 singleton 버전을
  `2026-09-29.1`로 되돌린 뒤 재계산 스크립트로 파생값을 되돌린다. 이 절은 절차 기록이며
  운영 적용 기록이 아니다.
