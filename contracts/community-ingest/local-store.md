# 앱 쪽 `community.db` v1 (PC·모바일 같은 의미)

위치: PC `<data>/community.db`, 모바일 앱 문서 폴더 `community.db`. 개인 DB(`data.db`, `mysafetyreport.db`)와 **별도 파일**이다.
DB 백업·다운로드·DB 편집기·서버↔모바일 변환·clearAll·초기화는 이 파일을 읽거나 지우지 않는다(교환 계약 3-1 불변).
WAL, `synchronous=FULL`(PC) / sqflite 기본 + `PRAGMA synchronous=FULL`, 일반 영속 테이블만(TEMP 금지). 비밀(토큰·연결 비밀)은 이 파일에 두지 않는다.
시간은 UTC ISO-8601 `…Z` 문자열, 불리언은 0/1 정수.

```sql
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- schema_version=1, project_namespace=sha256(COMMUNITY_SUPABASE_URL 정규화)[:16], local_dataset_id=uuid,
-- source_account_namespace=dataset_key 와 같은 값(공식 계정), next_revision=정수, dataset_history=JSON 배열

CREATE TABLE context (            -- 단일 행(id=1). 메인 프로세스/앱이 중앙 status 확인 뒤 기록, 수집 쪽은 읽기만
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state TEXT NOT NULL CHECK (state IN ('active','inactive')),
  contributor_fingerprint TEXT, connection_id TEXT, writer_epoch INTEGER, dataset_key TEXT,
  consent_grant_id TEXT, policy_version TEXT, source_app TEXT, source_mode TEXT,
  verified_at TEXT, inactive_reason TEXT);

CREATE TABLE source_journal (      -- 불변 관측 사본. ack/save 상태 열만 갱신
  event_id TEXT PRIMARY KEY,
  project_namespace TEXT NOT NULL, local_dataset_id TEXT NOT NULL, dataset_key TEXT,
  source_report_id TEXT NOT NULL, source_revision INTEGER NOT NULL,
  event_type TEXT NOT NULL, captured_at TEXT NOT NULL, capture_trigger TEXT NOT NULL,
  rebuild_run_id TEXT, schema_version INTEGER NOT NULL, parser_version TEXT NOT NULL,
  payload_json TEXT NOT NULL, payload_sha256 TEXT NOT NULL, eligible INTEGER NOT NULL,
  contributor_fingerprint TEXT, connection_id TEXT, writer_epoch INTEGER, consent_grant_id TEXT,
  personal_save_state TEXT NOT NULL DEFAULT 'pending' CHECK (personal_save_state IN ('pending','saved','failed')),
  ack_status TEXT, receipt_id TEXT, acked_at TEXT, projection_status TEXT, blocked_reason TEXT,
  UNIQUE (local_dataset_id, source_revision));
CREATE INDEX source_journal_report ON source_journal(local_dataset_id, source_report_id, source_revision);

CREATE TABLE outbox (              -- 전달 상태만
  event_id TEXT PRIMARY KEY REFERENCES source_journal(event_id),
  state TEXT NOT NULL CHECK (state IN ('pending','in_flight','retry_wait','auth_required','blocked','dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0, next_retry_at TEXT, lease_owner TEXT, lease_until TEXT,
  last_error_code TEXT, last_request_id TEXT, enqueued_trigger TEXT NOT NULL, enqueued_at TEXT NOT NULL);
CREATE INDEX outbox_due ON outbox(state, next_retry_at);

CREATE TABLE report_latest (       -- 신고별 최신 journal 행(이벤트 결정용). rebuild 는 report_latest_staging 에 쓰고 cutover
  local_dataset_id TEXT NOT NULL, source_report_id TEXT NOT NULL, event_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL, eligible INTEGER NOT NULL, source_generation INTEGER NOT NULL,
  PRIMARY KEY (local_dataset_id, source_report_id));
CREATE TABLE report_latest_staging (run_id TEXT NOT NULL, source_report_id TEXT NOT NULL, event_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL, eligible INTEGER NOT NULL, PRIMARY KEY (run_id, source_report_id));

CREATE TABLE upload_runs (run_id TEXT PRIMARY KEY, trigger TEXT NOT NULL, schedule_key TEXT,
  contributor_fingerprint TEXT, started_at TEXT NOT NULL, finished_at TEXT,
  result TEXT CHECK (result IN ('running','no_change','success','partial','auth_required','consent_required',
                                'connection_required','offline','failed','deferred')),
  counts_json TEXT NOT NULL DEFAULT '{}', request_ids TEXT NOT NULL DEFAULT '[]', error_code TEXT);

CREATE TABLE schedule_runs (
  project_namespace TEXT NOT NULL, contributor_fingerprint TEXT NOT NULL, local_dataset_id TEXT NOT NULL,
  writer_epoch INTEGER NOT NULL, schedule_key TEXT NOT NULL, scheduled_date_kst TEXT NOT NULL, due_at_utc TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('due','running','succeeded','deferred','failed')),
  attempts INTEGER NOT NULL DEFAULT 0, last_attempt_at TEXT, finished_at TEXT, deferred_reason TEXT,
  lease_owner TEXT, lease_until TEXT, run_id TEXT,
  PRIMARY KEY (project_namespace, contributor_fingerprint, local_dataset_id, writer_epoch, schedule_key));

CREATE TABLE leases (name TEXT PRIMARY KEY, owner TEXT NOT NULL, until TEXT NOT NULL);  -- upload / rebuild / scheduler

CREATE TABLE rebuild_jobs (
  run_id TEXT PRIMARY KEY, required_version TEXT NOT NULL, local_dataset_id TEXT NOT NULL,
  source_account_namespace TEXT NOT NULL, state TEXT NOT NULL, phase TEXT, confirmed_at TEXT,
  started_at TEXT, updated_at TEXT NOT NULL, completed_at TEXT, list_complete INTEGER NOT NULL DEFAULT 0,
  counts_json TEXT NOT NULL DEFAULT '{}', backup_ref TEXT, backup_check TEXT, last_error TEXT,
  source_generation INTEGER, gaps_accepted_at TEXT);
CREATE UNIQUE INDEX rebuild_one_active ON rebuild_jobs(required_version, local_dataset_id, source_account_namespace)
  WHERE state NOT IN ('completed','completed_with_gaps','abandoned');
CREATE TABLE rebuild_items (run_id TEXT NOT NULL, source_report_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','fetched','failed_retryable','failed_permanent')),
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, event_id TEXT, PRIMARY KEY (run_id, source_report_id));
```

규칙
- capture: journal INSERT + (이벤트면) outbox INSERT + report_latest(또는 rebuild 중이면 staging) UPSERT + meta.next_revision 증가를 **한 트랜잭션**으로 commit 한 뒤 개인 DB 저장. 저장 결과로 `personal_save_state` 갱신.
- `source_revision` 은 로컬 데이터셋 단조 증가. 중앙 status 의 `last_accepted_revision` 보다 작으면 그 값+1 로 올린다.
- 전송 대상 = outbox 행 중 journal 의 (project_namespace, contributor_fingerprint, connection_id, consent_grant_id) 가 현재 `context` 와 같은 것. 다르면 `blocked:context_mismatch`.
- 삭제: outbox 는 durable ACK 때 삭제. journal 은 신고별 최신 행 + 미ACK 전부 보존, 나머지 ACK 행은 90일 뒤 정리. 파일 200MB 초과 시 경고(자동 삭제 안 함).
- `rotate_dataset(reason)`: 개인 DB 교체(복원·가져오기·모드 전환·공식 계정 변경) 성공 뒤 호출 → 새 local_dataset_id, 이전 id 를 dataset_history 에. 이전 journal/outbox 삭제 안 함.
- `project_namespace` 가 바뀌면 이전 namespace 행은 `blocked:namespace_changed`(E05).
