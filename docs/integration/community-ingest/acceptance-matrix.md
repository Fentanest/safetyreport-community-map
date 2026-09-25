# acceptance matrix (요구 → 테스트 → 담당 → 결과)

결과 칸은 실행 증거가 생길 때 채운다: `passed`(명령·로그 경로) / `failed` / `blocked`(사유) / `not-run`. 파일 존재만으로 passed 로 쓰지 않는다.
repo: PC=safetyreport, M=safetyreport-mobile, MAP=community-map, AUTH=community-auth. 담당 task 는 plan-final §10.

| ID | 요구(원 프롬프트 §22 / Sol) | 테스트 위치 | task | 결과 |
|---|---|---|---|---|
| A01–A03 | 수집값 확정·편집·재전송 불변 | PC `tests/test_community_capture.py`, M `test/community/capture_test.dart` | T4, T6 | not-run |
| A04 | 수기 저장·복원·변환은 이벤트 0 | 같음 | T4, T6 | not-run |
| A05 | API 직접·Selenium fallback 같은 payload | PC `tests/test_community_capture.py`(fallback 경로 fixture) | T4 | not-run |
| A06 | 모바일 일반·재로그인·단건 누락/이중 없음 | M `capture_test.dart` | T6 | not-run |
| A07 | 개인 종결여부 수정이 선정에 안 섞임 | PC `tests/test_community_selection.py`, M `list_refetch_test.dart` | T3, T6 | not-run |
| A08 | 완료 판정표 일치 | 세 언어 `vectors/observations.json` | T2, T4, T6 | not-run |
| A09 | 지오코딩은 공식 주소, override 좌표 무시 | capture 테스트 | T4, T6 | not-run |
| B01–B13 | outbox·순서·장애·재시도·partial·용량 | PC `tests/test_community_uploader.py`, M `uploader_test.dart`, MAP `tests/integration/ingest.test.ts`(B04·B05·B06·B07·B09 서버쪽) | T4, T6, T2 | not-run |
| C01 | §14 보안 행렬 전 행(+구 RPC·GraphQL·publication·Storage, 행 수 불변) | MAP `tests/integration/security-matrix.test.ts` | T2 | not-run |
| C02–C03 | 공개키 단독·해제/철회 후 JWT | 같음 | T2 | not-run |
| C04 | A 대기열을 B 토큰으로 안 보냄 | PC·M uploader 테스트 + MAP 행렬 | T4, T6, T2 | not-run |
| C05 | 사용자 간 ID 충돌 무영향 | MAP ingest 통합 | T2 | not-run |
| C06–C07 | 갱신 single-flight·local signout | PC `tests/test_community_auth.py`(기존), M `community_auth_service_test.dart`(기존) | 기존 | not-run |
| C08 | 철회·ingest 경쟁(+takeover·policy 경쟁, deadlock 0) | MAP `tests/integration/races.test.ts` | T2 | not-run |
| C09 | 재동의로 폐기 grant backlog 자동 업로드 없음 | MAP 통합 + PC·M uploader | T2, T4, T6 | not-run |
| C10 | helper RPC·view·GraphQL·Realtime·Storage·옛 함수 우회 없음 | security-matrix | T2 | not-run |
| C11 | relay pre-login·모바일 직접 로그인 회귀 없음 | AUTH `tests/relay.integration.test.ts`(합성 스택으로 재실행) | T1 | not-run |
| C12 | 연결 완료 표시 전 세션·레지스트리 확정 | PC `tests/test_community_gate.py` | T3 | not-run |
| C13 | 같은 계정 재로그인 rebind 후 pending 계속, 다른 grant 승계 없음 | MAP 통합 + PC gate | T2, T3 | not-run |
| D01 | 기존 N건 + 1건 → N+1 | MAP `tests/integration/projection.test.ts` | T2 | not-run |
| D02–D03 | 재전송·모드 전환 이중 집계 없음, 구 자료 가드 | projection 테스트 + migration 가드 테스트 | T2 | not-run |
| D04 | 재개·취하·정정 반영(+manifest 정정) | projection + PC·M capture | T2, T4, T6 | not-run |
| D05 | ACK 뒤 재시작해도 반영 유실 없음(동기 트랜잭션) | projection | T2 | not-run |
| D06–D07 | KST 경계·결측·0분모, 분모 없는 비율 unsupported | MAP `tests/product/aggregate.test.ts` 확장 | T2 | not-run |
| D08 | 마스킹·원 ID·계정·토큰 노출 스캔 | MAP `npm run scan` + 공개 API 응답 스캔 | T2, T8 | not-run |
| D09 | 익명 공개 지도 정상·capability 설명 | MAP 통합 + 브라우저 | T2, T7 | not-run |
| E01–E04 | 빌드 공개 설정 주입·누락 실패·비밀 거부·산출물 스캔 | PC `tests/test_community_config.py` + 빌드 스캔, M 빌드 스크립트 테스트, AUTH/MAP scan | T3, T6, T8 | not-run |
| E05 | 프로젝트 URL 변경 시 이전 namespace 미전송 | PC·M uploader | T4, T6 | not-run |
| E06 | callback 직접 접근·취소·만료·다중 탭·딥링크 cold/warm | AUTH browser e2e(기존) + M 딥링크 테스트 | T1, T5 | not-run |
| E07 | 합성 migration 이력·checksum·중복 검사 | MAP `scripts/integration/compose_supabase.mjs check` 테스트 | T0 | not-run |
| E08 | fork/PR 테스트가 production 호출 안 함 | workflow 검토 | T8 | not-run |
| F01–F20 | 게이트·온보딩 순서·우회 방지 | PC `tests/test_community_gate.py`(라우트 전수), M `test/community/gate_*`·`test/widgets/community_onboarding_*` | T3, T5 | not-run |
| G01–G18 | 초기화·DB 전환 | PC `tests/test_community_rebuild.py`, M `test/community/rebuild_*` | T3, T5, T6 | not-run |
| H01–H18 | 실시간·수동·자정 | PC `tests/test_community_schedule.py`·uploader, M schedule·uploader·패널 위젯 | T4, T6 | not-run |
| I01 | 로컬 Supabase 실제 HTTP·JWT·RPC·SQL 로 PC fixture 수직 연결 | MAP `tests/integration/vertical_pc.test.ts`(PC 모듈 실행) | Opus 통합 | not-run |
| I02 | Dart 업로드 같은 의미 | `tests/integration/vertical_dart` (dart test 가 로컬 스택 호출) | Opus 통합 | not-run |
| I03 | auth 코드가 저장한 연결·동의를 ingest 가 사용 | MAP 통합 | T1, T2 | not-run |
| I04 | journal→manual/midnight→fact→공개 API | vertical 테스트 | Opus 통합 | not-run |
| I05 | 세 언어 벡터 결과 동일 | 벡터 테스트 3종 | T2, T4, T6 | not-run |
| I06 | trigger 기록되나 identity/revision/hash 불변 | ingest 통합 | T2 | not-run |
| I07 | 릴리즈 산출물 env 누락·mock·우회·비밀 검출 | 빌드 스캔 | T8 | not-run |
| I08 | 실제 카카오·운영 E2E 미실행 분리 보고 | verification-report | Opus | not-run |
| J01–J12 | 병렬·머지·정리 | parallel-work-manifest + merge 기록 | Opus | not-run |
| K01–K12 | 최근 7일 Sol 감사 | audit-* 문서 | Opus, Sol | not-run |
| S-01 | 좌표 결측 fact 총계 포함, 지점만 제외 | MAP aggregate + projection | T2 | not-run |
| S-02 | 철회·재동의 자동 재공개 없음·reshare·삭제 tombstone 영구 | MAP projection + security | T2, T1 | not-run |
| S-03 | capture 실패 시 개인 저장 보류 → 다음 수집 재조회 | PC·M capture | T4, T6 | not-run |
| S-04 | takeover·재설치 뒤 첫 비적격 관측 정정(manifest) | MAP manifest + PC·M capture | T2, T4, T6 | not-run |
| S-05 | 같은 ID 다른 dataset 두 fact | MAP ingest | T2 | not-run |
| S-06 | 목록 부분 실패·상세 실패·crash 재개·부재 행 보존·병합 cutover | PC·M rebuild | T3, T5, T6 | not-run |
| S-07 | config_invalid 에서 설정 복구 POST | PC gate | T3 | not-run |
| S-08 | update_jobs 뒤 커뮤니티 job 존속 | PC schedule | T3, T4 | not-run |
| S-09 | 잠금 순서·경쟁 deadlock 0 | MAP races | T1, T2 | not-run |
| S-10 | 구 자료 존재 시 migration 중단(가드) | MAP migration 테스트 | T2 | not-run |
| S-11 | published 직후 익명 API 반영 | MAP projection | T2 | not-run |
| S-12 | 목록 상태 변경 재조회(detail_status) | PC·M selection 벡터 | T3, T6 | not-run |
| S-13 | 원격 철회 60초 상한 | PC gate(가상 시계), M gate | T3, T5 | not-run |
| S-15 | 날짜 내 계정 전환 schedule 독립 | PC·M schedule | T4, T6 | not-run |
| S-16 | 좌표 문자열 정규형 왕복 | 벡터 + MAP 값 검증 | T2, T4, T6 | not-run |
| S-18 | IP 헤더 무시·구 RPC 음성 | security-matrix | T2 | not-run |
| S-19 | iOS URL scheme·AppDelegate | M plist 파싱 테스트(빌드 미실행 표시) | T5 | not-run |
| S-20 | 교체 전 선회전 | PC db_backup, M local_db_service | T3, T6 | not-run |
| S-21 | 게이트→권한(모드 무관)→설정→모드 권한 보충 순서 | M 위젯 테스트 | T5 | not-run |
| N-01 | 값 검증·금액 문법 | 벡터 + MAP 422 테스트 | T2, T4, T6 | not-run |
| N-03 | 정책 (버전, 해시) 불변·해시 변경 시 outdated | AUTH migration 테스트 + MAP ingest | T1, T2 | not-run |
