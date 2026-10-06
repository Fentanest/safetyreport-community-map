# Supabase 전체 쿼리 목록 · 2026-10-06

기준 map `5cf45c6`, auth `151adfd`. 운영 프로젝트에 접속하지 않았다. 공유 manifest의 미적용 AUTH `202610050100`과 MAP `202610060100`을 **로컬 트랜잭션에서만** 적용한 카탈로그를 기준으로 한다. 이전 정의를 중복 계수하지 않으며 drop된 `internal_my_reports`는 현재 목록에서 제외한다.

호출 빈도는 코드에서 추정한 발생 시점이며 운영 트래픽 수치가 아니다. 신규 감사 migration은 이 표의 **수정 전 기준** 다음에 적용한다. 원문·signature·권한·내부 의존성은 [catalog-before.json](evidence/catalog-before.json)에 있다.

## RPC·함수 74개

| 객체 | 최신 정의 (소유 repo:파일:줄) | 직접 호출부 / 내부 호출자 | 빈도·용도 |
|---|---|---|---|
| `private.analytics_in_polygon` | `map:supabase/migrations/202610040300_analytics_rollups.sql:316` | `private.analytics_region` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.analytics_in_ring` | `map:supabase/migrations/202610040300_analytics_rollups.sql:301` | `private.analytics_in_polygon` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.analytics_law` | `map:supabase/migrations/202610040300_analytics_rollups.sql:354` | `private.analytics_rollup_source` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.analytics_region` | `map:supabase/migrations/202610040300_analytics_rollups.sql:325` | `private.analytics_rollup_source` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.analytics_rollup_source` | `map:supabase/migrations/202610040600_rollup_scope_plan.sql:7` | `public.internal_analytics_rollup` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.community_bump_manifest` | `map:supabase/migrations/202609260200_community_ingest.sql:141` | `private.community_facts_manifest_trigger` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.community_bump_projection` | `auth:supabase/migrations/202609260100_community_account_registry.sql:162` | `private.community_facts_projection_trigger`<br>`public.internal_community_delete_contributions` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.community_current_policy` | `auth:supabase/migrations/202609260100_community_account_registry.sql:115` | `public.internal_account_grant_consent`<br>`public.internal_account_policy`<br>`public.internal_account_rebind_connection`<br>`public.internal_account_register_connection`<br>`public.internal_account_revoke_connection`<br>`public.internal_account_revoke_consent`<br>`public.internal_account_status`<br>`public.internal_community_delete_contributions`<br>`public.internal_community_ingest` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.community_fact_publicly_listed` | `map:supabase/migrations/202609260200_community_ingest.sql:175` | `public.internal_analytics_viewer`<br>`public.internal_community_ingest`<br>`public.internal_my_analytics_cohort_source`<br>`public.internal_my_analytics_source` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.community_facts_manifest_trigger` | `map:supabase/migrations/202609260200_community_ingest.sql:93` | `private.community_report_facts trigger community_report_facts_manifest` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.community_facts_projection_trigger` | `map:supabase/migrations/202609260200_community_ingest.sql:162` | `private.community_report_facts trigger community_report_facts_projection` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.community_grant_is_current` | `auth:supabase/migrations/202609260100_community_account_registry.sql:155` | `public.internal_account_grant_consent`<br>`public.internal_account_status`<br>`public.internal_community_ingest` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.community_identity_state` | `auth:supabase/migrations/202609260100_community_account_registry.sql:102` | `private.my_reports_gate`<br>`public.internal_account_grant_consent`<br>`public.internal_account_rebind_connection`<br>`public.internal_account_register_connection`<br>`public.internal_account_status`<br>`public.internal_analytics_viewer`<br>`public.internal_community_delete_contributions`<br>`public.internal_community_ingest`<br>`public.internal_community_manifest`<br>`public.internal_my_analytics_cohort_source`<br>`public.internal_my_analytics_source` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.community_lineage_active` | `auth:supabase/migrations/202609260100_community_account_registry.sql:146` | `private.community_fact_publicly_listed`<br>`private.my_reports_own`<br>`private.ranking_representatives`<br>`public.internal_account_revoke_consent`<br>`public.internal_analytics_v2_facts`<br>`public.internal_analytics_v2_state`<br>`public.internal_analytics_viewer`<br>`public.internal_community_ingest` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.community_lock_contributor` | `auth:supabase/migrations/202609260100_community_account_registry.sql:130` | `public.internal_account_grant_consent`<br>`public.internal_account_rebind_connection`<br>`public.internal_account_register_connection`<br>`public.internal_account_revoke_connection`<br>`public.internal_account_revoke_consent`<br>`public.internal_community_delete_contributions` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.community_policies_immutable` | `auth:supabase/migrations/202609260100_community_account_registry.sql:27` | `private.community_policies trigger community_policies_no_update` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.community_policy_texts_immutable` | `auth:supabase/migrations/202609280600_policy_consent_text.sql:21` | `private.community_policy_texts trigger community_policy_texts_no_update` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.community_stamp_registry_version` | `map:supabase/migrations/202609290100_agency_registry_recompute.sql:37` | `private.community_report_facts trigger community_report_facts_registry_version` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.invalidate_analytics_v2` | `map:supabase/migrations/202609260200_community_ingest.sql:461` | `private.contributor_profiles trigger invalidate_analytics_v2_contributor`<br>`private.upload_snapshots trigger invalidate_analytics_v2_snapshot` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.my_reports_address_base` | `map:supabase/migrations/202610020100_my_reports.sql:41` | `private.my_reports_matches` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.my_reports_check_query` | `map:supabase/migrations/202610020100_my_reports.sql:227` | `public.internal_my_reports_numbers`<br>`public.internal_my_reports_search` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.my_reports_gate` | `map:supabase/migrations/202610020100_my_reports.sql:191` | `public.internal_my_reports_numbers`<br>`public.internal_my_reports_search`<br>`public.internal_my_reports_summary` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.my_reports_managers` | `map:supabase/migrations/202610020100_my_reports.sql:256` | `public.internal_my_reports_search` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.my_reports_matches` | `map:supabase/migrations/202610020100_my_reports.sql:217` | `public.internal_my_reports_numbers`<br>`public.internal_my_reports_search` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.my_reports_norm_address` | `map:supabase/migrations/202610020100_my_reports.sql:34` | `private.my_reports_address_base`<br>`private.my_reports_check_query` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.my_reports_norm_vehicle` | `map:supabase/migrations/202610020100_my_reports.sql:28` | `private.my_reports_check_query`<br>`private.my_reports_matches` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.my_reports_own` | `map:supabase/migrations/202610020100_my_reports.sql:72` | `public.internal_my_reports_numbers`<br>`public.internal_my_reports_search`<br>`public.internal_my_reports_summary` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.my_reports_page` | `map:supabase/migrations/202610020100_my_reports.sql:246` | `public.internal_my_reports_search`<br>`public.internal_my_reports_summary` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.my_reports_row_json` | `map:supabase/migrations/202610020100_my_reports.sql:167` | `private.my_reports_page` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.my_reports_stats` | `map:supabase/migrations/202610020100_my_reports.sql:128` | `private.my_reports_managers`<br>`public.internal_my_reports_search`<br>`public.internal_my_reports_summary` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.my_reports_version` | `map:supabase/migrations/202610020100_my_reports.sql:182` | `public.internal_my_reports_numbers`<br>`public.internal_my_reports_search`<br>`public.internal_my_reports_summary` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.ranking_representatives` | `map:supabase/migrations/202610040700_ranking_binary_sort.sql:7` | `public.internal_user_rankings` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.safeauth_expire_if_needed` | `auth:supabase/migrations/202609251200_community_auth_relay.sql:89` | `public.internal_safeauth_browser_status`<br>`public.internal_safeauth_cancel`<br>`public.internal_safeauth_claim`<br>`public.internal_safeauth_complete`<br>`public.internal_safeauth_poll`<br>`public.internal_safeauth_prepare`<br>`public.internal_safeauth_publish`<br>`public.internal_safeauth_rotate_ticket` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `private.touch_updated_at` | `map:supabase/migrations/202608150001_initial_schema.sql:200` | `private.contributor_profiles trigger contributor_profiles_touch_updated_at` | 아래 상위 함수 또는 트리거가 호출할 때 |
| `public.internal_account_grant_consent` | `auth:supabase/migrations/202609260100_community_account_registry.sql:225` | `auth:server/account.ts:176` | 로그인·화면 진입·공유 동의·기기 연결/해제 요청 |
| `public.internal_account_policy` | `auth:supabase/migrations/202609280600_policy_consent_text.sql:216` | `auth:server/account.ts:163` | 로그인·화면 진입·공유 동의·기기 연결/해제 요청 |
| `public.internal_account_rebind_connection` | `auth:supabase/migrations/202609260100_community_account_registry.sql:337` | `auth:server/account.ts:199` | 로그인·화면 진입·공유 동의·기기 연결/해제 요청 |
| `public.internal_account_register_connection` | `auth:supabase/migrations/202609260100_community_account_registry.sql:303` | `auth:server/account.ts:191` | 로그인·화면 진입·공유 동의·기기 연결/해제 요청 |
| `public.internal_account_revoke_connection` | `auth:supabase/migrations/202609260100_community_account_registry.sql:362` | `auth:server/account.ts:204` | 로그인·화면 진입·공유 동의·기기 연결/해제 요청 |
| `public.internal_account_revoke_consent` | `auth:supabase/migrations/202609260100_community_account_registry.sql:275` | `auth:server/account.ts:183` | 로그인·화면 진입·공유 동의·기기 연결/해제 요청 |
| `public.internal_account_status` | `auth:supabase/migrations/202609260100_community_account_registry.sql:170` | `auth:server/account.ts:155` | 로그인·화면 진입·공유 동의·기기 연결/해제 요청 |
| `public.internal_activate_snapshot` | `map:supabase/migrations/202608150001_initial_schema.sql:215` | `현재 제품 직접 호출 없음` | 현재 Edge 호출 없음; 남아 있는 서비스 RPC/레거시·정리 |
| `public.internal_agency_recompute_apply` | `map:supabase/migrations/202609290300_agency_recompute_rpc.sql:58` | `map:scripts/recompute-agency-keys.mjs:155` | 운영자 기관 키 재계산 배치 |
| `public.internal_agency_recompute_page` | `map:supabase/migrations/202609290300_agency_recompute_rpc.sql:13` | `map:scripts/recompute-agency-keys.mjs:118` | 운영자 기관 키 재계산 배치 |
| `public.internal_agency_recompute_state` | `map:supabase/migrations/202609290300_agency_recompute_rpc.sql:6` | `map:scripts/recompute-agency-keys.mjs:105` | 운영자 기관 키 재계산 배치 |
| `public.internal_analytics_cohort_facts` | `map:supabase/migrations/202610060100_cohort_facts_setwise.sql:10` | `map:supabase/functions/public-analytics/index.ts:40`<br>`public.internal_my_analytics_cohort_source` | 지도/메타/통계/열람 gate 요청마다; 상세는 호출 경로 참조 |
| `public.internal_analytics_cohort_state` | `map:supabase/migrations/202610040500_cohort_state_setwise.sql:5` | `map:server/aggregate.ts:470`<br>`map:server/publicHandler.ts:26`<br>`map:supabase/functions/public-analytics/index.ts:34`<br>`map:src/data/demoEngine.ts:220`<br>`public.internal_my_analytics_cohort_source` | 지도/메타/통계/열람 gate 요청마다; 상세는 호출 경로 참조 |
| `public.internal_analytics_rollup` | `map:supabase/migrations/202610040300_analytics_rollups.sql:423` | `map:supabase/functions/public-analytics/index.ts:53` | 지도/메타/통계/열람 gate 요청마다; 상세는 호출 경로 참조 |
| `public.internal_analytics_v2_facts` | `map:supabase/migrations/202609300100_long_range_bounds.sql:22` | `map:server/compare.ts:106`<br>`map:server/aggregate.ts:143`<br>`public.internal_my_analytics_source` | 현재 Edge 호출 없음; 남아 있는 서비스 RPC/레거시·정리 |
| `public.internal_analytics_v2_rate_limit` | `map:supabase/migrations/202609240001_analytics_v2.sql:137` | `map:supabase/functions/user-rankings/index.ts:39`<br>`map:supabase/functions/public-analytics/index.ts:57` | 지도/메타/통계/열람 gate 요청마다; 상세는 호출 경로 참조 |
| `public.internal_analytics_v2_state` | `map:supabase/migrations/202609300100_long_range_bounds.sql:153` | `public.internal_analytics_cohort_state`<br>`public.internal_my_analytics_source` | 지도/메타/통계/열람 gate 요청마다; 상세는 호출 경로 참조 |
| `public.internal_analytics_viewer` | `map:supabase/migrations/202610040800_viewer_lookup_plan.sql:9` | `map:server/viewerAuth.ts:36`<br>`map:server/publicHandler.ts:45`<br>`map:supabase/functions/public-analytics/index.ts:74`<br>`public.internal_user_rankings` | 지도/메타/통계/열람 gate 요청마다; 상세는 호출 경로 참조 |
| `public.internal_cleanup_expired` | `map:supabase/migrations/202608150001_initial_schema.sql:297` | `현재 제품 직접 호출 없음` | 현재 Edge 호출 없음; 남아 있는 서비스 RPC/레거시·정리 |
| `public.internal_community_delete_contributions` | `map:supabase/migrations/202609260200_community_ingest.sql:420` | `auth:server/account.ts:209` | 실시간·수동·자정 업로드/manifest; 삭제는 사용자 요청 |
| `public.internal_community_ingest` | `map:supabase/migrations/202609281800_rating.sql:14` | `map:server/ingest/handler.ts:250` | 실시간·수동·자정 업로드/manifest; 삭제는 사용자 요청 |
| `public.internal_community_ingest_rate_limit` | `map:supabase/migrations/202609260200_community_ingest.sql:534` | `map:server/personalHandler.ts:107`<br>`map:server/ingest/handler.ts:180`<br>`map:server/ingest/handler.ts:204`<br>`map:server/myReports/handler.ts:263` | 실시간·수동·자정 업로드/manifest; 삭제는 사용자 요청 |
| `public.internal_community_manifest` | `map:supabase/migrations/202609260200_community_ingest.sql:383` | `map:server/ingest/handler.ts:186` | 실시간·수동·자정 업로드/manifest; 삭제는 사용자 요청 |
| `public.internal_my_analytics_cohort_source` | `map:supabase/migrations/202610010100_single_date_cohort.sql:199` | `map:server/personalHandler.ts:115` | 개인 비교·내 맞춤 통계 요청 |
| `public.internal_my_analytics_source` | `map:supabase/migrations/202609270100_my_analytics.sql:12` | `현재 제품 직접 호출 없음` | 현재 Edge 호출 없음; 남아 있는 서비스 RPC/레거시·정리 |
| `public.internal_my_reports_numbers` | `map:supabase/migrations/202610020100_my_reports.sql:371` | `map:server/myReports/handler.ts:343` | 확장 프로그램의 내 신고 요약·검색·번호 페이지 요청 |
| `public.internal_my_reports_search` | `map:supabase/migrations/202610020100_my_reports.sql:291` | `map:server/myReports/handler.ts:294` | 확장 프로그램의 내 신고 요약·검색·번호 페이지 요청 |
| `public.internal_my_reports_summary` | `map:supabase/migrations/202610020100_my_reports.sql:334` | `map:server/myReports/handler.ts:328` | 확장 프로그램의 내 신고 요약·검색·번호 페이지 요청 |
| `public.internal_safeauth_browser_status` | `auth:supabase/migrations/202610050100_relay_hardening.sql:101` | `auth:server/relay.ts:320` | 연결 대기 중 반복 poll |
| `public.internal_safeauth_cancel` | `auth:supabase/migrations/202609251200_community_auth_relay.sql:511` | `auth:server/relay.ts:362` | 기기 연결 단계별 요청 |
| `public.internal_safeauth_claim` | `auth:supabase/migrations/202609251200_community_auth_relay.sql:226` | `auth:server/relay.ts:224` | 기기 연결 단계별 요청 |
| `public.internal_safeauth_cleanup` | `auth:supabase/migrations/202610050100_relay_hardening.sql:130` | `auth:server/relay.ts:175` | 생성 요청의 5% 비동기 청소 / 선택적 시간당 cron(설정 미확인) |
| `public.internal_safeauth_complete` | `auth:supabase/migrations/202609251200_community_auth_relay.sql:463` | `auth:server/relay.ts:346` | 기기 연결 단계별 요청 |
| `public.internal_safeauth_create` | `auth:supabase/migrations/202610050100_relay_hardening.sql:13` | `auth:server/relay.ts:181` | 기기 연결 단계별 요청 |
| `public.internal_safeauth_poll` | `auth:supabase/migrations/202609251200_community_auth_relay.sql:380` | `auth:server/relay.ts:286` | 연결 대기 중 반복 poll |
| `public.internal_safeauth_prepare` | `auth:supabase/migrations/202609251200_community_auth_relay.sql:268` | `auth:server/relay.ts:242` | 기기 연결 단계별 요청 |
| `public.internal_safeauth_publish` | `auth:supabase/migrations/202609251200_community_auth_relay.sql:308` | `auth:server/relay.ts:268` | 기기 연결 단계별 요청 |
| `public.internal_safeauth_rate_limit` | `auth:supabase/migrations/202609251200_community_auth_relay.sql:553` | `auth:server/account.ts:141`<br>`auth:server/relay.ts:145` | relay/account 액션별 제한 검사 |
| `public.internal_safeauth_rotate_ticket` | `auth:supabase/migrations/202609251200_community_auth_relay.sql:193` | `auth:server/relay.ts:200` | 기기 연결 단계별 요청 |
| `public.internal_user_rankings` | `map:supabase/migrations/202610040200_ranking_grouped_diagnostics.sql:5` | `map:supabase/functions/user-rankings/index.ts:46` | 랭킹 화면·조건·페이지 변경 |

## 테이블·뷰·RLS

현재 제품 view/materialized view는 **0개**다. 이름이 `public_map_points`여도 실제로는 테이블이다. `public.it_realtime_control`과 그 `rt_read` 정책은 기존 로컬 테스트 잔여 객체로 제품 migration 소유가 아니다. 나머지 28개는 제품 테이블이다. 제품 RLS 정책은 0개: RLS 활성 테이블은 기본 거부이며 RPC의 SECURITY DEFINER/service_role 경계로 접근한다. 지역/registry 정적 참조 테이블은 RLS 대신 private schema/ACL로 제한한다. 따라서 행마다 `auth.uid()`를 실행하는 제품 정책은 없다.

| 테이블 | 현재 생성 정의 | RLS / 강제 RLS | 정책 | 접근 비용 측정 |
|---|---|---|---|---|
| `private.abuse_events` | `map:supabase/migrations/202608150001_initial_schema.sql:116` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.analytics_region_geometry` | `map:supabase/migrations/202610040300_analytics_rollups.sql:8` | False / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.analytics_region_names` | `map:supabase/migrations/202610040300_analytics_rollups.sql:6` | False / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.analytics_region_splits` | `map:supabase/migrations/202610040300_analytics_rollups.sql:7` | False / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.analytics_region_tokens` | `map:supabase/migrations/202610040300_analytics_rollups.sql:5` | False / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.analytics_state` | `map:supabase/migrations/202609240001_analytics_v2.sql:35` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.community_auth_rate_limits` | `auth:supabase/migrations/202609251200_community_auth_relay.sql:23` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.community_auth_requests` | `auth:supabase/migrations/202609251200_community_auth_relay.sql:34` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.community_connections` | `auth:supabase/migrations/202609260100_community_account_registry.sql:63` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.community_consent_grants` | `auth:supabase/migrations/202609260100_community_account_registry.sql:43` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.community_deletion_fences` | `map:supabase/migrations/202609260200_community_ingest.sql:126` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.community_fact_tombstones` | `map:supabase/migrations/202609260200_community_ingest.sql:115` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.community_ingest_events` | `map:supabase/migrations/202609260200_community_ingest.sql:22` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.community_manifest_generations` | `map:supabase/migrations/202609260200_community_ingest.sql:134` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.community_owner_transfer_audit` | `map:supabase/migrations/202609280800_report_owner_transfer.sql:12` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.community_policies` | `auth:supabase/migrations/202609260100_community_account_registry.sql:16` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.community_policy_current` | `auth:supabase/migrations/202609260100_community_account_registry.sql:21` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.community_policy_disclosures` | `map:supabase/migrations/202609280100_amount_duration_region.sql:12` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.community_policy_texts` | `auth:supabase/migrations/202609280600_policy_consent_text.sql:13` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.community_registry_state` | `map:supabase/migrations/202609290100_agency_registry_recompute.sql:26` | False / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.community_report_facts` | `map:supabase/migrations/202609260200_community_ingest.sql:48` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.contributor_profiles` | `map:supabase/migrations/202608150001_initial_schema.sql:15` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.rate_limits` | `map:supabase/migrations/202608150001_initial_schema.sql:131` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.report_facts_v2` | `map:supabase/migrations/202609240001_analytics_v2.sql:6` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.upload_chunks` | `map:supabase/migrations/202608150001_initial_schema.sql:107` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.upload_points` | `map:supabase/migrations/202608150001_initial_schema.sql:67` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `private.upload_snapshots` | `map:supabase/migrations/202608150001_initial_schema.sql:28` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `public.it_realtime_control` | `local test object / no product migration` | True / False | rt_read: true | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |
| `public.public_map_points` | `map:supabase/migrations/202608150001_initial_schema.sql:151` | True / False |  | anon/authenticated 실제 ACL 거부 + service_role 실행; 기본 거부 RLS는 별도 격리 진단 |

## 트리거 8개

| 테이블 / 트리거 | 현재 정의 | 실행 함수 | 호출 시점 |
|---|---|---|---|
| `private.community_policies` / `community_policies_no_update` | `auth:supabase/migrations/202609260100_community_account_registry.sql:33` | `private.community_policies_immutable()` | `CREATE TRIGGER community_policies_no_update BEFORE DELETE OR UPDATE ON private.community_policies FOR EACH ROW EXECUTE FUNCTION private.community_policies_immutable()` |
| `private.community_policy_texts` / `community_policy_texts_no_update` | `auth:supabase/migrations/202609280600_policy_consent_text.sql:27` | `private.community_policy_texts_immutable()` | `CREATE TRIGGER community_policy_texts_no_update BEFORE DELETE OR UPDATE ON private.community_policy_texts FOR EACH ROW EXECUTE FUNCTION private.community_policy_texts_immutable()` |
| `private.community_report_facts` / `community_report_facts_manifest` | `map:supabase/migrations/202609260200_community_ingest.sql:157` | `private.community_facts_manifest_trigger()` | `CREATE TRIGGER community_report_facts_manifest AFTER INSERT OR DELETE OR UPDATE ON private.community_report_facts FOR EACH ROW EXECUTE FUNCTION private.community_facts_manifest_trigger()` |
| `private.community_report_facts` / `community_report_facts_projection` | `map:supabase/migrations/202609260200_community_ingest.sql:170` | `private.community_facts_projection_trigger()` | `CREATE TRIGGER community_report_facts_projection AFTER INSERT OR DELETE OR UPDATE ON private.community_report_facts FOR EACH STATEMENT EXECUTE FUNCTION private.community_facts_projection_trigger()` |
| `private.community_report_facts` / `community_report_facts_registry_version` | `map:supabase/migrations/202609290100_agency_registry_recompute.sql:46` | `private.community_stamp_registry_version()` | `CREATE TRIGGER community_report_facts_registry_version BEFORE INSERT OR UPDATE OF agency_key, agency_current_name, manager_key ON private.community_report_facts FOR EACH ROW EXECUTE FUNCTION private.community_stamp_registry_version()` |
| `private.contributor_profiles` / `contributor_profiles_touch_updated_at` | `map:supabase/migrations/202608150001_initial_schema.sql:211` | `private.touch_updated_at()` | `CREATE TRIGGER contributor_profiles_touch_updated_at BEFORE UPDATE ON private.contributor_profiles FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at()` |
| `private.contributor_profiles` / `invalidate_analytics_v2_contributor` | `map:supabase/migrations/202609240001_analytics_v2.sql:66` | `private.invalidate_analytics_v2()` | `CREATE TRIGGER invalidate_analytics_v2_contributor AFTER UPDATE OF revoked_at, status ON private.contributor_profiles FOR EACH ROW WHEN (((old.revoked_at IS DISTINCT FROM new.revoked_at) OR (old.status IS DISTINCT FROM new.status))) EXECUTE FUNCTION private.invalidate_analytics_v2()` |
| `private.upload_snapshots` / `invalidate_analytics_v2_snapshot` | `map:supabase/migrations/202609240001_analytics_v2.sql:71` | `private.invalidate_analytics_v2()` | `CREATE TRIGGER invalidate_analytics_v2_snapshot AFTER UPDATE OF state ON private.upload_snapshots FOR EACH ROW WHEN ((old.state IS DISTINCT FROM new.state)) EXECUTE FUNCTION private.invalidate_analytics_v2()` |

## 인덱스 60개

인덱스는 그 테이블의 SELECT/DML 실행계획과 쓰기 비용에서 측정한다. 인덱스를 독립 쿼리처럼 측정했다고 표시하지 않는다. PK/UNIQUE가 제공하는 인덱스도 포함한다.

| 테이블 | 인덱스 | 현재 생성 정의 | SQL |
|---|---|---|---|
| `private.abuse_events` | `abuse_events_created_idx` | `map:supabase/migrations/202608150001_initial_schema.sql:126` | `CREATE INDEX abuse_events_created_idx ON private.abuse_events USING btree (created_at)` |
| `private.abuse_events` | `abuse_events_pkey` | `map:supabase/migrations/202608150001_initial_schema.sql:116 (table constraint)` | `CREATE UNIQUE INDEX abuse_events_pkey ON private.abuse_events USING btree (id)` |
| `private.analytics_region_geometry` | `analytics_region_geometry_pkey` | `map:supabase/migrations/202610040300_analytics_rollups.sql:8 (table constraint)` | `CREATE UNIQUE INDEX analytics_region_geometry_pkey ON private.analytics_region_geometry USING btree (code)` |
| `private.analytics_region_names` | `analytics_region_names_pkey` | `map:supabase/migrations/202610040300_analytics_rollups.sql:6 (table constraint)` | `CREATE UNIQUE INDEX analytics_region_names_pkey ON private.analytics_region_names USING btree (key)` |
| `private.analytics_region_splits` | `analytics_region_splits_pkey` | `map:supabase/migrations/202610040300_analytics_rollups.sql:7 (table constraint)` | `CREATE UNIQUE INDEX analytics_region_splits_pkey ON private.analytics_region_splits USING btree (key)` |
| `private.analytics_region_tokens` | `analytics_region_tokens_pkey` | `map:supabase/migrations/202610040300_analytics_rollups.sql:5 (table constraint)` | `CREATE UNIQUE INDEX analytics_region_tokens_pkey ON private.analytics_region_tokens USING btree (token)` |
| `private.analytics_state` | `analytics_state_pkey` | `map:supabase/migrations/202609240001_analytics_v2.sql:35 (table constraint)` | `CREATE UNIQUE INDEX analytics_state_pkey ON private.analytics_state USING btree (singleton)` |
| `private.community_auth_rate_limits` | `community_auth_rate_limits_pkey` | `auth:supabase/migrations/202609251200_community_auth_relay.sql:23 (table constraint)` | `CREATE UNIQUE INDEX community_auth_rate_limits_pkey ON private.community_auth_rate_limits USING btree (bucket, window_start)` |
| `private.community_auth_rate_limits` | `community_auth_rate_limits_window_idx` | `auth:supabase/migrations/202609251200_community_auth_relay.sql:29` | `CREATE INDEX community_auth_rate_limits_window_idx ON private.community_auth_rate_limits USING btree (window_start)` |
| `private.community_auth_requests` | `community_auth_requests_create_idem_hash_key` | `auth:supabase/migrations/202609251200_community_auth_relay.sql:34 (table constraint)` | `CREATE UNIQUE INDEX community_auth_requests_create_idem_hash_key ON private.community_auth_requests USING btree (create_idem_hash)` |
| `private.community_auth_requests` | `community_auth_requests_expires_idx` | `auth:supabase/migrations/202609251200_community_auth_relay.sql:78` | `CREATE INDEX community_auth_requests_expires_idx ON private.community_auth_requests USING btree (expires_at)` |
| `private.community_auth_requests` | `community_auth_requests_install_active_idx` | `auth:supabase/migrations/202609251200_community_auth_relay.sql:79` | `CREATE INDEX community_auth_requests_install_active_idx ON private.community_auth_requests USING btree (install_hash) WHERE (status = ANY (ARRAY['created'::text, 'claimed'::text, 'oauth_started'::text, 'code_ready'::text, 'code_delivered'::text]))` |
| `private.community_auth_requests` | `community_auth_requests_pkey` | `auth:supabase/migrations/202609251200_community_auth_relay.sql:34 (table constraint)` | `CREATE UNIQUE INDEX community_auth_requests_pkey ON private.community_auth_requests USING btree (id)` |
| `private.community_connections` | `community_connections_epoch` | `auth:supabase/migrations/202609260100_community_account_registry.sql:85` | `CREATE UNIQUE INDEX community_connections_epoch ON private.community_connections USING btree (writer_epoch)` |
| `private.community_connections` | `community_connections_one_active_writer` | `auth:supabase/migrations/202609260100_community_account_registry.sql:83` | `CREATE UNIQUE INDEX community_connections_one_active_writer ON private.community_connections USING btree (user_id, dataset_key) WHERE (status = 'active'::text)` |
| `private.community_connections` | `community_connections_pkey` | `auth:supabase/migrations/202609260100_community_account_registry.sql:63 (table constraint)` | `CREATE UNIQUE INDEX community_connections_pkey ON private.community_connections USING btree (connection_id)` |
| `private.community_connections` | `community_connections_user` | `auth:supabase/migrations/202609260100_community_account_registry.sql:86` | `CREATE INDEX community_connections_user ON private.community_connections USING btree (user_id)` |
| `private.community_consent_grants` | `community_consent_grants_lineage` | `auth:supabase/migrations/202609260100_community_account_registry.sql:59` | `CREATE INDEX community_consent_grants_lineage ON private.community_consent_grants USING btree (lineage_id) WHERE (revoked_at IS NULL)` |
| `private.community_consent_grants` | `community_consent_grants_one_active` | `auth:supabase/migrations/202609260100_community_account_registry.sql:57` | `CREATE UNIQUE INDEX community_consent_grants_one_active ON private.community_consent_grants USING btree (user_id) WHERE (revoked_at IS NULL)` |
| `private.community_consent_grants` | `community_consent_grants_pkey` | `auth:supabase/migrations/202609260100_community_account_registry.sql:43 (table constraint)` | `CREATE UNIQUE INDEX community_consent_grants_pkey ON private.community_consent_grants USING btree (grant_id)` |
| `private.community_deletion_fences` | `community_deletion_fences_pkey` | `map:supabase/migrations/202609260200_community_ingest.sql:126 (table constraint)` | `CREATE UNIQUE INDEX community_deletion_fences_pkey ON private.community_deletion_fences USING btree (contributor_id)` |
| `private.community_fact_tombstones` | `community_fact_tombstones_pkey` | `map:supabase/migrations/202609260200_community_ingest.sql:115 (table constraint)` | `CREATE UNIQUE INDEX community_fact_tombstones_pkey ON private.community_fact_tombstones USING btree (contributor_id, source_report_key)` |
| `private.community_ingest_events` | `community_ingest_events_contributor_id_event_id_key` | `map:supabase/migrations/202609260200_community_ingest.sql:22 (table constraint)` | `CREATE UNIQUE INDEX community_ingest_events_contributor_id_event_id_key ON private.community_ingest_events USING btree (contributor_id, event_id)` |
| `private.community_ingest_events` | `community_ingest_events_pkey` | `map:supabase/migrations/202609260200_community_ingest.sql:22 (table constraint)` | `CREATE UNIQUE INDEX community_ingest_events_pkey ON private.community_ingest_events USING btree (receipt_id)` |
| `private.community_ingest_events` | `community_ingest_events_received_idx` | `map:supabase/migrations/202609260200_community_ingest.sql:46` | `CREATE INDEX community_ingest_events_received_idx ON private.community_ingest_events USING btree (received_at)` |
| `private.community_ingest_events` | `community_ingest_events_report_idx` | `map:supabase/migrations/202609260200_community_ingest.sql:45` | `CREATE INDEX community_ingest_events_report_idx ON private.community_ingest_events USING btree (contributor_id, dataset_key, source_report_key)` |
| `private.community_manifest_generations` | `community_manifest_generations_pkey` | `map:supabase/migrations/202609260200_community_ingest.sql:134 (table constraint)` | `CREATE UNIQUE INDEX community_manifest_generations_pkey ON private.community_manifest_generations USING btree (contributor_id, dataset_key)` |
| `private.community_owner_transfer_audit` | `community_owner_transfer_audit_pkey` | `map:supabase/migrations/202609280800_report_owner_transfer.sql:12 (table constraint)` | `CREATE UNIQUE INDEX community_owner_transfer_audit_pkey ON private.community_owner_transfer_audit USING btree (audit_id)` |
| `private.community_policies` | `community_policies_pkey` | `auth:supabase/migrations/202609260100_community_account_registry.sql:16 (table constraint)` | `CREATE UNIQUE INDEX community_policies_pkey ON private.community_policies USING btree (version)` |
| `private.community_policy_current` | `community_policy_current_pkey` | `auth:supabase/migrations/202609260100_community_account_registry.sql:21 (table constraint)` | `CREATE UNIQUE INDEX community_policy_current_pkey ON private.community_policy_current USING btree (singleton)` |
| `private.community_policy_disclosures` | `community_policy_disclosures_pkey` | `map:supabase/migrations/202609280100_amount_duration_region.sql:12 (table constraint)` | `CREATE UNIQUE INDEX community_policy_disclosures_pkey ON private.community_policy_disclosures USING btree (version)` |
| `private.community_policy_texts` | `community_policy_texts_pkey` | `auth:supabase/migrations/202609280600_policy_consent_text.sql:13 (table constraint)` | `CREATE UNIQUE INDEX community_policy_texts_pkey ON private.community_policy_texts USING btree (consent_text_sha256)` |
| `private.community_registry_state` | `community_registry_state_pkey` | `map:supabase/migrations/202609290100_agency_registry_recompute.sql:26 (table constraint)` | `CREATE UNIQUE INDEX community_registry_state_pkey ON private.community_registry_state USING btree (id)` |
| `private.community_report_facts` | `community_report_facts_completed_date_idx` | `map:supabase/migrations/202609260200_community_ingest.sql:87` | `CREATE INDEX community_report_facts_completed_date_idx ON private.community_report_facts USING btree (completed_date, category, region_code) WHERE (public_state = 'completed'::text)` |
| `private.community_report_facts` | `community_report_facts_grant_idx` | `map:supabase/migrations/202609260200_community_ingest.sql:89` | `CREATE INDEX community_report_facts_grant_idx ON private.community_report_facts USING btree (consent_grant_id)` |
| `private.community_report_facts` | `community_report_facts_my_reports_owner` | `map:supabase/migrations/202609300200_my_reports.sql:5` | `CREATE INDEX community_report_facts_my_reports_owner ON private.community_report_facts USING btree (contributor_id, source_report_key, completed_date DESC) WHERE (public_state = 'completed'::text)` |
| `private.community_report_facts` | `community_report_facts_number_lookup` | `map:supabase/migrations/202610040800_viewer_lookup_plan.sql:6` | `CREATE INDEX community_report_facts_number_lookup ON private.community_report_facts USING btree (source_report_key, first_accepted_at, contributor_id) WHERE ((public_state = 'completed'::text) AND (report_number IS NOT NULL))` |
| `private.community_report_facts` | `community_report_facts_owner_lookup` | `map:supabase/migrations/202609280800_report_owner_transfer.sql:11` | `CREATE INDEX community_report_facts_owner_lookup ON private.community_report_facts USING btree (source_report_key)` |
| `private.community_report_facts` | `community_report_facts_pkey` | `map:supabase/migrations/202609260200_community_ingest.sql:48 (table constraint)` | `CREATE UNIQUE INDEX community_report_facts_pkey ON private.community_report_facts USING btree (contributor_id, dataset_key, source_report_key)` |
| `private.community_report_facts` | `community_report_facts_point_idx` | `map:supabase/migrations/202609260200_community_ingest.sql:88` | `CREATE INDEX community_report_facts_point_idx ON private.community_report_facts USING btree (point_key)` |
| `private.community_report_facts` | `community_report_facts_report_date_idx` | `map:supabase/migrations/202609260200_community_ingest.sql:86` | `CREATE INDEX community_report_facts_report_date_idx ON private.community_report_facts USING btree (report_date, category, region_code) WHERE (public_state = 'completed'::text)` |
| `private.contributor_profiles` | `contributor_profiles_pkey` | `map:supabase/migrations/202608150001_initial_schema.sql:15 (table constraint)` | `CREATE UNIQUE INDEX contributor_profiles_pkey ON private.contributor_profiles USING btree (user_id)` |
| `private.rate_limits` | `rate_limits_pkey` | `map:supabase/migrations/202608150001_initial_schema.sql:131 (table constraint)` | `CREATE UNIQUE INDEX rate_limits_pkey ON private.rate_limits USING btree (bucket, window_start)` |
| `private.rate_limits` | `rate_limits_window_idx` | `map:supabase/migrations/202608150001_initial_schema.sql:138` | `CREATE INDEX rate_limits_window_idx ON private.rate_limits USING btree (window_start)` |
| `private.report_facts_v2` | `report_facts_v2_completed_date_idx` | `map:supabase/migrations/202609240001_analytics_v2.sql:28` | `CREATE INDEX report_facts_v2_completed_date_idx ON private.report_facts_v2 USING btree (completed_date, category, region_code)` |
| `private.report_facts_v2` | `report_facts_v2_pkey` | `map:supabase/migrations/202609240001_analytics_v2.sql:6 (table constraint)` | `CREATE UNIQUE INDEX report_facts_v2_pkey ON private.report_facts_v2 USING btree (snapshot_id, fact_identity)` |
| `private.report_facts_v2` | `report_facts_v2_point_idx` | `map:supabase/migrations/202609240001_analytics_v2.sql:29` | `CREATE INDEX report_facts_v2_point_idx ON private.report_facts_v2 USING btree (point_key)` |
| `private.report_facts_v2` | `report_facts_v2_report_date_idx` | `map:supabase/migrations/202609240001_analytics_v2.sql:27` | `CREATE INDEX report_facts_v2_report_date_idx ON private.report_facts_v2 USING btree (report_date, category, region_code)` |
| `private.upload_chunks` | `upload_chunks_pkey` | `map:supabase/migrations/202608150001_initial_schema.sql:107 (table constraint)` | `CREATE UNIQUE INDEX upload_chunks_pkey ON private.upload_chunks USING btree (snapshot_id, chunk_index)` |
| `private.upload_points` | `upload_points_location_idx` | `map:supabase/migrations/202608150001_initial_schema.sql:104` | `CREATE INDEX upload_points_location_idx ON private.upload_points USING btree (period_year, category, location_key)` |
| `private.upload_points` | `upload_points_pkey` | `map:supabase/migrations/202608150001_initial_schema.sql:67 (table constraint)` | `CREATE UNIQUE INDEX upload_points_pkey ON private.upload_points USING btree (id)` |
| `private.upload_points` | `upload_points_snapshot_id_period_year_category_location_key_key` | `map:supabase/migrations/202608150001_initial_schema.sql:67 (table constraint)` | `CREATE UNIQUE INDEX upload_points_snapshot_id_period_year_category_location_key_key ON private.upload_points USING btree (snapshot_id, period_year, category, location_key)` |
| `private.upload_points` | `upload_points_snapshot_idx` | `map:supabase/migrations/202608150001_initial_schema.sql:101` | `CREATE INDEX upload_points_snapshot_idx ON private.upload_points USING btree (snapshot_id)` |
| `private.upload_snapshots` | `upload_snapshots_one_active_per_user` | `map:supabase/migrations/202608150001_initial_schema.sql:60` | `CREATE UNIQUE INDEX upload_snapshots_one_active_per_user ON private.upload_snapshots USING btree (user_id) WHERE (state = 'active'::text)` |
| `private.upload_snapshots` | `upload_snapshots_payload_dedupe` | `map:supabase/migrations/202608150001_initial_schema.sql:56` | `CREATE UNIQUE INDEX upload_snapshots_payload_dedupe ON private.upload_snapshots USING btree (user_id, payload_sha256) WHERE (state = ANY (ARRAY['staged'::text, 'active'::text, 'quarantined'::text]))` |
| `private.upload_snapshots` | `upload_snapshots_pkey` | `map:supabase/migrations/202608150001_initial_schema.sql:28 (table constraint)` | `CREATE UNIQUE INDEX upload_snapshots_pkey ON private.upload_snapshots USING btree (id)` |
| `private.upload_snapshots` | `upload_snapshots_state_received_idx` | `map:supabase/migrations/202608150001_initial_schema.sql:64` | `CREATE INDEX upload_snapshots_state_received_idx ON private.upload_snapshots USING btree (state, received_at)` |
| `public.it_realtime_control` | `it_realtime_control_pkey` | `local test object / no product migration (table constraint)` | `CREATE UNIQUE INDEX it_realtime_control_pkey ON public.it_realtime_control USING btree (id)` |
| `public.public_map_points` | `public_map_points_bbox_idx` | `map:supabase/migrations/202608150001_initial_schema.sql:179` | `CREATE INDEX public_map_points_bbox_idx ON public.public_map_points USING btree (period_year, category, lat, lng)` |
| `public.public_map_points` | `public_map_points_pkey` | `map:supabase/migrations/202608150001_initial_schema.sql:151 (table constraint)` | `CREATE UNIQUE INDEX public_map_points_pkey ON public.public_map_points USING btree (period_year, category, location_key)` |

## Edge·웹의 왕복 경로

| 경로 | 순차 호출 | 빈도 / 판단 |
|---|---|---|
| public-analytics 일반 조회 | Auth getUser → viewer RPC → rate RPC → cohort state RPC → facts 또는 rollup RPC | 조회 1회당 Auth 1 + DB 4. facts별 RPC 반복/N+1 없음. gate·rate 거절 순서는 계약이므로 무작정 병렬화하지 않음 |
| public-analytics meta/catalog | Auth → viewer → rate → state | Auth 1 + DB 3. catalog의 state는 반환에 쓰이지 않는 후보(계약/호출 실패 의미를 검토) |
| my-analytics | Auth → rate → personal source RPC(내부 state/facts) | Auth 1 + DB 2, 행별 네트워크 호출 없음 |
| my-reports | Auth → rate → summary/search/numbers RPC | Auth 1 + DB 2, 페이지별 한 RPC |
| user-rankings | Auth → rate → rankings RPC(내부 viewer) | Auth 1 + DB 2 |
| community-ingest upload | Auth → user rate → connection rate → ingest RPC | 배치별 호출, DB 함수 내부 이벤트 루프는 별도 측정 |
| community-ingest manifest | Auth → user rate → manifest RPC | 5천 건 페이지마다 1 RPC, 원시 keys 전체 반환 없음 |
| community-account | Auth → rate → action RPC | 등록/재동의/철회/삭제마다; 앱의 실시간/수동/자정 흐름도 이 경로 |
| community-auth-relay | capability/Auth 검사 → rate → action RPC; create 5% cleanup | poll/브라우저 상태 반복, 전역 capacity lock 보존 |

웹 클라이언트에서 제품 DB로 직접 `.from().select()`/RPC를 호출하는 경로는 발견되지 않았다. 지도는 Edge API를, auth 사이트는 Auth OAuth/relay를 호출한다. `.from` 문자열 중 `Array.from`, `Buffer.from`은 DB 접근이 아니다. Supabase Auth 내부 플랫폼 쿼리는 저장소 소유 SQL이 아니며 getUser/OAuth 통합 검증으로 구분한다. 앱 저장소는 수정하지 않는다.

## 재현

`python3 scripts/query-audit/catalog.py --auth /path/to/auth-perf --installed --out /tmp/query-audit-current.json`으로 현재 설치 상태를 읽는다. 기준 catalog-before.json은 감사 시작 시 저장한 불변 oracle이므로 덮지 않는다. `python3 scripts/query-audit/inventory.py`는 보관된 두 카탈로그에서 표를 재생성한다.

## 감사 migration 적용 후 현재 정의

함수 76개 / 트리거 10개 / 인덱스 60개. 아래 11개 함수 외에는 위 기준 정의와 동일하다. 인덱스·테이블·RLS 정책 변경은 없다.

| 함수 | 현재 정의 |
|---|---|
| `private.analytics_rollup_source` | `map:supabase/migrations/202610060500_rollup_region_inputs.sql:3` |
| `private.community_facts_manifest_delete_batch` | `map:supabase/migrations/202610060300_manifest_statement_batches.sql:18` |
| `private.community_facts_manifest_insert_batch` | `map:supabase/migrations/202610060300_manifest_statement_batches.sql:6` |
| `private.ranking_representatives` | `map:supabase/migrations/202610060200_query_read_paths.sql:242` |
| `public.internal_agency_recompute_apply` | `map:supabase/migrations/202610060400_agency_recompute_batch.sql:3` |
| `public.internal_analytics_cohort_state` | `map:supabase/migrations/202610060200_query_read_paths.sql:32` |
| `public.internal_analytics_v2_facts` | `map:supabase/migrations/202610060200_query_read_paths.sql:64` |
| `public.internal_analytics_v2_state` | `map:supabase/migrations/202610060200_query_read_paths.sql:5` |
| `public.internal_analytics_viewer` | `map:supabase/migrations/202610060200_query_read_paths.sql:179` |
| `public.internal_my_analytics_cohort_source` | `map:supabase/migrations/202610060200_query_read_paths.sql:322` |
| `public.internal_my_analytics_source` | `map:supabase/migrations/202610060200_query_read_paths.sql:277` |

fact의 기존 `community_report_facts_manifest`는 `060300`에서 UPDATE 전용 ROW 트리거가 되며, INSERT/DELETE statement 트리거 2개가 같은 파일에서 추가된다. 실제 호출별 측정 매핑은 [coverage.json](evidence/coverage.json), 전후 전체 표는 [MEASUREMENTS.md](MEASUREMENTS.md)에 있다.
