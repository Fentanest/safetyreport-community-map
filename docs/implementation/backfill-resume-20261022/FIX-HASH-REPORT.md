# v2 원본 전송 해시 호환 수정 보고서

작성일: 2026-10-23. 작업 저장소: `/home/better0101/projects/backfill-resume-ws/map`, 브랜치 `feat/backfill-resume`.
시작 HEAD: `b1002035fd519b0f589b033e18f5652864a77364`. 시작 작업 트리는 깨끗했다. 아래 검사는 해당 HEAD 위의 미커밋 변경에 대해 실행했다.
커밋·푸시·원격 서버 접근·운영 배포는 하지 않았다. 모바일 파일은 읽고 실행만 했으며 PC·모바일 계약 사본은 수정하지 않았다.

## 결과

v2 `supplement_sha256`와 `client_observation_sha256`은 서버형 또는 문자 그대로형 중 하나가 일치하면 받는다.
저장할 supplement 해시는 클라이언트 값 그대로다. 형식 판정은 `supplement_hash_form: 'server'|'literal'` 로그 필드 하나로만 남긴다.
제어문자가 없는 등 두 정규형이 같은 경우 `server`를 우선한다. 이 로그는 해시 검증 성공을 뜻하며 DB 저장 성공을 뜻하지 않는다.
기존 로그 공통 필드(event/route/outcome/request_id) 외에 원문·해시·이벤트/신고/계정 식별자는 추가하지 않았다.

추가한 raw ingest 회귀 시험 포함 **25/25**, Deno **6/6**, TypeScript, 계약 재생성/manifest 검사, 로컬 PGlite SQL 및 모바일 Dart 바이트 대조는 통과했다.
전체 Vitest는 **1362 통과 / 11 실패 / 232 건너뜀**이다. 실패는 `composeScript.test.ts`의 자식 프로세스 stdout/stderr 검증 11건이며
단독 재실행에서도 재현되었다. 전체 시험 통과로 보고하지 않는다. 실패 상세와 원출력은 아래에 보존한다.

## 변경 파일과 줄

줄 번호는 최종 작업 파일 기준이며, 표의 시작 줄부터 관련 변경을 찾을 수 있다.

| 파일 | 줄 | 변경 |
|---|---:|---|
| `server/ingest/observation.ts` | 81–98 | `canonicalJsonLiteralEscapes` 추가. 기존 `canonicalJson`(66–79)은 그대로 유지 |
| `server/ingest/raw.ts` | 2, 64–74, 89–94 | 두 형식 검사 공통 함수, supplement 형식 반환, 비교 DTO에도 동일 호환 검사 |
| `server/ingest/handler.ts` | 436–438 | 개인정보 없는 `supplement_hash_form` 진단 로그 |
| `scripts/raw-ingest/generate_contract.py` | 29–42, 118–132 | UTF-16 키 정렬·두 문자열 형식·제어문자 벡터 생성 |
| `scripts/raw-ingest/check_contract.py` | 11, 50–62 | 필수 제어문자 사례와 두 형식의 UTF-8 hex/SHA-256 검사 추가 |
| `tests/product/rawIngest.test.ts` | 6, 27, 30–113 | 바이트/해시, 두 형식 수신, 불일치 거절, 저장값·로그·v1 경계 회귀 시험 |
| `tests/deno/raw_ingest_test.ts` | 2, 41–68 | 실제 Deno의 공용 Edge 처리기에서 두 형식 수신·오류 거절 |
| `tests/sql/verify-raw-ingest.mjs` | 102–116 | 두 형식 각각의 no_change/duplicate, 형식 변경 시 stored, 클라이언트 해시 보존 |
| `contracts/community-ingest-v2/README.md` | 11–23 | 서버 정본·모바일 2.5.1 이하 호환·타입/로그/멱등성 규칙 |
| `contracts/community-ingest-v2/vectors/wire.json` | 81–222 | supplement 4개 + UTF-16/중첩/정수 경계 1개 해시 벡터 |
| `contracts/community-ingest-v2/MANIFEST.sha256` | 1, 14 | README·wire.json 해시 갱신 |
| `contracts/community-ingest/canonical-json.md` | 12–14 | v1 DTO 제어문자 가정이 v2에는 성립하지 않는다는 주의 |
| `contracts/community-ingest/MANIFEST.sha256` | 4 | canonical-json.md 해시 갱신 |
| `docs/implementation/backfill-resume-20261022/FIX-HASH-REPORT.md` | 1 | 본 보고서 |

## 두 정규형의 정확한 정의

- 공통: object 키를 **UTF-16 코드 단위** 오름차순으로 재귀 정렬하고 `,`·`:` 주변 공백을 넣지 않는다.
  object/string/정수/null만 허용한다. 정수는 ±(2^53−1), `-0` 금지, 10진 표기다. null 키를 생략하지 않는다.
  유니코드 정규화는 하지 않는다. 최종 문자열을 UTF-8로 인코딩한 SHA-256 소문자 hex를 비교한다.
- **서버형 `canonicalJson`**: 문자열 값과 키를 기존 `JSON.stringify`로 인코딩한다.
  LF는 `\n`, 탭은 `\t`, CRLF는 `\r\n`, U+0001은 `\u0001`로 이스케이프한다. 기존 구현/호출 의미를 바꾸지 않았다.
- **문자 그대로형 `canonicalJsonLiteralEscapes`**: 문자열 값과 키의 `"` → `\"`, `\` → `\\`만 처리한다.
  나머지 문자는 제어문자까지 그대로 남겨 UTF-8로 만든다. 따라서 해시 입력은 유효 JSON이 아닐 수 있지만 전송 envelope는 유효 JSON이어야 한다.
- 읽은 모바일 원본: `/home/better0101/projects/safetyreport-mobile/lib/community/capture/canonical_json.dart`.
  `_compareUtf16`, `_sortKeys`, `_escape`, `_encode`를 확인했다. Dart 원본은 배열 처리도 제공하지만 현재 supplement/비교 DTO 계약은
  배열을 허용하지 않으므로 서버 두 함수 모두 배열을 거절한다. 모바일의 일반적인 int 지원보다 계약의 안전 정수 범위를 우선한다.
- 기존 수신 단계의 U+0000·짝 없는 surrogate·스키마 거절을 유지한다. 호환 해시는 이 검증을 우회하지 않는다.
  선택적 비교 DTO는 기존대로 해시 검사 뒤 의미 검증 실패 시 DTO/해시 쌍만 버린다.
- supplement 벡터 4개는 신고명에 LF·탭·CRLF·U+0001을 각각 넣었다. 각 형식에 canonical 문자열·UTF-8 hex·SHA-256을 기록했다.
  추가 벡터는 😀/U+E000 키 순서(코드 포인트 정렬과 UTF-16 정렬의 차이), 키 내부 제어문자/따옴표/역슬래시,
  중첩 키, 안전 정수 경계, 한글/emoji/슬래시/BS/FF/U+2028/U+2029를 확인한다.
- 모바일 Dart 파일을 수정 없이 직접 import해 5개 벡터의 **literal 문자열과 UTF-8 hex**를 비교했다.
  같은 hex의 SHA-256은 Python 생성·계약 검사, Node, Deno에서 일치했다. 모바일 앱 전체 실행이나 운영 요청 재현을 주장하지 않는다.

## 멱등성·다른 경로 영향

1. `raw.sha256`/size 검사는 원문 문자열의 UTF-8 바이트를 사용하며 변경하지 않았다. 원문 공백·키 순서·숫자 표기 차이를 그대로 유지한다.
2. v1 payload 검사는 `handler.ts`의 기존 `canonicalJson` 한 가지로만 진행한다. 제어문자 포함 payload의 서버형 수신·literal형 거절을 별도 시험했다.
3. handler는 입력 해시를 재작성하거나 형식 필드를 RPC 이벤트/DB/응답에 추가하지 않는다. `rawEventFingerprint`도 기존 그대로다.
   새 로그 필드는 fingerprint에 들어가지 않는다. 같은 이벤트를 두 번 처리해 동일한 RPC 입력과 fingerprint를 확인했다.
4. SQL `community_ingest_events`의 같은 event_id 재전송은 동일 fingerprint 등 불변 필드가 맞으면 **duplicate**다
   (`202610210100_raw_json_ingest.sql` 1030–1055). 다른 event_id로 같은 신고를 보내는 경우
   `community_report_raw.raw_sha256`·`supplement_sha256`·동의·writer/revision·parse 상태 조건이 맞으면 **no_change**다(1073–1079).
   이 두 결과를 구분하며, SQL 자체는 수정하지 않았다.
5. 로컬 PGlite에서 server/literal 각각 같은 해시로 보내면 no_change, 같은 이벤트를 다시 보내면 duplicate임을 검증했다.
   같은 내용의 해시 형식만 바꾸고 새 event_id를 쓰면 stored가 되며 클라이언트 해시가 그대로 저장됨도 검증했다.
   같은 event_id에서 형식을 바꾸면 fingerprint가 달라 기존 규칙에 따라 conflict가 될 수 있다.
   **한 클라이언트는 늘 한 형식을 쓴다는 사용자 전제에 따라 형식 변경 시 달라지는 SHA/콘텐츠 판정을 받아들인다.**

## 나중에 PC·모바일 사본에 반영할 계약 파일

아래 5개만 변경됐다. 스키마·기존 wire envelope·기존 해시 벡터 값은 유지했다.

- `contracts/community-ingest-v2/README.md`
- `contracts/community-ingest-v2/vectors/wire.json`
- `contracts/community-ingest-v2/MANIFEST.sha256`
- `contracts/community-ingest/canonical-json.md`
- `contracts/community-ingest/MANIFEST.sha256`

`python3 scripts/raw-ingest/generate_contract.py`로 v2를 재생성했다. 출력:

```text
NOTE: PARSER_REPO 가 없어 커밋된 vectors/wire.json 의 client_observation 을 그대로 씁니다(파서 재계산 생략).
PASS: generated schemas and synthetic UTF-8/hash vectors
```

v1 manifest는 canonical-json.md 한 행의 digest만 갱신했다. 별도 Python 읽기 전용 검증으로 기존 18행 전부 파일 SHA-256과 일치했다:

```text
PASS: all 18 v1 contract manifest digests match
```

## 실행 명령·결과

명령 실행 디렉터리는 작업 저장소다. npm 호출에는 다운로드 방지를 위해 `npm_config_offline=true`,
`npm_config_cache="$PWD/.agent-runtime/fix-hash-20261023/npm-cache"`를 지정했다.
추가/분리 재실행에는 `TMPDIR="$PWD/.agent-runtime/fix-hash-20261023/tmp"`를 지정했다.
각 로그는 `set -o pipefail` 상태에서 `2>&1 | tee .agent-runtime/fix-hash-20261023/<로그명>`으로 보존했다.
아래는 stdout/stderr 원출력이며, 종료 코드는 도구가 보고한 값이다. tsc는 성공 시 출력이 없다.

| 검사 | 결과 |
|---|---|
| `npx vitest run` | 종료 1: 87 파일 통과 / 1 실패 / 37 건너뜀, 1362 시험 통과 / 11 실패 / 232 건너뜀 |
| `npx tsc --noEmit` | 종료 0, 출력 없음 |
| `python3 scripts/raw-ingest/check_contract.py` | 종료 0, 15 계약 파일·생성 재현·0 사본 |
| `DENO_DIR="$PWD/.agent-runtime/fix-hash-20261023/deno" deno test --no-config --no-remote --no-lock --allow-read tests/deno/raw_ingest_test.ts` | 종료 0, 6 통과 |
| `npx vitest run tests/product/composeScript.test.ts tests/product/rawIngest.test.ts` | 종료 1: compose 11 실패 재현, raw 25 통과 |
| `npx vitest run tests/product/rawIngest.test.ts --reporter=verbose` | 종료 0, 25 통과 |
| `node tests/sql/verify-raw-ingest.mjs` | 최초/두 형식 멱등성 시험 추가 후 모두 종료 0, 합성 PGlite |
| `/home/better0101/development/flutter/bin/cache/dart-sdk/bin/dart --disable-dart-dev .agent-runtime/fix-hash-20261023/check_mobile.dart` | 종료 0, 모바일 원본과 literal 5개 문자열/바이트 일치 |
| `git diff --check` | 종료 0, 출력 없음 |

### 전체 시험의 미해결 한계

5초 시간 초과는 없었다. compose 11건은 모두 예상한 stdout/stderr가 빈 문자열이어서 실패했다.
이 파일과 `scripts/integration/compose_supabase.mjs`는 수정하지 않았다. 단독 재실행에서도 같은 11건이 실패했다.
Vitest 밖에서 그 스크립트를 spawnSync로 실행해도 상태 2에 stdout/stderr는 모두 빈 문자열이었다.
더 줄여 저장소 코드를 전혀 호출하지 않는 아래 Node 명령도 실행했고 stdout/stderr 캡처가 비었다:

```js
import { spawnSync } from 'node:child_process';
const r = spawnSync(process.execPath, ['-e', "console.log('console-out'); console.error('console-err'); process.stdout.write('direct-out'); process.stderr.write('direct-err');"], { encoding: 'utf8' });
process.stdout.write(JSON.stringify({ status: r.status, stdout: r.stdout, stderr: r.stderr }) + '\n');
```

실제 출력:

```text
{"status":0,"stdout":"","stderr":""}
```

**BLOCKED: 전체 Vitest 통과 판정.** 현 실행 환경에서 자식 Node 출력 캡처가 사라지는 현상까지 확인했다. 정확한 환경 원인은 확정하지 않았다.
무관한 compose 코드나 호스트 설정을 바꿔 통과시키지 않았다. 37개 파일/232개 시험은 suite의 기존 조건에 따라 skipped이며 통과로 세지 않았다.
**BLOCKED/미실행: 실제 서비스·운영 로그 재검증, 운영 DB·Edge 배포, PC·모바일 계약 사본 검사.** 사용자 범위 밖이다.
로컬 Deno 처리기 시험의 인증/RPC는 합성 의존성이며 실제 원격 Edge 호출이 아니다. 로컬 PGlite는 실제 운영 DB가 아니다.
UI 파일을 변경하지 않아 브라우저/Muse UI 검수는 이번 해시 수정 검증 대상에 포함하지 않았다.

### 전체 Vitest 원출력 (vitest.log)

```text

 RUN  v5.0.1 /home/better0101/projects/backfill-resume-ws/map

 ❯ tests/product/composeScript.test.ts (11 tests | 11 failed) 4630ms
   ❯ compose_supabase.mjs auth path (2)
     × fails clearly when no auth repository is given 81ms
     × fails clearly when the auth path is not a community-auth checkout 135ms
   ❯ compose_supabase.mjs staging coverage (9)
     × fails when a transitive import (json with-attribute, resolver, type-only) is not staged 457ms
     × passes when the full import closure is staged 381ms
     × fails when a staged shared file is not imported 376ms
     × ignores fake imports inside comments and string literals 356ms
     × detects a two-argument dynamic import (import attributes as second argument) 394ms
     × tracks a fixed template-literal dynamic import 606ms
     × allows imports of other files inside the same function directory 1021ms
     × uses the same function-file filter as compose, including names containing node_modules 403ms
     × still fails when a JSON import target is missing 414ms

⎯⎯⎯⎯⎯⎯ Failed Tests 11 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/product/composeScript.test.ts > compose_supabase.mjs auth path > fails clearly when no auth repository is given
AssertionError: expected '' to contain 'auth repository path required'

- Expected
+ Received

- auth repository path required

 ❯ tests/product/composeScript.test.ts:19:22
     17|     const r = run(['check']);
     18|     expect(r.status).toBe(2);
     19|     expect(r.stderr).toContain('auth repository path required');
       |                      ^
     20|   });
     21|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/11]⎯

 FAIL  tests/product/composeScript.test.ts > compose_supabase.mjs auth path > fails clearly when the auth path is not a community-auth checkout
AssertionError: expected '' to contain 'not a community-auth checkout'

- Expected
+ Received

- not a community-auth checkout

 ❯ tests/product/composeScript.test.ts:27:27
     25|     const viaEnv = run(['check'], { SR_AUTH_REPO: empty });
     26|     expect(viaEnv.status).toBe(2);
     27|     expect(viaEnv.stderr).toContain('not a community-auth checkout');
       |                           ^
     28|   });
     29| });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/11]⎯

 FAIL  tests/product/composeScript.test.ts > compose_supabase.mjs staging coverage > fails when a transitive import (json with-attribute, resolver, type-only) is not staged
AssertionError: expected '' to contain 'shared/reg/data.json'

- Expected
+ Received

- shared/reg/data.json

 ❯ tests/product/composeScript.test.ts:78:22
     76|     const r = check();
     77|     expect(r.status).toBe(1);
     78|     expect(r.stderr).toContain('shared/reg/data.json');
       |                      ^
     79|     expect(r.stderr).toContain('shared/reg/resolve.ts');
     80|     expect(r.stderr).toContain('shared/reg/types.ts');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/11]⎯

 FAIL  tests/product/composeScript.test.ts > compose_supabase.mjs staging coverage > passes when the full import closure is staged
AssertionError: expected '' to contain 'manifest check ok'

- Expected
+ Received

- manifest check ok

 ❯ tests/product/composeScript.test.ts:88:22
     86|     const r = check();
     87|     expect(r.status).toBe(0);
     88|     expect(r.stdout).toContain('manifest check ok');
       |                      ^
     89|   });
     90|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/11]⎯

 FAIL  tests/product/composeScript.test.ts > compose_supabase.mjs staging coverage > fails when a staged shared file is not imported
AssertionError: expected '' to contain 'server/unused.ts'

- Expected
+ Received

- server/unused.ts

 ❯ tests/product/composeScript.test.ts:98:22
     96|     const r = check();
     97|     expect(r.status).toBe(1);
     98|     expect(r.stderr).toContain('server/unused.ts');
       |                      ^
     99|     expect(r.stderr).toContain('is not imported');
    100|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/11]⎯

 FAIL  tests/product/composeScript.test.ts > compose_supabase.mjs staging coverage > ignores fake imports inside comments and string literals
AssertionError: expected '' to contain 'manifest check ok'

- Expected
+ Received

- manifest check ok

 ❯ tests/product/composeScript.test.ts:123:22
    121|     const r = check();
    122|     expect(r.status).toBe(0);
    123|     expect(r.stdout).toContain('manifest check ok');
       |                      ^
    124|   });
    125|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/11]⎯

 FAIL  tests/product/composeScript.test.ts > compose_supabase.mjs staging coverage > detects a two-argument dynamic import (import attributes as second argument)
AssertionError: expected '' to contain 'shared/reg/lazy.ts'

- Expected
+ Received

- shared/reg/lazy.ts

 ❯ tests/product/composeScript.test.ts:139:25
    137|     const fail = missing.check();
    138|     expect(fail.status).toBe(1);
    139|     expect(fail.stderr).toContain('shared/reg/lazy.ts');
       |                         ^
    140|     expect(fail.stderr).toContain('is not staged');
    141|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/11]⎯

 FAIL  tests/product/composeScript.test.ts > compose_supabase.mjs staging coverage > tracks a fixed template-literal dynamic import
AssertionError: expected '' to contain 'shared/reg/lazy.ts'

- Expected
+ Received

- shared/reg/lazy.ts

 ❯ tests/product/composeScript.test.ts:162:25
    160|     const fail = missing.check();
    161|     expect(fail.status).toBe(1);
    162|     expect(fail.stderr).toContain('shared/reg/lazy.ts');
       |                         ^
    163|     expect(fail.stderr).toContain('is not staged');
    164|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/11]⎯

 FAIL  tests/product/composeScript.test.ts > compose_supabase.mjs staging coverage > allows imports of other files inside the same function directory
AssertionError: expected '' to contain 'manifest check ok'

- Expected
+ Received

- manifest check ok

 ❯ tests/product/composeScript.test.ts:190:22
    188|     const r = check();
    189|     expect(r.status).toBe(0);
    190|     expect(r.stdout).toContain('manifest check ok');
       |                      ^
    191|   });
    192|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/11]⎯

 FAIL  tests/product/composeScript.test.ts > compose_supabase.mjs staging coverage > uses the same function-file filter as compose, including names containing node_modules
AssertionError: expected '' to contain 'node_modules-helper.ts'

- Expected
+ Received

- node_modules-helper.ts

 ❯ tests/product/composeScript.test.ts:202:25
    200|     const fail = excluded.check();
    201|     expect(fail.status).toBe(1);
    202|     expect(fail.stderr).toContain('node_modules-helper.ts');
       |                         ^
    203|     expect(fail.stderr).toContain('is not staged');
    204|

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[10/11]⎯

 FAIL  tests/product/composeScript.test.ts > compose_supabase.mjs staging coverage > still fails when a JSON import target is missing
AssertionError: expected '' to contain 'shared/reg/data.json'

- Expected
+ Received

- shared/reg/data.json

 ❯ tests/product/composeScript.test.ts:224:22
    222|     const r = check();
    223|     expect(r.status).toBe(1);
    224|     expect(r.stderr).toContain('shared/reg/data.json');
       |                      ^
    225|     expect(r.stderr).toContain('is not staged');
    226|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[11/11]⎯


 Test Files  1 failed | 87 passed | 37 skipped (125)
      Tests  11 failed | 1362 passed | 232 skipped (1605)
   Start at  09:14:21
   Duration  28.93s (transform 47%, import 37%, tests 15%, worker 1%)

  Transform  transforming modules took 143.37s · 47% of tracked time, re-done on every run
             persist transforms across runs with fsModuleCache: true
             learn more: https://vitest.dev/guide/improving-performance#caching-between-reruns

```

### TypeScript 원출력 (tsc.log)

```text
```

### 계약 검사 원출력 (contract.log)

```text
PASS: 15 contract files; generator output reproduced; 0 copies
```

### Deno 원출력 (deno.log)

```text
Check tests/deno/raw_ingest_test.ts
running 6 tests from ./tests/deno/raw_ingest_test.ts
raw UTF-8, supplement and DTO bytes match shared vectors ... ok (14ms)
immutable fingerprint includes fetch/source metadata ... ok (878µs)
v2 handler accepts both control-character hash forms and rejects neither ... ok (67ms)
gzip bomb: 300MB of zeros is rejected with 413 without large RSS growth (Deno runtime) ... ok (668ms)
gzip with v2 disabled fails fast with 415 before auth and before inflating ... ok (809ms)
bounded inflate returns exact bytes up to the cap ... ok (76ms)

ok | 6 passed | 0 failed (1s)

```

### raw ingest 분리 시험 원출력 (raw-final.log)

```text

 RUN  v5.0.1 /home/better0101/projects/backfill-resume-ws/map

 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > validates exact UTF-8 bytes and preserves original serialization 10ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > matches both canonical strings, UTF-8 bytes and hashes in the shared vectors 7ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > accepts server supplement hashes without rewriting storage or exposing content 62ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > accepts literal supplement hashes without rewriting storage or exposing content 24ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > rejects supplement hashes matching neither form before storage 8ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > does not enable literal compatibility for v1 payload hashes 4ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > accepts either client_observation hash independently of the supplement form; rejects neither 17ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > stores+queues without Edge parsing, gzip=false 3ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > stores+queues without Edge parsing, gzip=true 13ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > is disabled by default and uses the shared capability switch 4ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > rejects content corruption, reporter keys and mismatched identities before storage 9ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > rejects protocol coercion and decompression bombs 38ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > gzip with v2 disabled fails fast with 415 (same as any unsupported encoding) before auth and before reading 2ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > gzip when the shared switch says v2 is off: auth → capabilities → rate limit → 503 retryable, never inflated 1ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > gzip bomb with v2 on is rejected 413 after auth; nothing is inflated for an unauthenticated caller 17ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > identity v2 bodies keep the 256KiB cap (413 before auth); gzip wire is capped at 512KiB 5ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > capabilities failure: v2 gets 503 service_unavailable (retryable), never 500 2ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > rejects duplicate keys in raw.body (reporter-key bypass) as raw_invalid 16ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > rejects lone UTF-16 surrogates with 422 instead of letting Postgres jsonb fail with 500 15ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > rejects NUL (literal or JSON-escaped) anywhere in raw.body, client_observation and supplement with 422 10ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > drops an optional client_observation with invalid VALUES (raw is kept); hash mismatch still rejects 5ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > v2 status_correction is schema_invalid (event.schema.json enum); reshare/trigger mismatch stays event_type_mismatch 2ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > fingerprint changes when metadata or comparison content changes, without storing a raw body 1ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > worker derivation equals every v1 observation vector 179ms
 ✓ tests/product/rawIngest.test.ts > private raw v2 reception > public handlers/read models never import or read the raw/parsed stores 3ms

 Test Files  1 passed (1)
      Tests  25 passed (25)
   Start at  09:16:03
   Duration  8.58s (transform 69%, import 25%, tests 5%)

  Transform  transforming modules took 5.80s · 69% of tracked time, re-done on every run
             persist transforms across runs with fsModuleCache: true
             learn more: https://vitest.dev/guide/improving-performance#caching-between-reruns

```

### 최종 SQL 원출력 (sql-final.log)

```text
PASS: v1 SQL parity + single-statement transport columns, cron-style purge keeps duplicate ACK, fail-closed config/notice CHECK, policy (date,N) compare, lease claim/finish, L3/L5/L7, M5 active grant, M6 tombstones, map client state, least privilege, revoke cascade (synthetic PGlite)
```

### 모바일 Dart 원출력 (dart.log)

```text
PASS: 5 literal canonical strings and UTF-8 byte vectors match the unmodified mobile Dart implementation
```

### 모바일 바이트 대조 재현 코드

위 Dart 명령에 사용한 로컬 검사 파일의 전체 내용이다. 같은 경로에 저장해 재실행할 수 있다.

```dart
import 'dart:convert';
import 'dart:io';
import '/home/better0101/projects/safetyreport-mobile/lib/community/capture/canonical_json.dart';

void main() {
  final wire = jsonDecode(File('contracts/community-ingest-v2/vectors/wire.json').readAsStringSync());
  final cases = [...wire['supplement_hash_cases'], ...wire['canonical_hash_cases']];
  for (final c in cases) {
    final encoded = canonicalJson(c['supplement'] ?? c['value']);
    final hex = utf8.encode(encoded).map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    if (encoded != c['literal']['canonical'] || hex != c['literal']['utf8_hex']) {
      throw StateError('${c['name']}: mobile byte mismatch');
    }
  }
  print('PASS: ${cases.length} literal canonical strings and UTF-8 byte vectors match the unmodified mobile Dart implementation');
}
```
