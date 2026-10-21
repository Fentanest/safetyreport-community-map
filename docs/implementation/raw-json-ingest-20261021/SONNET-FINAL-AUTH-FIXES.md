# auth 최종 검수 수정 (Sonnet, 2026-10-21)

작업 위치: auth worktree (feat/raw-json-ingest, 미커밋 변경).

1. 카카오 연결 해제 시 세션 삭제: `202610210300_kakao_unlink_revoke.sql` 의 함수가 같은 트랜잭션에서 `delete from auth.sessions where user_id = v_user` 를 한다.
   로컬 GoTrue 에서 `auth.refresh_tokens_session_id_fkey ... ON DELETE CASCADE` 확인(읽기 전용 psql). 이미 철회된 계정에도 실행(멱등). `docs/kakao-unlink.md` 의 G10 문장을 Supabase refresh token 기준으로 정정.
2. SQL 테스트 커밋: `tests/sql/verify-kakao-unlink.mjs` (`npm run test:sql`) + `tests/sql-kakao-unlink.unit.test.ts`(npm test 가 호출). PGlite 는 auth node_modules 없음 → `../map/node_modules` 대체 사용(없으면 exit 2 로 skip, PGLITE_PATH 지원).
   범위: 전체 active grant 철회(reason kakao_unlinked), 세션·refresh token cascade 삭제(타 사용자 유지), 두 번째 호출 already_revoked, 모르는 id matched:false, google identity 불일치, sub 대체 조회, CHECK, 권한, search_path. map purge 트리거는 같은 규칙의 스텁(문서·헤더에 명시).
3. `server/kakaoUnlink.ts`: 타임아웃 뒤 RPC 를 `deps.waitUntil`(주입) 또는 `EdgeRuntime.waitUntil` 로 유지. 주입 waitUntil 테스트 추가.
4. `server/account.ts`: capabilities·uploadHistory 를 Promise.all 로 병렬(각각 실패 허용 유지; internal_account_status 는 앞선 call 로 먼저 실패해야 하는 필수 호출이라 순차 유지 — 기존 에러 의미 보존). v1 폴백에 `raw_policy_version:null` 명시(테스트 2곳 갱신). auth/docs/account-api.md 에 `last_parser_version` 추가, 폴백 문구 갱신.
   **map 계약 필요 변경(REPORT)**: `map/contracts/community-ingest-v2/account-api.md` 는 이미 last_parser_version 를 포함하지만 auth 사본과 다른 문단이 많음(실패 허용 문단·CORS 문단). 바이트 동일 요구라면 계약 쪽에서 실패 허용 문단(raw_policy_version:null 포함)을 맞춰야 함. map 은 수정하지 않음.
5. `docs/kakao-unlink.md` "배포 메모": 정책 초안 SQL 번호 202610210200 은 새 번호로 변경, verify_jwt=false 확인 절차 유지, 웹훅은 새 정책 스위치와 함께 등록.

검사: `npm test` 통과(89 passed, 3 files skipped 기존 통합), `npm run build` 통과, `npm run test:sql` "SQL verification OK".
