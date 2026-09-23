# 안전신문고 공동 신고 지도

`safetyreport-mobile`과 `safetyreport` 이용자가 자발적으로 제공한 위치별 신고 통계를 합쳐 공개 지도에 표시하기 위한 별도 프로젝트다.

이 저장소는 현재 **설계 단계**다. Supabase를 인증·수집·집계 API의 기준 플랫폼으로 사용하고, GitHub Pages는 공개 지도 화면만 제공한다.

## 목표

- 정확한 위도·경도(소수 6자리 반올림)를 기준으로 동일 신고 지점을 묶고, 주소는 대표 표시값으로 사용한다.
- 신고건수, 수용 현황, 과태료 처분 현황과 처리기관별 비중을 지도에 표시한다.
- 차량번호, 신고번호, 신고 내용, 사진·영상 등 피신고자를 식별할 수 있는 원문은 받지 않는다.
- 휴대폰 SMS OTP로 `인증된 번호당 하나의 기여자`를 만든다.
- 모바일 단독 모드와 `safetyreport` 서버 모드가 동일 전화번호로 로그인하면 같은 기여자로 처리한다.
- 업로드를 계속 더하는 대신 사용자의 최신 스냅샷으로 교체하여 이중 집계를 막는다.

## 확정한 설계 원칙

| 항목 | 결정 |
|---|---|
| 백엔드 | Supabase Auth, Postgres, Edge Functions |
| 공개 프런트엔드 | GitHub Pages 정적 사이트 |
| 사용자 고유성 | Supabase Phone Auth의 SMS OTP |
| 내부 사용자 키 | `auth.users.id` UUID |
| 전화번호 저장 | Supabase `auth.users`에만 저장, 통계 테이블에는 저장하지 않음 |
| 위치 데이터 | 정확한 위도·경도와 정규화 주소 수집 |
| 연도 기준 | 신고일 기준 (`safetyreport` 서버 통계는 답변일 기준이므로 업로드 변환 필요) |
| 담당자 | 비공개 원본 영역에 수집, 공개 지도에는 제외 (공개 여부는 ADR-004) |
| 업로드 방식 | 사용자별 전체 스냅샷 교체, 대용량은 청크 업로드 |
| 공개 방식 | Edge Function의 읽기 전용 `public-map` API |
| 금지 데이터 | 차량번호·신고번호·본문·첨부파일·정확한 발생시각·안전신문고 로그인 정보 |

## 전체 구조

```text
safetyreport-mobile ─┐
                     ├─ 위치별 로컬 집계
safetyreport 서버 ───┘
          │
          │ Phone Auth JWT + 집계 스냅샷
          ▼
  Supabase Edge Functions
          │
          ├─ 인증·검증·속도 제한
          ├─ 스냅샷 활성화
          └─ 공개 지도 응답
          │
          ▼
 Supabase Postgres
   ├─ auth.users               전화번호·인증 상태
   ├─ private.upload_*         비공개 기여 스냅샷
   └─ public_map_points        공개 가능한 집계 결과
          │
          ▼
 GitHub Pages 지도
```

GitHub Pages는 서버 코드를 실행하거나 POST 요청을 저장하지 않는다. 브라우저의 JavaScript가 Supabase의 공개 GET API를 호출해 지도 데이터를 받는다.

## 문서

- [아키텍처](docs/architecture.md)
- [업로드·공개 데이터 계약](docs/data-contract.md)
- [API 설계](docs/api.md)
- [데이터베이스 설계](docs/database.md)
- [모바일·서버 연동](docs/client-integration.md)
- [개인정보·보안·남용 방지](docs/privacy-security.md)
- [결정 사항과 미결정 사항](docs/decisions.md)
- [구현 로드맵](docs/roadmap.md)

초기 SQL 초안은 [Supabase 마이그레이션](supabase/migrations/202608150001_initial_schema.sql)에 있다.

## 용어

- **기여자(contributor)**: SMS OTP를 통과한 휴대폰번호 하나에 연결된 Supabase 사용자 UUID.
- **스냅샷(snapshot)**: 특정 사용자가 가진 전체 위치별 집계 데이터의 한 버전.
- **기여 지점(upload point)**: 한 사용자의 한 스냅샷에 포함된 `연도 + 분류 + 위치` 집계.
- **공개 지도 지점(public map point)**: 여러 기여자의 활성 스냅샷을 위치별로 합친 결과.
- **정확한 위치**: 현재 앱과 동일하게 마커를 찍을 수 있는 위도·경도와 표시 주소.

## 범위 밖

- 안전신문고 계정 아이디·비밀번호 또는 세션을 중앙 서버로 전송하는 기능
- 개별 차량·피신고자 이력 검색
- 신고 사진·영상·본문 보관
- 담당자 개인별 순위 또는 평가 공개
- GitHub Pages를 데이터 수집 서버로 사용하는 구성

## 공식 참고 문서

- [Supabase Phone Login](https://supabase.com/docs/guides/auth/phone-login)
- [Supabase Users](https://supabase.com/docs/guides/auth/users)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Supabase 데이터 보안](https://supabase.com/docs/guides/database/secure-data)
- [GitHub Pages 사이트 생성](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)

