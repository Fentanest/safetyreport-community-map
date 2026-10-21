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
- 2026-09-28부터 신고번호 `STTEMNT_NO`는 Observation 해시 밖의 private `report_number` 이벤트 필드로 전송한다. 새 앱은 번호가 늦게 확보되면 같은 해시여도 백필 이벤트를 만든다. 형식·계정 간 소유 이전·거절 규칙은 `docs/integration/community-ingest/report-owner-transfer-plan.md`에 있다.
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
- 다른 dataset이 같은 신고 ID 또는 신고번호를 선점한 경우 `report_owned_elsewhere`로 거절한다. 계정 간 이전 성공을 뜻하는 `transferred` ACK는 더 이상 발급하지 않는다. 신고번호는 공개 API/DTO에 포함하지 않는다.


## 원본 JSON v2 로컬 후보 (2026-10-21)

정본은 [구현 계획](implementation/raw-json-ingest-20261021/PLAN.md), 현 상태·미완료 목록은
[SOL-REPORT](implementation/raw-json-ingest-20261021/SOL-REPORT.md)다. 운영에는 적용하지 않았다.
`contracts/community-ingest-v2`의 원본 문자열·보조 필드·선택 비교 DTO를 검증해 private raw와 queue에 저장한다.
워커가 PC 1a67d01의 고정 Python 파서로 해석한 뒤 공용 SQL 투영 함수로 facts를 갱신한다.
`stored` ACK는 중앙 저장 완료이며 `parse_pending`은 지도 반영 대기다. 파싱 실패 시 이전 fact를 유지한다.
새 raw/parsed/diffs/queue는 public API·화면 캐시·rollup·CSV의 원천이 아니며 anon/authenticated에 권한이 없다.
실제 철회는 raw 삭제와 parsed/diffs/queue cascade를 실행한다. 정책 대체(superseded_policy)는 철회와 구분한다.
v1 원장 payload는 30일 뒤 제거하되 재시도 식별에 필요한 최소 메타·해시·영수증은 유지한다.
capability·notice·차단일은 같은 private 설정 행을 사용하며 v2 기본값은 꺼짐, 차단일은 미정이다.
새 계정 status 계약 사본은 [account-api](account-api.md)다. v1 wire 계약 파일은 유지한다.
앱 업데이트 안내: PC·모바일은 account status·v2 ACK 의 `client_notice` 를 쓴다. 지도 웹은 account API 를 부르지 않고
자기 `GET /my-analytics/client-status`(지도 세션 토큰, `internal_map_client_state`)로 같은 설정의 notice 를 읽는다
([personal-comparison §client-status](personal-comparison.md#client-status--앱-업데이트-안내-2026-10-21)). 앱 번들에 버전·링크 기본값은 없다.
