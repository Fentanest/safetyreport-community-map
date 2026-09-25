# safeauth 배포·설정 런북

대상: 운영자(Fentanest). 이 문서의 어떤 단계도 아직 실행되지 않았다. 모든 원격 변경(Supabase, GitHub,
WorklazyTools, 앱 배포)은 운영자 승인 후 운영자가 실행한다.

## 1. 확정 주소

| 항목 | 값 |
|---|---|
| 중앙 페이지 | `https://worklazy.net/safeauth/` |
| 웹 콜백 | `https://worklazy.net/safeauth/callback.html` |
| 브라우저 Origin | `https://worklazy.net` |
| 모바일 Standalone 복귀 | `com.fentanest.mysafetyreport://auth/callback` |

`/safeauth/`는 worklazy.net의 하위 경로다. 서브도메인이 아니며 WorklazyTools와 같은 origin이다(보안 검토 참조).

## 2. Supabase Dashboard (운영자 수동)

1. **Authentication → URL Configuration → Redirect URLs**에 두 줄을 **추가**한다. 기존 항목·Site URL은 지우거나 바꾸지 않는다.
   ```text
   https://worklazy.net/safeauth/callback.html
   com.fentanest.mysafetyreport://auth/callback
   ```
   중요: 목록에 없는 `redirect_to`를 받으면 Supabase Auth는 오류 대신 **Site URL로 코드를 보낸다**
   (GoTrue v2.197.0 `utilities.GetReferrer`, 로컬 테스트 P05b로 확인). 등록 누락은 조용한 실패가 되므로 배포 전 §7 점검을 반드시 한다.
2. **Authentication → Sign In / Providers → Kakao**: REST API 키(Client ID)·Client Secret은 여기에만 넣는다.
   이메일 없는 카카오 계정을 허용하는 옵션(“Allow users without an email”)을 켠다.
3. **카카오 Developers → 카카오 로그인 → Redirect URI**에는 위 주소가 아니라 Supabase Kakao Provider 화면의
   **Callback URL** `https://<PROJECT_REF>.supabase.co/auth/v1/callback`을 복사해 넣는다.
4. Site URL은 현재 값(community-map 등 다른 서비스가 쓰는 값)을 유지한다. 모든 새 흐름은 명시적 `redirect_to`를 쓴다.
5. “Single session per user”를 켜지 않는다(여러 기기 연결을 서로 로그아웃시킴).

## 3. 값과 저장 위치

| 값 | 성격 | 넣는 곳 |
|---|---|---|
| `SAFEAUTH_PUBLIC_SUPABASE_URL` = `https://<ref>.supabase.co` | 공개 | WorklazyTools **Actions Variables** |
| `SAFEAUTH_PUBLIC_PUBLISHABLE_KEY` = `sb_publishable_...` (선택) | 공개 | WorklazyTools Actions Variables |
| `SAFEAUTH_PUBLIC_PRIVACY_POLICY_URL` (정본 방침 https URL) | 공개 | WorklazyTools Actions Variables |
| `SAFEAUTH_PUBLIC_OPERATOR_CONTACT` (선택) | 공개 | WorklazyTools Actions Variables |
| `SAFEAUTH_SOURCE_TOKEN` | **비밀** | WorklazyTools **Actions Secrets**. fine-grained PAT, 저장소 1개(`Fentanest/safetyreport-community-map`), 권한 `Contents: Read-only`만. community-map은 private이므로 기본 `GITHUB_TOKEN`으로 읽을 수 없다 |
| `AUTH_RELAY_HASH_PEPPER` | **비밀** | Supabase Edge Function Secrets. `openssl rand -base64 32 \| tr '+/' '-_' \| tr -d '='` |
| `AUTH_RELAY_ENCRYPTION_KEY` | **비밀** | Supabase Edge Function Secrets. 위와 같은 방법으로 **별도** 생성(정확히 32바이트) |
| `AUTH_RELAY_ENABLED` | 설정 | Supabase Secrets. 검증 전 `false`, 공개 시 `true` |
| `AUTH_SITE_URL` = `https://worklazy.net/safeauth/` | 설정 | Supabase Secrets |
| `AUTH_BROWSER_ORIGIN` = `https://worklazy.net` | 설정 | Supabase Secrets (경로 금지) |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEYS`/`SUPABASE_SERVICE_ROLE_KEY` | 플랫폼 제공 | Edge 런타임 기본값. 복사하지 않는다 |
| safetyreport `[COMMUNITY] supabase_url`, `publishable_key`, `enabled` | 공개 | 각 설치의 config.ini 또는 Docker env `SAFETYREPORT_COMMUNITY_*` |
| 모바일 `COMMUNITY_SUPABASE_URL`, `COMMUNITY_SUPABASE_PUBLISHABLE_KEY` | 공개 | 앱 빌드 `--dart-define` |
| 사용자 access/refresh token | 비밀 | 각 원래 기기의 암호화 저장소에만 |

`VITE_*`/`SAFEAUTH_PUBLIC_*`에 들어간 값은 번들에 공개된다. 빌드 설정은 `sb_secret_`·service_role JWT·
이름에 SECRET/SERVICE/PEPPER/PRIVATE/PASSWORD가 들어간 공개 변수를 거부한다.

## 4. 백엔드(Supabase) 배포 — 승인 후

```bash
# community-map 저장소, 승인된 커밋에서
supabase link --project-ref <PROJECT_REF>
supabase db push                       # 202609251200_community_auth_relay.sql (additive)
supabase secrets set AUTH_RELAY_HASH_PEPPER=... AUTH_RELAY_ENCRYPTION_KEY=... \
  AUTH_SITE_URL=https://worklazy.net/safeauth/ AUTH_BROWSER_ORIGIN=https://worklazy.net AUTH_RELAY_ENABLED=false
supabase functions deploy community-auth-relay   # config.toml: verify_jwt=false (이 함수만)
```
- 기존 migration 이력(`202608150001`, `202609240001`)과 `public-analytics` 함수는 변경하지 않는다.
- 청소: pg_cron이 켜져 있으면 `select cron.schedule('safeauth-cleanup','23 * * * *','select public.internal_safeauth_cleanup()');`.
  꺼져 있으면 relay가 요청 생성 때 확률적으로(5%) 정리한다. pg_cron 사용 여부는 프로젝트에서 확인하지 않았다.
- `AUTH_RELAY_ENABLED=false`면 모든 액션이 503 `service_disabled`이고 중앙 페이지는 “연결 서비스를 준비 중이에요”를 보인다.

## 5. 중앙 페이지 공개 — WorklazyTools 합성 배포

인증 소스는 community-map에만 있다. WorklazyTools는 **고정된 커밋**을 빌드해 `dist/safeauth/`에 넣고
기존 단일 Pages 배포로 올린다. community-map push만으로는 worklazy.net이 바뀌지 않는다.

1. community-map의 승인할 커밋을 원격에 push한다(현재 로컬 전용).
2. WorklazyTools에 `integration-patches/worklazytools/0001-compose-pinned-safeauth.patch`를 적용한다
   (`git am` 또는 `git apply`). 변경은 `.github/safeauth-pin.json` 추가와 `deploy-pages.yml`의 3단계 추가뿐이다.
   이 단계들은 WorklazyTools의 기존 build/test 단계 **뒤**, artifact 업로드 **앞**에서 실행되므로 기존 검사는 그대로다.
3. WorklazyTools Secrets/Variables를 §3대로 넣는다.
4. `.github/safeauth-pin.json`의 `commit`을 승인된 40자 SHA로, `enabled`를 `true`로 바꿔 커밋한다.
   main push가 곧 배포다(기존 workflow 트리거). 수동 재실행은 `workflow_dispatch`.
5. 합성 단계는 실패 시 배포를 중단한다: 핀 SHA 불일치, artifact 검증 실패(허용 목록·CSP·비밀·데모 잔재·공식 카카오 에셋 해시),
   Supabase URL 미설정, 기존 `dist/safeauth` 충돌, 합성 전후 기존 파일 해시 변화, 경로 점검 실패.
6. 배포 후 §7 점검.

갱신: 새 community-map 커밋 SHA로 핀을 바꾸는 커밋(리뷰 가능). 자동 갱신은 넣지 않았다
(다른 저장소 push로 자동 배포되지 않게 하기 위함). 필요하면 GitHub App 토큰으로 핀 갱신 PR을 여는 방식을 따로 검토한다.

롤백: 핀을 직전 승인 SHA로 되돌리는 커밋. 긴급 차단은 Supabase `AUTH_RELAY_ENABLED=false`(새 연결 즉시 중단, 기존 연결 기기는 영향 없음).
`enabled=false`로 핀을 끄면 다음 배포에서 `/safeauth/`가 사라져 진행 중인 사용자가 404를 보게 되므로 최후 수단이다.

community-map 저장소에 worklazy.net CNAME을 두지 않는다. Cloudflare 경로 라우팅은 사용하지 않았다(대안 조건 미충족·미확인).

## 6. 앱 배포

- safetyreport: `feat/community-account` 브랜치(로컬). 기능 기본값 OFF. 설치자는 설정 화면에서 켜고 공개 URL/키만 넣는다.
- safetyreport-mobile: `feat/community-account` 브랜치(로컬). Standalone 로그인은 `--dart-define` 공개 값이 있어야 보인다.
- 두 앱 모두 릴리즈·태그·스토어 배포는 이번 작업에서 하지 않았다.

## 7. 배포 후 점검 (운영자, 실제 계정)

1. `curl -sI https://worklazy.net/safeauth/` → 200, `text/html`; 본문에 `<meta name="safeauth-page" content="index">`.
2. `https://worklazy.net/safeauth/callback.html`과 `https://worklazy.net/safeauth`(→301) 직접 열기.
3. 브라우저 개발자도구 Network: 인증 페이지에서 광고·분석·외부 CDN 요청 없음, Supabase 외 연결 없음.
4. PC(127.0.0.1:6819)에서 연결 → 중앙 비교코드 일치 → 카카오 로그인(본인이 직접) → 원래 앱에서 계정 확인 → 중앙 “완료”.
5. Docker(LAN IP/사용자 도메인)에서 반복, Supabase Redirect URLs에 사용자별 주소를 추가하지 않았음을 확인.
6. 모바일 Standalone·Client 각각 반복. 연결 해제 후 다른 기기 로그인이 유지되는지 확인(scope=local).
7. 실패 시 `AUTH_RELAY_ENABLED=false`로 새 연결을 멈추고 로그의 `trace`만 공유한다(코드·토큰·링크 금지).
