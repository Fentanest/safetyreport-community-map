# GPT-6-Sol 독립 계획 재확인 (plan-review-sol-final)

## 0. 범위와 검증 방법

- 대상은 `plan-resolution.md`(R), `plan-final.md`(P), `contracts/community-ingest/`(C), 고정 코드 스냅샷(PC/M/MAP/AUTH), `review-input/10_account_registry.sql`(POC-A), `review-input/20_community_ingest.sql`(POC-M)이다. 줄 번호는 이 worktree의 원문 기준이다. `plan-resolution.md:34`의 스택 결과는 작성자 진술로 취급했고 Docker·네트워크·다른 worktree를 실행하거나 수정하지 않았다.
- 계약 생성기는 실행하지 않았다. 독립 재계산기 `review-input/tmp/independent_vectors.py:1-88`를 작성해 `python review-input/tmp/independent_vectors.py`를 실행했다. 관측 25건, 이벤트 결정 7건, payload·적격성·canonical JSON·SHA-256 불일치 **0건**. `contracts/community-ingest/MANIFEST.sha256:1-20`의 20개 파일은 `sha256sum -c` 전부 OK였다.
- POC는 최종 계획보다 앞선 SQL이다(`review-input/20_community_ingest.sql:1-3`). POC의 인증·동시성 결과가 최종 계획의 보안·공개 의미를 증명한다고 보지 않는다.

## 1. 총평과 착수 판정

**현재 plan-final 그대로는 구현 착수 불가.** S-02와 S-10의 critical 데이터 공개·소실 경로가 남았다. S-03/S-04/S-06/S-12/S-20/S-21과 N-03에도 high 설계 공백이 있다. 해결된 항목도 많지만 처리표의 “수용”은 구현 검증이나 원 지적 해소와 같지 않다.

가장 직접적인 반례는 두 가지다. 기존 v2 fact는 contributor의 `revoked_at is null`이면 공개된다(`MAP:supabase/migrations/202609240001_analytics_v2.sql:104-109`). 재동의가 이 값을 null로 되돌리므로(`POC-A:183-185`; P `3.2:54`), 신규 ingest가 아직 없는 사용자의 과거 v2 자료가 별도 다시 공유 없이 재등장한다. 반대로 첫 ingest 한 건은 해당 contributor의 v2 전체를 제외한다(`P:66,69-72`). 원 요구 `review-input/original-prompt.md:967-970`의 “새 한 건으로 이전 수천 건이 없어지지 않아야 한다”와 정면 충돌한다.

## 2. S-01~S-21 처리 판정

| ID·원 심각도 | 판정 | 원문 근거와 남은 판단 |
|---|---|---|
| S-01 critical | **해소(계획)** | 좌표 없는 완료 fact를 반환하고 bbox·지점에서만 제외하며 모집단을 축소 표기했다(`P:69-73`). 공개 집계 구현 검증은 별도 필요. |
| S-02 critical | **미해소** | fact의 수락 grant 필터는 개선(`P:15,64,70`). 그러나 legacy v2는 재동의 시 재공개되고(`MAP:…/202609240001_analytics_v2.sql:104-109`, `POC-A:183-185`), 사용자 시각 `captured_at`만으로 삭제 tombstone을 판정한다(`P:65-68`). §3.1 참조. |
| S-03 high | **부분** | `personal_save_state`와 journal 선저장은 정의(`P:12,95`, `C/local-store.md:20-30,76-80`). 그러나 capture 실패를 로그만 남기고 개인 저장을 계속하면 완료 Y 상세가 증분에서 사라져 공유 관측을 영구 놓칠 수 있다(`C/interfaces.md:60-62`, `PC:core/database/database.py:459-483`). §3.3. |
| S-04 high | **부분** | 같은 연결 rebind·takeover pending 차단·명시적 reshare는 명료(`P:53,98-99,132-138`). 새 writer의 빈 journal에서 최초 비적격 관측은 correction 이벤트가 없어 이전 공개 완료 fact가 남는 전환 사례가 빠졌다(`C/observation.md:61-66`). §3.4. |
| S-05 high | **해소(계획)** | fact 키에 연결의 dataset_key를 넣고 source key 서버 계산을 선언(`P:14,63-64`, `C/account-api.md:41`). POC는 아직 미반영. |
| S-06 high | **부분** | PC `--force` 연결과 모바일 부재행 보존, 제자리 갱신+백업으로 문구 정정(`P:118-125`). 그러나 무변경 행·영구 오류 행을 staging 전환에 어떻게 보존하는지 불명확(`C/local-store.md:40-45,76-77`, `C/rebuild.md:21-25`). §3.5. |
| S-07 high | **해소(계획)** | 정확한 설정 복구 POST와 인증·CSRF 유지가 명시됨(`P:104-110`). |
| S-08 high | **해소(계획)** | 크롤 job만 교체하고 커뮤니티 job 재등록(`P:135-136`, `C/interfaces.md:47-63`). |
| S-09 high | **부분(POC 차이)** | 최종 잠금 순서와 40P01/40001 처리 계획은 타당(`P:51,79,165`). 현재 POC는 policy 잠금이 없고 grant도 FOR UPDATE/SHARE 없이 읽는다(`POC-A:161-170`, `POC-M:103-118`). 구현에서 계획 순서를 실제 SQL/트리거까지 강제해야 한다. |
| S-10 high | **미해소; critical로 상향** | “첫 ingest 수락”을 contributor 전체 authoritative 전환으로 삼는다(`P:66,71`). 기존 1000건+새 1건이면 999건 소실. 원 요구 `original-prompt.md:967-970` 위반. §3.2. |
| S-11 medium | **부분** | published에 ready·generated_at·공개 RPC 포함 조건을 넣었다(`P:74-75`). 하지만 S-10 전환 시 새 한 건만 보이는데 ‘공개 완료’가 되고, POC는 generated_at을 검사/갱신하지 않는다(`POC-M:126,198-209`). |
| S-12 high | **부분** | 완료 후 목록 변화 감지는 제안(`P:139-140`), 벡터도 있음(`C/vectors/list_refetch.json:1-78`). 다만 목록 upsert가 기존 `상태`를 상세 선정 전에 덮는다(`PC:start.py:146,210`, `PC:core/database/database.py:568-579`; `M:lib/services/sync_engine.dart:220-238`). 마지막 *상세 C_NOW 상태*의 별도 보존 위치가 계약에 없다. §3.6. |
| S-13 high | **해소(계획)** | 온라인 ≤60초 poll, 새 작업 60초 검증, 로컬 철회 동기 무효화, 오프라인 상한을 적었다(`P:101-103`, `C/gate.md:8-23`). 이 지연은 원 요구의 “즉시”에 대한 명시적 운영 해석이며 실제 시간 제어 테스트가 필요. |
| S-14 medium | **부분** | 벌점 필드·enum은 추가(`P:84-87`, `C/observation.schema.json:62-95`). 금액 문법은 부호·단위를 무시해 잘못된 확정값을 만들고 combined의 생성 규칙은 없다(`C/observation.md:49-52`). §3.9. |
| S-15 medium | **해소(계획)** | schedule PK에 namespace·contributor·dataset·epoch·날짜 포함(`P:96`, `C/local-store.md:53-59`). |
| S-16 medium | **해소(계획)** | e7 양자화를 제거하고 double 최단 왕복 문자열·원 문자열 저장을 명시(`P:64,84-86`, `C/observation.md:54-56,74`). 표본 계산 일치. |
| S-17 medium | **해소(계획)** | T0 인터페이스와 단일 writer, 포트·DB 소유를 지정(`P:145-162`, `C/interfaces.md:45-95`). |
| S-18 high | **해소(계획), 증거 제한** | IP 헤더를 한도 근거에서 제외하고 구 RPC·private REST·GraphQL·Realtime·Storage 공격 행렬을 계획(`P:76,81-82`). POC는 일부 직접 RPC만 검증(`review-input/poc_rpc.mjs:30-42`); 최종 구현 보안 증거는 없다. |
| S-19 high | **해소(계획)** | iOS plist·AppDelegate·cold/warm callback 소유·테스트 한계 명시(`P:112-113,154-155,165`). |
| S-20 high | **부분** | DB 교체 후 rotate 및 소유자 지정(`P:98,127,152,155`). 그러나 교체 성공과 rotate 사이 crash를 복구할 durable intent/fingerprint가 없다(`C/local-store.md:81`). §3.7. |
| S-21 high | **미해소** | 계획은 gate→Setup→Permission(`P:25-27`), 원문은 gate→기존 권한 안내/요청→실행 설정(`original-prompt.md:402-414`). 모드별 권한 의존성은 분리 설계로 풀어야 하며 원 요구를 조용히 뒤집을 근거는 없다. §3.8. |

## 3. 남은 결함과 수정·회귀 기준

### 3.1 S-02 · critical · 재동의와 삭제 뒤 과거 공개 재등장

**근거:** `P:15,65-71`; `POC-A:176-185,195-203`; `MAP:supabase/migrations/202609240001_analytics_v2.sql:104-109`; `C/observation.md:66,73`. **문제:** 계획의 신규 fact grant 필터는 legacy v2 fact에는 적용되지 않는다. 철회 시 profile.revoked_at을 기록했다가 재동의 때 null로 되돌리면 아직 authoritative 전환되지 않은 사용자의 legacy v2 fact가 자동 재공개된다. tombstone도 삭제 요청 시각과 클라이언트가 제공한 captured_at만 비교한다. 새 로컬 데이터셋·시계가 앞선 장치의 재관측은 삭제 전 신고라도 “삭제 후 관측”으로 통과할 수 있다. **영향:** 철회/삭제 의사를 거스르는 공개 및 정적/동적 집계 재등장. **수정:** legacy 공개를 grant 세대 또는 별도 legacy suppression marker에 귀속시키고 철회·삭제 이후 기본 비공개로 고정한다. 삭제는 서버 관리 generation/epoch를 두고 클라이언트 시각과 무관하게 옛 source identity를 차단한다. 신규 재공개는 새 grant 아래 명시적 행위로만 승인한다. **테스트:** legacy 2건→철회→재동의(ingest 0건)에서도 0건, 삭제→다른 장치/새 dataset/미래 captured_at 이벤트도 0건, 명시적 새 권한 절차만 허용; live API와 정적 버전 동시 확인.

### 3.2 S-10 · critical · 첫 신규 fact가 기존 한 기여자의 전체 공개를 숨김

**근거:** `P:15,66,69-72`; `R:19`; 원 요구 `original-prompt.md:553,967-970`. **문제:** contributor 단위 전환 자체는 합리적 범위일 수 있지만, “첫 ingest 수락”은 전수 수집/ACK/coverage 완료 증거가 아니다. **영향:** 구 v2 1000건 중 새 1건만 받은 순간 999건이 지도·통계에서 사라진다. **수정:** 전환 marker를 첫 이벤트가 아닌 해당 contributor/dataset의 검증된 완전 전환 완료 후 찍는다. 이전 자료의 안정 ID가 없으면 전환 전 혼합 집계의 중복 가능성을 coverage로 표시하거나 두 계열을 분리해 보여야 한다. 전환 경계의 old/new count·누락·중복·rollback 조건을 정의한다. **테스트:** 구 v2 1000건+신규 1건·동일/다른 신고·rebuild 실패/영구 누락·철회 각각에서 이중 집계와 999건 소실이 없는지 익명 API로 확인.

### 3.3 S-03 · high · capture 실패 후 완료 상세의 재시도 근거가 없음

**근거:** `C/interfaces.md:60-62`; `PC:core/database/database.py:459-483`; `M:lib/services/sync_engine.dart:226-238`; `P:12,95`. **문제:** capture 예외를 로그에 적고 개인 저장을 계속하면 개인 상세는 종결 Y가 되고, 목록 상태도 변하지 않을 수 있어 이후 증분에서 해당 신고를 다시 읽지 않는다. `capture_failed`의 내구 테이블·재시도 스케줄도 계약에 없다. 개인 commit 후 `mark_personal_save` 전 crash의 reconciliation도 정의되지 않았다. **영향:** 공식 사본 영구 누락, 영원한 pending 표시. **수정:** capture 실패를 durable item으로 저장해 공식 상세 재조회 대상으로 강제하거나, 해당 개인 저장 성공을 공유 capture 성공과 묶는 명확한 오류 경로를 정한다. pending/saved는 개인 DB에서 재조정한다. **테스트:** journal open/insert 실패, 개인 commit 직후 crash, mark 실패를 주입하고 정상 증분만으로 원본 사본·상태가 회복되는지 확인.

### 3.4 S-04 · high · writer 전환 후 비적격 정정을 전송하지 못함

**근거:** `C/observation.md:61-66`; `P:53,98-99,132-138`; `C/rebuild.md:21`. **문제:** A writer가 완료를 공개한 뒤 공식 상태가 취하되고 B가 takeover하여 새 빈 journal로 전체 재수집하면, B의 최초 비적격 관측은 prev=null이라 이벤트가 없다. A의 pending correction은 새 connection/epoch로 승계되지 않는다. reshare는 최신 eligible에만 허용한다. **영향:** 공개 fact가 취하 후에도 완료로 남는다. **수정:** takeover/rebuild 때 중앙의 해당 dataset 기존 공개 identity를 안전하게 대조할 수 있는 사용자 전용 manifest를 제공하거나, 검증된 전체 재수집의 비적격 결과도 이미 공개된 fact에 한해 correction으로 전송하는 규칙을 추가한다. **테스트:** A 완료 공개→취하→B takeover→B 전수 상세, 중앙 완료 fact 0; A pending correction이 blocked여도 같은 결과.

### 3.5 S-06 · high · staging 전환에서 무변경·오류 행의 최신 근거가 빠질 수 있음

**근거:** `C/observation.md:61-64`; `C/local-store.md:40-45,76-77`; `C/rebuild.md:21-25`; `P:123-125`. **문제:** 무변경 eligible 관측은 새 journal 이벤트가 없는데 staging 행은 `event_id NOT NULL`이다. 계약은 기존 최신 event_id를 staging에 복사하는지 말하지 않는다. `completed_with_gaps`에서 영구 실패한 ID도 staging에 없을 수 있는데 cutover는 전체 `report_latest` 교체다. **영향:** 최신 원본 사본 포인터가 사라져 이후 위치 보강·정정·다시 공유가 누락될 수 있다. **수정:** rebuild 대상별로 무변경이면 기존 최신 journal 포인터를 staging에 넣고, 영구 실패/목록 부재는 기존 포인터를 명시적으로 carry-forward한다. 새 공식 부재를 근거로 제거하려면 별도 승인된 정책을 둔다. **테스트:** 기존 완료 3건(변경 1, 무변경 1, 영구 실패 1)→cutover 뒤 세 최신 포인터와 미ACK 원장 유지; 무변경 신고의 뒤늦은 위치 보강 가능.

### 3.6 S-12 · high · 상태 변경 탐지용 과거 상세 목록 상태가 덮임

**근거:** `P:139-140`; `C/vectors/list_refetch.json:23-48`; `PC:start.py:146,210`; `PC:core/database/database.py:568-579`; `M:lib/services/sync_engine.dart:220-238`; `M:lib/services/local_db_service.dart:190-225`; `PC:services/parser.py:296-314`. **문제:** 계획의 비교값은 `처리상태`가 아니라 상세 응답의 `C_NOW` 라벨(`title_fields['상태']`)이어야 한다. 기존 title 상태는 목록 갱신으로 먼저 덮인다. 현재 local-store 스키마에는 상세 관측 당시의 별도 C_NOW가 없다. **영향:** 완료→취하/진행 변경을 놓치거나, 처리상태와 C_NOW를 비교해 모든 완료 신고를 계속 재조회한다. **수정:** 별도 `last_detail_list_status`를 source journal/report state에 저장하고 목록 upsert 이전 또는 그 독립 컬럼과 새 목록 C_NOW를 비교한다. 값은 상세 파서의 `progress_status`에서만 갱신한다. **테스트:** 목록 `답변완료→취하` 전에 title upsert를 실행해도 한 번 재조회, 변경 없는 완료는 0회; 처리상태 `수용`과 C_NOW `답변완료`를 섞어 비교하지 않는지 확인.

### 3.7 S-20 · high · DB 교체와 dataset 회전 사이 crash

**근거:** `C/local-store.md:8-18,81`; `P:98,127,152,155`; `M:lib/services/local_db_service.dart:2722-2758,2920-2935`. **문제:** 개인 DB 파일 교체 성공 뒤 `rotate_dataset` 호출 전 앱이 죽으면 새 개인 DB와 옛 community context가 결합된다. **영향:** B 자료를 A의 source namespace/revision으로 해석하거나 초기화 필요 판정을 건너뛸 수 있다. **수정:** 교체 전 durable intent에 이전/예정 dataset과 개인 DB fingerprint를 기록하고, 재시작 시 파일 상태를 판별해 commit/rollback 회전을 완료한다. **테스트:** 파일 교체 직전·직후·rotate 직후 강제 종료, A pending은 B 토큰으로 0건, B는 재초기화 필요.

### 3.8 S-21 · high · 명시된 모바일 화면 순서 반대

**근거:** 원 요구 `original-prompt.md:402-414`; `P:25-27`; 기존 `M:lib/screens/setup_screen.dart:75-90,123-159`, `M:lib/screens/permission_screen.dart:70-75`. **문제:** 계획은 게이트 이후 기존 Setup을 Permission보다 먼저 두었다. 모드 의존 권한 판단은 실제 제약이지만 원문의 순서를 변경할 승인 근거가 아니다. **영향:** 구현 완료 뒤에도 acceptance 순서 불일치. **수정:** 게이트→모드 독립적인 기존 권한 안내/요청→설정→모드 의존 권한 보충으로 분리하거나, 사용자에게 순서 변경을 명시적으로 결정받아 요구를 갱신한다. **테스트:** 새 설치/기존 세션·Standalone/Client 첫 프레임과 OS 권한 팝업 순서, callback/Back 복귀.

### 3.9 N-01 · medium · 계약 유효값 검증과 금액 문법이 어긋남

**근거:** `C/observation.md:47-56,70-74`; `C/observation.schema.json:70-95,104-116,140-170`; `P:79`. **문제:** Schema는 `2026-02-30`, `location.source=none`+실제 좌표, 범위 밖 좌표, 비최단 표기 `37.000`, 비적격 상태의 completed_date를 허용한다. 서버 검증 문장은 status/event 일치만 구체화해 값 검증 책임이 불분명하다. 금액의 “숫자만 이음”은 `과태료: -10,000원`을 10000원, `과태료: 10만원`을 10원으로 만들 수 있고, prose에 없는 최대 1억원/벌점 1000 제한은 Schema에만 있다. **영향:** 조작/오입력 통계와 PC·Dart·서버 불일치. **수정:** 조건부·달력·범위·최단 표기 및 금액의 완전 일치 문법/상한 초과 처리 규칙을 계약과 서버 검증에 같이 고정한다. **테스트:** 위 악성/경계 입력을 Python·Dart·TS 파서와 Edge schema에 통과시켜 모두 같은 거절/unknown 결과.

### 3.10 N-02 · medium · 계획에 명시한 acceptance 파일이 없음

**근거:** `P:19-20,164-165`; 현재 `docs/integration/community-ingest/`에는 `acceptance-matrix.md`가 없고 `C/README.md:17-30`에도 없다. **문제:** S별 테스트·소유자 매핑을 외부 문서에 위임했지만 그 문서가 아직 없어 구현자에게 검증 완료 기준이 전달되지 않는다. **수정:** T0의 첫 산출물로 acceptance matrix를 생성하고 본 계획의 critical/high 반례 및 테스트 ID를 포함한다. **테스트:** T0 gate에서 파일·ID·소유자 존재와 contract manifest 일치 검사.

### 3.11 N-03 · high · 정책 문구 해시가 바뀌어도 옛 동의가 유효

**근거:** `POC-A:8-25,101-109,161-164`; `POC-M:111-116`; `P:50-52,67`. **문제:** consent grant에는 `consent_text_sha256`이 저장되지만 status와 ingest는 활성 grant의 `policy_version`만 현재 정책과 비교한다. 같은 버전 문자열을 유지한 채 중앙 정책 문구/해시가 바뀌면 과거 문구에 대한 동의를 새 문구 동의로 취급한다. SQL 제약에는 버전·해시 쌍의 불변 조건이 없다. **영향:** 실제 동의하지 않은 공유 조건으로 게이트·업로드가 통과할 수 있다. **수정:** 정책 변경은 새 버전 발급만 허용하고, status·ingest 양쪽에서 현재 정책 해시와 grant 해시도 비교한다. **테스트:** 같은 버전에서 해시만 바꾼 운영자 갱신을 거절하거나, 이미 존재하면 status/outbox/ingest가 `consent_outdated`로 차단되고 새 명시적 동의를 요구하는지 확인.

## 4. 계약 벡터와 스키마 검증

- 독립 스크립트는 `clean`의 제어문자/공백/코드포인트 자름, 처리상태 적격성, 날짜 달력 검사, 금액·벌점, 좌표 double 문자열, canonical JSON/SHA-256, 이벤트 결정을 별도 코드로 재계산했다. **25+7건 전부 일치**(`review-input/tmp/independent_vectors.py:1-88`; 원 벡터 `C/vectors/observations.json:1`).
- 좌표 표본: `geocode_long_decimals_kept`의 127.02861010903201 입력 double은 `127.02861010903202`가 최단 왕복 표현이고, 정수 37/127은 `37.0`/`127.0`이다(`C/vectors/observations.json`; `C/observation.md:54-56`). 문자열 숫자, 결측·범위 밖도 예상과 일치했다.
- `date_formats`는 2026.02.28→2026-02-28, 20260301→2026-03-01; `invalid_calendar_date`는 둘 다 null이다. `whitespace_and_controls_cleaned`, `long_text_truncated_by_code_point`, `penalty_points_only_text`, 0원도 문서와 일치했다. event 7건은 같은 해시 무이벤트·eligible→비eligible correction·재eligible 완료 이벤트까지 일치한다.
- 이 성공은 벡터에 포함된 정상 범위의 적합성이다. 스키마의 조건·달력·좌표 정규형 공백(N-01)과 새 writer의 비적격 정정(S-04)은 벡터가 검증하지 않는다. `C/envelope.schema.json:92-98`은 reshare를 허용하지만, reshare의 `trigger=reshare` 결합과 권한은 Schema만으로 강제하지 않는다. `C/ack.schema.json:27-94`도 accepted/duplicate 시 durable/receipt 조합을 조건부로 강제하지 않는다.

## 5. POC SQL과 최종 계획의 차이 — 구현 시 폐기/수정 대상

| 항목 | POC 원문 | 최종 계획·필요 변경 |
|---|---|---|
| fact·event identity | `POC-M:7-29,31-63,159-166`에 dataset_key 없음, fact PK는 (contributor, source_report_key). 이벤트가 보낸 source_report_key 사용 | `P:63-64,67`: 두 테이블에 연결의 dataset_key, fact 복합 PK, source key 서버 계산·검증. 동일 ID/다른 공식 계정 회귀. |
| grant 공개 기준 | `POC-M:247-252`는 **사용자의 임의 활성 grant**만 존재하면 과거 fact 포함. 같은 해시일 때 grant 변경도 no_change(`173-179`) | `P:67,70`: **fact.consent_grant_id 자체**가 활성인지 검사, grant가 다르면 accepted/reshare로 갱신. 재동의 자동 재공개 방지. |
| 삭제 | POC-A 함수 목록 `280-292`에 delete 없음. POC-M에 tombstone·삭제 RPC 없음 | `P:53,65,68`: 서비스 전용 delete와 tombstone 추가. §3.1의 서버 세대형 삭제 의미로 먼저 수정. |
| 잠금 | `POC-A:161-170,191-203,220-222`; `POC-M:103-118` policy 읽기만, ingest grant는 잠금 없음, contributor→policy 순서 | `P:51,67`: policy→contributor→grant→connection→fact→analytics_state 전 RPC·트리거 공통. 철회/policy/takeover 경쟁 반복. |
| 이벤트 상태·중복 | `POC-M:19,25,138-155` reshare 없음; 같은 event_id는 payload hash만 비교, metadata/귀속 변경 검증 없음 | `P:63,67,88`: reshare 허용, 동일 event 전체 불변 필드 충돌 판정과 서버 계산 hash/key를 명세. |
| 공개 RPC | `POC-M:227-269` ingest만 읽고 `f.lat is not null`, old v2와 contributor source marker 없음, fact_identity에 dataset 없음 | `P:66,69-73`: 좌표 결측 포함, bbox만 제외, legacy source 병합과 안전한 authoritative cutover, dataset을 identity에 포함. |
| 공개 상태·ACK | `POC-M:126,198-209`은 ready만 보고 published, `generated_at` 갱신 없음. `POC-M:216-224`은 모든 snapshot 변경 시 ready 유지 | `P:67,74-75`: ready+generated_at, contributor만 ready 유지, snapshot 변경은 ready=false, version·generated_at 트랜잭션 반영. |
| fact 내용 | `POC-M:40-60,162-190`에 penalty_points·lat_text/lng_text 없음 | `P:64` 필드·원 문자열 보존을 추가하고 결측·정확 좌표 검증. |
| POC 증거 범위 | `review-input/poc_rpc.mjs:13-21`은 가짜 Kakao identity와 `payload:{x:hash}`/임의 derived, service role RPC 직접 호출; `30-42`는 일부 역할·철회만 검사 | `P:56-59,78-82,164-165`의 실제 Edge getUser, schema/hash/파생, old RPC/GraphQL/Realtime/Storage, 익명 공개 결과는 **아직 검증되지 않음**. POC 결과를 최종 수직 검증으로 인용 금지. |

POC-A의 상태 응답은 `dataset_key`를 포함(`POC-A:123-129`)하지만 P의 상태 응답 설명에는 빠져 있다(`P:59`); `C/account-api.md:26-27`에는 있다. 최종 API 문서·테스트를 한 형태로 맞춰야 한다. `P:97`은 context에 connection_secret 원문을 적었다가 같은 줄에서 DB에는 두지 않는다고 하므로 `C/local-store.md:13-18`처럼 참조만 저장하는 문장으로 정정해야 한다.

## 6. plan-final 전 필수 수정

1. **Critical:** legacy v2의 grant/철회/삭제 suppression과 서버 세대형 tombstone을 설계하고, 첫 ingest가 contributor의 기존 수천 건을 숨기지 않는 cutover 조건을 정의한다(S-02, S-10). 이 둘을 고치기 전에는 구현 착수 불가.
2. **High:** capture 실패의 내구 재시도, takeover 뒤 최초 비적격 정정, staging의 무변경·영구 누락 carry-forward, 상세 당시 C_NOW 별도 저장·pre-upsert 비교, DB 교체 intent 복구, 모바일 권한/설정 순서, 동의 정책 버전·해시 불변성을 계약·테스트에 반영한다(S-03/04/06/12/20/21, N-03).
3. **High 구현 게이트:** 최종 SQL에 일관된 잠금과 fact grant 필터, 좌표 결측·legacy 병합, published 조건을 구현하고 POC와 다른 부분을 최종 스택의 실제 HTTP/DB/익명 API로 재검증한다(S-09/11/18). POC는 이 게이트의 대체 증거가 아니다.
4. 계약 값 검증·금액 문법과 누락된 acceptance matrix를 T0에 추가한다(N-01/02). 원 요구를 변경할 선택이 필요하면 그 결정과 근거를 명시적으로 기록한다.
