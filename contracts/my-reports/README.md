# my-reports-v1 — 본인 완료 신고 조회 API (정본 계약)

소유: `safetyreport-community-map`. 소비자: `safetyreport-chromeextension`.
이 폴더가 정본이다. 기계 판독 스키마는 `my-reports-v1.schema.json`, TypeScript 타입·상수·정규화 함수는 `types.ts`,
예시 응답은 `fixtures/`. 세 가지와 이 문서는 `tests/product/myReportsContract.test.ts`가 서로 맞는지 검사한다.
확장 레포로 복사할 때는 `python3 scripts/integration/sync_contract_copy.py --contract my-reports --to <확장 레포>`로
바이트 그대로 복사하고 `MANIFEST.sha256`으로 확인한다. 복사본을 고치지 않는다.

## 1. 경로와 공통 규칙

| 경로 | 용도 |
|---|---|
| `POST {SUPABASE_URL}/functions/v1/my-reports/search` | 차량·주소로 본인 완료 신고 검색: 목록 페이지 + 전체 요약 + 담당자별 집계 |
| `POST {SUPABASE_URL}/functions/v1/my-reports/summary` | 본인 완료 신고 전체 요약 + 최근 3일 답변 신고 페이지 |
| `POST {SUPABASE_URL}/functions/v1/my-reports/numbers` | search와 같은 범위의 실제 신고번호 페이지 (명시적 ‘신고번호 복사’ 때만) |

- method: `POST`만 허용한다. `OPTIONS`는 preflight다. 다른 method는 `405 METHOD_NOT_ALLOWED`.
- 헤더
  - `Authorization: Bearer <사용자 access token>` (필수. 확장이 같은 Supabase 프로젝트의 Kakao Provider로 받은 세션)
  - `apikey: <프로젝트 publishable(anon) key>` (Supabase gateway용. 이 키만으로는 아무 자료도 받을 수 없다)
  - `Content-Type: application/json` (없거나 다르면 `415`)
- 본문: UTF-8 JSON 객체, 최대 16 KiB(`413`). 정의되지 않은 필드가 있으면 `400 INVALID_REQUEST`.
  특히 `user_id`, `contributor_id`, `dataset_key`, `url` 같은 필드는 받지 않는다. 조회 대상은 검증된 토큰의 사용자뿐이다.
- 검색 문자열은 URL query가 아니라 본문에만 둔다.
- 응답 헤더: `Content-Type: application/json; charset=utf-8`, `Cache-Control: private, no-store, max-age=0`,
  `Pragma: no-cache`, `X-Content-Type-Options: nosniff`, `Vary: Origin, Authorization`, `X-Request-Id`.
- 응답 본문 상한 256 KiB. 넘으면 잘라서 200을 주지 않고 `422 RESULT_TOO_LARGE`.
- 모든 날짜는 `YYYY-MM-DD`, 시각(`queried_at`)은 UTC ISO 8601이다.

### 1.1 CORS·Origin

- 허용 Origin은 서버 환경변수 `MY_REPORTS_ALLOWED_ORIGINS`(쉼표 구분)에 적힌 정확한 값만이다.
  예: `chrome-extension://<배포 확장 ID>,chrome-extension://<개발 확장 ID>`. 와일드카드와 `chrome-extension://*`는 없다.
- `Origin`이 있고 목록에 없으면 `403 ORIGIN_FORBIDDEN`이다(허용 헤더를 붙이지 않으므로 브라우저에서는 읽을 수 없다).
- `Origin`이 없는 요청(서버·CLI)도 인증과 본인 제한은 똑같이 적용해 처리한다. Origin은 본인 확인을 대신하지 않는다.
- 허용 Origin이면 성공과 오류 응답 모두 `Access-Control-Allow-Origin: <그 origin>`,
  `Access-Control-Expose-Headers: Retry-After, X-Request-Id`를 붙인다.
- preflight: `Access-Control-Allow-Methods: POST, OPTIONS`,
  `Access-Control-Allow-Headers: authorization, apikey, content-type, x-client-info`, `Access-Control-Max-Age: 600`.
- CORS Origin(`chrome-extension://<ID>`)과 OAuth Redirect URL(`https://<ID>.chromiumapp.org/...`)은 서로 다른 설정이다.

### 1.2 인증과 본인 범위

1. `Authorization` Bearer 토큰을 Supabase Auth `getUser`로 검증하고, 토큰 claims의 `sub`·`role=authenticated`·
   `aud=authenticated`·`iss`(설정 시)·`session_id`를 대조한다.
2. DB 안에서 `private.community_identity_state(user, session)`로 삭제·정지(banned)·익명이 아닌 사용자인지,
   Kakao identity가 있는지, 그 세션이 아직 유효한지 매 요청 확인한다. 커서가 있는 다음 페이지·번호복사도 똑같다.
3. 조회 대상은 `contributor_id = 검증된 사용자 UUID`인 업로드뿐이다. 이 사용자의 PC·모바일·복원 dataset을 모두 포함한다.
   다른 기기의 세션 ID와 같을 필요는 없다. writer 등록·재연결·writer_epoch 변경은 하지 않는다.
4. 접근 허용 자료 = 완료 상태 4종 + 그 업로드의 동의 계보가 활성(`private.community_lineage_active`)인 것.
   동의 문구 버전 갱신은 계보가 이어지므로 그대로 보인다. 사용자가 철회한 계보의 자료는 보이지 않는다.
5. 커뮤니티 지도의 10건 기준은 여기 적용하지 않는다. 0건이면 정상 빈 결과, 1~9건도 그대로 보인다.
6. 계정 상태(`account.contributor`)
   - `active`: 활성 공유 동의가 있다.
   - `none`: 공유 동의를 한 적이 없다(앱 미사용 신규 계정). 결과는 0건 성공.
   - `revoked`: 모든 동의를 철회했다. 철회된 계보의 자료는 나오지 않으므로 보통 0건.
   - 정지된 기여자(`contributor_profiles.status <> 'active'`)는 0건으로 위장하지 않고 `403 ACCOUNT_INELIGIBLE`.

### 1.3 완료 신고와 중복 제거

- 완료 상태: `accepted`(수용), `partial`(일부 수용), `rejected`(불수용), `completed_unknown`(결과 미상: 원문 ‘답변완료’/‘기타’).
  처리중·보완요청·취하·이송은 목록·통계 어디에도 없다. `completed_unknown`을 불수용으로 세지 않는다.
- 한 신고 = 본인 업로드 안의 `report_identity` 하나. 순서는 **본인 범위 확정 → identity와 대표 관측 선택 → 검색 조건 → 집계·페이지**.
  - `report_identity = source_report_key | coalesce(관측의 신고번호, 그 키의 최초 신고번호, 'legacy')`.
    “그 키의 최초 신고번호”는 본인의 접근 허용 완료 관측 전체 이력에서 정한다(검색 조건·날짜와 무관).
    같은 source_report_key라도 실제 신고번호가 다르면 다른 신고다. 번호 없는 구버전 관측은 같은 키의 최초 번호에 붙는다.
  - 대표 관측: 같은 답변 내용(payload) 그룹의 최신 수신 시각(`answer_accepted_at`) DESC → 답변일 DESC NULLS LAST →
    최초 수신 시각 → dataset_key. 단순 재전송·재공유·동의 갱신은 수신 시각을 바꾸지 않으므로 대표를 뒤집지 않는다.
  - 다른 사용자의 관측은 identity·대표·번호 보완 어디에도 쓰지 않는다.
- 검색 조건은 대표 관측에만 건다. 과거 관측의 차량번호·주소로 옛 값이 되살아나지 않는다.
- 차량번호·주소·날짜가 같다는 이유로 서로 다른 신고를 합치지 않는다. 좌표가 없어도 제외하지 않는다.
- 기본 기간은 본인 전체 완료 이력이다(지도 화면 기간 없음).

## 2. 검색 정규화

| kind | 정규화 | 유효 길이 | 일치 규칙 |
|---|---|---|---|
| `vehicle` | NFC → 모든 공백 제거 | 6~64 **코드포인트** | 대표 관측의 `vehicle_raw`에 같은 정규화를 적용한 값이 검색값을 **문자 그대로** 포함 |
| `address` | NFC → 공백류를 한 칸으로 → 앞뒤 공백 제거 | 5~200 코드포인트 | 양쪽의 **주소 기준형**이 완전히 같음 |

- 공백 = `\t \n \v \f \r`, 스페이스, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF.
- 제어문자(U+0000–U+001F, U+007F–U+009F)가 남으면 `400 QUERY_LENGTH`. 정규화 전 `query`는 최대 256자.
- 차량 포함 검사는 SQL `strpos`로 한다. `%`, `_`, `\`는 와일드카드가 아닌 보통 문자다. 대소문자는 구분한다.
  원본 `vehicle_raw`는 바꾸지 않고 `vehicle_number`로 그대로 반환한다.
- **주소 기준형** = 정규화한 주소에서 끝의 ` (…)` 참고항목 한 묶음을 뗀 값. 예: `서울특별시 종로구 예시로 1 (예시동)`과
  `서울특별시 종로구 예시로 1`은 같은 주소다. `예시로 1`과 `예시로 12`, `예시로 1-3`은 다른 주소다.
  구·동 단위 확장, 반경 검색, 지오코딩은 하지 않는다. 표기가 다르면(`서울` vs `서울특별시`) 다른 주소다.
  - 기존 PC 서버 `/api/v1/address`(`search_by_address`)는 `위반장소 LIKE %q%`(부분 포함)였다. 이 방식은
    `예시로 1`로 `예시로 12`까지 섞으므로 v1에서는 “같은 주소” 비교로 좁혔다.
- 응답의 `query_normalized`는 서버가 쓴 정규화 결과다. 확장은 이 값을 캐시 키로 쓸 수 있다.

## 3. 요청·응답

TypeScript 정의는 `types.ts`, JSON 예시는 `fixtures/`에 있다.

### 3.1 search

요청:

```json
{ "kind": "vehicle", "query": "12가 3456", "part": "reports", "cursor": null, "page_size": 20, "managers_page_size": 10 }
```

| 요청 | 응답 `summary` | 응답 `reports` | 응답 `managers` |
|---|---|---|---|
| 첫 요청 (`part` 생략/`reports`, `cursor` null) | 전체 요약 | 1쪽 | 담당자 1쪽 |
| 다음 목록 (`part` `reports`, `cursor`=`reports.next_cursor`) | null | 다음 쪽 | null |
| 담당자 더 보기 (`part` `managers`, `cursor`=`managers.next_cursor`) | null | null | 다음 쪽 |
| 담당자만 처음부터 (`part` `managers`, `cursor` null) | null | null | 1쪽 |

- 커서는 그 커서를 만든 `part`에서만 쓸 수 있다. 다른 part·경로·검색어·계정의 커서는 `400 INVALID_CURSOR`.
- 커서와 함께 `page_size`/`managers_page_size`를 보낼 때는 첫 요청과 같은 값이어야 한다. 생략하면 커서의 값을 쓴다.
- 목록 정렬: `completed_date` DESC NULLS LAST → `report_date` DESC NULLS LAST → `report_number` DESC NULLS LAST →
  서버 내부 고유 키(노출하지 않음). 커서는 같은 데이터 버전에서만 유효하므로 페이지 사이 중복·누락이 없다.
- 담당자 정렬: `total` DESC → `manager_name` 오름차순(코드포인트 순) → `agency_key` → `manager_key`.
- 담당자 그룹 = (`agency_key`, `manager_key`). 이름이 같아도 기관이 다르면 다른 담당자다. `manager_key`가 없는 신고는
  담당자 목록에 넣지 않고 `unassigned_count`로 센다. 그룹의 표시 이름(`manager_name`, `agency_name_*`)은 그 그룹에서
  답변일이 가장 최근인 신고의 값이다.

### 3.2 summary

요청: `{ "cursor": null, "page_size": 20 }`

- `recent_start`..`recent_end`: 첫 요청을 처리할 때 서버가 `Asia/Seoul` 오늘(`recent_end`)과 직전 2일(`recent_start`)로
  한 번 정한다. 이 값은 커서에 묶여 있어 페이지를 넘기는 중 자정이 지나도 바뀌지 않는다. 새 기간은 첫 요청부터 다시 한다.
- `summary` = 본인 완료 신고 전체, `recent_summary` = 최근 3일(`completed_date` 기준) 모집단. 둘은 모집단이 다르다.
  답변일이 없는 신고는 `summary`에는 들어가지만(`completed_date_missing`) 최근 목록에는 들어가지 않는다.
  업로드·수신 시각은 답변일로 쓰지 않는다.
- `recent`: 최근 3일 신고 페이지(정렬은 search와 같음), 커서 페이지에서는 `summary`/`recent_summary`가 null이다.

### 3.3 numbers

요청: `{ "kind": "vehicle", "query": "12가3456", "cursor": null, "page_size": 200 }`

| 필드 | 뜻 |
|---|---|
| `matched_reports` | search와 같은 범위의 고유 완료 신고 수(= search `summary.total`) |
| `without_number` | 그중 `report_number`가 없는 신고 수(복사에서 빠짐) |
| `unique_numbers` | 복사 대상인 서로 다른 신고번호 문자열 수. 같은 번호의 여러 신고는 한 번만 복사된다 |
| `items` | 이번 페이지의 번호(오름차순 아님: `report_number` DESC, 코드포인트 순) |
| `complete` | 이 페이지가 마지막이면 true |

- `source_report_id`를 신고번호 대신 넣지 않는다. 빈 번호·형식이 맞지 않는 번호는 없다(DB 제약).
- `unique_numbers`가 10,000을 넘으면 첫 요청부터 `422 NUMBERS_LIMIT_EXCEEDED`. 잘린 목록을 보내지 않는다.
- 모든 페이지는 첫 페이지의 `data_version`에 묶인다. 중간에 자료·권한이 바뀌면 `409 DATASET_CHANGED` → 처음부터 다시.
- 서버는 클립보드 성공 여부를 모른다. 확장은 `complete: true` 페이지까지 모두 받은 뒤에만 “복사 완료”를 표시한다.

### 3.4 신고 행(`ReportRow`)과 DB 열

| API | DB (`private.community_report_facts`) | 비고 |
|---|---|---|
| `report_number` | `report_number` | null 가능 |
| `source_report_id` | `source_report_id` | 안전신문고 내부 ID(c_no) |
| `official_url` | (서버 생성) | §4 |
| `vehicle_number` | `vehicle_raw` | 본인 업로드 원본 |
| `report_date` / `completed_date` | 같은 이름 | null 가능 |
| `category` | `category` | traffic / parking / other |
| `status`, `status_label` | `status` | 4종, 라벨은 `types.ts STATUS_LABEL` |
| `disposition` | `disposition` | fine / warning / penalty / none / unknown |
| `amount_kind` | `amount_kind` | fine / penalty / combined / unknown |
| `confirmed_amount_won` | `amount_confirmed_won` | null = 금액 없음, 0 = 0원 |
| `penalty_points` | `penalty_points` | null ≠ 0 |
| `address`, `lat`, `lng` | 같은 이름 | 좌표 null 가능 |
| `agency_key` | `agency_key` | |
| `agency_name_original` | `agency_name` | 답변 원문 기관명 |
| `agency_name_current` | `agency_current_name` | registry 현행명(`(구)` 표시 포함 가능), 미계산이면 null |
| `manager_key`, `manager_name` | 같은 이름 | |
| `violation_law` | `violation_law` | null 가능 |
| `rating` | `rating` | 1~5, null 가능 |

반환하지 않는 것: 신고 제목·본문·처리 답변 원문·사진·첨부·별점 사유·안전신문고 쿠키·원본 payload,
contributor UUID·dataset_key·source_report_key·grant/receipt/connection ID·payload hash·report_identity.
본인 자료이므로 공개 지도의 금액·법규·별점 공개 동의 마스킹은 적용하지 않는다(본인이 올린 값 그대로).

## 4. 안전신문고 상세 링크

`official_url = "https://www.safetyreport.go.kr/#mypage/mysafereport/" + encodeURIComponent(source_report_id)`.
근거는 PC `safetyreport` `web/templates/base.html`의 `safetyWebUrl(id)`(같은 origin·경로·인코딩)이다.
`source_report_id`가 `^[0-9A-Za-z_-]{1,40}$`에 맞지 않으면 null이다. `report_number`(SPP-…)를 넣지 않는다.
요청에서 URL을 받지 않는다. 링크를 열면 안전신문고 로그인이 필요할 수 있으며, 원문 접근 권한은 공식 사이트가 판단한다.
확장은 이 값을 그대로 쓰되, 열기 전에 `https://www.safetyreport.go.kr/#mypage/mysafereport/`로 시작하는지 다시 확인한다.

## 5. 통계 정의

| 필드 | 정의 |
|---|---|
| `total` | 현재 범위(검색 전체/본인 전체/최근 3일)의 고유 완료 신고 수. 페이지 행 수가 아니다 |
| `status.*` | 4종 합 = `total` |
| `accept_rate` | `accepted / total × 100`, 소수 첫째 자리 반올림(0.05 → 0.1, 반올림 half away from zero), `total = 0`이면 null. 일부 수용을 더하지 않는다 |
| `disposition.*` | 5종 합 = `total`. `none`(처분 없음)을 불수용으로 다시 세지 않는다. 계도+범칙금 합은 확장이 `warning + penalty`로 계산해도 된다 |
| `fine_amount.fine_count` | `disposition = fine` 신고 수 |
| `fine_amount.confirmed_count` | 과태료 중 `amount_kind = fine`, 상태 수용/일부 수용, 금액이 있는 신고(0원 포함) |
| `fine_amount.confirmed_sum_won` | 위 신고 금액의 합. `confirmed_count = 0`이면 null(확인된 0원 합은 0) |
| `fine_amount.unconfirmed_count` | 과태료지만 금액이 없는 신고(금액 종류 무관) |
| `fine_amount.other_count` | 과태료이고 금액은 있지만 확정 과태료가 아닌 신고(금액 종류가 범칙금·혼합·미상이거나 상태가 수용/일부 수용이 아님). `fine_count = confirmed + unconfirmed + other` |
| `category.*` | 분류별 수(합 = `total`). 교통위반 전용 요약은 제공하지 않는다 |
| `completed_date_missing` | 답변일 없는 신고 수 |
| `report_number_missing` | 신고번호 없는 신고 수(번호 복사에서 빠지는 수. `numbers`의 `without_number`와 같은 범위면 같은 값) |

담당자 행의 `status`·`accept_rate`·`disposition`·`fine_amount`도 같은 정의를 그 담당자 신고에 적용한다.

## 6. 커서와 데이터 버전

- `data_version`: 본인의 접근 허용 완료 신고(대표 관측의 반환 필드, identity, 계정 상태) 전체의 해시(32 hex).
  내용·별점·금액·기관 표시·담당자·신고번호 보완·삭제·동의 철회가 바뀌면 달라진다. 다른 사용자의 업로드만으로는 바뀌지 않는다.
- 커서 = `base64url(JSON).base64url(HMAC-SHA256)`, 서버 비밀키(`MY_REPORTS_CURSOR_SECRET`)로 서명한다. 사용자·경로·part·
  정규화 검색어·페이지 크기·데이터 버전·(summary는 최근 기간)·만료(15분)에 묶인다. 커서 안에 검색어·차량번호·사용자 ID 원문은 없다.
  확장은 내용을 해석하지 않는다.
- 커서 요청마다 인증·계정·세션을 다시 확인하고, 같은 DB 문장 안에서 현재 `data_version`을 계산해 커서와 다르면
  `409 DATASET_CHANGED`다. 만료되면 `409 CURSOR_EXPIRED`. 두 경우 모두 캐시를 버리고 첫 페이지부터 다시 요청한다.
- 한 응답의 권한 확인·목록·총수·요약·담당자는 하나의 DB 함수 호출(한 스냅샷)에서 계산된다.

## 7. 오류

본문: `{ "error": { "code": "...", "message": "...", "retryable": true|false }, "request_id": "..." }`.
`message`는 사용자에게 보여도 되는 한국어 문장이다. 내부 SQL·스택·비밀값은 없다.

| HTTP | code | retryable | 확장 동작 |
|---|---|---|---|
| 400 | `INVALID_REQUEST` | false | 버그. 재시도하지 않는다 |
| 400 | `QUERY_LENGTH` | false | 입력 길이 안내(차량 6~64자, 주소 5~200자) |
| 400 | `INVALID_CURSOR` | false | 캐시 폐기, 첫 페이지부터 |
| 401 | `AUTH_REQUIRED` | false | 로그인 화면 |
| 401 | `SESSION_EXPIRED` | true | refresh 1회 후 1회 재시도. 실패하면 로그인 화면 |
| 403 | `KAKAO_REQUIRED` | false | 카카오 로그인 안내 |
| 403 | `ACCOUNT_INELIGIBLE` | false | 사용할 수 없는 계정 안내, 개인 캐시 폐기 |
| 403 | `ORIGIN_FORBIDDEN` | false | 배포 설정 문제(허용 Origin 누락) |
| 404/405 | `NOT_FOUND`/`METHOD_NOT_ALLOWED` | false | 버그 |
| 409 | `DATASET_CHANGED` | true | 캐시 폐기, 첫 페이지부터(자동 1회까지) |
| 409 | `CURSOR_EXPIRED` | true | 캐시 폐기, 첫 페이지부터 |
| 413/415 | `PAYLOAD_TOO_LARGE`/`UNSUPPORTED_MEDIA_TYPE` | false | 버그 |
| 422 | `NUMBERS_LIMIT_EXCEEDED` | false | “한 번에 복사할 수 없는 양” 안내, 복사 안 함 |
| 422 | `RESULT_TOO_LARGE` | false | 더 작은 `page_size`로 다시 |
| 429 | `RATE_LIMITED` | true | `Retry-After`초 뒤까지 요청 금지 |
| 503 | `SERVICE_UNAVAILABLE`/`QUERY_TIMEOUT` | true | `Retry-After`(있으면) 뒤 사용자 조작으로 재시도. 0건으로 표시하지 않는다 |

- 같은 사용자 1분 120회(세 경로 합계, DB rate-limit bucket `my-reports|user|<uid>`의 해시). 업로드 한도와 섞이지 않는다.
- Supabase gateway가 handler 전에 거절하면(예: 401 잘못된 JWT, 402/5xx 플랫폼 한도·장애) JSON 형식이 다르거나
  CORS 헤더가 없을 수 있다. 확장은 `error.code`가 없는 응답을 “일시적 서버 오류”로 다루고 자동 무한 재시도하지 않는다.

## 8. 변경 이력

- v1 (2026-09-29): 최초 확정.
- v1 (2026-09-30): `Summary.report_number_missing` 추가(확장 복사 버튼 표시용). main의 offset 초안(`internal_my_reports`)을 대체.
