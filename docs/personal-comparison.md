# 전체 × 내 신고 비교 · 개편 계약 (cm-2026-09-27)
이번 개편의 정본이다. 우선순위는 PROJECT_RULES.md > 이 문서 > ui-spec.md/screen-by-screen.md(과거 기준판 배치)다.
배치가 과거 기준판과 충돌하면 이 문서를 따른다. 토큰·의미 상태색·공개 정책(담당자 전체 성명·정확 좌표·1건 공개·전국·차량 마스킹)은 그대로다.

> 출처 메모: 사용자가 첨부했다고 한 `community-map-personal-comparison-implementation-prompt.md`는 이 호스트에서
> 찾을 수 없었다(2026-09-27 전체 파일시스템 검색). 이 문서는 사용자 메시지에 적힌 요구 1~7과 금지사항을 그대로
> 옮기고, 첨부에 있었을 세부값은 아래 **결정** 표에 따로 적었다. 첨부가 제공되면 결정 표만 대조해 고친다.

## 1. 목표
전국 통계 상황판을 **현재 보고 있는 지역·기관·담당자·기간의 전체 통계와 내 신고 통계를 같은 화면에서 나란히 비교하는
커뮤니티 지도**로 바꾼다. 개인 통계를 마이페이지에 가두지 않는다. `내 데이터 함께 보기`를 켜면
KPI·지역 목록·담당자 비교·지도·추이에 개인 비교가 추가된다. 끄거나 로그인하지 않으면 지금과 같은 공개 화면이다.

## 2. 인증 경계
| 항목 | 규칙 |
|---|---|
| 공개 열람 | 비로그인. 공개 API(`public-analytics`)는 Authorization을 받지도 쓰지도 않는다(CORS 허용 헤더 `Accept`만) |
| 지도 웹 로그인 | 선택 기능. 브라우저에서 Supabase Auth 카카오 OAuth(PKCE), 저장 키 `cm-map-auth-v1`. `src/auth/mapAuth.ts` |
| relay와 구분 | `safeauth.worklazy.net`·`community-auth-relay`는 PC/Docker 서버 기기 연결 중계, `community-account`는 동의·writer 등록 API다. 지도는 둘 다 호출하지 않는다(테스트로 고정) |
| 소유권 | `my-analytics`가 `getUser(token)` + claims(sub·role·aud·iss·session_id·익명 여부)로 검증한 사용자 id만 쓴다. 요청 파라미터·헤더·로컬 저장값의 id는 받지 않는다 |
| 로그아웃 | `signOut({ scope: 'local' })`만. 이 브라우저의 지도 세션만 끝난다. `global`/`others`는 앱·서버의 업로드 연결 세션(`bound_session_id`)을 끊으므로 호출 금지(테스트·통합 스택으로 고정) |
| 수집 정책 | 동의·writer·ingest·업로드 정책·스키마는 바꾸지 않는다. 새 migration은 읽기 전용 RPC 하나다 |

## 3. 개인 읽기 API
`GET {VITE_PUBLIC_ANALYTICS_URL}/my-analytics/compare?start&end&category&region_code&agency_key&manager_key&bbox&expected_version`

- Edge `supabase/functions/my-analytics`(verify_jwt=true) → `server/personalHandler.ts`.
- 순서: Origin allowlist(`MY_ANALYTICS_ALLOWED_ORIGINS`) → GET·경로 → Bearer JWT → getUser + claims → 사용자별 60회/분 →
  공개 API와 **같은 scope 파서** → `internal_my_analytics_source` RPC 한 번 → 집계 → 응답.
- 응답 헤더: `Cache-Control: private, no-store, max-age=0`, `Vary: Origin, Authorization`, `Pragma: no-cache`.
  허용 Origin만 `Access-Control-Allow-Origin` 에코(와일드카드 없음).
- 오류: 401 `auth_required`/`session_expired`, 403 `kakao_required`/`account_ineligible`/`origin_forbidden`, 400 `INVALID_QUERY`,
  409 `DATASET_CHANGED`, 429 `rate_limited`(Retry-After 60), 503 `AGGREGATE_NOT_READY`/`service_unavailable`. 본문에 id·SQL·토큰 없음.
- 개인 응답은 공개 API·`public/data` 스냅샷·exporter·Service Worker·localStorage에 넣지 않는다. exporter는 `mine`·`viewer`·`my_points`
  필드를 거부한다(`tests/product/test_export_snapshot.py`).

### 3.1 같은 scope·모집단·게시 버전
- `internal_my_analytics_source`는 STABLE 함수 한 번으로 `state`(dataset_version), 신원 상태, 사실 행을 **한 스냅숏**에서 돌려준다.
- 사실 행은 공개 API와 똑같은 `internal_analytics_v2_facts`다(완료·활성 기여자·활성 동의 lineage). 따라서
  **내 신고 = 공개 모집단 중 contributor_id가 검증된 사용자인 행**이고 항상 전체의 부분집합이다.
- 전체와 내 값은 `server/aggregate.ts selectScope()` 한 번의 선택 결과에서 계산한다(`server/compare.ts`).
- 클라이언트는 공개 dashboard의 `dataset_version`을 `expected_version`으로 보내고, 응답의 version·scope가 화면과 다르면 버린다.

### 3.2 응답(`src/domain/personal.ts`, strict zod `src/data/personal.ts`)
`viewer{contributor, has_public_facts}`(id 없음), `all`/`mine` 요약, `diff`, `regions[]`(범위의 모든 지역, 전체·내),
`agencies[]`/`managers[]`(내가 처리결과를 받은 곳만, 최대 50), `monthly[]`, `my_points[]`(내 신고가 있는 정확 지점, `shared`).

## 4. 계산 기준
| 지표 | 전체 | 내 신고 | 차이 열 |
|---|---|---|---|
| 신고 접수 R | 신고일이 범위 안 | 같은 조건 + 내 계정 | **내 비중** = 내/전체 ×100 (%) |
| 처리완료 C | 종결 상태 + 처리완료일 범위 | 〃 | 내 비중 (%) |
| 수용·일부수용 비율 | (A+P)/D ×100, D=결과 확인 | 〃 | **내 − 전체 (%p)** |
| 불수용 비율 | J/D ×100 | 〃 | 내 − 전체 (%p) |
| 과태료 처분 | 건수, 비율=과태료/C | 〃 | 건수는 내 비중, 비율은 %p |
| 신고 지점 | 신고일 기준 고유 정확 지점 | 〃 | 내 비중 (%) |
| 기여 계정 | 공개 값 그대로 | 해당 없음(표시 안 함) | — |

- 분모 0이면 비율은 `—`와 이유(`결과 확인 0건`). 실제 0은 0. 차이는 양쪽 분모가 모두 있을 때만.
- 결과 미확인은 D에서 빼고 별도 표시. 1건도 그대로 보이고 `표본 1건` 배지.
- 비교는 관측값 비교다. 개인·기관·담당자의 우열·점수·등급·순위 문구 금지. `내가 더 잘한다` 같은 문장 금지.
- 지역·기관·담당자 행 차이도 같은 규칙(수용·일부수용 %p). 담당자 행은 기관 키와 담당자 키로 구분한다(동명이인 합치지 않음).

## 5. 화면 배치(이번 개편안)
### 5.1 데스크톱 1920 기준 — `함께 보기`
```
TopBar 64 : 로고 · 데이터 기준 · [카카오 로그인 | 내 계정▾] · 테마 · 브리핑
Command 56: 기간 · 분류 · 지역 칩 · 상세필터 · [내 데이터 함께 보기 ◯] · [함께 보기|지도 집중|통계 집중] · 초기화 · 공유
┌───────────────── 좌 1.35fr (지도 중심) ─────────────────┬──────── 우 1fr (min 420) ────────┐
│ 지도 카드 (clamp(460px, 58vh, 760px))                     │ 선택 지점 카드 (선택 시만)          │
│  지점 필터: 전체·내 신고 포함·함께 기록한 지점·관심 지역     │ 비교 KPI 표: 지표 × 전체/내/차이   │
│  범례(내 지점 링 / 함께 기록 링)                           │ 담당자·기관 비교(내가 받은 곳)       │
│ 짧은 지역 목록 (기본 6행 + 관심 지역 고정, [더 보기])        │ 월별 추이(전체 실선 / 내 점선)       │
└──────────────────────────────────────────────────────────┴──────────────────────────────────┘
하단: 처리결과 구성 · 차량 TOP5 · 기관·담당자 전체 표(비교 켜짐 시 내 열 추가) · 데이터 안내
```
- 기존 6 KPI 행과 `REGION INSIGHT` 패널은 오른쪽 열의 비교 KPI 표·선택 지점 카드로 대체한다(숫자 중복 금지).
- 비교가 꺼져 있으면 KPI 표는 `전체` 열만(6지표 + 비교기간 변화) 보인다. 켜지면 `내 신고`와 `차이` 열이 붙는다.
- 두 열 gap 16, 카드 radius·border·surface 토큰 그대로. 오른쪽 열은 지도 높이에 맞추지 않고 자연 높이, sticky 금지.
- 2560: 좌 1.5fr/우 1fr. 1440: 좌 1.2fr/우 1fr(우 min 380). 1024 이하: 한 열(지도 → 지역 목록 → 오른쪽 열 순).

### 5.2 보기 전환 (`view` URL 파라미터, 기본 both)
| 모드 | 배치 |
|---|---|
| 함께 보기 `both` | 위 5.1 |
| 지도 집중 `map` | 지도 전체 폭·높이 clamp(560px,72vh,960px), 지역 목록은 지도 오른쪽 좁은 열(320). 통계 열은 지도 위 한 줄 요약(R·C·수용% 전체/내) |
| 통계 집중 `stats` | 통계 전체 폭 2열 그리드(KPI 표·추이 / 담당자·지역 목록), 지도는 높이 280 미니 카드 + [지도 크게] 버튼 |
전환은 데이터 재조회를 하지 않는다. 지도 크기가 바뀌면 `relayout()`.

### 5.3 지도 표시
- 내 신고가 포함된 지점: 기존 마커 + **2px 청색 링(`--brand-ink`)**. 함께 기록한 지점: 청색 링 + **바깥 점선 링(`--cyan`)**.
  나만 기록한 지점은 청색 링만. 관심 지역 지점: 작은 별 배지. 색만으로 구분하지 않고 범례·목록 라벨·aria-label에 텍스트.
- 지점 필터(전체/내 신고 포함/함께 기록한 지점/관심 지역)는 **표시 필터**다. scope·통계를 바꾸지 않는다고 라벨로 알린다.
- 집계 표시 노드(클러스터)는 bbox 안에 내 지점이 있으면 `내 지점 포함` 링. 원좌표를 바꾸지 않는다.
- 선택 지점 카드: 공개 값 + (비교 켜짐) `이 지점 내 신고 n건 · 함께 기록 여부`.

### 5.4 짧은 지역 목록
- 행: 지역명 · 전체 신고 · (비교) 내 신고 · 수용·일부수용 % 전체/내 · 차이 %p · 관심 별.
- 기본 6행, 관심 지역은 위에 고정(최대 10, 이 브라우저에만 저장, 서버 전송 없음). `더 보기`로 전체.
- 정렬: 전체 신고순(기본) / 내 신고순(비교 켜짐 시). 행 클릭은 **지역 조건 적용**(scope 변경, 명시적), 별은 관심 토글만.

### 5.5 모바일 390
상단 56 · bottom nav 64(지도/지역/분석/안내) · 비교 토글과 보기 전환은 command 아래 한 줄 segmented(44px).
한 열: 지도(420) → 지점 필터 → 지역 목록 → 비교 KPI 표(가로 스크롤 없이 3열 고정: 전체/내/차이) → 담당자 비교 → 추이.
페이지 가로 스크롤 금지, 터치 44px.

### 5.6 테마·브리핑
다크·라이트 모두 토큰만 사용. 내 값 강조는 `--brand-ink` 텍스트·링만(배경 채움 금지).
**브리핑 모드는 기본으로 내 데이터를 숨긴다**(발표 화면 노출 방지). 브리핑 바에 `내 데이터 표시`를 누르면 그 브리핑 동안만 표시,
종료하면 원래 상태 복원. 브리핑에서 계정 이름은 표시하지 않는다.

### 5.7 화면 문구(2026-09-27 사용자 지시)
화면에는 일반 이용자 말만 쓴다. 변수명·capability 키·버전 ID·검증 코드(UI03, BLOCKED 등)·‘분모/표본/원좌표/집계 표시’ 같은
내부 용어를 노출하지 않는다. 이 문서의 용어와 화면 문구 대응: 내 데이터 함께 보기 → **내 신고와 비교**, 함께 보기/지도 집중/통계 집중 →
**지도+통계/지도 크게/통계 크게**, 처리완료 → **답변 완료**, 수용·일부수용 비율 → **수용률(일부 수용 포함)**, 신고일/처리완료일 기준 →
**신고한 날/답변 받은 날 기준**, 함께 기록한 지점 → **함께 신고한 곳**, 기여 계정 → **참여한 사람**, 내 비중 → **전체 중 내 신고**.

## 6. 상태
| 상태 | 표시 |
|---|---|
| 로그인 미설정(배포) | 토글 비활성 + `이 배포에는 지도 로그인이 설정되지 않았습니다` (공개 화면 정상) |
| 로그아웃 | 토글을 켜면 KPI 표 `내 신고` 열 자리에 로그인 안내 카드 + [카카오로 로그인] |
| 로딩 | 내 열만 skeleton. 공개 값은 그대로 |
| 공유 기록 없음(`contributor=none`) | 내 값 0과 `아직 공유한 신고가 없습니다 — 앱에서 커뮤니티 공유를 켜면 다음 업로드부터 반영` |
| 범위에 내 신고 없음 | 내 값 0, 차이 `—(내 결과 확인 0건)` |
| 정지·철회 | `공유가 중지된 상태라 공개 집계에 포함된 내 신고가 없습니다` |
| 세션 만료 | `로그인이 만료되었습니다` + 다시 로그인. 앱 업로드 연결은 영향 없음을 문구로 알림 |
| 카카오 아님 | `카카오 계정으로 로그인해야 …` |
| 429 / 네트워크 / 503 | 내 열만 오류 + 재시도(429는 초 표시). 공개 통계는 계속 |
| 버전 변경 409 | `공개 데이터가 방금 갱신됐습니다` + 다시 조회 |

## 7. 합성 fixture (demo 전용)
`VITE_DATA_MODE=demo`는 `src/data/demoEngine.ts`의 결정적 합성 사실(실제 신고·계정·차량 아님)을 실제 서버 집계
(`aggregateDashboard`, `aggregateCompare`)에 통과시킨다. live 빌드에는 이 chunk가 들어가지 않는다(`import.meta.env` 리터럴 분기 + dist 검사).
- 합성 로그인: 헤더 로그인 버튼(세션 저장) 또는 `?me=` : `signed`, `out`, `unconfigured`, `empty`, `expired`, `kakao`, `suspended`, `error`, `rate`, `stale`.
- 기존 `?fixture=one|empty|offline|rate|stale`은 그대로(공개 쪽 상태).
- 합성 사용자는 서울·경기 위주 34건, 제주 1건(나만 기록한 1건 지점)을 가진다.

## 8. 결정(첨부 원문 부재로 이번에 정한 값)
| 항목 | 결정 | 이유 |
|---|---|---|
| 차이 열 | 건수=내 비중 %, 비율=내−전체 %p | 사용자 지시의 `차이(%p)`를 비율에 적용, 건수 뺄셈은 의미 없음 |
| 전체에 나 포함 | 포함 | 화면의 공개 전체 숫자와 같은 값이어야 한다 |
| 관심 지역 | 브라우저 localStorage, 최대 10 | 읽기 전용 API 원칙, 서버에 개인 선호 저장 안 함 |
| 함께 기록한 지점 | 같은 범위에서 다른 기여자도 기록한 정확 지점 | 공개 지점 건수와 모순 없음 |
| 브리핑 | 기본 숨김, 명시 표시 | 발표 화면 노출 방지 |
| 비교 토글 저장 | localStorage `cm-compare`, URL에는 넣지 않음 | 공유 URL에 개인 모드 없음 |

## 9. BLOCKED (운영)
- 운영 Supabase: `202609270100_my_analytics.sql` 적용, `my-analytics` 배포, `MY_ANALYTICS_ALLOWED_ORIGINS` 설정 — 별도 승인 전 미실행.
- Supabase Auth: Kakao provider에 `https://safemap.worklazy.net/**` 리다이렉트 허용 추가, Pages 빌드 변수 `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`(공개 키) — 운영 인증 미검증.
- 실제 카카오 로그인·실데이터의 내 통계 대조, 실 Kakao 지도 위 링 표시 — 키·운영 세션 없음.
