-- Agency registry 2026-10-18.1: 공식 기관코드 전체자료 2026-10-18 판으로 재빌드.
--
-- 변화는 공식 자료의 조직 개편 반영이다(2026-10-01 검찰청 → 공소청 개편 등). 1:1 파생 링크 146개 추가·17개
-- 제거(목적 코드가 다시 폐지된 검찰 옛 연쇄), (구) 역사 노드 32 → 40, forward 19,822 → 20,300.
-- 빌더·규칙 변경은 없다. PC 테스트 서버의 실제 기관 134종(신고 3,143건)은 통계 키·표시가 하나도 바뀌지 않았다.
--
-- 이 migration은 singleton 버전만 올린다(additive, idempotent). 저장된 사실의 파생값 재계산은
-- Edge 번들에 새 스냅샷을 담은 뒤 scripts/recompute-agency-keys.mjs 로 한다(dry-run 먼저, DB·번들 버전이 같을 때만 동작).
--
-- Rollback: 새 migration으로 version을 2026-09-29.3 으로 되돌린다(이미 적용한 SQL 수정 금지). facts 값은 그대로 둔다.
begin;
update private.community_registry_state
    set version = '2026-10-18.1', updated_at = now()
    where id = 1;
commit;
