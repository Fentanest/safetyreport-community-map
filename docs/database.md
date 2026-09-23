# 데이터베이스 설계

초기 실행 가능한 초안은 `supabase/migrations/202608150001_initial_schema.sql`에 있다.

## 1. 관계

```text
auth.users
    │ 1:1
    ▼
private.contributor_profiles
    │ 1:N
    ▼
private.upload_snapshots
    │ 1:N
    ▼
private.upload_points

활성 upload_points 전체
    │ 집계 작업
    ▼
public.public_map_points
```

## 2. `auth.users`

Supabase가 관리한다.

- `id`: 다른 테이블이 참조하는 UUID
- `phone`: OTP 확인 휴대폰번호
- `phone_confirmed_at`: 확인 시각
- 세션·identity 정보

전화번호를 별도 `public.profiles` 등에 복제하지 않는다.

## 3. `private.contributor_profiles`

공동 지도 참여에 필요한 최소 메타데이터다.

- 사용자 UUID
- 동의서·처리방침 버전
- 동의 및 철회 시각
- 마지막 업로드 시각
- 정상·정지·삭제대기 상태

## 4. `private.upload_snapshots`

사용자별 업로드 버전을 보관한다.

상태:

- `staged`: 청크 업로드 중
- `quarantined`: 이상치 검토 중
- `active`: 공개 집계에 포함되는 현재 버전
- `superseded`: 새 버전으로 교체됨
- `deleted`: 삭제 대기 또는 논리 삭제

부분 고유 인덱스로 사용자당 `active` 하나만 허용한다.

`(user_id, payload_sha256)` 중복 방지도 부분 고유 인덱스(`staged`·`active`·`quarantined` 상태만)로 건다. 전체 컬럼 unique 제약이면 A→B→A 순서의 정당한 재업로드가 과거 `superseded` 행과 충돌한다. 스냅샷에는 위치 키 알고리즘 버전(`location_key_version`)을 기록한다.

## 5. `private.upload_points`

스냅샷의 위치별 집계다.

- 정확한 위도·경도와 주소
- 연도와 신고 분류
- 총 신고·수용·처리중·불수용·취하·과태료 건수
- 상태·처분·기관·담당자 breakdown JSON (담당자는 비공개 저장 전용, 공개 집계에서 제외)
- 서버가 계산한 위치 키

전화번호, 신고번호, 차량번호, 본문과 첨부파일 컬럼은 만들지 않는다. 존재하지 않는 컬럼은 실수로 저장할 수도 없다는 점에서 중요한 방어다.

## 6. `public.public_map_points`

공개 가능한 위치별 집계 결과다.

- 사용자 UUID 없음
- 전화번호 없음
- 담당자 breakdown 없음
- 여러 활성 스냅샷의 건수 합
- 서로 다른 기여자 수와 신뢰도
- 현재 앱과 호환되는 breakdown JSON
- (연도 | all) × (분류 | all) 사전 집계 조합 행 (`period_year = 0`이 전체 연도, `category = 'all'`이 전체 분류)

이 테이블도 직접 공개하지 않고 Edge Function을 통해 필요한 열만 반환한다. bbox 조회는 b-tree `(period_year, category, lat, lng)` 인덱스로 시작하고, 데이터가 커지면 PostGIS 또는 geohash 인덱스를 검토한다.

## 7. RLS와 권한

기본 정책:

| 역할 | `private.*` | `public_map_points` |
|---|---:|---:|
| `anon` | 접근 불가 | 직접 접근 불가 |
| `authenticated` | 직접 접근 불가 | 직접 접근 불가 |
| Edge Function `service_role` | 필요한 작업 가능 | 읽기·집계 가능 |

클라이언트 JWT는 Edge Function에서 사용자를 식별하는 데만 쓴다. 데이터베이스 쓰기는 검증을 마친 Edge Function이 수행한다.

`private` 스키마는 Data API의 exposed schema로 추가하지 않는다. Edge Function은 `public.internal_*` 이름의 `security definer` RPC를 `service_role`로 호출하고, RPC가 고정된 작업만 `private` 테이블에 수행한다. 초기 migration에는 스냅샷 활성화 RPC가 포함되며 begin/chunk/withdraw RPC는 해당 Edge Function 구현과 함께 추가한다. 직접 PostgreSQL 연결을 선택할 경우에도 transaction pooler와 짧은 연결만 사용한다.

`service_role` 키는 다음 위치에 넣지 않는다.

- Flutter 소스와 APK
- `safetyreport` 공개 설정 파일
- GitHub Pages JavaScript
- GitHub 저장소의 `.env`
- 오류 로그나 분석 이벤트

## 8. 집계 작업

초기에는 다음 중 하나를 사용한다.

1. 스냅샷 활성화 후 해당 연도·분류·위치만 재집계
2. Supabase Cron으로 일정 주기 전체 재집계

MVP는 구현 단순성을 위해 전체 재집계로 시작하고, 데이터가 늘어나면 영향받은 위치만 증분 갱신한다.

공개 API가 `year=all`·`category=all`을 지원하므로 집계 작업은 (연도 | all) × (분류 | all) 조합 행을 미리 만든다. `contributor_count`는 조합별 `count(distinct user_id)`이며, 개별 행을 사후 합산하면 같은 기여자가 여러 번 세어져 부풀려지므로 요청 시점 병합으로는 정확한 값을 만들 수 없다.

개념 쿼리:

```sql
select
  coalesce(p.period_year, 0) as period_year,  -- 0 = 전체 연도
  coalesce(p.category, 'all') as category,
  p.location_key,
  avg(p.lat) as lat,
  avg(p.lng) as lng,
  max(p.address) as address,
  sum(p.total_count) as total_count,
  sum(p.accepted_count) as accepted_count,
  sum(p.fine_count) as fine_count,
  count(distinct s.user_id) as contributor_count
from private.upload_points p
join private.upload_snapshots s on s.id = p.snapshot_id
where s.state = 'active'
group by grouping sets (
  (p.period_year, p.category, p.location_key),
  (p.period_year, p.location_key),
  (p.category, p.location_key),
  (p.location_key)
);
```

위치 키가 좌표 기반이므로 같은 좌표의 주소 표기가 달라도 하나의 지점으로 합쳐지고, 표기 중 하나가 대표값으로 선택된다. 대표 주소 선택 규칙(최빈값 등)은 구현 시 확정한다.

## 9. 보존 기간 시작값

| 데이터 | 보존 기간 |
|---|---|
| 활성 스냅샷 | 동의 유지 중 |
| 교체된 스냅샷 | 30일 후 삭제 |
| 미완료 staged 스냅샷 | 24시간 후 삭제 |
| 격리 스냅샷 | 7일 후 삭제 또는 검토 연장 |
| 보안 감사 이벤트 | 90일, 전화번호·본문 미기록 |
| 공개 집계 | 원본 삭제 시 재생성 |
| Auth 전화번호 | 계정 삭제 또는 동의 철회 정책에 따름 |

정리는 초기 migration의 `internal_cleanup_expired` 함수가 수행하며 pg_cron으로 주기 실행한다. 삭제는 개인정보 처리방침의 약속과 직결되므로 로드맵 8단계가 아니라 2단계(업로드 API)와 함께 구현한다.

운영 전 개인정보 처리방침과 실제 삭제 작업이 같은 기간을 사용하도록 맞춘다.

## 10. 용량 측정

추정치보다 실제 행 크기를 측정한다.

```sql
select
  count(*) as row_count,
  pg_size_pretty(pg_total_relation_size('private.upload_points')) as total_size,
  pg_total_relation_size('private.upload_points')
    / greatest(count(*), 1) as bytes_per_row
from private.upload_points;
```

JSON breakdown과 인덱스가 전체 DB 크기에 포함된다. 초기 사용자 10~20명의 실제 데이터를 넣은 뒤 업로드 지점당 바이트와 공개 API 응답 크기를 측정한다.
