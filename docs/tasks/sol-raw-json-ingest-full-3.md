# Sol 수정 지시서 3 · PC·모바일 검수 결함 수정 (2026-10-21)

검수자(Claude)가 PC·모바일을 실제 환경에서 시험·검수했다. 아래 자료의 결함을 모두 고친다. 규칙·금지는 앞 지시서와 같다.

## 쓰기 범위
- **`pc/` 와 `mobile/` 만.** `map/`·`auth/` 는 검수자가 동시에 수정 중이다. 예외: 새 보고서 `map/docs/implementation/raw-json-ingest-20261021/SOL-REPORT-3.md` 하나.
- 계약 정본(`map/contracts/community-ingest-v2/`, gate-vectors 포함) 변경이 필요하면 pc·mobile 사본을 먼저 고치지 말고 SOL-REPORT-3 에 정확한 변경(파일·내용)을 적는다. 검수자가 정본에 반영하고 사본을 동기화한다.
  (PC·모바일의 판정 코드와 시험은 새 기대값으로 고쳐도 된다.)

## 입력 자료 (map/docs/implementation/raw-json-ingest-20261021/review/)
1. `pc-review.md` — PC 검수 지적 10건 + 배포 위험. 각 항목의 "→" 가 검수자 결정이다.
2. `mobile-review.md` — 모바일 검수 지적 17건 + 낮음. "→" 결정을 따른다.
3. `pc-test-failures.txt` — 검수자 환경에서 PC 전체 시험(`unittest discover`, 1355건) 실행 결과 새 실패 25건(기준 1a67d01 은 1327건 전부 통과). 원인 분류:
   - DB 최적화·사진 보충 시험 다수: 새 작업 허가(소프트 리셋 세대·게이트) 검사 때문에 게이트 문맥이 없는 기존 시험 환경에서 maybe_start 가 None 을 돌려주거나 paused. 기존 사용자 동작(게이트 통과 상태)에서 이 작업들이 그대로 돌아야 한다. 허가 검사는 "명시적 리셋·잠금 중"일 때만 막고, 기존 시험은 바꾸지 않고 통과해야 한다(시험을 고쳐야 한다면 그 이유를 보고서에 항목별로).
   - `community_uploader.stop_background` 없음(AttributeError), 철회 흐름 500(`test_onboarding_consent_flow_and_revoke`), 게이트 기대값 차이, consent catch-up baseline, fallback 목록(`test_fallback_policy` — 새 조용한 대체 지점 3곳을 note_fallback 또는 SILENT_ALLOWED 분류).
4. `mobile-test-failures.txt` — 모바일 `flutter test`(3.47.5) 실행 결과 새 실패 21건(기준 a03d37e0 은 성능 시험 2건만 실패, 부하 영향). 게이트·로그인 보안·소프트 리셋·백그라운드 헤드리스·Client 알림·데모 우회·DB 최적화 closeDb 등.

## 추가 결정
- 서버 계약: 공유 설정이 v2 를 끄면 gzip v2 요청에도 503 service_unavailable(재시도 가능)이다(이번에 서버를 이렇게 바꿨다). 클라이언트는 이를 재시도로 처리하고, status 에 2 가 없으면 v1 로 돌아간다.
- run identity 와 재실행 조건은 mobile-review 11 결정대로(PC·모바일 같게).
- 기존 시험을 새 정책에 맞춰 고칠 때는 "의도한 정책 변경 때문"인지 항목별로 보고서에 적는다. 의도와 무관한 회귀는 코드를 고친다.

## 시험
- PC: 실패 25건이 나온 시험 파일을 포함해 소켓이 필요 없는 시험을 최대한 돌린다(`test_db_optimize*`, `test_maintenance_service`, `test_fallback_policy`, `test_community_consent_catchup`, 새 시험 등). 소켓 시험은 NOT RUN 으로 적는다.
- 모바일: 순수 Dart 검사 스크립트와 `flutter analyze --no-pub`(앞에서 쓴 SDK 사본). tester 는 NOT RUN.
- 검수자가 전체 시험을 다시 돌린다. 재실행 명령을 보고서에 적는다.

## 보고
`SOL-REPORT-3.md`: 지적 항목 번호별 처리(파일·요약·시험), 시험 실패 항목별 원인과 처리, 계약/벡터 변경 요청, 남은 일. 끝까지 진행하고 못 끝낸 것은 명시한다.
