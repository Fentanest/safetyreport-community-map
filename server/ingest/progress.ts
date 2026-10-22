// POST /community-ingest/progress body (contracts/community-ingest-v2/progress.schema.json, 2026-10-22 task 2-1).
// Counts and status codes only: no report id, report text, URL, official id or device identifier can fit the schema.
// Returns the object stored as `last_progress` (the envelope keys protocol / connection_id are dropped).

export const PROGRESS_MAX_BYTES = 4096;
export const BACKFILL_STATES = ['waiting_optimize', 'listing', 'filling', 'uploading', 'paused', 'holds', 'done', 'none'] as const;
const PLATFORMS = ['windows', 'linux', 'macos', 'docker', 'android', 'ios', 'other'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CODE = /^[a-z0-9_]{1,40}$/;
const VERSION_TEXT = /^[0-9][0-9A-Za-z.+_-]{0,39}$/;
const PARSER_TEXT = /^[0-9A-Za-z.+_-]{1,40}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const COUNT_MAX = 10_000_000;
const PACE_MAX = 100_000;
const KEYS = ['protocol', 'contract', 'connection_id', 'source_app', 'platform', 'client_version', 'parser_version', 'backfill',
  'optimize', 'official_login', 'pace'];
const BACKFILL_KEYS = ['state', 'phase', 'reason', 'next_attempt_at', 'total', 'stored', 'queued', 'pending', 'holds', 'stale_holds',
  'raw_unavailable', 'not_eligible', 'run_started_at', 'updated_at'];
const COUNTS = ['total', 'stored', 'queued', 'pending', 'holds', 'stale_holds', 'raw_unavailable', 'not_eligible'];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
const code = (v: unknown) => v === null || (typeof v === 'string' && CODE.test(v));
const instant = (v: unknown) => v === null || (typeof v === 'string' && INSTANT.test(v) && Number.isFinite(Date.parse(v)));
const count = (v: unknown, max = COUNT_MAX) => v === null || (Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max);

/** null when the body does not match the contract (the handler answers 422 schema_invalid). */
export function parseProgress(b: unknown): { connectionId: string; report: Record<string, unknown> } | null {
  if (!isObj(b) || !exact(b, KEYS) || b.protocol !== 1 || b.contract !== 'community-progress-v1') return null;
  if (typeof b.connection_id !== 'string' || !UUID.test(b.connection_id)) return null;
  if (b.source_app !== 'safetyreport' && b.source_app !== 'safetyreport-mobile') return null;
  if (!PLATFORMS.includes(b.platform as string)) return null;
  if (typeof b.client_version !== 'string' || !VERSION_TEXT.test(b.client_version)) return null;
  if (typeof b.parser_version !== 'string' || !PARSER_TEXT.test(b.parser_version)) return null;
  const f = b.backfill;
  if (!isObj(f) || !exact(f, BACKFILL_KEYS) || !(BACKFILL_STATES as readonly string[]).includes(f.state as string)) return null;
  if (!code(f.phase) || !code(f.reason) || !instant(f.next_attempt_at) || !instant(f.run_started_at) || !instant(f.updated_at)) return null;
  if (!COUNTS.every(k => count(f[k]))) return null;
  const o = b.optimize;
  if (!isObj(o) || !exact(o, ['required', 'running', 'holds_only']) || ![o.required, o.running, o.holds_only].every(x => typeof x === 'boolean')) return null;
  if (!['ok', 'retry', 'manual_required'].includes(b.official_login as string)) return null;
  const p = b.pace;
  if (p !== null) {
    // mobile only: progress-speed hints for the WorkManager/foreground split (PC sends null)
    if (b.source_app !== 'safetyreport-mobile' || !isObj(p) || !exact(p, ['foreground_slices_today', 'background_runs_today'])
        || !count(p.foreground_slices_today, PACE_MAX) || !count(p.background_runs_today, PACE_MAX)) return null;
  }
  const { protocol: _p, connection_id: _c, ...report } = b;
  return { connectionId: b.connection_id, report };
}
