# 모바일·서버 연동

## 1. 공통 UX

설정에 `공동 신고 지도 참여` 영역을 별도로 추가한다.

1. 기능 설명과 전송 항목 보기
2. 선택 동의 체크
3. 기존 설정의 휴대폰번호를 입력란에 미리 표시
4. 사용자가 `인증번호 받기`를 눌러 SMS OTP 인증
5. 전송 예정 지점 수와 제외 항목 미리보기
6. 최초 업로드
7. 마지막 업로드 시각·상태·철회 버튼 표시

기존 휴대폰번호가 입력되어 있다는 사실만으로 동의나 소유 확인을 간주하지 않는다.

## 2. `safetyreport-mobile` 단독 모드

재사용할 수 있는 현재 기능:

- 로컬 DB의 신고 지도 집계
- 정확한 위도·경도와 정규화 주소
- 상태·처분·처리기관·분류 breakdown

추가할 계층:

```text
LocalDbService.computeReportMapStats()
        │
        ▼
CommunityMapSnapshotBuilder
        │ 금지 필드 제거·계약 검증
        ▼
CommunityMapUploadService
        │ Supabase Auth JWT
        ▼
Edge Function
```

Supabase access/refresh token은 `FlutterSecureStorage`에 저장한다. 전화번호나 JWT를 SharedPreferences, 일반 로그, 크래시 보고서에 기록하지 않는다.

현재 앱에는 Supabase 관련 코드와 의존성이 전혀 없으므로 `supabase_flutter` 의존성 추가부터 시작한다. DTO 변환 시 주의: 로컬 집계의 `category_breakdown`은 한글 표시 라벨(`교통위반` 등)로 직렬화되므로 지점 단위 `category` enum(`traffic`·`parking`·`other`)은 DB의 `category` 컬럼에서 직접 가져오고, 연도는 신고일 기준으로 배정한다.

## 3. `safetyreport-mobile` 서버 연결 모드

두 가지 구현 중 하나를 선택할 수 있다.

### 권장: 모바일이 최종 업로드

```text
safetyreport 서버 집계 API
        │ LAN에서 집계 수신
        ▼
모바일이 스키마 검증·Phone Auth 서명
        │
        ▼
Supabase 업로드
```

장점은 서버에 Supabase 장기 인증 토큰을 둘 필요가 없고 사용자 동의 화면을 모바일에 통일할 수 있다는 점이다.

### 대안: 서버가 직접 업로드

서버 웹 UI에서 동일 번호로 OTP 로그인하고 서버가 직접 업로드한다. 모바일과 같은 전화번호를 사용하면 동일 `auth.users.id`이므로 사용자 활성 스냅샷 하나만 유지된다.

서버의 refresh token은 일반 `config.ini`, 브라우저 HTML, 백업 ZIP에 평문으로 넣지 않는다. 운영체제 키 저장소 또는 권한이 제한된 별도 비밀 파일을 사용한다.

## 4. `safetyreport` 서버 집계

현재 지도 통계 서비스가 사용하는 다음 값을 업로드 DTO로 변환한다.

- `lat`, `lng`
- `address`, `region`
- `total`
- `status_breakdown`
- `disposition_breakdown`
- `agency_breakdown`
- `category_breakdown`

담당자 통계는 `manager_counts`로 수집하되 공개 DTO에는 포함하지 않는다. 두 레포의 현재 지도 집계 경로에는 담당자 필드가 없으므로(모바일 지도 통계 SELECT 목록과 서버 `_MAP_COLUMNS` 모두 미포함) DTO 생성 시 담당자 집계 쿼리를 추가한다.

업로드 DTO 생성 시 두 클라이언트가 다음 옵션을 동일하게 고정한다. 서버 지도 API는 dedupe 모드를 서버 설정으로 강제하고 취하 제외·경찰서명 정규화도 설정 의존이라, 옵션이 다르면 같은 원본에서 다른 스냅샷이 나온다.

- 취하 포함(`excludeWithdraw=false`) — 취하는 `withdrawn` 건수로 반영
- 경찰서명 정규화 적용(`normalizePolice=true`)
- dedupe 모드는 `canonical`을 시작값으로 고정 (0단계에서 두 레포 결과 일치 확인 후 확정)
- 연도는 신고일 기준 (서버 통계의 답변일 기준 필터를 사용하지 않음)

## 5. 동일 사용자 이중 집계 방지

모바일과 서버를 별개 설치 ID로 합산하지 않는다. JWT의 동일한 `auth.uid()`를 기준으로 사용자당 활성 스냅샷을 하나만 둔다.

```text
user A / mobile snapshot 10:00 ─ active
user A / server snapshot 10:05 ─ active
user A / mobile snapshot 10:00 ─ superseded
```

새 스냅샷이 모든 지점을 포함하는 전체 스냅샷인지 반드시 확인한다. 부분 업데이트를 전체 스냅샷으로 잘못 활성화하면 기존 지점이 사라진다.

begin이 겹치면 서버가 기존 `staged` 스냅샷을 만료 처리하고 새 `upload_id`를 발급하므로, 클라이언트는 진행 중이던 업로드가 `SNAPSHOT_EXPIRED`로 실패할 수 있음을 처리한다.

## 6. 자동 업로드

초기에는 수동 업로드로 시작한다. 데이터 계약과 중복 처리가 검증된 뒤 다음 조건으로 자동화를 도입한다.

- 명시적 자동 업로드 동의
- 동기화 완료 후에만 실행
- 최소 6시간 간격
- 데이터가 바뀐 경우에만 실행
- Wi-Fi 전용 선택 제공
- 실패 시 지수 백오프
- 같은 payload hash는 재전송하지 않음

## 7. 호환성

- 모든 요청과 응답에 `schema_version`을 둔다.
- 서버는 최소 두 개의 최근 클라이언트 스키마 버전을 허용한다.
- 알 수 없는 필드는 거부해 개인정보가 우발적으로 추가되지 않게 한다.
- 앱 버전과 API 스키마 버전을 별도로 관리한다.

## 8. 필수 테스트

- 동일 번호로 모바일·서버 업로드 시 한 사용자로 집계
- 동일 payload 재전송 시 건수 불변
- 업로드 중 네트워크 중단 시 이전 활성본 유지
- 차량번호·신고번호·본문 키가 있으면 전송 전 실패
- 전화번호와 JWT가 로그에 남지 않음
- 동의 철회 후 사용자 지점이 공개 집계에서 제거됨
- 기존 앱의 로컬 신고 지도 결과와 공동 지도 단일 사용자 집계가 일치
- 모바일(신고일)과 서버(답변일) 연도 배정이 계약 기준(신고일)으로 일치
- disposition 건수 합이 `total`과 정합 (`safetyreport`의 처분 판정 중복 카운트 수정 확인)

