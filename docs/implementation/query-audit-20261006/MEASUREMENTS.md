# 전체 실행시간 비교

단위 ms. 각 칸은 **수정 전 → 후**이며 오류 SQLSTATE도 숨기지 않는다. 측정은 로컬 서버 1회 호출이며 p95/운영 SLA가 아니다. 계획 계측은 별도 실행했다. 8초 진단 한도는 제품 타임아웃을 늘린 값이 아니다. `P0001` 정책 불변성 거부는 예상 결과다.

3천 fact는 30계정/120동의 이력/60기기, 3만 fact는 300계정/1,200동의 이력/600기기다. 계정 1개에 전체 facts를 넣은 집중 조건도 측정한다. revoked/suspended 계정, 같은 lineage의 이전 동의, NULL 날짜/번호, 중복 관측과 공개 정책 차이가 포함된다. 운영 계정 수가 제공되지 않아 합성 가정이며 운영 자료에서 추출한 분포가 아니다.

읽기 raw facts 3천 건 약 3.4 MB / 3만 건 약 36 MB의 JSONB 반환 비용을 포함한다. 각 scalar helper는 명시적 호출로, trigger는 실제 DML로, index는 그 계획과 DML 비용으로 측정한다. my_reports 배열 helper 시간에는 own 배열 생성도 포함하므로 helper 자체의 단독 시간으로 해석하지 않는다.

## 계정 분산

| 호출 / 동작 | 3천 custom | 3천 generic | 3만 custom | 3만 generic |
|---|---:|---:|---:|---:|
| `internal_analytics_v2_state` | 83.6 → 4.1 | 90.7 → 3.6 | 383.3 → 28.4 | 442.2 → 30.5 |
| `internal_analytics_cohort_state` | 83.3 → 3.4 | 92.5 → 2.5 | 418.4 → 28.2 | 460.3 → 27.0 |
| `internal_analytics_viewer` | 23.2 → 4.1 | 25.0 → 3.5 | 24.3 → 14.3 | 26.6 → 10.9 |
| `internal_analytics_cohort_facts` | 202.0 → 198.5 | 204.8 → 194.5 | 2128.3 → 2126.1 | 2180.7 → 2063.1 |
| `internal_analytics_v2_facts` | 402.7 → 172.1 | 1405.9 → 168.2 | 3188.9 → 1981.2 | 8005.1 (57014) → 1885.3 |
| `internal_my_analytics_cohort_source` | 279.1 → 207.3 | 284.2 → 203.3 | 3019.2 → 2493.9 | 2896.2 → 2371.1 |
| `internal_my_analytics_source` | 522.8 → 189.1 | 1515.6 → 190.5 | 3863.4 → 2170.0 | 8012.9 (57014) → 2150.3 |
| `internal_account_policy` | 2.1 → 1.0 | 0.9 → 1.0 | 1.3 → 1.0 | 1.0 → 0.9 |
| `internal_account_status` | 2.2 → 2.2 | 3.0 → 2.6 | 2.9 → 2.0 | 2.2 → 2.0 |
| `internal_community_manifest` | 2.4 → 2.5 | 2.2 → 2.0 | 3.0 → 2.9 | 2.1 → 1.9 |
| `internal_agency_recompute_state` | 0.4 → 0.3 | 0.3 → 0.3 | 0.4 → 0.4 | 0.3 → 0.3 |
| `internal_my_reports_summary` | 7.6 → 7.3 | 5.9 → 5.8 | 6.6 → 8.2 | 7.2 → 5.8 |
| `internal_my_reports_search` | 11.0 → 9.7 | 12.7 → 8.3 | 8.1 → 10.3 | 9.7 → 9.0 |
| `internal_my_reports_numbers` | 5.1 → 5.1 | 6.5 → 5.2 | 4.8 → 4.9 | 5.6 → 5.0 |
| `rollup/agency` | 50.6 → 58.8 | 48.7 → 48.0 | 464.1 → 471.8 | 445.7 → 428.2 |
| `rollup/manager` | 44.1 → 50.9 | 47.0 → 46.7 | 437.2 → 417.9 | 440.5 → 444.5 |
| `rollup/laws` | 44.1 → 48.2 | 40.0 → 42.4 | 411.2 → 413.0 | 439.6 → 405.4 |
| `rollup/series` | 47.2 → 51.0 | 50.3 → 43.7 | 471.2 → 449.2 | 442.2 → 428.2 |
| `internal_user_rankings` | 56.7 → 29.5 | 55.0 → 30.9 | 297.8 → 245.7 | 309.5 → 263.2 |
| `ranking_representatives` | 40.5 → 37.5 | 52.5 → 36.7 | 462.2 → 436.6 | 446.0 → 410.8 |
| `my_reports_own` | 4.3 → 4.6 | 4.7 → 4.7 | 4.4 → 4.4 | 4.6 → 4.4 |
| `analytics_rollup_source` | 56.0 → 66.6 | 66.3 → 56.5 | 629.4 → 659.5 | 657.4 → 616.5 |
| `internal_agency_recompute_page` | 5.1 → 5.4 | 5.3 → 5.3 | 5.3 → 5.2 | 5.5 → 5.2 |
| `internal_account_grant_consent/current` | 2.3 → 2.2 | 2.4 → 3.1 | 2.7 → 2.4 | 2.2 → 2.5 |
| `internal_account_grant_consent/new` | 1.5 → 2.6 | 1.5 → 2.0 | 1.8 → 1.8 | 1.4 → 2.0 |
| `internal_account_register_connection` | 1.9 → 2.3 | 2.9 → 2.7 | 3.0 → 1.9 | 1.8 → 2.3 |
| `internal_account_rebind_connection` | 1.3 → 1.6 | 1.6 → 1.8 | 1.6 → 1.8 | 1.2 → 1.8 |
| `internal_account_revoke_connection` | 0.8 → 1.0 | 0.8 → 1.1 | 1.2 → 1.0 | 0.7 → 0.9 |
| `internal_account_revoke_consent` | 1.8 → 2.6 | 2.5 → 3.0 | 2.6 → 2.1 | 1.7 → 2.1 |
| `internal_community_delete_contributions` | 21.3 → 10.4 | 13.0 → 5.4 | 26.7 → 12.2 | 12.8 → 7.4 |
| `internal_analytics_v2_rate_limit` | 0.6 → 0.5 | 0.6 → 0.4 | 0.5 → 0.6 | 0.6 → 0.5 |
| `internal_community_ingest_rate_limit` | 0.6 → 0.6 | 0.6 → 0.3 | 0.5 → 0.6 | 0.4 → 0.5 |
| `internal_safeauth_rate_limit` | 1.0 → 0.9 | 0.9 → 0.8 | 1.2 → 1.1 | 1.4 → 1.1 |
| `internal_safeauth_create` | 1.9 → 2.2 | 2.1 → 1.6 | 2.6 → 2.6 | 2.9 → 2.7 |
| `internal_safeauth_claim` | 1.1 → 1.2 | 1.1 → 1.1 | 1.2 → 1.2 | 1.1 → 1.5 |
| `internal_safeauth_browser_status` | 0.5 → 0.4 | 0.4 → 0.4 | 0.4 → 0.4 | 0.4 → 0.6 |
| `internal_safeauth_prepare` | 1.1 → 0.9 | 0.9 → 0.9 | 1.1 → 0.9 | 0.8 → 1.2 |
| `internal_safeauth_publish` | 1.0 → 1.5 | 1.0 → 1.5 | 1.0 → 1.0 | 1.0 → 1.3 |
| `internal_safeauth_poll` | 1.0 → 1.1 | 0.9 → 1.0 | 1.0 → 0.9 | 1.3 → 1.2 |
| `internal_safeauth_complete` | 1.2 → 1.5 | 1.3 → 1.1 | 1.4 → 1.1 | 1.4 → 1.7 |
| `internal_safeauth_cancel` | 1.3 → 1.1 | 0.8 → 0.9 | 1.0 → 0.9 | 1.0 → 1.2 |
| `internal_safeauth_rotate_ticket` | 0.9 → 0.8 | 1.2 → 0.7 | 1.1 → 0.9 | 0.9 → 1.1 |
| `internal_safeauth_cleanup` | 10.2 → 9.9 | 8.9 → 8.6 | 98.8 → 110.9 | 96.4 → 109.7 |
| `internal_activate_snapshot` | 1.9 → 1.9 | 1.7 → 1.7 | 1.9 → 1.9 | 1.9 → 1.9 |
| `internal_agency_recompute_apply` | 317.9 → 104.0 | 237.5 → 64.8 | 369.7 → 182.3 | 277.9 → 89.4 |
| `internal_community_ingest/1` | 7.4 → 7.1 | 7.1 → 6.6 | 6.8 → 6.5 | 7.8 → 6.0 |
| `internal_community_ingest/20` | 40.6 → 40.8 | 31.7 → 28.2 | 45.6 → 43.7 | 29.2 → 27.0 |
| `internal_cleanup_expired` | 0.9 → 0.9 | 0.9 → 1.0 | 39.2 → 33.6 | 38.3 → 51.3 |
| `community_current_policy` | 0.2 → 0.2 | 0.2 → 0.2 | 0.4 → 0.2 | 0.3 → 0.3 |
| `community_identity_state` | 0.4 → 0.4 | 0.5 → 0.5 | 0.8 → 0.6 | 0.7 → 0.6 |
| `community_lineage_active` | 0.4 → 0.3 | 0.3 → 0.4 | 0.5 → 0.5 | 0.5 → 0.4 |
| `community_lock_contributor` | 0.5 → 0.3 | 0.2 → 0.2 | 0.4 → 0.3 | 0.5 → 0.3 |
| `community_grant_is_current` | 0.3 → 0.3 | 0.3 → 0.3 | 0.4 → 0.3 | 0.4 → 0.3 |
| `community_fact_publicly_listed` | 0.6 → 1.0 | 0.5 → 0.5 | 0.8 → 0.6 | 0.8 → 0.5 |
| `community_bump_manifest` | 0.4 → 0.6 | 0.3 → 0.3 | 0.5 → 0.4 | 0.3 → 0.3 |
| `community_bump_projection` | 0.2 → 0.3 | 0.2 → 0.2 | 0.3 → 0.2 | 0.2 → 0.2 |
| `safeauth_expire_if_needed` | 0.5 → 0.8 | 0.7 → 0.5 | 0.6 → 0.6 | 0.6 → 0.5 |
| `analytics_in_ring` | 0.8 → 0.8 | 0.6 → 0.5 | 0.6 → 0.6 | 0.7 → 0.6 |
| `analytics_in_polygon` | 0.3 → 0.5 | 0.3 → 0.2 | 0.2 → 0.2 | 0.3 → 0.2 |
| `analytics_region` | 1.1 → 1.1 | 1.2 → 0.9 | 1.4 → 1.0 | 3.0 → 1.0 |
| `analytics_law` | 1.4 → 1.7 | 1.7 → 1.2 | 1.4 → 1.4 | 1.2 → 1.3 |
| `my_reports_address_base` | 0.3 → 0.5 | 0.3 → 0.3 | 0.3 → 0.4 | 0.3 → 0.3 |
| `my_reports_norm_address` | 0.1 → 0.3 | 0.2 → 0.2 | 0.1 → 0.2 | 0.2 → 0.1 |
| `my_reports_norm_vehicle` | 0.1 → 0.2 | 0.2 → 0.1 | 0.2 → 0.2 | 0.2 → 0.1 |
| `my_reports_check_query` | 0.3 → 0.5 | 0.4 → 0.3 | 0.3 → 0.3 | 0.3 → 0.3 |
| `my_reports_gate` | 0.9 → 1.0 | 1.1 → 0.7 | 1.1 → 1.0 | 1.1 → 0.9 |
| `my_reports_page` | 4.3 → 4.5 | 5.4 → 4.2 | 4.9 → 4.2 | 4.8 → 4.4 |
| `my_reports_managers` | 4.6 → 4.8 | 7.3 → 4.6 | 5.5 → 5.0 | 4.5 → 4.2 |
| `my_reports_stats` | 2.7 → 3.1 | 3.5 → 2.8 | 3.0 → 4.2 | 3.0 → 2.8 |
| `my_reports_version` | 2.8 → 3.4 | 3.0 → 4.4 | 4.9 → 4.0 | 3.2 → 3.0 |
| `my_reports_matches` | 2.3 → 2.4 | 2.5 → 3.4 | 3.9 → 3.1 | 3.0 → 2.4 |
| `my_reports_row_json` | 2.2 → 2.3 | 2.3 → 3.0 | 3.2 → 2.6 | 3.1 → 2.2 |
| `triggers/insert-bulk` | 849.6 → 431.4 | 498.6 → 243.0 | 8000.2 (57014) → 4437.5 | 5142.9 → 2916.0 |
| `triggers/insert-one` | 1.1 → 1.3 | 1.0 → 0.9 | 2.2 → 1.3 | 1.1 → 1.2 |
| `triggers/delete-bulk` | 441.8 → 12.1 | 241.5 → 10.0 | 4478.1 → 146.2 | 2568.3 → 128.9 |
| `triggers/update-state` | 25.4 → 37.7 | 16.5 → 14.6 | 26.5 → 25.0 | 15.1 → 16.9 |
| `triggers/profile-update` | 0.6 → 0.7 | 0.5 → 0.8 | 0.7 → 0.5 | 0.6 → 0.8 |
| `triggers/policy-immutable` | 0.3 (P0001) → 0.4 (P0001) | 0.3 (P0001) → 0.3 (P0001) | 0.4 (P0001) → 0.3 (P0001) | 0.3 (P0001) → 0.3 (P0001) |
| `triggers/policy-text-immutable` | 0.4 (P0001) → 0.6 (P0001) | 0.4 (P0001) → 0.5 (P0001) | 0.5 (P0001) → 0.4 (P0001) | 0.7 (P0001) → 0.4 (P0001) |
## 한 계정 집중

| 호출 / 동작 | 3천 custom | 3천 generic | 3만 custom | 3만 generic |
|---|---:|---:|---:|---:|
| `internal_analytics_v2_state` | 97.3 → 3.5 | 112.5 → 3.6 | 461.4 → 24.7 | 426.8 → 26.0 |
| `internal_analytics_cohort_state` | 105.1 → 2.4 | 127.6 → 2.6 | 472.8 → 23.5 | 412.8 → 24.0 |
| `internal_analytics_viewer` | 652.3 → 10.2 | 589.1 → 10.2 | 6892.4 → 119.0 | 6684.2 → 123.2 |
| `internal_analytics_cohort_facts` | 220.7 → 218.1 | 215.4 → 212.8 | 2216.7 → 2158.2 | 2172.0 → 2093.9 |
| `internal_analytics_v2_facts` | 475.8 → 196.8 | 1535.1 → 181.1 | 3348.6 → 1919.3 | 8014.1 (57014) → 1859.1 |
| `internal_my_analytics_cohort_source` | 323.7 → 213.5 | 314.9 → 201.3 | 3002.8 → 2440.8 | 2934.2 → 2350.7 |
| `internal_my_analytics_source` | 575.1 → 213.6 | 1647.4 → 189.6 | 3999.2 → 2164.8 | 8006.7 (57014) → 2118.1 |
| `internal_account_policy` | 1.0 → 1.0 | 0.9 → 1.0 | 0.9 → 0.9 | 0.8 → 1.0 |
| `internal_account_status` | 2.0 → 1.9 | 1.8 → 1.9 | 2.2 → 2.1 | 2.1 → 2.2 |
| `internal_community_manifest` | 10.7 → 11.0 | 8.8 → 9.2 | 28.4 → 25.6 | 26.9 → 27.8 |
| `internal_agency_recompute_state` | 0.4 → 0.4 | 0.6 → 0.3 | 0.4 → 0.3 | 0.6 → 0.3 |
| `internal_my_reports_summary` | 54.7 → 57.2 | 49.5 → 50.1 | 640.6 → 575.2 | 573.5 → 572.4 |
| `internal_my_reports_search` | 82.2 → 86.4 | 85.4 → 89.4 | 1051.3 → 919.8 | 1013.1 → 970.8 |
| `internal_my_reports_numbers` | 67.1 → 62.7 | 68.7 → 75.3 | 864.6 → 806.5 | 809.1 → 774.5 |
| `rollup/agency` | 46.7 → 52.1 | 44.5 → 54.3 | 424.8 → 431.9 | 408.5 → 417.7 |
| `rollup/manager` | 44.6 → 50.2 | 42.0 → 44.9 | 417.8 → 430.8 | 404.9 → 403.0 |
| `rollup/laws` | 41.8 → 50.5 | 40.1 → 46.3 | 429.2 → 406.8 | 406.3 → 404.9 |
| `rollup/series` | 46.6 → 52.5 | 51.9 → 44.7 | 432.0 → 449.2 | 427.0 → 420.5 |
| `internal_user_rankings` | 640.4 → 40.4 | 604.6 → 39.4 | 7209.3 → 356.7 | 7121.3 → 361.3 |
| `ranking_representatives` | 44.4 → 43.6 | 43.8 → 39.2 | 470.8 → 412.3 | 433.0 → 410.0 |
| `my_reports_own` | 94.8 → 98.9 | 90.6 → 100.0 | 973.5 → 940.0 | 958.9 → 934.0 |
| `analytics_rollup_source` | 59.5 → 81.3 | 61.9 → 62.7 | 624.9 → 643.7 | 636.7 → 603.8 |
| `internal_agency_recompute_page` | 5.6 → 6.0 | 6.5 → 5.6 | 5.5 → 5.7 | 6.2 → 5.4 |
| `internal_account_grant_consent/current` | 2.5 → 2.2 | 2.2 → 2.4 | 2.4 → 2.3 | 2.7 → 3.1 |
| `internal_account_grant_consent/new` | 1.8 → 1.4 | 1.5 → 1.5 | 1.8 → 1.4 | 2.2 → 1.9 |
| `internal_account_register_connection` | 2.5 → 5.6 | 1.8 → 1.9 | 1.9 → 1.9 | 2.6 → 2.3 |
| `internal_account_rebind_connection` | 1.4 → 1.8 | 1.4 → 1.3 | 1.2 → 1.3 | 1.6 → 2.1 |
| `internal_account_revoke_connection` | 0.9 → 1.4 | 0.8 → 0.7 | 0.9 → 0.8 | 1.0 → 1.0 |
| `internal_account_revoke_consent` | 1.9 → 2.2 | 2.1 → 1.8 | 1.7 → 1.7 | 2.2 → 1.8 |
| `internal_community_delete_contributions` | 673.5 → 156.6 | 399.7 → 59.0 | 8000.4 (57014) → 1478.6 | 8000.2 (57014) → 663.6 |
| `internal_analytics_v2_rate_limit` | 0.7 → 0.6 | 0.4 → 0.5 | 0.6 → 0.4 | 0.4 → 0.4 |
| `internal_community_ingest_rate_limit` | 0.5 → 0.4 | 0.4 → 0.4 | 0.5 → 0.4 | 0.7 → 0.4 |
| `internal_safeauth_rate_limit` | 1.2 → 0.9 | 1.2 → 0.9 | 1.3 → 1.1 | 1.1 → 1.2 |
| `internal_safeauth_create` | 2.3 → 1.7 | 2.0 → 1.8 | 3.1 → 2.1 | 2.9 → 2.3 |
| `internal_safeauth_claim` | 1.4 → 1.1 | 1.2 → 1.2 | 1.4 → 1.0 | 1.3 → 1.2 |
| `internal_safeauth_browser_status` | 0.6 → 0.4 | 0.4 → 0.4 | 0.5 → 0.4 | 0.4 → 0.4 |
| `internal_safeauth_prepare` | 1.2 → 0.9 | 1.4 → 0.9 | 1.0 → 0.8 | 0.8 → 1.1 |
| `internal_safeauth_publish` | 1.4 → 1.0 | 1.4 → 1.0 | 1.1 → 0.9 | 0.9 → 1.0 |
| `internal_safeauth_poll` | 1.2 → 0.9 | 1.3 → 0.9 | 0.9 → 0.9 | 0.8 → 1.3 |
| `internal_safeauth_complete` | 1.5 → 1.1 | 1.4 → 1.2 | 1.2 → 1.0 | 1.0 → 1.4 |
| `internal_safeauth_cancel` | 1.2 → 0.8 | 1.1 → 0.9 | 0.8 → 0.8 | 0.8 → 1.0 |
| `internal_safeauth_rotate_ticket` | 0.9 → 0.7 | 0.9 → 0.7 | 0.8 → 0.7 | 0.7 → 0.9 |
| `internal_safeauth_cleanup` | 9.2 → 9.4 | 10.2 → 9.6 | 101.2 → 89.3 | 98.6 → 98.6 |
| `internal_activate_snapshot` | 1.9 → 2.0 | 1.7 → 1.7 | 1.7 → 1.6 | 1.6 → 2.0 |
| `internal_agency_recompute_apply` | 328.2 → 97.7 | 247.0 → 70.1 | 331.9 → 99.9 | 259.7 → 79.1 |
| `internal_community_ingest/1` | 6.5 → 7.7 | 8.0 → 6.7 | 6.0 → 6.3 | 6.2 → 12.8 |
| `internal_community_ingest/20` | 40.5 → 47.7 | 33.0 → 27.0 | 36.9 → 39.4 | 33.6 → 28.7 |
| `internal_cleanup_expired` | 1.0 → 1.0 | 1.1 → 1.0 | 30.6 → 31.3 | 43.3 → 35.7 |
| `community_current_policy` | 0.2 → 0.2 | 0.2 → 0.2 | 0.2 → 0.2 | 0.2 → 0.2 |
| `community_identity_state` | 0.5 → 0.7 | 0.5 → 0.5 | 0.9 → 0.6 | 0.5 → 0.7 |
| `community_lineage_active` | 0.4 → 0.4 | 0.5 → 0.5 | 0.6 → 0.4 | 0.4 → 0.4 |
| `community_lock_contributor` | 0.3 → 0.4 | 0.3 → 0.2 | 0.4 → 0.6 | 0.5 → 0.4 |
| `community_grant_is_current` | 0.3 → 0.4 | 0.4 → 0.3 | 0.3 → 0.4 | 0.4 → 0.5 |
| `community_fact_publicly_listed` | 0.5 → 0.6 | 0.7 → 0.5 | 0.6 → 0.8 | 0.9 → 0.9 |
| `community_bump_manifest` | 0.3 → 0.4 | 0.4 → 0.3 | 0.3 → 0.5 | 0.5 → 0.4 |
| `community_bump_projection` | 0.2 → 0.2 | 0.3 → 0.2 | 0.2 → 0.3 | 0.4 → 0.2 |
| `safeauth_expire_if_needed` | 0.6 → 0.7 | 0.6 → 0.5 | 0.6 → 0.7 | 0.8 → 0.8 |
| `analytics_in_ring` | 0.6 → 0.7 | 0.7 → 0.6 | 0.6 → 0.6 | 0.9 → 0.7 |
| `analytics_in_polygon` | 0.2 → 0.3 | 0.2 → 0.2 | 0.3 → 0.3 | 0.3 → 0.3 |
| `analytics_region` | 0.9 → 1.2 | 1.0 → 0.9 | 1.0 → 1.5 | 1.3 → 1.1 |
| `analytics_law` | 1.3 → 1.3 | 1.4 → 1.2 | 1.3 → 1.4 | 1.8 → 1.5 |
| `my_reports_address_base` | 0.3 → 0.5 | 0.3 → 0.3 | 0.3 → 0.3 | 0.4 → 0.3 |
| `my_reports_norm_address` | 0.1 → 0.2 | 0.2 → 0.2 | 0.2 → 0.1 | 0.2 → 0.2 |
| `my_reports_norm_vehicle` | 0.2 → 0.2 | 0.3 → 0.2 | 0.2 → 0.1 | 0.2 → 0.2 |
| `my_reports_check_query` | 0.4 → 0.4 | 0.4 → 0.3 | 0.3 → 0.3 | 0.5 → 0.3 |
| `my_reports_gate` | 0.9 → 1.2 | 1.0 → 0.9 | 1.0 → 1.1 | 1.5 → 1.0 |
| `my_reports_page` | 42.8 → 44.9 | 43.5 → 48.7 | 413.2 → 403.9 | 446.8 → 454.5 |
| `my_reports_managers` | 56.9 → 54.8 | 58.1 → 61.7 | 580.5 → 517.1 | 545.2 → 572.5 |
| `my_reports_stats` | 40.5 → 40.7 | 42.7 → 42.5 | 403.7 → 352.2 | 383.0 → 430.8 |
| `my_reports_version` | 52.2 → 61.6 | 50.0 → 52.3 | 538.5 → 522.5 | 505.2 → 556.9 |
| `my_reports_matches` | 34.2 → 38.1 | 31.7 → 34.9 | 328.1 → 317.5 | 328.6 → 370.7 |
| `my_reports_row_json` | 34.1 → 32.6 | 32.4 → 38.9 | 337.1 → 325.3 | 334.3 → 337.7 |
| `triggers/insert-bulk` | 976.9 → 409.9 | 582.9 → 278.2 | 8000.2 (57014) → 4442.3 | 8000.4 (57014) → 3033.3 |
| `triggers/insert-one` | 1.2 → 1.1 | 1.1 → 1.3 | 1.5 → 1.2 | 1.3 → 1.1 |
| `triggers/delete-bulk` | 523.7 → 11.4 | 355.5 → 16.0 | 8000.3 (57014) → 133.8 | 8000.2 (57014) → 144.3 |
| `triggers/update-state` | 840.9 → 819.9 | 600.5 → 607.5 | 8000.6 (57014) → 8000.5 (57014) | 8000.3 (57014) → 8000.3 (57014) |
| `triggers/profile-update` | 0.4 → 0.8 | 0.8 → 0.8 | 0.5 → 0.5 | 0.7 → 0.5 |
| `triggers/policy-immutable` | 0.3 (P0001) → 0.3 (P0001) | 0.4 (P0001) → 0.5 (P0001) | 0.3 (P0001) → 0.3 (P0001) | 0.9 (P0001) → 0.3 (P0001) |
| `triggers/policy-text-immutable` | 0.4 (P0001) → 0.4 (P0001) | 0.6 (P0001) → 0.5 (P0001) | 0.9 (P0001) → 0.4 (P0001) | 0.7 (P0001) → 0.4 (P0001) |

## 계획과 원자료

`evidence/{before,after}-{3000,30000}-force_{custom,generic}_plan.json`: 읽기 latency. `write-` 접두사는 변경·helper 호출이며 각 작업 후 savepoint rollback한다. `-concentrated`는 한 계정 집중, `-plans.json`은 EXPLAIN ANALYZE BUFFERS JSON, `-plans-stderr.txt`는 auto_explain nested 계획이다. 작은 내부 문장은 직접 helper 호출 계획과 함께 해석한다.

`rls-*.json`: 실제 anon/authenticated/service_role 접근과 별도 임시 SELECT 권한 진단. 제품 private 테이블의 실제 ACL 거부(42501)와 RLS 기본 거부를 구분한다. 임시 진단 권한은 전부 rollback하며 실제 앱 권한을 바꾸지 않는다.

`parity-*.json`: 같은 트랜잭션의 수정 전후 응답 비교. ranking의 요청 시각 `generated_at`만 두 별도 호출의 시각 차이 때문에 제외했다. 별도 회귀 검사는 같은 SQL 문장에서 원본 alias와 후보를 실행하므로 그 필드까지 동일 비교한다. 3만 generic의 원본 v2/personal timeout 2개는 동등성 PASS로 세지 않는다; 3만 custom에서는 해당 응답도 완전 비교한다.

## 추가 필터 분기

같은 트랜잭션의 전후 전체 JSON 비교(20/20 일치)와 비계측 시간. 지역·법규·bbox·월·기관별 조건을 분리했다.

| 필터 | 3천 custom | 3천 generic | 3만 custom | 3만 generic |
|---|---:|---:|---:|---:|
| `region` | 309.0 → 53.0 | 263.4 → 56.5 | 3081.2 → 473.3 | 2074.9 → 448.8 |
| `law` | 32.7 → 30.5 | 33.8 → 29.8 | 287.2 → 331.6 | 298.5 → 285.4 |
| `bbox` | 33.4 → 33.3 | 39.0 → 32.3 | 319.8 → 343.3 | 320.6 → 330.9 |
| `month` | 7.3 → 7.2 | 6.9 → 6.7 | 38.7 → 40.5 | 36.9 → 44.6 |
| `agency` | 11.3 → 10.3 | 10.5 → 8.9 | 94.0 → 81.1 | 77.9 → 81.5 |
