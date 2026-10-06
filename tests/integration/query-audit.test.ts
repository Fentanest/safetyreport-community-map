// Local-only rollback tests; frozen pre-audit functions are stored in the catalog evidence.
import { execFileSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

describe.skipIf(process.env.COMMUNITY_STACK !== '1')('complete query audit regression', () => {
  it('preserves ordered read results, manifest increments, CAS errors and actual role boundaries', () => {
    execFileSync('python3', ['scripts/query-audit/regression.py'], {
      encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    });
  }, 120000);
  it.skipIf(process.env.QUERY_AUDIT_PERF !== '1')('keeps concentrated viewer and metadata out of the per-fact helper regression', () => {
    // Thresholds apply to complete RPCs on 30k synthetic facts, including their actual JSON serialization.
    const result = execFileSync('python3', ['scripts/query-audit/performance_test.py'], {
      encoding: 'utf8', timeout: 300000, maxBuffer: 4 * 1024 * 1024,
    });
    expect(result).toContain('performance checks passed');
  }, 300000);
});
