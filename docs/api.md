# API 설계

실제 기본 주소 예시:

```text
https://<project-ref>.supabase.co/functions/v1
```

함수 이름과 내부 경로는 구현 시 확정한다. 아래는 목표 계약이다.

배포 설정은 다음 원칙을 따른다.

- `consent`, `contribute` 등 쓰기 함수: JWT 검증 활성화
- `public-map`: JWT 검증 비활성화, 읽기 전용 공개 함수
- 쓰기 함수는 Gateway 검증에만 의존하지 않고 함수 안에서도 사용자와 claim을 확인
- `public-map`은 고정된 공개 집계 쿼리만 실행하고 요청으로 테이블명·열 이름을 받지 않음

## 1. 인증

회원가입과 로그인은 Supabase Phone Auth 표준 API를 사용한다.

```text
signInWithOtp(+821012345678)
verifyOtp(+821012345678, 123456)
```

성공 후 받은 access token을 업로드 요청에 포함한다.

```http
Authorization: Bearer <supabase-access-token>
```

전화번호 형식은 국내 `01012345678`을 E.164 `+821012345678`로 정규화한다.

## 2. 동의 등록

### `POST /consent`

```json
{
  "consent_version": "2026-08-15-v1",
  "privacy_policy_version": "2026-08-15-v1"
}
```

응답:

```json
{
  "consented": true,
  "consented_at": "2026-08-15T10:00:00Z"
}
```

업로드는 활성 동의 기록이 있는 사용자에게만 허용한다.

## 3. 업로드 시작

### `POST /contribute/begin`

```json
{
  "schema_version": 1,
  "source_mode": "mobile_standalone",
  "generated_at": "2026-08-15T10:30:00Z",
  "data_through_at": "2026-08-15T10:25:00Z",
  "expected_point_count": 1240,
  "payload_sha256": "<hex>"
}
```

응답:

```json
{
  "upload_id": "5cf1c768-5e44-4b7f-b669-c917cde97718",
  "chunk_size": 500,
  "expires_at": "2026-08-15T11:00:00Z"
}
```

동일 사용자의 같은 `payload_sha256`가 이미 활성화되어 있으면 새 업로드 없이 현재 상태를 반환한다. 같은 사용자의 미완료 `staged` 스냅샷이 있으면 만료 처리하고 새 `upload_id`를 발급한다. 모바일과 서버가 동시에 시작해도 마지막 begin의 스냅샷만 살아남는다.

## 4. 청크 업로드

### `POST /contribute/chunk`

```json
{
  "upload_id": "5cf1c768-5e44-4b7f-b669-c917cde97718",
  "chunk_index": 0,
  "points": []
}
```

응답:

```json
{
  "accepted": 500,
  "rejected": 0,
  "next_chunk_index": 1
}
```

청크 번호는 스냅샷 안에서 고유하다. 같은 청크를 재전송하면 멱등하게 동일 결과를 반환한다.

## 5. 업로드 완료

### `POST /contribute/finalize`

```json
{
  "upload_id": "5cf1c768-5e44-4b7f-b669-c917cde97718"
}
```

서버는 다음을 확인한다.

- 예상 지점 수와 실제 지점 수
- 저장된 청크 해시들로 재계산한 payload SHA-256 일치 (정의는 데이터 계약 7절)
- 중복 위치 키
- 건수 합과 범위
- 동의 상태와 사용자 상태
- 비정상적인 이전 스냅샷 대비 증가율

정상일 때만 새 스냅샷을 활성화한다.

```json
{
  "status": "active",
  "point_count": 1240,
  "received_at": "2026-08-15T10:33:00Z"
}
```

이상치가 크면 `quarantined`를 반환하고 공개 집계에는 반영하지 않는다.

## 6. 공개 지도

### `GET /public-map`

인증이 필요 없는 읽기 전용 API다.

쿼리 예시:

```text
/public-map?year=2026&category=traffic
  &min_lat=37.0&max_lat=37.8
  &min_lng=126.5&max_lng=127.5
```

필드:

| 이름 | 필수 | 설명 |
|---|---:|---|
| `year` | 아니요 | `all` 또는 4자리 연도 |
| `category` | 아니요 | `all`, `traffic`, `parking`, `other` |
| `min_lat` 등 bbox | 아니요 | 현재 지도 화면 범위 |
| `min_contributors` | 아니요 | 서버 정책이 허용한 범위에서만 적용 |
| `limit` | 아니요 | 서버 최대값 이하 |

`year=all`·`category=all` 조회는 요청 시점에 행을 병합하지 않고, 집계 작업이 미리 만든 `all` 조합 행을 그대로 반환한다. `contributor_count`는 연도·분류별 고유 기여자 수라서 개별 행을 사후 합산하면 같은 기여자가 여러 번 세어지기 때문이다.

응답에는 `ETag`와 다음 캐시 헤더를 시작값으로 사용한다.

```http
Cache-Control: public, max-age=60, stale-while-revalidate=300
```

허용 CORS origin은 실제 GitHub Pages 및 정식 도메인으로 제한한다. 공개 GET이므로 CORS는 인증 수단이 아니며, 반환 데이터 자체가 공개 가능해야 한다.

## 7. 내 기여 상태

### `GET /contribute/status`

로그인한 사용자의 상태만 반환한다.

```json
{
  "consented": true,
  "active_snapshot": {
    "generated_at": "2026-08-15T10:30:00Z",
    "point_count": 1240,
    "source_mode": "mobile_standalone"
  }
}
```

다른 사용자의 상태나 UUID는 조회할 수 없다.

## 8. 기여 철회

### `DELETE /contribute`

- 활성·대기 스냅샷과 기여 프로필을 삭제한다.
- 공개 지도 집계를 재생성한다.
- Phone Auth 계정까지 삭제할지는 요청 본문에서 명확히 분리한다.
- 공개 집계 재생성 후 완료 상태를 반환한다. 브라우저 캐시는 원격 무효화가 불가능하므로 짧은 TTL(60초) 경과 후 소멸에 의존하고, CDN을 도입하면 명시적 purge를 추가한다.

## 9. 오류 형식

```json
{
  "error": {
    "code": "INVALID_POINT",
    "message": "위도 범위를 확인해 주세요.",
    "request_id": "req_..."
  }
}
```

권장 코드:

- `AUTH_REQUIRED`
- `PHONE_NOT_VERIFIED`
- `CONSENT_REQUIRED`
- `RATE_LIMITED`
- `PAYLOAD_TOO_LARGE`
- `INVALID_POINT`
- `DUPLICATE_CHUNK`
- `SNAPSHOT_EXPIRED`
- `SNAPSHOT_QUARANTINED`
- `INTERNAL_ERROR`

내부 SQL, 전화번호, JWT 내용, 스택 트레이스는 오류 응답에 넣지 않는다.

## 10. 초기 제한값

- OTP 요청: Supabase 및 SMS 사업자 기본 제한에 추가로 전화번호·IP별 제한
- 업로드 시작: 사용자당 최소 10분 간격, 24시간에 6회 (같은 날 모바일↔서버 전환 업로드를 허용하기 위해 6시간 1회보다 완화)
- 스냅샷 동시 생성: 사용자당 1개 (새 begin이 기존 staged를 만료)
- 청크: 최대 500지점 또는 1MiB
- 공개 API: IP당 분당 120회 시작값
- bbox 없는 전체 조회: 낮은 빈도와 강한 캐시 적용
- 제한 카운터는 `private.rate_limits` 테이블에 저장한다. Edge Function은 무상태라 함수 메모리로는 제한을 유지할 수 없다. IP는 해시로 저장하고 짧게 보존한다.

제한값은 운영 지표를 확인하면서 조정한다.
