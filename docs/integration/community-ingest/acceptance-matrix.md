# acceptance matrix (요구 → 테스트 → 담당 → 결과)

결과 칸은 실행 증거가 생길 때 채운다(2026-09-26 통합 후보 기준 갱신 — 증거 명령은 각 칸): `passed`(명령·로그 경로) / `failed` / `blocked`(사유) / `not-run`. 파일 존재만으로 passed 로 쓰지 않는다.
repo: PC=safetyreport, M=safetyreport-mobile, MAP=community-map, AUTH=community-auth. 담당 task 는 plan-final §10.

| ID | 요구(원 프롬프트 §22 / Sol) | 테스트 위치 | task | 결과 |
|---|---|---|---|---|
| A01–A03 | 수집값 확정·편집·재전송 불변 | PC `tests/test_community_capture.py`, M `test/community/capture_test.dart` | T4, T6 | passed(단위: PC capture, M capture_test) |
| A04 | 수기 저장·복원·변환은 이벤트 0 | 같음 | T4, T6 | passed(단위) |
| A05 | API 직접·Selenium fallback 같은 payload | PC `tests/test_community_capture.py`(fallback 경로 fixture) | T4 | not-applicable — Selenium HTML 수집기는 387ef8e 에서 제거, API 경로만 남음 |
| A06 | 모바일 일반·재로그인·단건 누락/이중 없음 | M `capture_test.dart` | T6 | passed(단위 M capture_test) |
| A07 | 개인 종결여부 수정이 선정에 안 섞임 | PC `tests/test_community_selection.py`, M `list_refetch_test.dart` | T3, T6 | passed(단위 PC selection 13벡터+A07, M list_refetch) |
| A08 | 완료 판정표 일치 | 세 언어 `vectors/observations.json` | T2, T4, T6 | passed(TS·Python·Dart observations 32 case) |
| A09 | 지오코딩은 공식 주소, override 좌표 무시 | capture 테스트 | T4, T6 | passed(단위, 공식 주소 geocode 만 사용) |
| B01–B13 | outbox·순서·장애·재시도·partial·용량 | PC `tests/test_community_uploader.py`, M `uploader_test.dart`, MAP `tests/integration/ingest.test.ts`(B04·B05·B06·B07·B09 서버쪽) | T4, T6, T2 | passed(단위 PC uploader 45·M uploader) + 서버쪽 실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19): 422·413·415·conflict·duplicate. ingest 429 는 실스택 미유발(account 429 만 확인) |
| C01 | §14 보안 행렬 전 행(+구 RPC·GraphQL·publication·Storage, 행 수 불변) | MAP `tests/integration/security-matrix.test.ts` | T2 | passed(실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19) §14 행 + 쓰기 거절 뒤 행 수 불변). Storage 서비스는 스택에서 제외 → not-run, Realtime 은 publication SQL 로만 |
| C02–C03 | 공개키 단독·해제/철회 후 JWT | 같음 | T2 | passed(실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19)) |
| C04 | A 대기열을 B 토큰으로 안 보냄 | PC·M uploader 테스트 + MAP 행렬 | T4, T6, T2 | passed(실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19) A 토큰+B 연결 403, PC·M uploader context 불일치 단위) |
| C05 | 사용자 간 ID 충돌 무영향 | MAP ingest 통합 | T2 | passed(실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19) C05/S-05) |
| C06–C07 | 갱신 single-flight·local signout | PC `tests/test_community_auth.py`(기존), M `community_auth_service_test.dart`(기존) | 기존 | passed(기존 단위 PC test_community_auth, M auth 테스트) |
| C08 | 철회·ingest 경쟁(+takeover·policy 경쟁, deadlock 0) | MAP `tests/integration/races.test.ts` | T2 | passed(실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19) 철회·takeover·정책 교체 경쟁 3회, deadlock 0) |
| C09 | 재동의로 폐기 grant backlog 자동 업로드 없음 | MAP 통합 + PC·M uploader | T2, T4, T6 | passed(실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19) 재동의 뒤 옛 grant 거절) |
| C10 | helper RPC·view·GraphQL·Realtime·Storage·옛 함수 우회 없음 | security-matrix | T2 | passed(실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19) RPC·REST·GraphQL·publication·grants). Storage not-run |
| C11 | relay pre-login·모바일 직접 로그인 회귀 없음 | AUTH `tests/relay.integration.test.ts`(합성 스택으로 재실행) | T1 | passed(AUTH relay 실스택 24/24 — map 선행 스키마 포함, 브라우저 E2E 11/11) |
| C12 | 연결 완료 표시 전 세션·레지스트리 확정 | PC `tests/test_community_gate.py` | T3 | passed(PC test_community_gate 32) |
| C13 | 같은 계정 재로그인 rebind 후 pending 계속, 다른 grant 승계 없음 | MAP 통합 + PC gate | T2, T3 | passed(PC gate rebind 단위 + 실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19) 두 번째 세션 rebind) |
| D01 | 기존 N건 + 1건 → N+1 | MAP `tests/integration/projection.test.ts` | T2 | passed(실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19)) |
| D02–D03 | 재전송·모드 전환 이중 집계 없음, 구 자료 가드 | projection 테스트 + migration 가드 테스트 | T2 | passed(실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19) 재전송 duplicate) + migration_paths.sh 구 v2 가드 PASS. 모드 전환 이중 집계는 not-run(Client 는 업로드 안 함 — 설계로 배제) |
| D04 | 재개·취하·정정 반영(+manifest 정정) | projection + PC·M capture | T2, T4, T6 | passed(실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19) 최신 정정 → removed·공개 0) |
| D05 | ACK 뒤 재시작해도 반영 유실 없음(동기 트랜잭션) | projection | T2 | passed(실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19) ACK durable=true, 같은 트랜잭션) |
| D06–D07 | KST 경계·결측·0분모, 분모 없는 비율 unsupported | MAP `tests/product/aggregate.test.ts` 확장 | T2 | passed(MAP 단위 74) |
| D08 | 마스킹·원 ID·계정·토큰 노출 스캔 | MAP `npm run scan` + 공개 API 응답 스캔 | T2, T8 | partial — 공개 map 응답에 원 차량번호 없음 확인(실스택). MAP `npm run scan` not-run |
| D09 | 익명 공개 지도 정상·capability 설명 | MAP 통합 + 브라우저 | T2, T7 | passed(실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19) 익명 overview/map). 브라우저는 T7 |
| E01–E04 | 빌드 공개 설정 주입·누락 실패·비밀 거부·산출물 스캔 | PC `tests/test_community_config.py` + 빌드 스캔, M 빌드 스크립트 테스트, AUTH/MAP scan | T3, T6, T8 | passed(PC test_community_packaging 3 + 로컬 PyInstaller 번들·스캔·격리 기동, M 빌드 스크립트 거부 6케이스(T6), AUTH scan PASS). MAP scan not-run |
| E05 | 프로젝트 URL 변경 시 이전 namespace 미전송 | PC·M uploader | T4, T6 | passed(단위 PC·M; M 은 통합에서 namespace 계산 결함 수정) |
| E06 | callback 직접 접근·취소·만료·다중 탭·딥링크 cold/warm | AUTH browser e2e(기존) + M 딥링크 테스트 | T1, T5 | passed(AUTH 브라우저 E2E 11/11, M 딥링크 단위). iOS 실기기 not-run |
| E07 | 합성 migration 이력·checksum·중복 검사 | MAP `scripts/integration/compose_supabase.mjs check` 테스트 | T0 | passed(compose_supabase.mjs check) |
| E08 | fork/PR 테스트가 production 호출 안 함 | workflow 검토 | T8 | not-run(fork/PR 워크플로 검토 안 함; 빌드 워크플로는 vars 공개값만 사용) |
| F01–F20 | 게이트·온보딩 순서·우회 방지 | PC `tests/test_community_gate.py`(라우트 전수), M `test/community/gate_*`·`test/widgets/community_onboarding_*` | T3, T5 | passed(단위 PC gate 32 라우트 전수, M gate·온보딩 위젯). 실기기 not-run |
| G01–G18 | 초기화·DB 전환 | PC `tests/test_community_rebuild.py`, M `test/community/rebuild_*` | T3, T5, T6 | passed(단위 PC rebuild 29, M rebuild). 실제 안전신문고 크롤 not-run(금지) |
| H01–H18 | 실시간·수동·자정 | PC `tests/test_community_schedule.py`·uploader, M schedule·uploader·패널 위젯 | T4, T6 | passed(단위 schedule·uploader). OS 백그라운드 실행 not-run |
| I01 | 로컬 Supabase 실제 HTTP·JWT·RPC·SQL 로 PC fixture 수직 연결 | MAP `tests/integration/vertical_pc.test.ts`(PC 모듈 실행) | Opus 통합 | passed(PC tests/test_community_live_stack.py 실스택) |
| I02 | Dart 업로드 같은 의미 | `tests/integration/vertical_dart` (dart test 가 로컬 스택 호출) | Opus 통합 | passed(M test/community/live_stack_test.dart 실스택) |
| I03 | auth 코드가 저장한 연결·동의를 ingest 가 사용 | MAP 통합 | T1, T2 | passed(실스택: account 가 저장한 grant·연결을 ingest 가 사용) |
| I04 | journal→manual/midnight→fact→공개 API | vertical 테스트 | Opus 통합 | passed(manual 경로 실스택). midnight 는 단위만 |
| I05 | 세 언어 벡터 결과 동일 | 벡터 테스트 3종 | T2, T4, T6 | passed(3 언어 벡터 + 실스택에서 PC·M 키 = 서버 source_report_key) |
| I06 | trigger 기록되나 identity/revision/hash 불변 | ingest 통합 | T2 | partial — duplicate 불변 필드 검사(실스택), trigger 만 다른 재전송 별도 테스트 없음 |
| I07 | 릴리즈 산출물 env 누락·mock·우회·비밀 검출 | 빌드 스캔 | T8 | passed(PC 번들 스캔·빌드 거부 규칙, M 빌드 스크립트) |
| I08 | 실제 카카오·운영 E2E 미실행 분리 보고 | verification-report | Opus | verification-report 에 분리 기재 |
| J01–J12 | 병렬·머지·정리 | parallel-work-manifest + merge 기록 | Opus | not-run |
| K01–K12 | 최근 7일 Sol 감사 | audit-* 문서 | Opus, Sol | not-run |
| S-01 | 좌표 결측 fact 총계 포함, 지점만 제외 | MAP aggregate + projection | T2 | passed(실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19) 통계 포함·지도 제외, location_missing API 노출) |
| S-02 | 철회·재동의 자동 재공개 없음·reshare·삭제 tombstone 영구 | MAP projection + security | T2, T1 | passed(실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19) 철회 제거·재동의 비공개·reshare 재공개·삭제 fence) |
| S-03 | capture 실패 시 개인 저장 보류 → 다음 수집 재조회 | PC·M capture | T4, T6 | passed(단위 PC·M capture 실패 시 개인 저장 보류) |
| S-04 | takeover·재설치 뒤 첫 비적격 관측 정정(manifest) | MAP manifest + PC·M capture | T2, T4, T6 | passed(manifest 실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19) + PC·M 단위 계약 모양) |
| S-05 | 같은 ID 다른 dataset 두 fact | MAP ingest | T2 | passed(실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19)) |
| S-06 | 목록 부분 실패·상세 실패·crash 재개·부재 행 보존·병합 cutover | PC·M rebuild | T3, T5, T6 | passed(단위 PC·M rebuild) |
| S-07 | config_invalid 에서 설정 복구 POST | PC gate | T3 | passed(PC gate) |
| S-08 | update_jobs 뒤 커뮤니티 job 존속 | PC schedule | T3, T4 | passed(PC scheduler split) |
| S-09 | 잠금 순서·경쟁 deadlock 0 | MAP races | T1, T2 | passed(실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19)) |
| S-10 | 구 자료 존재 시 migration 중단(가드) | MAP migration 테스트 | T2 | passed(migration_paths.sh) |
| S-11 | published 직후 익명 API 반영 | MAP projection | T2 | passed(실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19)) |
| S-12 | 목록 상태 변경 재조회(detail_status) | PC·M selection 벡터 | T3, T6 | passed(PC·M list_refetch 13벡터) |
| S-13 | 원격 철회 60초 상한 | PC gate(가상 시계), M gate | T3, T5 | passed(PC gate 가상 시계, M gate 단위) |
| S-15 | 날짜 내 계정 전환 schedule 독립 | PC·M schedule | T4, T6 | passed(단위 PC·M schedule) |
| S-16 | 좌표 문자열 정규형 왕복 | 벡터 + MAP 값 검증 | T2, T4, T6 | passed(벡터 + 실스택 좌표 문자열) |
| S-18 | IP 헤더 무시·구 RPC 음성 | security-matrix | T2 | partial — 구 RPC 음성 실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19), IP 헤더 위조 무시 not-run |
| S-19 | iOS URL scheme·AppDelegate | M plist 파싱 테스트(빌드 미실행 표시) | T5 | passed(정적 plist·AppDelegate 테스트). iOS 빌드 not-run |
| S-20 | 교체 전 선회전 | PC db_backup, M local_db_service | T3, T6 | passed(단위 PC exchange rotate, M local_db_service) |
| S-21 | 게이트→권한(모드 무관)→설정→모드 권한 보충 순서 | M 위젯 테스트 | T5 | passed(M 위젯) |
| N-01 | 값 검증·금액 문법 | 벡터 + MAP 422 테스트 | T2, T4, T6 | passed(벡터 + 실스택=`COMMUNITY_STACK=1 npx vitest run tests/integration`(19/19) 422) |
| N-03 | 정책 (버전, 해시) 불변·해시 변경 시 outdated | AUTH migration 테스트 + MAP ingest | T1, T2 | partial — 정책 불변 트리거 코드 검토, HTTP 테스트 없음. 해시 불일치 → consent_outdated 는 실스택 |
