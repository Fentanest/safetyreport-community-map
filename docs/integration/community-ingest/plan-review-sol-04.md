# GPT-6-Sol 4차 독립 계획 재확인 — 최종 판정

## 0. 범위·검증 방법

대상은 `plan-review-sol-03.md`의 S-02/03/04/06/10/12/20/21·N-03, 수정 계획·계약, `review-input/v2/`의 **실제 SQL 두 파일**이다. 아래 약칭 P=`plan-final.md`, R=`plan-resolution.md`, C=`contracts/community-ingest/`, A=`review-input/v2/202609260100_community_account_registry.sql`, I=`review-input/v2/202609260200_community_ingest.sql`, MAP=요청에 지정된 map 고정 스냅샷이다. 줄 번호는 각 파일의 현재 행이다. 제품 파일·git·Docker·네트워크·다른 worktree를 건드리지 않았다. SQL은 정적으로 읽었으며 Opus의 격리 스택 POC 출력(`R:57-71`)은 참고 증거로만 취급한다. 따라서 동시성·HTTP·공개 API 동작은 이번 검토에서 실행 검증되지 않았다.

독립 스크립트 `review-input/tmp/independent_vectors.py`로 새 목록 재조회 13건을 계산했다. **13/13 일치**했고 관측 32건·이벤트 결정 10건도 불일치 0이었다. 계약 식의 null 분기를 생략하고 Python `!=`를 직접 적용하면 `closed_permanent_failure_not_retried` 1건은 여전히 틀린다. `C/vectors/list_refetch.json:3,115-161`의 명시적 분기를 구현해야 한다. `C/MANIFEST.sha256:1-20`은 계약 디렉터리에서 `sha256sum -c`로 20/20 OK였다. 이는 파일 무결성과 벡터 일치 증거이며 서버 구현 통과 증거는 아니다.

## 1. 최종 판정

**현재 SQL 초안을 그대로 migration으로 옮기는 구현 착수는 불가하다.** S-02 삭제 이후 대기 이벤트의 재공개 경로와 S-09 동시 업로드 교착이 critical이고, S-11 `published` ACK와 stale grant 철회도 공개 상태에 관한 high 결함이다. 핵심 원칙인 사용자 철회 후 별도 계보 유지와 dataset_key 무관 tombstone은 개선되었지만, POC는 삭제 전에 이미 fact가 있는 경우만 시험했다(`review-input/v2/poc_v2.mjs:23-40`). 아래 수정 뒤 SQL·계약·계획을 맞추고 같은 트랜잭션 경쟁 테스트를 통과시켜 다시 판정받아야 한다.

## 2. 직전 지적별 판정

| ID | 판정 | 근거와 남은 범위 |
|---|---|---|
| **S-02 critical** | **부분** | 기존 fact는 철회 계보를 유지하고 일반 이벤트로 G2에 자동 귀속되지 않는다(`I:232-255`, `A:145-150`); tombstone은 dataset_key와 무관하다(`I:91-99,180-185`). 그러나 삭제 시 **이미 있는 fact의 키만** tombstone으로 기록한다(`I:330-334`). 삭제 전 capture되어 중앙에는 아직 없는 대기 이벤트는 이후 최초 fact로 수락된다(`I:219-231`). `C/local-store.md:90-91`은 대기 outbox를 보존한다. §3.1. |
| **S-03 high** | **부분** | 별도 내구 재시도 파일·강제 증분 재조회·연속 3회 실패 중단을 명시했다(`P:105,149`, `C/local-store.md:88`), 기존 Y·동일 목록 라벨 누락은 해소. 다만 **재시도 파일 쓰기 자체의 실패**에 대한 중단/복구 규칙이 없어 그 경우 기존 Y의 재조회가 다시 빠진다(`C/local-store.md:88`, `C/interfaces.md:63`). §3.6. |
| **S-04 high** | **해소(계획), 검증 게이트** | 사용자·연결 검사와 5000개 페이지, total·중복 확인 뒤 원자 교체, 실패 시 수집 중단을 명시했다(`A`와 별개인 `I:283-312`, `C/account-api.md:44-46`, `C/local-store.md:89`). 페이지 간 자료 변경을 단일 snapshot으로 묶지는 않으므로 실제 부하에서 재시도/버전 검증이 필요하다(§3.7). |
| **S-06 high** | **해소(계획)** | 첫 비적격·무포인터 관측은 detail_status만 기록하고, staging은 병합한다(`C/observation.md:68`, `C/local-store.md:84-85`, `C/rebuild.md:25`, `P:133`). |
| **S-10 운영 차단** | **부분** | SQL은 active snapshot의 v2 fact가 있으면 적용 중단한다(`I:10-20`); staged만 있는 경우 통과하며 기존 공개 RPC도 active만 읽는다(`MAP:supabase/migrations/202609240001_analytics_v2.sql:104-108`). 결정표도 생겼다(`deployment-and-rollback.md:12-17`). 그러나 `preflight_counts.sql:5-17`은 표 존재 여부를 출력한 **뒤에도 없는 표를 무조건 SELECT**하므로 map v2 미적용 경로에서 오류 난다. 계획의 옛 설명도 현재 SQL과 다르다(`P:69-74`). §3.5. |
| **S-12 high** | **해소(계약)** | null 명시 분기와 영구 실패 당시 라벨이 스키마·규칙에 있다(`C/local-store.md:77-81`, `C/vectors/list_refetch.json:3`, `P:148-149`). 13건 독립 계산 일치. |
| **S-20 high** | **해소(같은 파일의 순서 계약)** | `meta.next_revision`은 파일 전체에서 단조이고 서버 floor보다 높이며 회전으로 초기화되지 않는다(`C/local-store.md:87,92`, `C/observation.md:74`). 새 관측의 revision이 보존된 옛 대기 이벤트보다 커야 한다는 원 지적은 해결. crash·다중 프로세스는 구현 게이트로 남긴다. |
| **S-21 high** | **해소(계획)** | Android 전용 권한을 iOS에서 건너뛰고 `MissingPluginException`과 `PlatformException`을 처리한다(`P:25-34,163-164`). 실제 iOS 빌드와 첫 프레임 검증은 미실행(`acceptance-matrix.md:70`). |
| **N-03 high** | **해소(정책 정본)** | 정책 이력·현재 포인터 두 표만 정의하고 변경 금지 트리거, version+hash 비교를 사용한다(`P:51-55`, `A:15-38,154-160`). 다만 정책/계보 이력 운영 규칙은 §3.4의 stale grant 철회를 반영해야 한다. |

## 3. SQL·계약에서 발견한 결함

### 3.1 S-02-R · critical · 삭제 후 대기 이벤트가 최초 fact로 공개됨

**근거:** `I:315-337`은 삭제 시 중앙 fact 행만 tombstone으로 복사한다. `I:180-185`는 tombstone 없는 키를 통과시키고 `I:219-231`은 최초 fact를 삽입한다. 삭제 후에도 grant와 connection은 활성으로 남는다(`I:327-329`는 잠글 뿐 상태를 바꾸지 않음). 로컬 대기 outbox는 보존된다(`C/local-store.md:90-91`). **재현:** G1·연결 C 활성 → 신고 R capture, 업로드 보류 → `contributions-delete`(deleted_facts=0) → 보류된 R 업로드 → `accepted` 및 ready이면 공개. **영향:** 삭제 확인 뒤 기존 사본이 처음 공개될 수 있다. **수정:** 삭제 때 사용자 단위 삭제 세대/fence를 서버에 기록하고, 이벤트에 서버가 검증 가능한 연결 세대를 묶어 삭제 이전 세대의 대기 이벤트를 영구 차단한다. 삭제와 함께 기존 연결을 revoke하고 새 연결 등록은 명시적 재개 절차로 삼는 방식도 가능하나, 구 연결 재사용·새 계정 전환을 포함해 정책을 명시해야 한다. 로컬 대기 outbox도 삭제 ACK 후 전송 금지로 전환한다. **회귀:** 중앙 fact 0·대기 R 1 → 삭제 → R 전송은 `deleted`/fenced, 공개 0; 삭제 뒤 사용자가 새로 공유한 S의 허용 여부를 별도 검증. 현재 POC는 이미 수락된 R1만 삭제한다(`poc_v2.mjs:23-40`).

### 3.2 S-09-R · critical · 동일 연결의 병렬 ingest가 교착됨

**근거:** `I:157-158`은 동일 connection을 `FOR SHARE`로 잠근다. 루프 안에서 fact를 `FOR UPDATE`로 잠근 뒤(`I:217-218`), 끝에서 그 connection의 `last_accepted_revision`을 `UPDATE`한다(`I:272-274`). 이는 선언한 `policy→contributor→grant→connection→fact→analytics_state` 순서(`I:6`, `P:55`)를 **fact→connection**으로 되돌린다. **재현:** T1/T2가 같은 connection `FOR SHARE`를 함께 보유 → T1이 R fact `FOR UPDATE`, T2가 R fact 대기 → T1이 connection UPDATE에 필요한 배타 잠금을 T2의 SHARE 때문에 대기 → 40P01. **영향:** 일반 업로더와 수동·자정 업로드가 겹치면 일부 요청이 503/backoff로 밀리고 재시도 폭주 가능. **수정:** ingest에서 connection을 처음부터 `FOR UPDATE`로 잡고 fact 앞에서 revision floor까지 처리한다. 계정 RPC와의 순서는 유지한다. **회귀:** 같은 connection·같은/다른 R을 두 세션에서 반복 동시 전송; deadlock 0, 순서·ACK·last_revision 보존. POC(`poc_v2.mjs`)에는 병렬 세션 검사가 없다.

### 3.3 S-11-R · high · 비공개 정정에 `published` ACK

**근거:** 공개 RPC는 `f.public_state='completed'`와 날짜 범위를 필수로 한다(`I:387-393`). ACK 판정은 ready·lineage·generated_at만 보고 `public_state`나 날짜를 보지 않는다(`I:263-269`). `status_correction`은 `not_completed` fact로 바꿀 수 있고(`C/observation.md:67,82,87`; `I:244-255`), eligible payload도 두 날짜가 모두 null일 수 있다(`C/observation.schema.json:104-116`). **재현:** 공개 완료 R → 공식 취하 관측을 status_correction으로 accepted, ready=true → ACK `published`, 익명 API에서는 R 0건. 또는 완료 R의 두 날짜가 null이면 ACK는 `published`여도 어떤 날짜 범위의 익명 API에도 들어가지 않는다. **영향:** `C/rebuild.md:37`의 “지도 반영됨” 표시와 실제 공개 가시성이 어긋난다. **수정:** ACK `published`의 뜻을 “공개 투영에 변경이 반영됨(삭제 포함)”으로 바꾸어 계약/UI를 명확히 하고 날짜 불명 완료의 처리도 별도 표시하거나, 현재 계약(`C/observation.md:86`)대로라면 `public_state='completed'`와 공개 RPC의 날짜 가시 조건을 확인하여 비공개 정정은 `held`/별도 `removed`로 반환한다. **회귀:** 완료→취하, 날짜 전부 null인 완료, 정상 완료, 좌표 결측 완료 각각 ACK·UI·익명 API를 비교한다.

### 3.4 N-04 · high · 구 정책 grant 철회가 성공으로 응답하지만 현재 계보는 공개

**근거:** 정책 교체는 G1을 `superseded_policy`로 닫고 G2를 같은 lineage로 만든다(`A:247-264`). 철회 RPC는 요청한 `p_grant`만 조회하고 이미 `revoked_at`이 있으면 아무것도 하지 않으면서 `revoked:true`를 반환한다(`A:273-289`). 계보 공개 함수는 같은 계보의 **아무 활성 grant**만 있으면 true다(`A:145-150`). **재현:** G1 동의·R 공개 → 정책 변경·G2 동의 → 캐시된 G1 ID로 `consent-revoke` → `revoked:true`이나 G2 활성·R 공개 유지. **영향:** 철회 성공 표시와 실제 공개 상태가 반대가 된다. **수정:** 현재 활성 grant ID를 요구하고 stale ID는 `consent_grant_superseded`/409와 최신 status 재조회로 처리하거나, 철회 요청이 계보의 현재 활성 grant에 안전하게 귀결되도록 규칙화한다. 철회 응답의 실제 비공개 결과를 같은 트랜잭션에서 확인한다. **회귀:** G1→G2 정책 승계→G1 철회 요청 후 응답은 conflict 또는 공개 0; G2 철회는 공개 0; 이후 G3 재동의는 새 lineage·자동 재공개 0.

### 3.5 S-10-D · medium · 사전 점검·계획과 migration 불일치

**근거:** `preflight_counts.sql:5-17`은 `to_regclass`로 부재를 확인하지만 `upload_snapshots`, `report_facts_v2`, `analytics_state`를 무조건 질의한다. `deployment-and-rollback.md:17`은 map v2 미적용 경로를 다룬다. P는 옛 tombstone PK와 과거 captured_at 조건(`P:69,71`), staged/active 전체 가드(`P:70`)를 여전히 적으면서 바로 아래에 새 규칙을 덧붙였다(`P:73-75`). 삭제 함수도 P는 `private.community_delete_contributions(user)`라 하지만 SQL은 `public.internal_community_delete_contributions(user,session)`이다(`P:57,72`; `I:316-317`). **영향:** 사전 점검이 의도한 상태에서 실패하고 구현자가 서로 다른 스키마/호출을 따를 수 있다. **수정:** 존재 조건별 동적 read-only SQL 또는 map 초기 스키마/ v2 적용 후 별도 점검으로 나누고, P:57,69-72의 옛 설명을 SQL·계약 정본에 맞게 삭제/수정한다. **회귀:** auth-only, map-initial-only, map-v2 staged-only, active-v2 1행 각각 preflight가 정상 결과 또는 명시 중단을 낸다. 구 `internal_activate_snapshot`의 service_role EXECUTE는 남아 있으므로(`MAP:supabase/migrations/202608150001_initial_schema.sql:290-293`) migration 뒤 legacy 행 신규 작성 방지도 rollout에서 확인한다.

### 3.6 S-03-F · medium · 재시도 파일 쓰기 실패 시 재조회 근거 소실

**근거:** `C/local-store.md:88`은 community.db capture 실패 뒤 별도 JSON에 ID를 적으라 하지만 그 파일의 fsync/rename 실패 시 수집을 중단하고 ID를 다른 내구 위치에 남길지 정의하지 않는다. 개인 저장을 건너뛰는 규칙(`C/local-store.md:85`)만으로는 이미 저장된 완료 Y·동일 C_NOW의 다음 증분 선정을 보장하지 못한다(`P:149`). **영향:** 디스크 가득 참·권한 오류에서 완료 상세 정정이 누락될 수 있다. **수정:** retry 기록 성공을 건별 실패 처리의 필수 조건으로 삼고, 기록 실패 즉시 전체 실행을 멈추며 재시작 시 강제 재검사 범위/복구 UI를 정의한다. **회귀:** 기존 Y·같은 목록 라벨에서 capture와 retry JSON 쓰기를 차례로 실패시켜, 정상 재시작 후 해당 ID가 반드시 다시 조회되는지 확인한다.

### 3.7 S-04-M · medium · manifest 페이지가 같은 사실 집합의 snapshot이 아님

**근거:** `I:302-311`은 각 HTTP 페이지마다 별도 `count(*)`와 커서 조회를 수행하고 `C/account-api.md:44-46`은 total과 중복만 검사한다. 페이지 사이 완료↔취하 또는 삭제/삽입이 발생해 전체 수가 같아지면 혼합 시점의 prefix 집합이 통과할 수 있다. **영향:** 새 writer의 최초 비적격 정정 대상이 누락될 수 있다. **수정:** `dataset_version`/manifest generation을 각 페이지에 포함하고 클라이언트가 전 페이지 동일 버전일 때만 교체하거나 서버 snapshot 토큰을 도입한다. 매번 변경되면 bounded retry 후 `manifest_unavailable`로 중단한다. **회귀:** 페이지 1 뒤 앞쪽 키 삭제·뒤쪽 키 삽입(총수 동일), 정책/철회·동시 ingest 중 페이지 수집에서 혼합본이 적용되지 않음.

## 4. SQL 권한·lineage·잠금 확인

- **권한 경계:** 신규 private 세 표는 RLS 활성·anon/authenticated/public 권한 회수(`I:101-107`), 신규 공개 RPC는 `SECURITY DEFINER`, `search_path=''`, service_role만 EXECUTE(`I:111-113,283-287,315-317,370-374,429-441`). 정책/grant/연결도 같은 방식(`A:88-98,225-227,370-383`). `private` 스키마의 service_role 사용권한은 기존 초기 migration에 있다(`MAP:supabase/migrations/202608150001_initial_schema.sql:9-13`). 이 정적 범위에서 신규 anon 직접 호출 허용은 찾지 못했다. 실제 PostgREST/GraphQL/Realtime 음성 시험은 `acceptance-matrix.md:60-67`대로 남는다.
- **잠금 순서:** account mutation은 대체로 policy→contributor→grant/connection→analytics로 간다(`A:225-267,273-287,292-345`). ingest만 `connection FOR SHARE` 뒤 fact를 잡고 connection을 갱신해 순서를 거스른다(§3.2). `contributor_profiles.revoked_at` 갱신은 기존 AFTER UPDATE trigger로 analytics_state를 잠근다(`MAP:supabase/migrations/202609240001_analytics_v2.sql:53-69`, `I:343-357`); account 함수의 중복 projection bump(`A:285-286`)도 정리할 수 있다.
- **계보 정상 경로:** G1 사용자 철회→G2 새 동의는 새 lineage(`A:247-264`), 일반 이벤트는 비활성 G1에 잔류(`I:232-255`), reshare만 G2로 재귀속한다. G1 정책 supersession→G2 동의는 같은 lineage라 공개를 유지한다(`A:253-264`, `I:391-393`). 반례는 stale G1 철회 성공 응답(§3.4)이며, 삭제 전 미수락 이벤트는 계보 로직에 진입하기도 전에 최초 fact로 공개된다(§3.1).
- **공개 조건:** 실제 공개는 completed ∧ contributor active ∧ lineage active ∧ 날짜 범위이며 좌표 결측을 포함하고 bbox에서만 제외한다(`I:387-410`). `published` ACK는 이 조건과 일치하지 않는다(§3.3). 구 v2 active fact 가드는 적용 시점의 소실을 막지만 구 service_role writer의 추후 호출까지 막지는 않는다(§3.5).

## 5. 재확인 전 필수 수정

1. **S-02-R critical:** 삭제 세대/fence와 로컬 대기 outbox 처리를 계약·SQL·POC에 넣고 “중앙 fact 0, 로컬 pending 1” 삭제 회귀를 통과시킨다.
2. **S-09-R critical:** connection을 fact보다 앞에서 배타 잠금으로 고치고 같은 연결의 병렬 ingest 경쟁을 반복해 40P01이 없음을 보인다.
3. **S-11-R/N-04 high:** ACK의 `published` 의미를 실제 공개 조건과 맞추고, superseded grant ID 철회가 거짓 성공을 내지 않게 한다. 정책 승계→stale 철회→익명 API 결과를 시험한다.
4. 계획·SQL 이름/키/가드 조건을 한 버전으로 정리하고 preflight의 부재 표 경로를 고친다. manifest 버전 고정과 capture retry 파일 실패 처리도 구현 게이트에 추가한다.

위 critical/high가 남아 있으므로 **“구현 착수 가능” 판정은 내리지 않는다.**
