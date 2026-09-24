# 기존 앱·서버와의 경계 · 이 패키지의 수정 대상 밖
사용자 합의: Google 로그인 일반 계정 → Supabase UUID 기여자. 이메일은 Auth 비공개, 공개 지도에는 계정정보 없음.
SMS OTP/익명 계정으로 되돌리지 않는다. 기존 안전신문고 로그인과 서버 관리자/API key 인증은 유지한다.

## 실행 담당
- 모바일 standalone: 로컬 DB 집계·업로드·Supabase 세션 저장/갱신을 앱이 담당.
- 모바일 server mode: 앱은 실행/상태 제어; 서버 DB 집계·업로드·예약은 safetyreport 서버가 담당.
- PC/서버 웹: 모바일과 같은 서버 업로드 서비스를 호출. UI 진입점만 다르다.

## 자동 업로드
명시적 동의 후 02~03 KST 분산 실행 목표. 수동 버튼은 보조다.
최초 Google 로그인 이후 실행 담당이 Supabase refresh session을 보호 저장하고 필요 때 자동 갱신한다.
Android는 WorkManager 등 persistent background 경로를 구현하며 배터리 최적화 제외가 정시 보장을 뜻하지 않는다.
지연/강제 중지/오프라인이면 다음 가능한 시점에 보완. 서버 mode는 휴대폰 야간 인증에 의존하지 않는다.
같은 계정의 앱·서버가 동일 refresh token 복제본을 병렬 갱신하지 않는다. Google 비밀번호/관리자키 배포 금지.

## 이 공개 UI 작업이 요구할 upstream 변경
report_date/completed_date, manager-status joint data, private vehicle identity/geo/date relation을
실제 제공 가능한 계약으로 정리한다. 아직 없는 필드는 docs/upstream-gaps.md로 요청하되 다른 레포를 임의 수정하지 않는다.
현재 공개 UI가 기존 서버 DB를 직접 읽거나 안전신문고 로그인을 중앙에서 대신하지 않는다.
