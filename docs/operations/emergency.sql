-- 비상 SQL (2026-10-22, 작업지시서 2-9·2-10). 운영 콘솔이 죽었을 때만 쓴다. 206 에서 postgres 로 한 줄씩 실행한다.
-- 바꾼 내용은 트리거가 private.community_ingest_config_audit 에 'sql:postgres' / 'sql_update' 로 남긴다.

-- 업로드 지금 중지(재개 시각 없음 = 직접 재개할 때까지). 앱은 503 maintenance 를 받고, 새 앱은 status 에서 중지를 본다.
update private.community_ingest_config set uploads_paused = true, pause_message = null, pause_resume_at = null, paused_at = now(), paused_by = 'emergency-sql' where singleton;

-- 업로드 1시간 중지(1시간 뒤 조작 없이 자동 재개)
update private.community_ingest_config set uploads_paused = true, pause_message = null, pause_resume_at = now() + interval '1 hour', paused_at = now(), paused_by = 'emergency-sql' where singleton;

-- 업로드 재개
update private.community_ingest_config set uploads_paused = false, pause_message = null, pause_resume_at = null where singleton;

-- 필수 버전 해제(426 과 지도 웹 안내 화면, 새 앱 잠금이 바로 풀린다)
update private.community_ingest_config set client_requirement = null where singleton;

-- 지금 상태 확인
select private.community_uploads_paused(uploads_paused, pause_resume_at) as paused_now, pause_resume_at, client_requirement from private.community_ingest_config where singleton;
