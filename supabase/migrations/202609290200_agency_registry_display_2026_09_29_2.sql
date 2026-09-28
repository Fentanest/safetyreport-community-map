-- Agency registry 2026-09-29.2: 현행 표시명 '경찰청 ' 접두어 제거에 맞춘 버전 상향.
--
-- 2026-09-29 사용자 결정: 기관코드로 찾은 현행 기관 표시명은 공식 '전체기관명'에서
-- 맨 앞의 '경찰청 ' 접두어만 한 번 뗀다('경찰청 광주경찰청 광주동부경찰서' →
-- '광주경찰청 광주동부경찰서', 본청 '경찰청'·비경찰 이름은 그대로).
-- 표시 규칙은 registry 스냅샷(2026-09-29.2) 빌드 시점에 적용되며, resolver·원문
-- 컬럼(source_agency_code, agency_name)·집계 건수는 바뀌지 않는다.
--
-- 이 migration은 singleton 버전만 올린다(additive, idempotent). 저장된 사실의
-- 파생값(agency_key, agency_current_name, manager_key) 재계산은 Edge 번들에 새
-- 스냅샷을 담은 뒤 scripts/recompute-agency-keys.mjs 로 한다(dry-run 먼저).
-- recompute 스크립트는 DB 버전과 번들 버전이 같을 때만 동작하므로, 이 migration
-- 없이 재계산을 돌리면 버전 불일치로 중단된다.
--
-- Rollback: 새 migration으로 version을 '2026-09-29.1'로 되돌린다(이미 적용한
-- SQL 수정 금지). facts 값은 그대로 둔다.
begin;
update private.community_registry_state
    set version = '2026-09-29.2', updated_at = now()
    where id = 1;
commit;
