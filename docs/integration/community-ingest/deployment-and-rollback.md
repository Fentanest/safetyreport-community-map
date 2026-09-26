# 배포·롤백 (운영 반영은 이번 작업에서 하지 않음 — 승인 경계)

## 1. rollout 순서
1. 운영자: `scripts/integration/preflight_counts.sql`(읽기 전용) 실행 → §2 결정표.
2. 중앙 SQL: manifest 순서로 auth `202609260100` → map `202609260200`(합성 이력, `compose_supabase.mjs check` 통과본만). `db push`·repair·reset 금지.
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
