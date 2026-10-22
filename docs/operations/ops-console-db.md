# 운영 콘솔 DB 준비 (2026-10-22)

콘솔 앱은 비공개 레포 `Fentanest/safetyreport-ops-console` 에 있다. DB 쪽(역할·함수·표)은 지도 migration
`202610220200_backfill_resume_ops.sql` 이 만든다. 함수 목록과 인자: `docs/implementation/backfill-resume-20261022/OPS-DB-API.md`.

## 1. 콘솔 로그인 역할 켜기 (206, 한 번)
migration 은 `community_ops`(NOLOGIN, `ops` 스키마 함수 실행 권한만)와 그 구성원 `community_ops_login`(아직 NOLOGIN, 비밀번호 없음)을 만든다.
운영자가 206 에서 비밀번호를 정해 로그인을 켠다. 비밀번호는 저장소·채팅·로그에 남기지 않고, 콘솔 컨테이너 `.env`(0600)의 DSN 에만 둔다.

```sql
alter role community_ops_login login password '<운영자가 정한 비밀번호>';
alter role community_ops_login set statement_timeout = '15s';
```

`community_ops_login` 은 표를 직접 읽거나 쓸 수 없고 `private` 스키마에도 들어갈 수 없다. 할 수 있는 것은 `ops.*` 함수 실행뿐이다.

## 2. 첫 관리자 등록 (사용자 ID 는 저장소에 넣지 않는다)
관리자가 콘솔에서 카카오로 한 번 로그인한 뒤(로그인은 되지만 403), 206 에서 그 사용자 ID 를 확인해 한 줄로 넣는다.

```sql
insert into private.ops_admins(user_id, memo) values ('<auth.users.id>', '운영자 이름이나 메모');
```

빼기: `delete from private.ops_admins where user_id = '<auth.users.id>';`. 관리자 추가·삭제는 콘솔에서 하지 않는다.

## 3. 비상 SQL
콘솔이 죽었을 때 점검 중지·재개, 필수 버전 해제: `docs/operations/emergency.sql`.

## 4. 기록
- 설정 변경: `private.community_ingest_config_audit`(누가·언제·무엇을, 이전 값 → 새 값). 콘솔 함수는 `ops:<메모>`, 직접 SQL 은 `sql:<DB 역할>`.
- 공지 변경: `private.app_announcements_audit`.
- 업로드 거절 수: `private.community_ingest_rejections`(분 단위, 7일 보관). 진행 보고 기록: `private.community_progress_history`(30일, 연결당 200건).
  하루 한 번 `private.prune_backfill_resume_history()`(pg_cron `community-progress-history-prune`, 03:41 KST)가 정리한다.
