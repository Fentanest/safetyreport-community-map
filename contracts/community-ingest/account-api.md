# community-account API v1 (auth 레포 구현, 사용자 전용)

`POST {COMMUNITY_SUPABASE_URL}/functions/v1/community-account/{action}`
헤더: `apikey: <publishable key>`, `Authorization: Bearer <사용자 access token>`, `Content-Type: application/json`.
함수는 `verify_jwt = true` 이고 handler 가 다시 `auth.getUser(jwt)` + claims(`role=authenticated`, `aud=authenticated`, `iss`, `session_id`, `is_anonymous=false`)를 확인한다.
본문은 `{"protocol":1, ...}`, 모르는 필드 거부, 8KB 이하. 응답 `Cache-Control: no-store`. 한도: 사용자별 분당 30 요청.
오류: `{"error":{"code","message","requestTraceId","retryable","retryAfterSeconds?"}}`.

| action | 본문(protocol 외) | 성공 응답(protocol 외) | 주요 오류 |
|---|---|---|---|
| `status` | `connection_id?` | 아래 status | `auth_required`(401) |
| `consent` | `policy_version`, `consent_text_sha256`, `via`(`safetyreport_server`/`mobile_standalone`/`mobile_client`), `accepted: true` | `grant_id`, `policy_version`, `granted_at`, `created` | `kakao_required`(403), `policy_mismatch`(409 + `required_version`), `contributor_suspended`(403) |
| `consent-revoke` | `grant_id` | `grant_id`, `revoked:true` | `not_found`(404) |
| `connections` | `source_app`, `source_mode`, `platform`, `device_label`(1~40, relay 규칙), `dataset_key`(64hex), `connection_secret`(base64url 32바이트 — 서버는 sha256 만 저장), `takeover`(bool) | `connection_id`, `writer_epoch`, `superseded_previous` | `kakao_required`, `writer_conflict`(409 + `active_writer:{device_label, platform, source_app, created_at}`), `invalid_request` |
| `connections-rebind` | `connection_id`, `connection_secret` | `connection_id`, `writer_epoch`, `last_accepted_revision` | `not_found`(404, 타인·없음 구분 안 함), `connection_revoked`/`connection_superseded`/`connection_suspended`(409) |
| `connections-revoke` | `connection_id` | `connection_id`, `status:"revoked"` | `not_found` |
| `contributions-delete` | `confirm: "DELETE_MY_SHARED_REPORTS"` | `deleted_facts`, `deleted_at` | `kakao_required` |

status 응답:
```json
{"protocol":1,
 "gate":{"kakao":true,"consent":true,"can_enter":true,"reasons":[]},
 "policy":{"required_version":"2026-09-26.1","consent_text_sha256":"…"},
 "consent":{"state":"active|none|revoked|outdated","grant_id":"…|null","policy_version":"…|null","granted_at":"…|null"},
 "contributor":{"status":"active|suspended|deletion_pending|none"},
 "connection":null | {"status":"active|superseded|revoked|suspended","writer_epoch":5,"bound_to_current_session":true,
                      "last_accepted_revision":120,"source_app":"safetyreport","source_mode":"server","dataset_key":"…"},
 "projection":{"ready":false},
 "account":{"fingerprint":"<32hex>","display_name":"…|null"},
 "server_time":"2026-09-26T03:00:00.000Z"}
```
- reasons 값: `user_not_eligible`, `kakao_missing`, `session_missing`, `consent_none`, `consent_revoked`, `consent_outdated`, `contributor_suspended`.
- `fingerprint = sha256("sr-community-account|v1|" + user_id)` 앞 32 hex. user UUID·이메일·토큰은 반환하지 않는다. `display_name` 은 표시용(권한 근거 아님).
- `connection` 은 요청한 connection_id 가 **이 사용자 것**일 때만 채운다(타인 것이면 null — 존재를 드러내지 않음).

동의 규칙: 카카오 로그인은 동의가 아니다. 앱은 동의 체크(기본 해제) + 계속 버튼으로만 `consent` 를 호출하고, 성공 응답을 받은 뒤에만 완료로 표시한다.
같은 활성 grant·같은 정책이면 멱등(`created:false`). 철회 뒤 재동의는 새 grant(이전 grant 로 수락된 fact 는 공개되지 않음, `reshare` 필요).

연결 규칙: 연결 비밀(`connection_secret`)은 기기에서 만들고 기기 보호 저장소에만 둔다(PC `data/auth` 암호화 저장소, 모바일 secure storage). 같은 사용자 재로그인 = `connections-rebind`(epoch 유지 → 대기 이벤트 계속 전송).
다른 사용자로 로그인하면 rebind 가 `not_found` → 새 사용자로 `connections` 등록, 이전 사용자 대기 이벤트는 보존·전송 금지.
`dataset_key = sha256("safetyreport-dataset|v1|" + 공식 로그인 ID 소문자·앞뒤 공백 제거)` — 클라이언트 주장값(증명 아님), writer 충돌 제어와 fact 네임스페이스용.
