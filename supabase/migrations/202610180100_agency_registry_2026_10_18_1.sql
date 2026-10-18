-- Agency registry 2026-10-18.1 (미배포): 공식 자료 갱신 + 경계 1:다 동일성 결함 수정.
-- 이전 2026-09-29.3 대비 링크 +145/-66, legacy forward 19,822→20,300, multi 32→40.
-- 현존 경계의 institution_id 충돌은 빌더/validator에서 금지한다.
--
-- 배포 순서: 새 스냅샷 Edge 번들 → 구 Edge 요청 종료 확인 → 이 singleton migration
-- → 같은 새 스냅샷으로 recompute dry-run → apply → stale 행/통계 검증.
-- 현재 trigger는 계산에 쓴 Edge 버전 대신 singleton을 찍는다. singleton을 먼저 올리면
-- 구 Edge의 옛 키가 새 버전으로 찍혀 recompute에서 누락된다. Edge 교체만으로 진행 중
-- 구 요청이 끝났다고 간주하지 않는다. 필요하면 수집을 잠시 멈추고 구 요청을 drain한다.
--
-- Rollback: 이전 Edge 번들 배포 + 구 요청 종료 → 별도 migration으로 singleton을
-- 2026-09-29.3으로 복구 → 이전 스냅샷과 호환 recompute 도구로 dry-run/apply 재실행.
-- singleton만 되돌려도 facts의 기관·담당자 키는 복구되지 않는다. 코드 없는 행은
-- 이전 별칭이 모호할 수 있으므로 적용 전 triple/version 백업과 대조해 복원한다.
-- 이미 적용한 SQL을 편집하지 않으며 원문 사실·신고 수를 바꾸지 않는다.
begin;
update private.community_registry_state
    set version = '2026-10-18.1', updated_at = now()
    where id = 1;
commit;
