// planUpdates unit test (no database): recompute rules for stored facts.
import { describe, expect, it } from 'vitest';

import { planUpdate } from '../../scripts/recompute-agency-keys.mjs';

const base = {
  contributor_id: 'u',
  dataset_key: 'd',
  source_report_key: 'k',
  manager_name: '김담당',
  agency_registry_version: '2026-09-28.1',
};

describe('recompute plan', () => {
  it('takes the fresh derivation for a coded row (seed-era a1: upgrades)', async () => {
    const plan = await planUpdate({
      ...base,
      source_agency_code: '1812314',
      agency_name: '광주광역시경찰청',
      agency_key: 'a1:oldseedhash00000000000000',
      agency_current_name: '광주광역시경찰청',
      manager_key: 'm1:oldseedhash00000000000000',
    });
    expect(plan.changed).toBe(true);
    expect(plan.reason).toBe('code-present');
    expect(plan.next.agency_key).toBe('inst:ag-gwangju-police-hq');
    expect(plan.next.agency_current_name).toBe('경찰청 광주경찰청 광주동부경찰서');
  });
  it('is a no-op when the stored triple already matches', async () => {
    const first = await planUpdate({
      ...base,
      source_agency_code: '1812314',
      agency_name: '광주광역시경찰청',
      agency_key: 'a1:oldseedhash00000000000000',
      agency_current_name: '광주광역시경찰청',
      manager_key: 'm1:oldseedhash00000000000000',
    });
    const plan = await planUpdate({
      ...base,
      source_agency_code: '1812314',
      agency_name: '광주광역시경찰청',
      agency_key: first.next.agency_key,
      agency_current_name: first.next.agency_current_name,
      manager_key: first.next.manager_key,
    });
    expect(plan.changed).toBe(false);
  });
  it('keeps a stored inst: key for a codeless row (REVIEW4, no regression)', async () => {
    const plan = await planUpdate({
      ...base,
      source_agency_code: null,
      agency_name: '광주광역시경찰청',
      agency_key: 'inst:ag-gwangju-police-hq',
      agency_current_name: '경찰청 광주경찰청 광주동부경찰서',
      manager_key: 'm1:somehash0000000000000000',
    });
    expect(plan.changed).toBe(false);
    expect(plan.reason).toBe('codeless-keep');
    expect(plan.next.agency_key).toBe('inst:ag-gwangju-police-hq');
  });
  it('upgrades a codeless a1: row on a unique alias hit', async () => {
    const plan = await planUpdate({
      ...base,
      source_agency_code: null,
      agency_name: '경찰청 광주경찰청 광주동부경찰서',
      agency_key: 'a1:somehash0000000000000000',
      agency_current_name: '경찰청 광주경찰청 광주동부경찰서',
      manager_key: 'm1:somehash0000000000000000',
    });
    expect(plan.changed).toBe(true);
    expect(plan.reason).toBe('codeless-alias-upgrade');
    expect(plan.next.agency_key).toBe('inst:ag-gwangju-police-hq');
  });
  it('keeps a codeless unknown name on its a1: row', async () => {
    const plan = await planUpdate({
      ...base,
      source_agency_code: null,
      agency_name: '어딘가구청',
      agency_key: 'a1:somehash0000000000000000',
      agency_current_name: '어딘가구청',
      manager_key: 'm1:somehash0000000000000000',
    });
    expect(plan.changed).toBe(false);
    expect(plan.reason).toBe('codeless-keep');
  });
  it('moves a branched code to its (구) row', async () => {
    const plan = await planUpdate({
      ...base,
      source_agency_code: '1270379',
      agency_name: '법무부 대구지방교정청 부산교도소 서무과',
      agency_key: 'a1:somehash0000000000000000',
      agency_current_name: '법무부 대구지방교정청 부산교도소 서무과',
      manager_key: 'm1:somehash0000000000000000',
    });
    expect(plan.changed).toBe(true);
    expect(plan.next.agency_current_name).toBe('(구)법무부 대구지방교정청 부산교도소 서무과');
  });
});
