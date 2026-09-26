# 수집 앱(PC·Docker·모바일)과 중앙의 경계

2026-09-26 개정(community-ingest). 계약 정본: `contracts/community-ingest/`, 계획: `docs/integration/community-ingest/plan-final.md`.
이전 판의 "Google 로그인 · 02~03시 KST 분산 업로드 · 로컬 DB 집계 snapshot 업로드" 설계는 **폐기**했다(사용자 지시 2026-09-26).

## 계정·동의
- 기여자 = 카카오로 로그인한 Supabase Auth 사용자(UUID). 이메일은 없을 수 있고 공개하지 않는다. 계정 연결 UI·PKCE relay 는 `safetyreport-community-auth`.
- `[필수] 카카오 인증` + `[필수] 신고내용 공유 동의` 가 두 수집 앱의 **진입 조건**이다(모바일은 권한 안내보다 먼저, PC·Docker 는 기존 관리자 로그인 뒤).
- 동의 정본은 중앙 `community_consent_grants`(정책 버전·동의문 해시·계보). 카카오 로그인만으로 동의가 생기지 않는다.
- 기존 안전신문고 로그인과 서버 관리자·API 키 인증은 그대로 둔다.

## 무엇을 언제 보내나
- 앱이 안전신문고 상세 응답을 받은 순간, 사용자 수정 전 값으로 공유 DTO(`observation-v1`)를 확정해 앱 쪽 `community.db` journal 에 먼저 저장한다.
- 전송은 한 서비스(`request_community_upload(trigger)`), 세 진입점: **수집 직후 실시간**, **신고 지도 탭의 [지금 업로드]**, **매일 00:00 Asia/Seoul**(앱 종료·절전·네트워크 상태에 따라 지연될 수 있고 다음 실행 기회에 이어서 전송).
- 한 이벤트 = 한 신고 관측. 개인 DB 전체를 읽어 보내는 snapshot 업로드, 수동·자정 업로드를 위한 재크롤링은 하지 않는다.
- 이번 업데이트는 사용자 확인 뒤 **1회 초기화 크롤링**으로 과거 완료 신고의 공유 사본을 새로 확보한다(`rebuild.md`).

## 실행 담당
- 모바일 Standalone: 앱이 수집·업로드·세션 갱신·writer 연결을 맡는다.
- 모바일 Client(서버 모드): 앱 사용자 본인의 게이트는 필수, 신고 수집·업로드·초기화·자정 작업은 **연결된 서버**가 맡는다. 앱은 서버 상태를 보고 제어만 한다(서버 신고를 자기 토큰으로 올리지 않는다).
- PC·Docker 서버: 서버 프로세스가 수집·업로드·자정 작업을 맡는다. 브라우저가 닫혀 있어도 서버가 켜져 있으면 실행한다.

## 중앙
- `community-ingest`(사용자 전용 Edge): JWT(getUser+claims)·writer 연결·동의 grant·정책 버전을 저장 트랜잭션 안에서 다시 확인하고 이벤트별 durable ACK 를 돌려준다.
- 공개 지도는 ingest 로 모인 신고별 최신 fact 를 투영한다. 저장 완료(`accepted`)와 지도 반영(`published`)은 ACK 에서 구분된다.
