# Sol 후속 지시서 · PC·모바일 미완료 항목 마무리 (2026-10-21)

앞 지시서 `sol-raw-json-ingest-full.md` 와 보고서 `SOL-REPORT.md` 의 "미완료" 1–6, 8 을 끝낸다. 규칙·금지·시험 방법은 앞 지시서와 같다.

## 쓰기 범위 (중요)
- **`pc/` 와 `mobile/` 만 쓴다.** `map/` 과 `auth/` 는 검수자가 동시에 검수·수정하므로 쓰지 않는다.
  예외: 보고서 새 파일 `map/docs/implementation/raw-json-ingest-20261021/SOL-REPORT-2.md` 하나만 쓴다(기존 SOL-REPORT.md 는 건드리지 않음).
- 계약(`contracts/community-ingest-v2/`) 변경이 꼭 필요하면 pc·mobile 사본을 고치지 말고 SOL-REPORT-2.md 에 필요한 변경을 적는다
  (map 정본은 검수자가 반영한다).

## 할 일 (PLAN 7-2, 7-3, 7-4)
1. `raw_backfill` 실행기(PC·모바일 1:1): `community.db meta.raw_backfill` 완료 표시(`contract, parser_target, local_dataset_id, state,
   cursor, holds, stats`), 재개, 3회 실패 holds, 로그인 문제·연속 실패 휴지, DB 최적화 선행 대기, 누락 채우기 A(목록 전 페이지 대조 —
   `list_ok` 일 때만 판정, 실패 페이지 있으면 미완료)·B(원본 없음/손상 재수집, 404/410 → `raw_unavailable` 기록 후 건너뜀)·
   C(별점·별점사유·사진 촬영시각 보충, 보관기간 지난 사진은 비운 채 기록), 답변 완료 신고 전체 `trigger='raw_backfill'` enqueue,
   모든 대상이 stored ACK 를 받으면 done. 기존 수집·DB 최적화와 같은 잠금을 쓰고 안전신문고 요청 간격을 지킨다.
   **완료 판정 정의(결정 필요 항목에 대한 지시)**: N = 답변 완료 신고 수. `raw_unavailable` 은 "보낼 수 없음"으로 따로 세고 완료를 막지 않는다.
   done 조건 = (N − raw_unavailable) 건 전부 stored ACK. 진행 표시에 `보냄 n / 보낼 수 있는 N′`, `원본 없음 k건` 을 함께 보인다.
2. 실행 트리거: 7-1 전환 조건(새 동의 active + status `ingest.contracts` 에 2)이 처음 성립할 때, 기동 시 미완료면 재개,
   `local_dataset_id` 변경 시 재실행, 소프트 리셋 뒤 같은 계정 재동의 시 재실행. 모바일은 포그라운드 + WorkManager 이어 하기, 망 제한 없음.
3. 진행 UI: PC 지도 탭 카드, 모바일 지도 탭 카드에 "원본 전송 n / N′", 채움/못 채움, holds, 다시 시도.
4. 모든 capture 호출 지점 1:1 전환: 사진 보충, 추정 금액 재전송, 재공유(reshare), 모바일 DB 최적화·재파싱, 알림 단건 등에서 v2 전환 뒤
   v1 이벤트가 만들어지지 않게 한다(전환 전에는 v1 유지). 호출 지점 목록과 처리 결과를 보고서 표로.
5. notice 완결: ACK 로 받은 `client_notice` 저장·전역 표시, 426 `client_upgrade_required` 전역 대화상자(모바일)·배너(PC).
6. Client 모드: PC 가 소프트 리셋·잠금되면 모바일 Client 가 "서버 동의 필요"로 잠기는 전체 경로.
7. 소프트 리셋 완결: 수집·DB 최적화·업로더·예약/백그라운드 작업 즉시 중단, 늦게 끝난 비동기 작업이 새 문맥을 되살리지 않게(세대 번호 등),
   서버 철회 실패 시 "철회 처리 중" 화면과 자동 재시도, 같은 계정 재로그인·재동의 시 DB 이어 쓰기 + raw_backfill 재실행,
   다른 계정 → 기존 `db_owner_mismatch` 흐름.
8. 긴급 정책 시험 정리: 남은 옛 기대값(동의 없음·철회인데 로컬 허용)을 새 규칙으로 바꾸고, 바꾼 시험 목록을 보고서에.

## 시험
- 샌드박스에서 소켓을 못 여는 시험(PC loopback HTTPServer, Flutter tester)은 NOT RUN 으로 적고, 대신 순수 판정·저장 시험을 최대한 늘린다.
  검수자가 소켓 시험·AVD·브라우저를 실행한다.
- 새/바뀐 시험 파일 목록과 실행 명령을 보고서에 적어 검수자가 그대로 돌릴 수 있게 한다.

## 보고
`SOL-REPORT-2.md`: 항목 1–8 별 완료 여부·파일·시험, 남은 일, 결정 필요. 범위를 끝까지 진행하고 못 끝낸 것은 명시한다.
