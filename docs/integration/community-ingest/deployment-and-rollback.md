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
