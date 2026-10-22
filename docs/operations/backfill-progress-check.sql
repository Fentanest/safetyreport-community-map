-- 운영 확인 SQL (2026-10-22, 작업지시서 2-1·2-7). 읽기 전용. 206 에서 postgres 로 실행한다.
-- 개인을 가리키는 값(사용자 UUID·dataset·기기 이름·카카오 이름)은 내지 않고 가명 ID(sha256 앞 8자리)만 낸다.
-- 운영 콘솔(ops.upload_overview)이 같은 분류를 화면으로 보여 준다. 콘솔이 없을 때 이 파일을 쓴다.

-- 1) 연결별 마지막 진행 보고 + 원본 수 + 지도 사실 수 (활성 연결, 최근 보고 순)
with raw as (select contributor_id, count(*) n from private.community_report_raw group by 1),
     facts as (select contributor_id, count(*) n from private.community_report_facts where public_state = 'completed' group by 1)
select left(encode(sha256(convert_to(c.user_id::text, 'UTF8')), 'hex'), 8) as pseudo_id,
       c.source_app, c.platform, c.last_client_version, c.last_contract,
       c.last_progress->'backfill'->>'state'  as state,
       c.last_progress->'backfill'->>'phase'  as phase,
       c.last_progress->'backfill'->>'reason' as reason,
       (c.last_progress->'backfill'->>'stored') || ' / ' || (c.last_progress->'backfill'->>'total') as stored_total,
       c.last_progress->'backfill'->>'holds'  as holds,
       c.last_progress->>'official_login'     as official_login,
       c.last_progress_at at time zone 'Asia/Seoul' as last_progress_kst,
       c.last_seen_at at time zone 'Asia/Seoul'     as last_seen_kst,
       coalesce(raw.n, 0) as raw_rows, coalesce(facts.n, 0) as map_rows
  from private.community_connections c
  left join raw on raw.contributor_id = c.user_id
  left join facts on facts.contributor_id = c.user_id
 where c.status = 'active'
 order by c.last_progress_at desc nulls last, c.last_seen_at desc nulls last;

-- 2) 동의(지금 정책)는 있는데 연결이 없는 사람 + 마지막 설정 단계(2-7)
select left(encode(sha256(convert_to(g.user_id::text, 'UTF8')), 'hex'), 8) as pseudo_id,
       g.granted_via, g.granted_at at time zone 'Asia/Seoul' as granted_kst,
       s.mode, s.stage, s.reason, s.client_version, s.platform,
       s.client->>'server_reachable' as srv_reachable, s.client->>'server_logged_in' as srv_logged_in,
       s.client->>'account_match' as account_match,
       s.updated_at at time zone 'Asia/Seoul' as setup_kst,
       (select string_agg(cs.app || ' ' || cs.version, ', ' order by cs.last_seen_at desc) from private.community_client_seen cs where cs.user_id = g.user_id) as apps_seen
  from private.community_consent_grants g
  join private.community_policy_current pc on pc.singleton and pc.version = g.policy_version
  left join private.community_setup_progress s on s.user_id = g.user_id
 where g.revoked_at is null
   and not exists (select 1 from private.community_connections c where c.user_id = g.user_id and c.status = 'active')
 order by s.updated_at desc nulls last, g.granted_at desc;

-- 3) 최근 1시간 업로드 거절(503 점검·426 필수 버전) 수
select code, app, route, sum(n) from private.community_ingest_rejections
 where minute >= now() - interval '1 hour' group by 1, 2, 3 order by 1, 2, 3;

-- 4) 지금 설정(점검 스위치·필수 버전)과 최근 변경 이력
select uploads_paused, private.community_uploads_paused(uploads_paused, pause_resume_at) as paused_now,
       pause_message, pause_resume_at at time zone 'Asia/Seoul' as resume_kst, paused_by, client_requirement
  from private.community_ingest_config where singleton;
select changed_at at time zone 'Asia/Seoul' as kst, actor_label, action from private.community_ingest_config_audit order by audit_id desc limit 10;
