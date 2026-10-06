import type { PrivateFact } from './aggregate.ts';

/** Service-only lossless wire format. Never return these rows or keys to a browser. */
export const SCREEN_FACT_COLUMNS = [
  'fact_identity',
  'contributor_id',
  'report_identity',
  'report_number',
  'source_report_key',
  'first_accepted_at',
  'snapshot_id',
  'snapshot_generation',
  'report_date',
  'completed_date',
  'identity_report_date',
  'identity_completed_date',
  'category',
  'status',
  'disposition',
  'vehicle_raw',
  'point_key',
  'lat',
  'lng',
  'address',
  'region_code',
  'agency_key',
  'agency_name',
  'agency_current_name',
  'manager_key',
  'manager_name',
  'is_representative',
  'contribution_count',
  'amount_kind',
  'amount_confirmed_won',
  'amount_public',
  'amount_stated',
  'violation_law',
  'rating',
] as const satisfies readonly (keyof PrivateFact)[];

/** Accept the old SQL response during SQL → Edge deployment/rollback. Unknown encodings fail closed. */
export function decodeScreenFacts(value: unknown): PrivateFact[] | null {
  if (Array.isArray(value)) return value as PrivateFact[];
  if (!value || typeof value !== 'object') return null;
  const packet = value as { encoding?: unknown; columns?: unknown; rows?: unknown };
  if (packet.encoding !== 'columns-v1' || !Array.isArray(packet.columns) ||
    packet.columns.length !== SCREEN_FACT_COLUMNS.length ||
    packet.columns.some((key, i) => key !== SCREEN_FACT_COLUMNS[i]) || !Array.isArray(packet.rows) ||
    packet.rows.some(row => !Array.isArray(row) || row.length !== SCREEN_FACT_COLUMNS.length)) return null;
  // A fixed object shape avoids per-row entry arrays and V8 dictionary-mode objects.
  return packet.rows.map(row => ({
    fact_identity: row[0],
    contributor_id: row[1],
    report_identity: row[2],
    report_number: row[3],
    source_report_key: row[4],
    first_accepted_at: row[5],
    snapshot_id: row[6],
    snapshot_generation: row[7],
    report_date: row[8],
    completed_date: row[9],
    identity_report_date: row[10],
    identity_completed_date: row[11],
    category: row[12],
    status: row[13],
    disposition: row[14],
    vehicle_raw: row[15],
    point_key: row[16],
    lat: row[17],
    lng: row[18],
    address: row[19],
    region_code: row[20],
    agency_key: row[21],
    agency_name: row[22],
    agency_current_name: row[23],
    manager_key: row[24],
    manager_name: row[25],
    is_representative: row[26],
    contribution_count: row[27],
    amount_kind: row[28],
    amount_confirmed_won: row[29],
    amount_public: row[30],
    amount_stated: row[31],
    violation_law: row[32],
    rating: row[33],
  }));
}
