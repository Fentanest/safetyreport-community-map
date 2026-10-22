# 클라이언트 규칙 (PC 3.6.2 · 모바일 2.5.1, 2026-10-22)

B(모바일 핵심)·C(PC 핵심)·D(모바일 주변)·E(PC 주변)는 **이 문서만 보고** 같은 동작을 만든다. PC·모바일은 같은 규칙, 호출 지점 1:1
(PC `services/community_raw_backfill.py`·`community_raw_backfill_runtime.py` ↔ 모바일 `lib/community/raw_backfill.dart`·`raw_backfill_runtime.dart`).
서버 계약: 지도 `contracts/community-ingest-v2/`(progress·client-requirement·version-vectors·errors·account-api), `contracts/app-announcements/`.
작업지시서: `docs/tasks/backfill-resume-20261022.md`. 이 문서와 지시서가 다르면 이 문서를 따르고 보고서에 적는다(A 가 서버에 맞춘 결정).

용어: **run** = 1회 전송 한 번(`meta.raw_backfill` marker), **항목** = run 안의 신고 하나(`pending`·`queued`·`stored`·`hold`·`raw_unavailable`·`not_eligible`).
시각은 모두 UTC epoch 초(marker 안) 또는 ISO `Z`(서버로 보내는 값).

---

## 1. 오류 분류 (2-2)

1회 전송의 채우기(상세 수집·보조 값·이벤트 만들기)와 업로드 확인에서 나는 오류를 **일시적**과 **고정적**으로 나눈다.
공식 사이트 로그인 문제(`official_login_required`·`official_login_retry`)는 지금 규칙 그대로(이 표 밖) — 신고별 횟수에 넣지 않는다.

| 구분 | 무엇 | PC 예 (Python) | 모바일 예 (Dart) |
|---|---|---|---|
| 일시적 | 네트워크 끊김·DNS·TLS | `requests.ConnectionError`, `urllib3.exceptions.*`, `ConnectionResetError`, `OSError`(errno 네트워크) | `SocketException`, `HandshakeException`, `http.ClientException` |
| 일시적 | 시간 초과 | `requests.Timeout`, `socket.timeout`, `TimeoutError` | `TimeoutException` |
| 일시적 | 공식 사이트 5xx·429 | 상세 API HTTP 500~599·429 (`db_optimize._fetch_envelope` 의 `outcome=='retryable'`, `RuntimeError('detail_retry')`) | 같은 응답(`DbOptimize.classifyFetchError` 가 `'retryable'`) |
| 일시적 | `result` 없는 응답 | 상세 응답에 `result` 객체가 없음(`detail_retry`) | 같음 |
| 일시적 | 다른 작업이 잠금을 잡음 | 업로드·크롤 lease 대기, `sync_busy` | `BackfillPaused('sync_busy')` |
| 일시적 | 로컬 DB 잠김 | `sqlite3.OperationalError: database is locked`, SQLAlchemy `OperationalError`(locked/busy) | `DatabaseException`(`isDatabaseLockedError()`·"database is locked") |
| 일시적 | 커뮤니티 서버 503 `maintenance` | 업로더·진행 보고가 받은 503 maintenance (5절) | 같음 |
| 일시적 | 커뮤니티 서버 5xx·429·`busy`·`service_unavailable` | 업로더 응답 | 같음 |
| 고정적 | 파서 예외(같은 입력이면 같은 결과) | `_parse_result` 가 None(`RuntimeError('parse_retry')`), 파서의 `KeyError`·`ValueError`·`TypeError`·`IndexError` | 파서의 `FormatException`·`TypeError`·`RangeError`·`StateError` |
| 고정적 | 저장·이벤트 만들기 실패(잠김 아님) | `detail_save_retry`, `missing_report`, `raw_event_not_created` | `StateError('missing_report')`, `StateError('raw_event_not_created')` |
| 고정적 | **분류 못 한 예외** | 그 밖 전부 | 그 밖 전부 |

- 분류 함수는 PC·모바일 각각 하나(`classify_backfill_error(exc) -> 'transient'|'fixed'`)로 두고, 위 표를 시험 벡터로 고정한다.
- 404/410(원본 없음)은 지금처럼 `raw_unavailable`(오류 아님). `BackfillBlocked` 는 지금처럼 `not_eligible`(오류 아님).

### 일시적 오류 → run `paused` (신고 횟수 안 셈)
- 그 신고의 `attempts` 를 올리지 않고 커서도 그대로 둔다. run 을 `state='paused'`, `reason=<사유 코드>`, `next_attempt_at=now+간격` 으로 둔다.
- 간격: 연속 일시적 오류 횟수 `transient_failures` 1회 **60초** → 2회 **300초** → 3회 **900초** → 4회 이상 **3600초**(최대 1시간).
  정상 처리(한 건이라도 진행)되면 `transient_failures=0`.
- 503 `maintenance` 는 간격 대신 **재개 시각**(5절): `next_attempt_at = resume_at + 지터`, 재개 시각이 없으면 `next_attempt_at=0` 이 아니라
  "status 가 재개를 알릴 때까지" — `reason='maintenance'` 이고 타이머를 걸지 않는다.
- 사유 코드(`reason`, 진행 보고와 같다): `network`, `timeout`, `server_5xx`, `rate_limited`, `no_result`, `sync_busy`, `db_locked`, `maintenance`,
  `list_failed`, `list_incomplete`, `consecutive_failures`, `official_login_required`, `official_login_retry`.
- 시험(지시서 3절): 일시적 오류를 40초 동안 계속 내도 보류 0, run 은 `paused`.

### 고정적 오류 → 신고별 3회 → `hold`
- 지금처럼 신고별 `attempts += 1`, 3회면 `state='hold'`. 연속 고정적 오류 5회면 지금처럼 run `paused`(`consecutive_failures`, 간격은 위 일시적 표).
- `hold` 에 새 필드: `hold_count`(몇 번째 보류인가, 1부터), `next_attempt_at`(epoch 초), `first_held_at`(처음 보류된 때), `stale`(bool).
  `hold_count`: 1 → **15분**, 2 → **1시간**, 3 → **6시간**, 4 이상 → **24시간**(이후 24시간 고정).
- **자동 재시도**: 채우기 slice 를 시작할 때 `state='hold' and next_attempt_at <= now` 인 항목을 `pending`, `attempts=2`(한 번 더 실패하면 다시 보류)로 되돌린다.
  다시 보류되면 `hold_count += 1`.
- **'다시 시도' 버튼**(그대로 둔다): 시각과 관계없이 모든 보류를 `pending`, `attempts=0`, `hold_count=0`, `stale=false` 로 즉시 되돌리고 run 을 깨운다.
- **30일 상한**: `now - first_held_at > 30일` 이면 `stale=true` 만 표시한다. 지우지 않고 하루 1번(24시간) 계속 시도한다. 진행 보고 `stale_holds` 에 센다.

### 업로드 확인 (`receipt`)
| 업로드 확인 결과 | 지금 | 바뀐 뒤 |
|---|---|---|
| `stored` | `stored` | 같음 |
| `retry` 3회 | `not_eligible` + `upload_rejected`(영구 제외) | **`hold`**(`error='upload_retry'`, 위 보류 간격) |
| `blocked`(outbox `blocked`·`dead_letter`, 서버가 재시도 불가로 거절) | `not_eligible` | 같음(`not_eligible` + `upload_rejected`) |
| `rebind` | `pending`, attempts 0 | 같음 |
| 아직 ACK 대기 | 그대로 | 같음 |

### 보류만 남은 run
- run 상태는 지금처럼 `holds`. 다음 깨울 시각 = 보류 항목 `next_attempt_at` 의 최솟값.
  모바일 `nextDelay`: `holds` 일 때 null 대신 `max(15초, 최소 next_attempt_at - now)`(상한 24시간; WorkManager 는 그 시각에 맞춘 1회 작업).
  PC: 스케줄러에 같은 시각 1회 작업을 건다.

## 2. 이미 멈춘 기기 풀기 (2-3)

새 버전 **첫 실행에 한 번**. 끝나면 `community.db` 의 `meta` 에 `raw_backfill_unstick = "2026-10-22.1"` 을 쓴다(값이 있으면 다시 하지 않는다).
한 트랜잭션: 지금 run(`meta.raw_backfill.run_id`)의 항목과 marker 를 함께 바꾼다. run 이 없으면 표시만 쓰고 끝낸다.

| 지금 상태 | 바꾼 뒤 |
|---|---|
| 항목 `hold` | `pending`, `attempts=0`, `hold_count=0`, `stale=false`, `next_attempt_at` 없음 |
| 항목 `not_eligible` + `error='upload_rejected'` | `pending`, `attempts=0`, `eligible=true`, `error` 지움 |
| 항목 `not_eligible`(그 밖 사유: 삭제·답변 전·`not_eligible`·`agency_code_too_long`) | 그대로 |
| 항목 `stored`·`queued`·`raw_unavailable`·`pending` | 그대로 |
| marker `paused` + 로그인 아님 | `next_attempt_at=0`, `transient_failures=0`, `failures=0` |
| marker `paused` + `official_login_required` 이고 수동 표시(`login_fp`/영구 멈춤) | **그대로**(사용자 로그인이 필요) |
| marker `done` + 위에서 되돌린 항목 ≥ 1 | `state='filling'`, `phase='filling'`, `cursor=0` |
| marker `done` + 되돌린 항목 0 | `done` 그대로 |
| marker `holds` + 되돌린 항목 ≥ 1 | `state='filling'`, `phase='filling'`, `cursor=0` |
| marker `waiting_optimize`·`listing`·`filling`·`uploading` | 그대로(되돌린 항목은 다음 slice 가 처리) |

시험: 위 조합 marker 를 만들어 이행 → 기대 상태, 두 번째 실행에서 다시 안 바뀜.

## 3. 업로더 자주 깨우기 (2-4)

채우기 slice 가 끝날 때 **그 slice 에서 새로 `queued` 된 항목이 1개 이상**이면 업로더를 한 번 깨운다
(PC `community_uploader.wake()`, 모바일 `wakeUploadNow('raw_backfill')`). 업로드 확인 단계 끝의 기존 깨우기는 그대로.
업로더의 묶음·한도·쿨다운 규칙은 바꾸지 않는다. 중지(5절)·필수 버전 잠금(6절) 중에는 깨우지 않는다.

## 4. 진행 보고 (2-1)와 설정 단계 보고 (2-7)

### 4-1. 진행 보고 `POST {SUPABASE_URL}/functions/v1/community-ingest/progress`
- 헤더: `apikey: <publishable key>`, `Authorization: Bearer <카카오 사용자 access token>`, `Content-Type: application/json`. **gzip 금지**, 본문 4KiB 이하.
- 인증·연결: 업로드와 같다(그 연결을 등록한 세션의 토큰 + `connection_id`). 연결이 없으면 보내지 않는다(4-2 가 맡는다).
- 본문: `contracts/community-ingest-v2/progress.schema.json`. 개수와 상태 코드만.

```json
{"protocol":1,"contract":"community-progress-v1","connection_id":"<연결 UUID>","source_app":"safetyreport-mobile","platform":"android",
 "client_version":"2.5.1","parser_version":"mobile-parser-13",
 "backfill":{"state":"paused","phase":"filling","reason":"network","next_attempt_at":"2026-10-22T03:15:00Z",
   "total":1861,"stored":1200,"queued":40,"pending":610,"holds":11,"stale_holds":0,"raw_unavailable":2,"not_eligible":0,
   "run_started_at":"2026-10-22T01:00:00Z","updated_at":"2026-10-22T03:10:00Z"},
 "optimize":{"required":false,"running":false,"holds_only":false},
 "official_login":"ok",
 "pace":{"foreground_slices_today":12,"background_runs_today":3}}
```

| 필드 | 채우는 법 |
|---|---|
| `backfill.state` | marker `state` 그대로(`waiting_optimize`·`listing`·`filling`·`uploading`·`paused`·`holds`·`done`). run 이 없으면 `none`(다른 값 모두 null) |
| `phase` | marker `phase` 또는 null. `reason` 은 1절 사유 코드 또는 null. `next_attempt_at` 은 marker 값(ISO Z) 또는 null |
| 개수 | `total`=run 항목 수, `stored`, `queued`, `pending`, `holds`, `stale_holds`(stale 보류), `raw_unavailable`, `not_eligible`. 모르면 null |
| `run_started_at`·`updated_at` | run 시작 시각, marker 마지막 갱신 시각(ISO Z) |
| `optimize` | `required`=현재 파서 세대 DB 최적화가 아직 done 아님, `running`=지금 돌고 있음, `holds_only`=최적화가 보류만 남김 |
| `official_login` | `ok` / `retry`(일시 실패로 기다리는 중) / `manual_required`(사용자가 로그인해야 함) |
| `pace` | **모바일만**(PC 는 null): 오늘(기기 KST 날짜) 포그라운드 채우기 slice 수, 백그라운드(WorkManager) 실행 수. 0시에 0으로 |

- **보내는 때**: ① 앱 시작(PC 서버 기동)·게이트 통과 뒤 1회 ② 상태가 바뀔 때 — `(state, phase, reason, official_login, optimize.*)` 중 하나가 바뀜
  (개수만 바뀐 것은 아님) ③ 진행 중(`listing`·`filling`·`uploading`·`paused`·`waiting_optimize`·`holds`)이면 마지막 전송 뒤 **모바일 10분, PC 15분**마다
  ④ `done` 이 된 뒤에는 **하루 1번**만(마지막 전송 날짜가 오늘이면 보내지 않음).
  marker 가 바뀔 때마다 보내지 않는다. 같은 연결에 **60초 안에 두 번 보내지 않는다**(서버가 429).
- 모바일 백그라운드 isolate 에서도 같은 규칙으로 보낸다(마지막 전송 시각·내용 요약은 공용 저장소에 둬 포그라운드와 공유).
- **실패는 조용히 넘기고 재시도하지 않는다**(다음 주기에 보냄). 429·5xx·네트워크·401·403 모두 같다. 503 `maintenance` 를 받으면 5절 중지 처리로 들어간다.
- 중지(5절)·필수 버전 잠금(6절) 중에는 보내지 않는다. 동의가 outdated 여도 보낸다(서버가 받는다).
- 응답: `200 {"protocol":1,"stored":true,"request_id":"ing_…"}`.

### 4-2. 설정 단계 보고 `POST {SUPABASE_URL}/functions/v1/community-account/setup-progress`
- 헤더: community-account 와 같다(`apikey`, `Authorization: Bearer <카카오 사용자 토큰>`, `Content-Type`, 그리고 6-3 의 버전 헤더). 본문 2KB 이하.
```json
{"protocol":1,"client_version":"2.5.1","source_app":"safetyreport-mobile","platform":"android","mode":"standalone",
 "stage":"official_login_failed","reason":"captcha_required","client":null}
```
- `mode`: 모바일 `standalone`·`client`·`demo`·`unselected`(모드 미선택), PC 는 항상 `server`.
- `stage` 순서: `kakao_ok`(카카오 로그인 끝) → `consent_ok`(동의 성공 응답) → `official_login_started` → `official_login_failed`(+`reason`) /
  `official_login_ok` → `connection_registered`(`connections` 성공). Client 모드는 `kakao_ok` 뒤에 `consent_ok` 대신 **`client_server_checked`**.
- `reason`: 앱이 이미 쓰는 실패 코드를 `^[a-z0-9_]{1,40}$` 로(예 `invalid_credentials`, `captcha_required`, `network`, `server_response_invalid`, `locked`). 성공 단계는 null.
- `client`(Client 모드의 `client_server_checked` 만, 그 밖에는 null): 정확히 6키.
  `{"server_reachable":true,"server_version":"3.6.2","server_community_supported":true,"server_logged_in":false,"server_consent_active":null,"account_match":null}`
  - `server_reachable`: 서버 게이트 응답을 받았는가. 못 받았으면 false 이고 나머지는 null.
  - `server_community_supported`: 서버가 커뮤니티를 지원·설정했는가(503 `community_disabled`·`community_unconfigured` 면 false, 3.0 미만이면 false).
  - `server_logged_in`: 서버가 카카오 로그인돼 있는가(온보딩 필요 거절이면 false). `server_consent_active`: 서버의 동의가 active 인가.
  - `account_match`: 계정 지문 비교 결과 **true/false, 모르면 null**(지문·이름 자체는 보내지 않는다).
- **보내는 때**: 단계(또는 `reason`·`mode`·`client` 내용)가 마지막으로 보낸 것과 다를 때만. 같은 단계 반복 전송 금지(마지막 보낸 내용을 저장).
  `connection_registered` 를 보낸 뒤에는 보내지 않는다(4-1 이 이어받는다). Client 는 게이트 판정 때 `client` 내용이 바뀌었으면 보낸다.
  60초 안에 두 번째는 서버가 429 — 그 단계는 다음 변화 때 다시 보낸다. 실패는 조용히 넘긴다(재시도 없음).
- PC: 카카오 로그인 뒤 공식 로그인·연결 등록 전 단계를 같은 경로로 보낸다(`source_app='safetyreport'`, `mode='server'`).
- 공식 사이트 ID·비밀번호·서버 주소·API 키·기기 식별자는 **절대 넣지 않는다**(서버가 모르는 키를 거부한다).

## 5. 업로드 일시 중지 (2-9)

서버가 본체다: 중지 중이면 업로드(v1·v2)·manifest·진행 보고가 모두 DB 쓰기 전에 503 `maintenance` 로 끝난다. 새 앱은 미리 알고 덜 두드린다.

### 받는 곳 두 가지
1. **status**(`community-account/status`): `ingest.paused`(서버가 "재개 시각 전인가"까지 판정한 값), `ingest.pause_message`, `ingest.resume_at`.
2. **503 응답**(업로드·manifest·진행 보고):
```json
HTTP/1.1 503   Retry-After: 5400
{"error":{"code":"maintenance","message":"Uploads are paused for server maintenance. They resume automatically.","request_id":"ing_…",
  "retryable":true,"retry_after_seconds":5400,"resume_at":"2026-10-22T06:30:00.000Z","pause_message":"서버 저장 공간을 늘리는 중입니다."}}
```
   `resume_at` 이 null 이면 `Retry-After: 600`(재개 시각 없음).

### 저장
`upload_pause = {paused:true, resume_at:<epoch 초 또는 null>, message:<문자열|null>, source:'status'|'503', saved_at}` 을
PC `community.db meta`, 모바일 공용 저장소(백그라운드 isolate 도 읽는 곳)에 둔다. 앱 재시작·백그라운드에서도 지킨다.

### 중지 동안
- 업로더·1회 전송·진행 보고를 멈춘다. **업로드 시도를 하지 않는다**(주기 재시도 금지). 1회 전송 run 은 `paused`, `reason='maintenance'`(1절, 신고 횟수 안 셈).
  로컬 기능(수집·조회)은 그대로.
- 재개 시각이 있으면 **그 시각 + 무작위 0~120초**에 한 번만 깨워 status 를 확인하고, `paused=false` 면 저장을 지우고 업로더·1회 전송을 깨운다.
  모바일 백그라운드는 그 시각에 맞춘 1회 WorkManager 작업(초기 지연 = 남은 시간 + 지터)을 예약한다. PC 는 스케줄러 1회 작업.
  깨워 본 status 가 아직 `paused=true`(연장)면 새 `resume_at` 으로 다시 예약한다.
- 재개 시각이 없으면 타이머를 걸지 않는다. **평소 주기의 status 확인**(게이트 갱신, 모바일 포그라운드·약 5분, PC 60초 poll)에서 `paused=false` 를 볼 때까지 기다린다.
- 재개 시각 전이라도 평소 status 에서 `paused=false` 나 새 `resume_at` 을 받으면 그대로 따른다(운영자가 일찍 올리거나 연장). 점검 때문에 status 를 더 자주 부르지 않는다.
- status 에 `ingest.paused` **키가 없으면**(서버가 설정을 읽지 못함) 저장된 판정을 그대로 둔다. 키가 있으면 그 값이 정본이다.
- 503 `maintenance` 를 받은 행은 지금처럼 `retry_wait` 로 두되 다음 시도 = 재개 시각(+지터). attempt 를 올리지 않는다.

### 안내 문구 (앱 상단 배너, 2-13)
- 재개 시각 있음: **"서버 점검 중입니다. 신고 업로드를 잠시 멈췄고, 오후 3시 30분에 자동으로 다시 올립니다."**
  (시각은 기기 시간대 KST "오전/오후 h시 m분", 날짜가 오늘이 아니면 "10월 23일 오전 9시").
- 재개 시각 없음: **"서버 점검 중입니다. 신고 업로드를 잠시 멈췄고, 점검이 끝나면 자동으로 다시 올립니다."**
- `pause_message` 가 있으면 다음 줄에 평문으로(HTML 해석 금지).

## 6. 필수 버전과 앱 잠금 (2-10)

### 6-1. 판정 입력 — status 의 최상위 `client_requirement`
```json
"client_requirement":{"min_version":{"pc":"3.6.2","mobile":"2.5.1"},
  "url":{"pc":"https://github.com/Fentanest/safetyreport/releases/latest","mobile":"https://play.google.com/store/apps/details?id=com.fentanest.mysafetyreport"},
  "message":null,"enforce_from":"2026-11-01T00:00:00.000Z"}
```
- 서버는 **적용 중일 때만** 객체를 준다(`enforce_from` 전이면 null). 앱은 `enforce_from` 을 다시 비교하지 않는다(기기 시계 문제 방지).
- 버전 비교: `contracts/community-ingest-v2/version-vectors.json`(`[v]N[.N[.N[.N]]][+build]`, 빠진 자리 0, 그 밖은 해석 불가). 벡터를 시험으로 돌린다.
  내 버전: 모바일 `PackageInfo.version`(빌드 번호 제외), PC `VERSION` 파일.

### 6-2. 잠금 판정 (먹통 방지가 먼저)
| status 결과 | 판정 |
|---|---|
| 정상 응답(200, 형식 맞음) + `client_requirement` 객체 + 내 플랫폼 `min_version` 이 문자열 + `cmp(내 버전, min) == -1` | **잠금** `update_required` |
| 정상 응답 + `client_requirement: null` | **즉시 해제** |
| 정상 응답 + 내 플랫폼 `min_version` 이 null | 해제(요구 없음) |
| 정상 응답 + `cmp` 가 0·1 | 해제 |
| 정상 응답인데 `client_requirement` **키 없음** | 마지막 판정 유지 |
| 내 버전 또는 요구 버전 해석 불가(`cmp == null`) | 마지막 판정 유지(새로 잠그지 않음) |
| 시간 초과·네트워크 오류·5xx·429·형식 이상(JSON 아님, 객체 모양 틀림) | **절대 잠그지 않음**, 마지막 판정 유지 |
| 업로드가 426 `client_upgrade_required` | 잠그지 않는다. 지금처럼 그 행은 `retry_wait`(1시간)·업데이트 안내만 |

- 판정(`locked`, `min_version`, `url`, `message`, `decided_at`)을 저장해 재시작해도 유지한다. 잠금 해제도 정상 응답에서만.
- 잠금 중: 전체 화면 잠금(로컬 자료는 지우지 않음), 업로드·크롤·1회 전송·진행 보고 정지. status 확인은 평소 주기대로 계속(해제를 보려고).
- 업데이트 버튼: 모바일은 Play In-App Updates **즉시 업데이트**를 먼저, 안 되면 `url.mobile`(없으면 Play 스토어 주소). GitHub APK 설치본은
  `https://github.com/Fentanest/safetyreport-mobile/releases/latest`. PC 는 `url.pc`(없으면 `https://github.com/Fentanest/safetyreport/releases/latest`).
- Client 모드: 휴대폰은 자기(`mobile`) 요구로만 잠근다. 붙은 PC 가 잠겨 있으면 PC 게이트가 Client API 에 기존 `SERVER_UPGRADE_REQUIRED` 409 를 주므로
  휴대폰은 "서버 프로그램 업데이트가 필요합니다" 안내를 보인다(휴대폰 잠금 아님).
- PC 잠금 중 Client API 응답: 기존 `SERVER_UPGRADE_REQUIRED` 409 형식 그대로.
- 문구(2-13): 제목 **"앱을 업데이트해 주세요"**, 본문 **"이 버전은 더 이상 신고를 공유할 수 없습니다. 최신 버전으로 업데이트하면 이어서 쓸 수 있습니다.
  기기에 있는 신고 자료는 그대로 남아 있습니다."**, 필요 버전 줄 **"필요한 버전: 2.5.1 이상"**, 서버 `message` 가 있으면 그 아래 평문, 버튼 **"업데이트"**.

### 6-3. 버전 헤더 (서버 기록용)
새 앱은 `community-account` 의 **모든 요청**에 붙인다. 진행 보고·업로드에는 붙이지 않는다(본문에 버전이 있다).

| 헤더 | 값 |
|---|---|
| `X-Client-Version` | 내 버전(`2.5.1`, `3.6.2`) — `^[0-9][0-9A-Za-z.+_-]{0,39}$` |
| `X-Client-App` | `mobile/android`, `mobile/ios`, `pc/windows`, `pc/linux`, `pc/macos`, `pc/docker` |

지도 웹은 "최근 30일 안에 요구 버전 이상으로 확인된 앱"이 있어야 열리므로, **업데이트 뒤 앱을 처음 열 때 status 한 번**이면 기록된다.

## 7. 첫 실행 모드·Client 계정 일치 (2-5, 모바일. PC 는 문서만)

- 첫 실행(prefs `appMode` 비어 있음)에서 게이트·온보딩은 **화면에서 고른 모드**(`SetupScreen` 의 `_initialModeChoice`)를 쓴다.
  모드를 고르기 전에는 동의 단계로 가지 않는다(설정 단계 보고 `mode='unselected'`). Standalone 을 고르면 동의 `via='mobile_standalone'`,
  Client 를 고르면 `via='mobile_client'`. 이미 잘못 붙은 grant 는 바꾸지 않는다.
- Client 계정 판정(서버 `GET /api/v1/community/gate` 의 `account.fingerprint` ↔ 휴대폰 status 의 `account.fingerprint`):

| 경우 | 판정 |
|---|---|
| 둘 다 32자리 16진이고 같음 | 통과(잠금 중이었으면 해제) |
| 둘 다 32자리 16진이고 **다름** | `client_account_mismatch` 잠금: 동의·철회 버튼 숨김, "로그아웃 후 다시 로그인" 버튼(휴대폰 세션만 지움) |
| 서버에 닿지 못함·시간 초과·5xx·형식 이상·`account` 키 없음·지문 빈 값/형식 틀림 | **새로 잠그지 않음**(지금 규칙). 이미 잠겨 있으면 그대로(해제는 아래 두 경우만) |
| 서버 계정 정보가 사라짐(정상 응답에서 `account` 가 null — 서버 카카오 로그아웃 등) | 해제 |
| 서버 "온보딩 필요"로 거절 | 지금처럼 잠금 + "서버의 커뮤니티 계정" 카드로 가는 버튼 |
| 서버 503 `community_disabled`·`community_unconfigured` | 잠그지 않고 안내만 |

- 잠금 문구: **"서버에 연결된 카카오 계정(서버 표시 이름)으로 다시 로그인해 주세요."** 버튼 **"로그아웃 후 다시 로그인"**.
  미설정 서버: **"서버 관리자가 커뮤니티 설정을 마쳐야 공유됩니다."**
- 판정 함수는 `serverAccountMismatch` 하나를 쓴다(`ClientAccountMismatchNotice` 카드는 잠금 화면으로 대체).

## 8. 사용자 조치 알림 (2-8)

| 사유 코드 | 언제 | 누르면 | 모바일 알림 문구 | 앱·PC 웹 상단 안내 |
|---|---|---|---|---|
| `official_login_required` | 1회 전송 `paused` + `official_login_required` + 수동 표시 | 공식 로그인 화면 | "안전신문고 로그인이 필요합니다. 앱에서 다시 로그인해 주세요." | 같은 문장 + [로그인] |
| `optimize_blocked_background` | DB 최적화 대기(`waiting_optimize`)가 백그라운드에서 막힘(모바일 백그라운드는 최적화를 시작하지 않음) | 업로드 화면 | "신고 공유를 이어 가려면 앱을 한 번 열어 주세요." | "앱을 열어 두면 신고 정리를 마치고 공유를 이어 갑니다." |
| `stale_holds` | `stale` 보류가 1건 이상 | 업로드 화면 | "30일 넘게 올리지 못한 신고가 N건 있습니다. 앱에서 확인해 주세요." | 같은 문장 + [다시 시도] |
| `update_required` | 6절 잠금 | 잠금 화면 | "앱을 업데이트해 주세요. 업데이트하면 신고 공유를 이어 갑니다." | (잠금 화면) |

- 같은 사유는 **하루 1번**(기기 KST 날짜 기준, 사유별 마지막 알림 날짜 저장). 진행 보고의 `reason` 과 같은 코드를 쓴다.
- 모바일: 앱에 이미 있는 알림 채널·권한 흐름을 쓴다. Android 13+ 알림 권한이 없으면 앱 안 안내만.
- PC: 웹 화면 상단 안내만(Docker 포함, 시스템 알림 없음).
- 점검(`maintenance`)은 사용자가 할 일이 없으므로 알림을 보내지 않고 배너만(5절).

## 9. 앱 공지 (2-11)

### 요청
`GET {SUPABASE_URL}/functions/v1/app-announcements?app=mobile&mode=client&platform=android&version=2.5.1`, 헤더 `apikey` 만(카카오 로그인 불필요).
`mode`: 모바일 `standalone`·`client`·`demo`, PC `server`. 쿼리는 4개 정확히.

### 응답
```json
{"protocol":1,"announcements":[{"id":"2026-10-client-to-standalone","title":"Client 모드가 곧 없어집니다",
  "body":"PC 프로그램 배포를 마치면 Client 모드도 함께 없어집니다.\n지금 미리 Standalone 모드로 바꿔 두세요.",
  "primary_action":{"label":"지금 바꾸기","app_action":"open_mode_switch"},"snooze_days":7,
  "starts_at":"2026-10-23T00:00:00.000Z","ends_at":null,"priority":10}],"server_time":"2026-10-23T01:00:00.000Z"}
```
스키마: `contracts/app-announcements/response.schema.json`. 최대 3개, 우선순위 순서.

### 동작
- 가져오는 때: 모바일 앱 시작(메인 화면 진입), PC 관리자 로그인 직후. 그 뒤 **6시간에 한 번**. 실패(네트워크·4xx·5xx·형식 이상)면 아무것도 띄우지 않고
  다음 때를 기다린다(잠금·재시도 반복 없음, 다른 기능에 영향 없음). 응답의 각 항목은 앱도 스키마로 다시 검사하고 틀린 항목은 버린다.
- 팝업: 한 번에 하나, 닫으면 다음 것. 숨김 판정은 공지 `id` 별.
- 버튼: `primary_action`(있고 허용될 때만), "일주일 동안 보지 않기"(`snooze_days` 7) / "N일 동안 보지 않기"(그 밖, 0 이면 버튼 없음), "닫기".
- **보지 않기**: `id` 별로 `지금 + snooze_days×24시간` 까지 숨긴다. 모바일 SharedPreferences 키 `app_announcement_snooze.<id>` = 만료 epoch 밀리초.
  PC 는 **관리자 계정별로 PC 데이터 폴더**(`data/announcements/snooze.json`, `{"<관리자 계정 키>":{"<id>":"<만료 ISO>"}}`) — 브라우저가 바뀌어도 유지.
  지난 만료 값은 읽을 때 지운다. 시험: 보지 않기 → 7일 숨김 → 7일 뒤 다시 뜸.
- **닫기**: 이번 실행(PC 는 이번 로그인) 동안만 숨긴다(메모리).
- 본문은 **평문**으로만(HTML·마크다운 해석 금지, `\n` 만 줄바꿈). 제목 40자·본문 600자 넘으면 그 공지를 버린다.
- 링크: `contracts/app-announcements/vectors/links.json` 허용 목록만 연다(같은 벡터로 시험). 밖이면 버튼을 숨긴다.
- `app_action`: 모바일 `open_mode_switch`(설정의 모드 변경 흐름 `_confirmModeReset` 을 연다)만. PC 와 모르는 값은 버튼을 숨긴다.
- PC: 브라우저가 Supabase 를 직접 부르지 않는다. PC 서버가 Edge 에서 받아 관리자 웹 화면에 넘긴다(Docker 도 같음).
- 구버전에는 이 기능이 없다(공지를 못 본다).

## 10. 서버 응답 예시 모음

```json
// 진행 보고 성공
200 {"protocol":1,"stored":true,"request_id":"ing_0a1b2c3d4e5f60718293a4b5"}
// 같은 연결 60초 안 두 번째
429 Retry-After: 37  {"error":{"code":"rate_limited","message":"Too many requests.","request_id":"ing_…","retryable":true,"retry_after_seconds":37}}
// 진행 보고 형식 오류(모르는 키·URL 이 든 reason 등)
422 {"error":{"code":"schema_invalid","message":"Request does not match the contract.","request_id":"ing_…","retryable":false}}
// 동의 철회됨 / 연결 없음
403 {"error":{"code":"consent_revoked",…}}   403 {"error":{"code":"connection_unknown",…}}
// 필수 버전 미만 업로드(v1·v2)
426 {"error":{"code":"client_upgrade_required","message":"This app version can no longer upload. Please update the app.","request_id":"ing_…",
     "retryable":false,"required_version":"2.5.1","update_url":"https://play.google.com/store/apps/details?id=com.fentanest.mysafetyreport","update_message":null}}
// 설정 단계 보고
200 {"protocol":1,"stored":true}
429 Retry-After: 60 {"error":{"code":"rate_limited","message":"Too many requests.","requestTraceId":"…","retryable":true,"retryAfterSeconds":60}}
400 {"error":{"code":"invalid_request","message":"Request body is not valid for this action.","requestTraceId":"…","retryable":false}}
// status (해당 부분)
200 {"protocol":1,…,"ingest":{"contracts":[1,2],"raw_policy_version":"2026-10-21.1","paused":false,"pause_message":null,"resume_at":null,
     "last_contract":"community-ingest-v2"},"client_notice":null,"client_requirement":null,…}
```

## 11. 앱에 넣을 새 문구 (2-13, 각 담당이 자기 보고서 표에 위치와 함께 옮긴다)

| 위치 | 문구 |
|---|---|
| 점검 배너(재개 시각 있음) | 서버 점검 중입니다. 신고 업로드를 잠시 멈췄고, {시각}에 자동으로 다시 올립니다. |
| 점검 배너(재개 시각 없음) | 서버 점검 중입니다. 신고 업로드를 잠시 멈췄고, 점검이 끝나면 자동으로 다시 올립니다. |
| 업데이트 잠금 제목 | 앱을 업데이트해 주세요 |
| 업데이트 잠금 본문 | 이 버전은 더 이상 신고를 공유할 수 없습니다. 최신 버전으로 업데이트하면 이어서 쓸 수 있습니다. 기기에 있는 신고 자료는 그대로 남아 있습니다. |
| 업데이트 잠금 버전 줄 | 필요한 버전: {버전} 이상 |
| 업데이트 버튼 | 업데이트 |
| Client: 서버가 잠김 | 서버 프로그램 업데이트가 필요합니다. 서버 관리자에게 업데이트를 요청해 주세요. |
| Client 계정 불일치 | 서버에 연결된 카카오 계정({서버 표시 이름})으로 다시 로그인해 주세요. |
| Client 계정 불일치 버튼 | 로그아웃 후 다시 로그인 |
| 커뮤니티 미설정 서버 | 서버 관리자가 커뮤니티 설정을 마쳐야 공유됩니다. |
| 알림: 공식 로그인 | 안전신문고 로그인이 필요합니다. 앱에서 다시 로그인해 주세요. |
| 알림: 최적화 대기 | 신고 공유를 이어 가려면 앱을 한 번 열어 주세요. |
| 알림: 30일 보류 | 30일 넘게 올리지 못한 신고가 {N}건 있습니다. 앱에서 확인해 주세요. |
| 알림: 업데이트 | 앱을 업데이트해 주세요. 업데이트하면 신고 공유를 이어 갑니다. |
| 공지 버튼 | 일주일 동안 보지 않기 / {N}일 동안 보지 않기 / 닫기 |

쓰지 않는 말(2-13): writer, backfill, outbox, 게이트, 동기화 대기열, run, hold, contract, v1/v2, "원활한", "더 나은 서비스를 위해", "최적의", "새롭게",
"편리하게", "~를 통해", "다양한", "효율적", "보다 나은". 느낌표·이모지·물결표 금지. 화면에는 "보류" 대신 "올리지 못한 신고"를 쓴다.
