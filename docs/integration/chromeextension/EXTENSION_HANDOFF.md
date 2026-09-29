# 크롬 확장 인계서 — my-reports-v1

대상: `safetyreport-chromeextension` 담당 세션. 작성·소유: `safetyreport-community-map`.
정본 계약은 `contracts/my-reports/`다(README.md, my-reports-v1.schema.json, types.ts, fixtures/). 이 문서는 확장에서
쓰는 방법을 정리한 것이다. 둘이 다르면 계약이 맞고, 이 문서를 고친다.

## 0. 상태 (2026-09-29 기준, 매 변경 시 갱신)

| 항목 | 상태 |
|---|---|
| 계약 `my-reports-v1` | 확정(v1). 변경은 `contracts/my-reports/README.md §8`에 기록 |
| map 코드(SQL·Edge·handler) | 구현 완료, 브랜치 `claude/gallant-darwin-7ldkbl` (PR 전, main 미병합) |
| 로컬 통합 검증 | 로컬 스택(Postgres 17·GoTrue·PostgREST)에서 SQL+handler 통합 테스트 통과. Deno Edge 경로는 `REPORT.md` 참고 |
| 운영 DB 적용 | **미적용** (사용자 승인·실행 필요, §8) |
| Edge 배포 | **미배포** (사용자 승인·실행 필요, §8) |
| 확장 연동 | 확장 세션 작업 중. 실제 확장 ID·Origin 미확정 |

운영 반영 전에는 실제 프로젝트에서 호출하면 `404`(함수 없음)가 난다. 개발 중에는 `fixtures/`의 응답으로 UI를 만든다.

## 1. 계약 복사

```
# map 레포에서
python3 scripts/integration/sync_contract_copy.py --contract my-reports --to <확장 레포 경로>
# 확장 레포 CI/테스트에서 복사본 검사
python3 <map>/scripts/integration/sync_contract_copy.py --contract my-reports --to . --check
```

`contracts/my-reports/`를 바이트 그대로 복사하고 `MANIFEST.sha256`으로 확인한다. 복사본을 고치지 않는다.
`types.ts`에는 import가 없고, 확장에서 그대로 쓸 수 있는 상수·정규화 함수(`normalizeVehicle`, `normalizeAddress`,
`validQuery`, `officialUrl`)와 오류표(`ERRORS`)가 있다. JS 빌드가 없다면 같은 규칙을 옮겨 쓰되 fixture로 확인한다.

## 2. 호출

```
POST {SUPABASE_URL}/functions/v1/my-reports/search
POST {SUPABASE_URL}/functions/v1/my-reports/summary
POST {SUPABASE_URL}/functions/v1/my-reports/numbers

Authorization: Bearer <supabase session.access_token>
apikey: <publishable(anon) key>
Content-Type: application/json
```

- 확장에 넣는 값은 `SUPABASE_URL`과 publishable key뿐이다. service/secret key, Kakao secret, 커서 서명키는 확장에 없다.
- 확장이 받는 세션은 같은 Supabase 프로젝트의 Kakao Provider 로그인 결과다. PC·모바일 앱 세션과 달라도 된다.
  계정(사용자 UUID)이 같으면 그 계정의 PC·모바일·복원 업로드가 모두 조회된다. writer 등록은 하지 않는다.
- 로그인(PKCE, `chrome.identity.launchWebAuthFlow`, refresh token 보관·갱신)은 확장 담당이다. 이 API는 access token만 검증한다.
- 검색어는 본문에만 넣는다(URL query 금지). 토큰·본문·차량번호·주소를 로그/오류 리포트에 남기지 않는다.

## 3. 세 API 사용법

### 3.1 차량 패널 (search, kind=vehicle)

1. 입력값을 `normalizeVehicle`로 정규화하고 `validQuery('vehicle', v)`가 false(6 코드포인트 미만 등)면 **요청하지 않는다**.
2. 첫 요청: `{ "kind": "vehicle", "query": v, "page_size": 20, "managers_page_size": 10 }`
   → `summary`(전체 요약), `reports`(1쪽), `managers`(담당자 1쪽).
   예시: `fixtures/search-vehicle-first-page.json`.
3. 목록 더 보기: `{ "kind": "vehicle", "query": v, "cursor": reports.next_cursor }` → `reports`만 온다
   (`summary`/`managers`는 null — 첫 응답 값을 유지한다). 예시: `fixtures/search-vehicle-next-page.json`.
4. 담당자 더 보기: `{ "kind": "vehicle", "query": v, "part": "managers", "cursor": managers.next_cursor }` → `managers`만 온다.
   예시: `fixtures/search-managers-page.json`. `managers.total_managers`가 전체 담당자 수, `unassigned_count`는 담당자 없는 신고 수.
5. 캐시 키는 `(계정, kind, query_normalized)`. 응답의 `data_version`이 바뀌면 이전 캐시를 버린다.

### 3.2 주소 패널 (search, kind=address)

같은 방식이며 `kind: "address"`. 공식 화면에서 읽은 주소를 그대로 보내도 된다(서버가 NFC·공백 정리).
일치 규칙은 “같은 주소”다: 끝의 ` (동명)` 참고항목 하나는 무시하고 나머지가 완전히 같아야 한다.
`예시로 1`은 `예시로 12`와 다르다. 구·동 단위로 넓히지 않는다. 결과가 0건이면 `fixtures/search-empty.json` 모양이다.

### 3.3 아이콘 팝업 (summary)

1. 첫 요청 `{}` 또는 `{ "page_size": 20 }` → `summary`(본인 완료 신고 전체), `recent_summary`와 `recent`(최근 3일).
   예시: `fixtures/summary-first-page.json`.
2. `recent_start`~`recent_end`(Asia/Seoul, 답변일 기준 오늘+직전 2일)를 화면에 그대로 쓴다. 확장이 날짜를 계산하지 않는다.
3. 더 보기: `{ "cursor": recent.next_cursor }` → 같은 기간의 다음 쪽. 자정이 지나도 기간이 바뀌지 않는다.
   새 기간을 보려면 cursor 없이 다시 요청한다. 예시: `fixtures/summary-next-page.json`.
4. 공유 동의가 없는 신규 계정: `account.contributor = "none"`, 0건(`fixtures/summary-empty-no-consent.json`).
   “앱에서 공유를 켜면 여기 표시됩니다” 같은 안내에 쓴다. `revoked`는 모든 동의를 철회한 계정이다.

### 3.4 신고번호 복사 (numbers)

사용자가 복사 버튼을 누를 때만 호출한다.

```js
async function copyAllNumbers(kind, query) {
  const all = [];
  let cursor = null;
  do {
    const r = await post('numbers', { kind, query, cursor, page_size: 500 });
    if (r.error) return showError(r.error);   // DATASET_CHANGED면 처음부터 다시(자동 1회까지), NUMBERS_LIMIT_EXCEEDED면 안내
    all.push(...r.items);
    cursor = r.next_cursor;
  } while (cursor);                             // 마지막 페이지는 complete: true
  await navigator.clipboard.writeText(all.join('\n'));
  // 클립보드 성공 여부는 확장만 안다. 서버 응답에는 '복사 성공' 상태가 없다.
}
```

- `unique_numbers` = 복사될 번호 수, `matched_reports` = 검색 결과 신고 수, `without_number` = 번호가 없어 빠진 신고 수.
  “10건 중 9건 복사(번호 없는 1건 제외)”처럼 표시할 수 있다.
- 모든 페이지를 받기 전에 “복사 완료”를 표시하지 않는다. 예시: `fixtures/numbers-first-page.json`, `numbers-last-page.json`.

## 4. 행 표시

- `vehicle_number`: 본인 업로드의 원본 차량번호(표시용). 검색 비교는 서버가 한다.
- `report_number`가 null이면 “신고번호 없음”으로 표시한다. `source_report_id`를 신고번호처럼 보이지 않는다.
- `official_url`: null이 아니면 “안전신문고에서 보기” 링크. 열기 전에
  `https://www.safetyreport.go.kr/#mypage/mysafereport/`로 시작하는지 다시 확인한다. 안전신문고 로그인이 필요할 수 있다.
- 기관: `agency_name_current`가 있으면 그것을, 없으면 `agency_name_original`을 쓴다. 두 값이 다르면 원문을 보조로 보여줄 수 있다.
- `confirmed_amount_won`: null = 금액 없음, 0 = 0원. `penalty_points`, `rating`도 null과 0/값을 구분한다. 별점은 1~5만 온다.
- 좌표(`lat`/`lng`)는 없을 수 있다. 없어도 목록에서 빼지 않는다.
- 응답에 제목·본문·답변 원문·첨부·사진은 없다. 해당 칸을 만들지 않는다.

## 5. 통계 표시

| 화면 문구 | 값 | 분모 |
|---|---|---|
| 총 n건 | `summary.total` | — (검색 전체, 페이지 행 수 아님) |
| 수용 / 일부 수용 / 불수용 / 결과 미상 | `status.*` | 합 = total |
| 수용률 | `accept_rate`(0~100, 소수 1자리, null이면 “—”) | 전체 완료 신고(total). 일부 수용 미포함 |
| 과태료 / 계도 / 범칙금 / 처분 없음 / 미확인 | `disposition.*` | 합 = total. 계도+범칙금 묶음은 `warning + penalty` |
| 확정 과태료 합계 | `fine_amount.confirmed_sum_won`(null이면 “확인된 금액 없음”) | `confirmed_count`건 |
| 금액 미확인 과태료 | `fine_amount.unconfirmed_count` | |

- 커뮤니티 지도(map)의 수용률은 “결과가 나온 신고(수용+일부+불수용)” 분모다. 이 API의 `accept_rate`는 전체 완료 신고 분모다.
  같은 이름으로 섞어 쓰지 않는다.
- 담당자 행도 같은 정의다. 이름이 같아도 `agency_key`가 다르면 다른 담당자다.

## 6. 오류 처리

`{ error: { code, message, retryable }, request_id }`. `message`는 그대로 보여도 된다. 전체 표는 계약 README §7.

| 상황 | 확장 동작 |
|---|---|
| `401 SESSION_EXPIRED` | refresh 1회 → 같은 요청 1회 재시도 → 또 실패하면 로그인 필요 상태 |
| `401 AUTH_REQUIRED` | 로그인 필요 상태 (refresh 없음) |
| `403 KAKAO_REQUIRED` / `ACCOUNT_INELIGIBLE` | 개인 캐시 삭제, 안내. 재시도 없음 |
| `409 DATASET_CHANGED` / `CURSOR_EXPIRED` | 해당 조회 캐시 삭제 → 첫 페이지부터(자동 1회까지) |
| `400 INVALID_CURSOR` | 캐시 삭제 → 첫 페이지부터 |
| `422 NUMBERS_LIMIT_EXCEEDED` | 복사하지 않고 안내 |
| `429 RATE_LIMITED` | `Retry-After`초 동안 같은 계정 요청 중단 |
| `503 SERVICE_UNAVAILABLE` / `QUERY_TIMEOUT` | “잠시 후 다시” 표시. 0건으로 표시하지 않는다. 자동 반복 재시도 금지 |
| JSON이 아니거나 `error.code` 없음 (gateway 401, 402/5xx 플랫폼 오류 등) | 일시 오류로 표시, 자동 재시도 없음 |

- 요청 한도: 계정당 1분 120회(세 경로 합계). 입력 debounce와 캐시로 이보다 훨씬 적게 쓴다.
- 늦게 도착한 응답은 요청 당시 계정·입력과 현재 상태가 같을 때만 표시한다(요청 ID 비교는 확장 몫).

## 7. Origin과 Redirect (서로 다른 설정)

| 설정 | 값 형식 | 어디에 |
|---|---|---|
| CORS 허용 Origin | `chrome-extension://<확장 ID>` (개발·배포 ID 각각, 쉼표 구분) | Edge 환경변수 `MY_REPORTS_ALLOWED_ORIGINS` |
| OAuth Redirect URL | `https://<확장 ID>.chromiumapp.org/` (확장이 `chrome.identity.getRedirectURL()`로 쓰는 값과 정확히 같게) | Supabase Dashboard → Authentication → URL Configuration → Redirect URLs에 **추가** |

- 기존 Redirect URL(지도·PC·모바일)은 지우지 않는다. 와일드카드 전체 확장은 허용하지 않는다.
- 개발용(압축 해제 로드) 확장 ID는 manifest `key`를 고정하지 않으면 PC마다 달라진다. 개발 ID를 쓰려면 그 값도 두 곳에 넣는다.
- 확장 service worker의 `fetch`는 `Origin: chrome-extension://<ID>`를 보낸다. 목록에 없으면 `403 ORIGIN_FORBIDDEN`이다.

## 8. 운영 반영 순서 (map 쪽, 사용자 승인 후)

1. SQL: `supabase/migrations/202610020100_my_reports.sql`만 적용(auth 레포와 공유 프로젝트이므로 `db push` 금지).
   `202610010100_single_date_cohort.sql`이 먼저 적용돼 있어야 한다.
   ```
   psql "<운영 DB 연결 문자열>" -v ON_ERROR_STOP=1 -f supabase/migrations/202610020100_my_reports.sql
   npx supabase migration repair --status applied 202610020100
   ```
2. Edge 비밀값: `npx supabase secrets set MY_REPORTS_CURSOR_SECRET=<32바이트 이상 임의값> MY_REPORTS_ALLOWED_ORIGINS=chrome-extension://<ID>`
3. 함수 배포: `npx supabase functions deploy my-reports` (`verify_jwt = true`는 `supabase/config.toml`에 있음)
4. Auth Redirect URL에 `https://<ID>.chromiumapp.org/` 추가.
5. smoke: 확장(또는 로그인한 토큰)으로 `summary` 1회 → 200, 토큰 없이 → 401, 다른 Origin → 403.
6. 끄기(kill switch): `npx supabase secrets set MY_REPORTS_ENABLED=false` → 모든 요청 503(DB 접근 없음).
   되돌리기: 함수 삭제 `npx supabase functions delete my-reports`, SQL은 마이그레이션 머리말의 rollback 순서.

환경변수 이름과 누락 시 동작:

| 이름 | 필요 | 누락·잘못일 때 |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEYS`/`SUPABASE_SERVICE_ROLE_KEY` | 플랫폼 기본 제공 | 503 |
| `MY_REPORTS_CURSOR_SECRET` | 필수, 32자 이상 | 503 (`my_reports_config_invalid` 로그) |
| `MY_REPORTS_ALLOWED_ORIGINS` | 확장 브라우저 호출에 필수 | Origin 있는 요청 모두 403 |
| `MY_REPORTS_ENABLED` | 선택 | `false`면 503 |
| `AUTH_JWT_ISSUER` | 선택(설정 시 `iss` 대조) | 미설정이면 issuer 대조 생략(getUser 검증은 그대로) |

## 9. 변경 이력

- 2026-09-29: v1 최초 인계.
