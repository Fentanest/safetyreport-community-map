# Sol 2차 통합 재검토 반영 (Opus5.5, 2026-09-26)

대상: `integration-review-sol-02.md`(판정 "수정 후 재검토"). 새 고정 후보는 네 레포 `ci0926/integration` HEAD
(map: 이 문서가 들어간 commit, auth `3be1c39` 변경 없음, PC `b8e49a9`, mobile `96085981`).
증거 로그는 **이번엔 git 에 추적**한다: `docs/integration/community-ingest/evidence/2026-09-26-r3/`(키·JWT 치환, ANSI·접속 로그 줄 제거).
`.gitignore` 의 `*.log` 에 예외를 넣었다(1차 제출 때 로그가 추적되지 않았던 것은 사실이었고, 그 문서의 해당 주장은 이 문서로 정정한다).

## 차단 결함

| ID | 조치 | 코드 | 검증 |
|---|---|---|---|
| H-03a | 삭제 대기 표시를 파일·prefs 에서 **journal 과 같은 `community.db` 의 meta 행**(`deletion_pending:<id>`)으로 옮기고, **중앙 `contributions-delete` 호출 전에** 트랜잭션으로 쓴다. 쓰지 못하면 중앙 삭제를 요청하지 않는다(PC 409 안내, 모바일 안내 문구). 중앙 성공 뒤 적용은 한 트랜잭션(경계 = 적용 시점 journal 최대 rowid, 시계 무관). 표시가 남으면 업로드·reshare 는 먼저 적용을 시도하고 못 하면 보내지 않는다. 표시와 journal 이 같은 파일이라 "표시만 잃고 옛 사본이 남는" 상태가 없다. | PC `services/community_capture.py` `begin_deletion`·`cancel_deletion`·`apply_pending_deletion`·`deletion_cleanup_pending`, `web/routers/community_route.py` `_contributions_delete`; M `lib/community/capture/server_completed.dart`, `lib/community/upload_hooks.dart` `requestDeletion`, `lib/community/community_wiring.dart`, `lib/widgets/community_account_card.dart` | PC `tests/test_community_deletion.py`: 표시 쓰기 실패 → 중앙 호출 0(`test_route_does_not_call_central_delete_when_the_marker_cannot_be_written`), 표시 남음 → 업로드·reshare 전송 0(fake 송신 기록), 다음 실행이 적용. M `integration_contract_test.dart` "deletion request order": 표시 실패 → 중앙 호출 0, 중앙 실패 → 자기 표시만 취소·예외 전파, 성공 → 적용. M `uploader_test.dart` "deletion cleanup": 표시 남음 → 업로드 송신 0·reshare null, 저장소 닫힘 → 계속 차단 |
| H-03b | 표시는 삭제별 행이라 서로 덮지 않는다. 중앙 실패 때는 **자기 id 행만** 지운다. 적용은 한 트랜잭션(PC `BEGIN IMMEDIATE`, 모바일 sqflite 트랜잭션 직렬화)에서 남은 표시를 모두 처리하고 지운다. | 같음 | PC `test_failed_central_delete_removes_only_its_own_marker`, `test_concurrent_deletions_each_apply_and_none_is_lost`(스레드 4개 동시 적용); M "cancel removes only its own marker; concurrent applies lose nothing" |
| M-02 | Realtime: 각 `phx_join` 응답 상태를 모두 기록·확인하고, **양성 대조**(로컬 스택 전용 공개 표 `it_realtime_control` 을 publication 에 넣음)가 실제로 변경을 받는지 먼저 증명한 뒤 private 표 구독에는 변경 0 을 요구. Storage: 기본 버킷 0·클라이언트 버킷 생성 거절에 더해, **실제 비공개 임시 버킷**에서 anon·사용자 업로드 거절(RLS)·객체 0·읽기 거절. 삭제 경쟁은 실행 중 받은 `d.session.userId` 3개로 공개 fact 0 확인. 계약 형식이 아닌 5xx 는 **같은 시간대 serve 로그의 작업자 종료 기록 수 이하**일 때만 런타임 원인으로 인정(이상은 실패), 계약 5xx 는 0. | MAP `tests/integration/community-stack.test.ts` | `map-stack-run-1..6.log`: run-1 은 대조 표를 **처음 만든 직후** Realtime 이 새 publication 표를 늦게 받아 대조 이벤트 미수신으로 실패(그대로 제출), run-2..6 연속 21/21 |
| M-03 | 로그 추적, 매트릭스 갱신, Firefox 간헐 실패 재확인(아래) | `.gitignore`, `acceptance-matrix.md`, `evidence/2026-09-26-r3/` | — |

## Sol 이 지적한 잔여 위험에 대한 판단
- **H-01 정상 경로 영향**: 연결이 있고 manifest 가 일시 불가하면 개인 동기화도 멈춘다 — 의도(공유 사본 누락 방지)이며, 게이트 자체가 중앙 연결을 요구하므로 "공유를 끄는" 경로는 제품에 없다(필수 기능). 사유는 수집 오류 문구로 보인다. 실기기 UX 는 운영 전 확인 목록에 둔다.
- **M-01 비용**: broadcast 의 게이트 평가를 스레드로 옮겼다(`asyncio.to_thread`) — 이벤트 루프를 막지 않는다. 세션 파일 순간 오류 시 연결을 닫는 fail-closed 는 유지한다.
- **런타임 503**: 위 M-02 의 대조 방식으로 바꿨다. 이번 제출 로그에서 계약 외 5xx 는 기록되지 않았다(`[race]` 경고 없음).
- **실경로 파서 동등성**: Sol 과 같은 판단 — 한계로 표시하고 통과로 쓰지 않는다.

## 실행 결과 (evidence/2026-09-26-r3)
| 영역 | 결과 |
|---|---|
| map 실스택 ×6 | 1회 실패(위 설명), 이후 5회 연속 21/21 |
| migration 4경로 + legacy 가드 | `map-migration-paths.log` |
| map 단위 / Deno 2.9.7 / compose check | 74 passed / 4 ok / ok |
| auth relay·브라우저·단위 | auth 후보 변경 없음(3be1c39) — 2차 실행 로그 복사 24/24·11/11·33 |
| PC 단위 / 실스택 | 368 OK(skip 4) / 1 OK |
| PC 브라우저 스모크 | 125/126 — 실패 1건은 firefox ops-pages 콘솔 오류: trace 상 **외부 CDN 폰트(Pretendard, jsdelivr) 다운로드 실패**(네트워크). 제품 코드 무관, 이전 제출의 간헐 실패도 같은 시험(원인 문구는 그때 덮여 미확인) — `pc-browser-smoke-firefox-cause.txt` |
| mobile | 511 passed(3 skipped), analyze error 0, 실스택 1 passed |
