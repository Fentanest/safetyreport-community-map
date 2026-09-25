# 공개 정책·보안 경계
사용자가 확정한 실명·정확좌표·최소표본 1건 정책을 구현한다. 공개 수위와 법적 적법성 판단은 동일하지 않으며
마스킹했으니 완전 익명이라는 문구는 쓰지 않는다. 연락처·신고자·피신고자 신원 추정 기능은 추가하지 않는다.

## 차량 규칙 mask-v1
1. NFKC 정규화, 공백·일반 하이픈 제거.
2. 허용된 대한민국 지역 접두어를 맨 앞에서만 판정한다. 동일성 canonical에는 보존한다.
3. 공개 표시에는 짧은 지역명(서울특별시 → 서울, 경기도 → 경기)을 **그대로 앞에 붙인다**. 위치를 셀 때만 건너뛴다.
4. 지역명 뒤 문자열의 1-based 위치 2,4,6의 문자(숫자·한글 모두)를 '*'로 치환한다.
5. 유효한 지원 형식이 아니면 원문을 반환하지 말고 표시 `번호 확인 불가`. 해당 건은 전체 신고수에는 남기되 차량순위 제외 사유 기록.

합성 예시:
| 내부 입력 | 공개 표시 |
|---|---|
| 12가3456 | 1*가*4*6 |
| 123가4567 | 1*3*4*67 |
| 서울12가3456 | 서울1*가*4*6 |
| 경기 123가-4567 | 경기1*3*4*67 |
| 경기76자3623 | 경기7*자*6*3 |

서울12가3456와 서울13가3456은 **서로 다른 canonical**인데 둘 다 `서울1*가*4*6`으로 표시된다. 표시가 같아도 합치지 않는다.
원번호 또는 region prefix를 지운 번호로 행을 묶고 TOP5를 계산하는 것 모두 금지. private canonical 전체로 집계한 뒤 마스킹한다.
같은 마스킹 문자열의 두 차량은 독립 행 유지; '마스킹 표시가 같아도 서로 다른 번호일 수 있음' 안내.

## 공개 전 차단할 필드
raw/canonical vehicle, 안정 vehicle HMAC/hash, report number/internal report IDs, contributor UUID,
snapshot IDs, 이메일·전화번호·계정 이름·Google sub·JWT·refresh token, 신고 본문·답변 전문·첨부 URL.
공개 담당자 이름과 기관 이름은 예외적으로 **명시 허용**된 필드다. 이메일/연락처와 같이 내려오는 payload를 통째로 펼치지 않는다.
차량 raw를 HTML hidden, title, data-attribute, tooltip, aria-label, analytics 이벤트, URL query에 넣어도 노출이다.

## 최소 권한
Pages에는 public API URL·Kakao JavaScript key만 필요하다. Supabase direct-read adapter를 쓰는 경우 publishable key는
공개 설정이며 read-only는 key 이름이 아니라 grants/RLS/함수 권한으로 강제한다.
CI export는 특정 safe view의 SELECT 전용 login role/endpoint를 사용한다. SUPABASE_SERVICE_ROLE_KEY를 read-only라고 이름 바꾸지 않는다.
Kakao REST key는 Actions 또는 중앙 Edge secret. VITE_ 접두어 금지. geocode cache 쓰기가 필요하면 별도 제한 RPC만 허용한다.

## 공개 artifact
Vite root는 web 또는 src 기반 제품 빌드만. docs/design reference PNG에는 원본 예시 번호가 있으므로 dist에 복사 금지.
빌드 후 텍스트·JSON뿐 아니라 sourcemaps·compressed files·CSV·service worker precache 목록을 검사한다.
원본번호 탐지, strict JSON unknown field 거부, secret canary 삽입 테스트를 수행한다.
CORS는 HTTP 비브라우저 호출을 막는 인증 수단이 아니다. 반환 결과 자체가 공개 가능해야 한다.

## 삭제와 보존
공동 지도 기여 철회 → 신규 업로드 차단 → active facts 제외 → aggregate version 교체 → API cache purge →
Actions의 static snapshot 긴급 재생성. 민감한 상세 차량/담당자 응답은 장기 정적 cache로 배포하지 않는다.
공개 파일을 이용자가 저장한 사본까지 원격 회수할 수 있다고 약속하지 않는다.
static snapshot은 생성시각 표시, API에서 더 최신 삭제 version을 알리면 그 즉시 구본 사용을 중단한다.
정정·삭제 요청은 실제 운영 문의 경로 확인 후 연결. 가짜 메일/문의 채널을 만들어두지 않는다.
