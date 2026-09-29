-- Agency registry 2026-09-29.3: 폐지 하위조직 코드의 색인 포함에 맞춘 버전 상향.
--
-- 2026-09-29 결함 대응: 2026-09-29.2로 운영 2,868건을 재계산했더니 기관코드가
-- 있는데도 86건(3%)이 미확정(src: 이름 키)으로 남았다. 빌더가 색인을 줄이며
-- 폐지된 부서(하위조직) 코드를 뺐기 때문이다. 2026-09-29.3은 후속
-- 없는(forward/multi 없음) 2014-01-01 이후 폐지 비제외 코드를 색인에 둔다:
-- 하위조직은 [code,agg] 압축 행이다. 지방자치단체 내부 국은 시도/시군구까지
-- 올리고, 경찰은 경찰서(직할이면 시도경찰청) 단위로 둔다. 집계기관이 개명·1:1
-- 승계됐으면 현행 경계로 잇고, 후속 없이
-- 폐지된 집계기관(예: 4810000 전라남도 여수시 — 전남광주통합특별시 출범
-- 2026-07-01로 폐지, 새 코드 이전기관코드 NULL이라 자동 연결 금지)은 마지막
-- 알려진 이름의 경계 행과 함께 둔다. forward/multi 보유 코드는 기존 귀결 유지.
--
-- 이 migration은 singleton 버전만 올린다(additive, idempotent). 저장된 사실의
-- 파생값(agency_key, agency_current_name, manager_key) 재계산은 Edge 번들에 새
-- 스냅샷을 담은 뒤 scripts/recompute-agency-keys.mjs 로 한다(dry-run 먼저).
-- recompute 스크립트는 DB 버전과 번들 버전이 같을 때만 동작하므로, 이 migration
-- 없이 재계산을 돌리면 버전 불일치로 중단된다.
--
-- Rollback: 새 migration으로 version을 '2026-09-29.2'로 되돌린다(이미 적용한
-- SQL 수정 금지). facts 값은 그대로 둔다.
begin;
update private.community_registry_state
    set version = '2026-09-29.3', updated_at = now()
    where id = 1;
commit;
