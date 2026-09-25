# GPT-6-Sol 3차 독립 계획 재확인 — 최종 판정

## 0. 검토 범위와 재현

이 보고서는 `plan-review-sol-02.md`의 S-02/03/04/06/10/12/20/21 및 N-01/02/03을 대상으로 한다. 근거 약칭: P=`docs/integration/community-ingest/plan-final.md`, R=`plan-resolution.md`, C=`contracts/community-ingest/`, PC/M/MAP=요청에 지정된 읽기 전용 고정 스냅샷. 제품 파일·git·Docker·네트워크·다른 worktree는 건드리지 않았다.

- 네 스냅샷의 실행 코드에서 `upload_snapshots`, `report_facts_v2`, `internal_activate_snapshot`, `public_map_points` 문자열을 `rg -F`로 검색했다(SQL·Markdown·JSON·lockfile 제외). **쓰기 호출 0건**, 유일한 실행 코드 검색 결과는 `MAP:tests/product/publicHandler.test.ts:66`의 악성 query 거절 테스트였다. 단, 현 공개 RPC는 v2를 **읽는다**(`MAP:supabase/migrations/202609240001_analytics_v2.sql:104-126`; `MAP:supabase/functions/public-analytics/index.ts:30-49`). 현재 writer가 없다는 결과는 운영 DB에 과거 행이 없다는 증거가 아니다.
- `review-input/tmp/independent_vectors.py`를 계약 생성기와 별도로 수정·실행했다. 관측 **32건**, 이벤트 결정 **10건**의 payload·eligible·canonical JSON·SHA-256·event 기대값이 모두 일치했다. 새 금액 7건과 server_completed 이벤트 3건도 일치했다. 목록 벡터 11건은 null 가드를 넣은 식으로 11건 일치하지만, 계약에 적힌 식을 Python/Dart의 `!=` 그대로 계산하면 `closed_permanent_failure_not_retried` 1건이 불일치한다(§4).
- `contracts/community-ingest/MANIFEST.sha256:1-20`은 `sha256sum -c` 전부 OK. 이는 파일 무결성 검사이며 제품 구현·서버 검증 통과 증거는 아니다. 새 `acceptance-matrix.md:1-72`는 모든 결과를 `not-run`으로 정확히 표기한다.

## 1. 판정

**구현 착수 불가.** 특히 S-02의 “재동의해도 예전 fact는 명시적 다시 공유 전까지 재공개되지 않는다”는 약속을 서버 수락 규칙이 여전히 깨뜨린다. 첫 비적격 신고에서는 S-06의 로컬 스키마 규칙 자체가 충돌하고, S-03/S-12/S-20/S-21/N-03에도 high 수준의 실패 경로가 남는다. S-10은 무음 소실을 막는 가드로 개선되었지만, 기존 행이 있는 배포의 전환 경로는 여전히 운영자 결정 전제다.

## 2. 직전 지적별 처리 판정

| ID | 판정 | 문서·코드 근거와 이유 |
|---|---|---|
| **S-02 critical** | **미해소** | identity tombstone 자체는 클라이언트 시각과 무관해졌다(`P:67,70-71`, `C/observation.md:82-83`). 그러나 일반 `completed_observation`도 기존 fact와 grant가 다르면 accepted(`P:69`). G1 철회→G2 재동의→빈 journal을 가진 새 writer가 같은 완료 신고를 전수 재수집하면 명시적 reshare 없이 G2로 갱신·공개된다(`C/observation.md:64-66`). `P:15,119`의 “명시적 reshare만”과 충돌. §3.1. |
| **S-10 critical** | **부분(무음 소실 차단)** | 공개 소스를 ingest만으로 바꾸고 구 v2 행·staged/active snapshot 발견 시 migration 중단(`P:15,68,71`). 현 코드의 legacy 쓰기 호출 0건은 직접 확인했지만 과거 행 존재는 미확인. staged만 남아도 배포가 중단되며 전환·재개 절차가 없다(`P:68,173-174`); 사전 점검 SQL은 아직 파일이 없다. §3.2. |
| **S-03 high** | **부분** | capture 실패 때 건별 개인 저장 보류(`P:100-101`, `C/interfaces.md:60-61`)는 새 신고 누락을 줄인다. 이미 개인 DB에 완료 Y로 저장된 신고가 같은 C_NOW 라벨에서 재조회되다가 capture만 실패하면, 다음 증분 후보가 아니어서 영구 재시도되지 않는다(`C/interfaces.md:64`, `PC:core/database/database.py:459-483`). §3.3. |
| **S-04 high** | **부분** | 사용자·연결 검증된 중앙 manifest와 server_completed 기반 최초 비적격 correction을 추가(`P:73`, `C/observation.md:64-67`). 그러나 manifest 실패/불완전 응답 시 rebuild·capture를 막는 규칙과 페이지·크기 상한이 없어 새 writer의 정정 보장에 구멍(`C/account-api.md:43-44`, `C/local-store.md:89`). §3.4. |
| **S-06 high** | **부분** | staging upsert/carry-forward 계약은 개선(`C/rebuild.md:21-25`). 하지만 첫 비적격 관측은 이벤트·기존 journal 포인터가 없는데 `report_latest_staging.event_id NOT NULL`에 **항상** 포인터를 쓰라고 한다(`C/observation.md:64-67`, `C/local-store.md:40-45,83`). 본문 P도 여전히 staging “교체”라고 적어 계약의 “병합”과 상충(`P:127`). §3.5. |
| **S-12 high** | **부분** | 별도 `detail_status`와 상세 C_NOW 입력이 추가됨(`C/local-store.md:47-49`, `C/interfaces.md:34,64`). 하지만 null 비교의 언어별 의미가 벡터와 충돌하고, failed_permanent의 목록 상태가 나중에 바뀔 때 다시 조회할 기준값이 없다(`C/vectors/list_refetch.json:3,97-115`). P §8.5도 옛 표현 그대로(`P:142-143`). §3.6. |
| **S-20 high** | **부분** | 개인 DB 교체 전 선회전으로 “교체 후/회전 전” crash 창은 없앴다(`P:100`, `C/local-store.md:88`). 그러나 같은 connection·dataset_key의 옛 pending outbox는 전송 필터에 local_dataset_id가 없고(`C/local-store.md:86`), 새 local_dataset_id의 revision은 다시 시작한다(`C/local-store.md:10-11,85`). 옛 높은 revision이 새 관측을 뒤집을 수 있다. §3.7. |
| **S-21 high** | **부분** | gate→모드 무관 권한→Setup→모드 권한 보충 순서와 T5 파일 소유가 명시됨(`P:25-29,157`). 그러나 기존 권한 확인 코드는 iOS에 handler 없는 Android MethodChannel을 필수 검사하며, `MissingPluginException`을 잡지 않는다(`M:lib/services/permission_service.dart:11-24`, `M:ios/Runner/SceneDelegate.swift:4-6,97-107`). 이 화면을 Setup 앞에 배치하면 iOS gate 다음 단계가 멈춘다. §3.8. |
| **N-01 medium** | **해소(계획)** | 금액/벌점 완전 일치 문법·상한, 달력·좌표 정규형·eligibility·reshare trigger 서버 값 검증 명시(`C/observation.md:49-53,75-83`). 새 벡터 7건 독립 일치. |
| **N-02 medium** | **해소** | `acceptance-matrix.md:1-72`에 요구·테스트 위치·담당·not-run 상태가 있다. 실제 실행 증거는 구현 게이트에 남는다. |
| **N-03 high** | **부분** | 불변 정책 이력과 grant의 (version, hash) 비교는 타당(`P:52,71`, `C/account-api.md:36`). 그러나 P는 바로 앞줄에 예전 `private.community_policy` singleton도 신규 테이블로 선언(`P:51-52`). 두 정책 정본을 동시에 만들거나 status/ingest가 서로 다른 표를 읽을 위험이 남는다. §3.9. |

## 3. 잔여 결함·새 회귀 경로

### 3.1 S-02 · critical · 일반 완료 이벤트로 과거 grant fact 자동 재공개

**근거:** `P:15,66-71,119`; `C/observation.md:64-69`; `C/account-api.md:36-44`. **재현:** G1로 신고 R 완료 공개 → G1 철회 → G2 명시 동의 → 새 writer/재설치로 local journal이 비어 있는 상태에서 R의 같은 공식 완료 응답 수집. `prev`가 없거나 manifest가 hash 불명 eligible이라 새 `completed_observation`이 생긴다. 서버는 더 큰 epoch/revision과 바뀐 grant를 accepted하고 fact grant를 G2로 바꾼다. 사용자는 `reshare`를 누르지 않았다. **영향:** 철회·재동의 뒤 구 사본의 자동 재공개. 삭제도 dataset_key가 클라이언트 주장값(`C/account-api.md:46`)이라 같은 실계정을 다른 dataset_key로 재등록하면 기존 identity tombstone과 다른 키로 다시 올릴 수 있는 한계가 있다. **수정:** 기존 fact의 grant가 폐기된 경우 같은 source identity를 일반 이벤트로 새 grant에 붙이는 정책을 명시적으로 금지하거나, 재동의 후 새 공식 관측의 공개 허용 범위를 사용자가 확인하는 별도 서버 승인 상태로 구분한다. “명시적 다시 공유만”을 유지한다면 `reshare` 또는 동등한 사용자 행위 근거가 없는 grant 변경은 거절한다. 삭제는 dataset_key 재주장으로 우회되지 않도록 사용자 단위 deletion generation/재공개 정책을 갖춰야 한다. **회귀:** G1→철회→G2→B writer 동일 완료 수집 시 공개 0·일반 이벤트 거절/보류; 명시적 reshare 후 1; 삭제→새 dataset_key·같은 공식 ID 시 0.

### 3.2 S-10 · medium 운영 차단 · 구 자료 가드의 배포 경로

**근거:** `P:15,68,173-174`; `MAP:supabase/migrations/202609240001_analytics_v2.sql:104-126`; `MAP:supabase/migrations/202608150001_initial_schema.sql:28-65`. **문제:** 네 코드베이스에 legacy **쓰기** 호출은 없지만, 현 공개 API의 v2 **읽기**는 살아 있다. 과거 운영 행·미완료 staged snapshot 1행도 migration을 실패시킨다. 이 안전 중단 자체는 옳지만, `scripts/integration/preflight_counts.sql`은 현재 없고, 구 행을 발견했을 때 보존·전환·재시도 기준이 없다. **영향:** 정상 배포가 중단될 수 있으며, 운영자가 임의 삭제로 가드를 우회할 유인이 생긴다. **수정:** T0에서 사전 점검 SQL과 staged/active/v2별 결정표를 작성하고 운영자 읽기 전용 점검 후 보존형 전환 또는 명시 BLOCKED로 분기한다. 검증 전에는 구 자료를 지우지 않는다. **회귀:** 빈 DB 적용 성공, staged만 1행·v2 fact 1행은 안전하게 중단, 중단 뒤 기존 익명 API·DB 행 불변, 문서화한 전환 후 재적용 성공.

### 3.3 S-03 · high · 완료 Y의 같은 목록 라벨에서 capture 실패가 재시도되지 않음

**근거:** `C/observation.md:71-72`; `C/interfaces.md:60-64`; `C/vectors/list_refetch.json:3,25-34`; `PC:core/database/database.py:459-483`. **문제:** 이미 개인 상세 Y와 detail_status=`답변완료`가 있다. 수동/전수 상세에서 공식 금액만 바뀌고 목록 C_NOW는 그대로인 상황에서 community.db 오류로 capture 실패하면 개인 DB 저장만 건너뛴다. 다음 정상 증분은 “새 신고도 아니고, Y이고, 목록 라벨도 같다”라서 재조회하지 않는다. **영향:** 실패한 공식 사본·개인 갱신이 영구 누락될 수 있다. community.db가 지속 장애면 PC는 건별 실패를 계속하고 모바일도 건별 실패(`PC:core/storage/reports_repo.py:221-239`, `M:lib/services/sync_engine.dart:262-304`)하여 사실상 전체 신규 저장이 멈춘다. **수정:** `capture_failed` ID·사유·시각을 개인 저장과 독립된 내구 재시도 목록에 남기고 증분 선정에서 우선 포함한다. 저장 보류의 건별·전체 장애 UI와 재시도 상한을 정한다. **회귀:** 기존 Y·같은 C_NOW·변경된 금액에서 capture 실패→다음 증분이 해당 ID를 재조회하고 공식 사본을 한 번만 저장; DB 전체 장애 때 오류/복구 UI를 검증.

### 3.4 S-04 · high · manifest 실패 시 정정 누락 및 응답 무제한

**근거:** `P:73,80`; `C/account-api.md:43-44`; `C/local-store.md:50-51,89`; `C/rebuild.md:26`. **문제:** manifest는 `key_prefixes` 전체를 한 응답에 보낸다. 10만 건이면 문자열·JSON 문법만 약 2.7 MB이며 페이지/상한/응답 캐시 금지/실패 시 capture 차단 규칙이 없다. 연결 직후/초기화 직전에 요청 실패 시 `server_completed`가 빈 채 계속되면 첫 취하 관측은 이벤트가 없다(`C/observation.md:65-67`). 앞 24hex는 낮은 엔트로피의 공식 신고 ID에 대해 사전 계산이 가능하므로 로그·중간 캐시에 남기지 말아야 한다. **영향:** 대량 계정의 메모리/시간 오류, writer 전환 후 공개 완료 fact 정정 누락, private ID 추론 범위 확대. **수정:** 사용자·연결 검사와 `no-store`, 페이지/커서·응답 크기 제한, 전체 페이지 검증 후 원자 교체, 실패하면 해당 dataset의 재빌드/correction 시작을 보류한다. **회귀:** 10만 건 페이지 수집·중간 503·잘못된 count/중복 prefix·다른 user/connection·응답 캐시 검사.

### 3.5 S-06 · high · 첫 비적격 관측의 NOT NULL 포인터 불가능

**근거:** `C/observation.md:64-67`; `C/local-store.md:40-45,82-83`; `C/rebuild.md:21-25`; `P:127`. **문제:** 최초 `처리중` 또는 `취하`는 prev 없음→이벤트 없음. 그러나 capture 규칙은 report_latest/staging에 “항상 유효 최신 event_id”를 UPSERT하라 하고 두 테이블의 event_id는 NOT NULL이다. 존재하지 않는 journal 행을 가리킬 수 없다. capture 실패를 개인 저장 보류로 취급하면 이런 정상 신고가 재시도 루프에 갇힌다. P의 “교체”와 C의 “병합”도 같은 cutover를 다르게 지시한다. **수정:** 이벤트가 없고 기존 포인터도 없으면 `detail_status`만 저장하고 report_latest UPSERT를 건너뛰는 규칙을 명시한다. 이벤트 없는 관측이 추후 eligible로 바뀌면 첫 journal 행을 만든다. P §7의 cutover도 upsert 병합으로 정정한다. **회귀:** 빈 DB에서 첫 처리중 1건→개인 저장 성공·journal/report_latest 0·detail_status 1; 이후 수용→event/fact 1, rebuild도 같은 결과.

### 3.6 S-12 · high · null 비교 및 영구 실패 변화 감지

**근거:** `C/vectors/list_refetch.json:3,87-115`; `C/interfaces.md:64`; `C/local-store.md:47-49,77-79`; `P:142-143`. **문제:** 식의 마지막 `list_label != detail_status_label`은 detail_status_label=null에서 Python/Dart는 true, SQL `<>`은 unknown이다. 벡터의 `closed_permanent_failure_not_retried`는 false를 요구한다. 더구나 영구 실패 당시의 목록 라벨을 저장하지 않아 나중에 공식 목록 라벨이 바뀌었을 때만 재시도하는 규칙을 만들 수 없다. **영향:** 언어별 무한 재조회 또는 영구 실패 뒤 상태 변화 놓침. **수정:** 마지막 항을 `detail_status_label != null AND list_label != detail_status_label`로 명시하고, 영구 실패 행에 당시 list_label을 저장해 이후 변화 시 재시도/재평가한다. P §8.5에 `detail_status`를 정확히 적는다. **회귀:** 11개 벡터 양 언어·SQL 동등성, null+failed_permanent에서 동일 라벨은 false·나중에 변경 라벨은 true.

### 3.7 S-20 · high · 선회전 뒤 옛 대기 revision이 새 관측을 덮을 수 있음

**근거:** `P:14,100-102`; `C/local-store.md:10-11,22-30,83-88`; `C/observation.md:73`. **재현:** 같은 연결·공식 dataset에서 옛 local_dataset_id=L1의 pending rev100, 중앙 마지막 accepted rev50. 개인 DB 교체 직전 L2로 선회전한 뒤 새 관측 rev51을 먼저 보내고, 보존된 L1 outbox rev100을 나중에 보내면 같은 fact의 서버 순서 (epoch,rev)에서 **오래된 L1이 이긴다**. 전송 필터에는 local_dataset_id가 없고 선회전 실패 시도도 새 세대를 남긴다. **영향:** 최신 공식 관측 역전·잘못된 집계; “추가 초기화 비용뿐”이라는 설명(`C/local-store.md:88`)이 틀림. **수정:** revision을 (connection, dataset_key, epoch) 전체에 걸쳐 이전 pending 최대값보다 높게 발급하거나 구 세대 outbox를 승인된 순서로 먼저 drain/격리한다. 교체 실패 때 재시작/재시도 상태와 dataset_history를 검증한다. **회귀:** L1 pending 100→L2 새 101→역순 ACK에서도 최신 fact 유지; 교체 실패·재시작·동시 uploader.

### 3.8 S-21 · high · 선행 권한 단계의 iOS 교착

**근거:** `P:25-29,157`; `M:lib/screens/permission_screen.dart:29-58,71-103`; `M:lib/services/permission_service.dart:11-24,27-42`; `M:ios/Runner/SceneDelegate.swift:4-6,97-107`. **문제:** iOS에는 permissions MethodChannel 호출 handler가 없고 SceneDelegate는 같은 채널로 Flutter에 알림을 보내기만 한다. 현재 `isNotificationListenerEnabled`는 `PlatformException`만 잡는다. 새 “모드 무관 권한” 단계가 기존 `_checkAll`을 재사용하면 `MissingPluginException`으로 검사가 실패하며 Setup에 도달하지 못한다. Android 전용 알림 리스너·배터리 최적화를 iOS에서 필수로 해도 같은 교착이다. **수정:** OS별 가능한 권한 집합을 분리하고 iOS는 Android 전용 항목을 건너뛰며, 새 단계가 실제 지원 API만 호출하도록 명시한다. **회귀:** iOS 플러그인 미등록 fixture와 Android 새 설치에서 gate→권한→Setup 진입, OS 팝업 순서, 이미 허용한 권한 재요청 0.

### 3.9 N-03 · high · 정책 정본이 계획 안에 두 개

**근거:** `P:50-53,69,71`; `C/account-api.md:36`. **문제:** P:51은 `community_policy(singleton)`을 신규 표로, P:52는 `community_policies`+ `community_policy_current`를 정책 정본으로 모두 정의한다. 어느 행을 status/ingest가 잠그고 비교할지가 구현자별로 갈릴 수 있다. **영향:** 예전 singleton만 바뀌거나 새 current만 바뀌는 상황에서 grant 상태·ingest·공개가 불일치할 수 있다. **수정:** P:51의 구 singleton 선언을 제거하고 seed/migration·RPC·lock 순서·상태 DTO를 두 신규 표 기준으로 하나로 고정한다. **회귀:** 정책 버전 교체·같은 버전 해시 변경 금지·동시 철회/ingest에서 status=outdated, ingest 0건, 공개 0건.

## 4. 벡터 독립 계산 상세

- 금액 7건(`amount_negative_rejected`, `amount_man_unit_rejected`, `amount_dot_thousands`, `amount_decimal_rejected`, `amount_over_cap_rejected`, `amount_bad_grouping_rejected`, `points_over_cap_rejected`)은 `C/observation.md:49-53`을 별도 regex/상한 로직으로 계산해 기대 payload·해시와 **7/7 일치**했다. `40.000원→40000`; 음수·만원·소수·잘못된 묶음·1억 초과→금액 null, 1001점→벌점 null.
- 새 이벤트 3건은 `server_completed=true`를 “eligible, hash 미상”인 prev로 계산해 `status_correction`, `completed_observation`, 이벤트 없음으로 **3/3 일치**했다(`C/observation.md:65-67`; `C/vectors/observations.json`의 `event_decisions`).
- 목록 11건: null을 명시적으로 가드하면 **11/11 일치**. 문서 `C/vectors/list_refetch.json:3`의 식 그대로 Python/Dart `!=`를 적용하면 `closed_permanent_failure_not_retried`은 계산 true·기대 false로 **10/11**. 이 차이는 구현 언어의 null 의미에 따라 회귀가 달라진다는 증거다.
- 계산 스크립트는 `review-input/tmp/independent_vectors.py`다. 제공 생성기 `scripts/integration/make_contract_vectors.py`와 벡터 파일은 실행·수정하지 않았다.

## 5. 착수 전 수정 순서

1. **S-02 critical:** 기존 폐기 grant fact가 일반 completed_observation으로 새 grant에 자동 재귀속되지 않게 서버 상태기계를 고정하고, dataset_key 변경을 통한 삭제 우회 경계를 정한다.
2. **S-06/S-03 high:** 첫 비적격 무이벤트 capture의 포인터 예외와 실패 ID 내구 재시도를 계약에 넣는다. 개인 저장 보류가 전수 수집을 멈추는 범위를 사용자 UI·재개 테스트로 고정한다.
3. **S-12/S-20 high:** null 가드·영구 실패 당시 라벨, 선회전 전후 pending revision floor/격리를 정의한다.
4. **S-04/S-21/N-03 high:** manifest 전체성·실패 시 fail-closed/페이지 제한, iOS 권한 단계, 단일 정책 표를 확정한다.
5. **S-10 운영 조건:** 현 코드에 legacy writer가 없다는 검색 결과와 운영 DB 무자료를 혼동하지 않는다. preflight SQL·중단 뒤 보존형 전환/재시도 절차를 마련하고 실행 결과는 실제 통합 스택·운영 읽기 전용 점검 단계에서 따로 기록한다. S-09/S-11/S-18의 POC도 최종 SQL·HTTP·익명 공개 API 검증으로만 닫는다.
