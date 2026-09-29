// Synthetic my-reports data on the composed local stack (.integration-stack). Every value is invented: keys are
// sha256 of fixed labels, plates are built from digits at runtime, addresses are 예시로 streets. Users are created
// through GoTrue admin with a password (a REAL GoTrue session/JWT), then given a synthetic `kakao` identity row so
// private.community_identity_state accepts them — the Kakao OAuth hop itself is covered by the mock-Kakao stack tests.
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const API = process.env.COMMUNITY_API_URL ?? 'http://127.0.0.1:56321';
export const DB_CONTAINER = process.env.COMMUNITY_DB_CONTAINER ?? 'supabase_db_ci0926-int';
export const STACK_DIR = process.env.COMMUNITY_STACK_DIR ?? '.integration-stack';
export const POLICY = '2026-09-28.3';

export function sql(query: string): string {
  return execFileSync('docker', ['exec', '-i', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAq', '-v', 'ON_ERROR_STOP=1'],
    { input: query, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim();
}
export const lit = (v: unknown) => (v === null || v === undefined ? 'null' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
export const hex = (text: string) => createHash('sha256').update(text).digest('hex');

export interface StackKeys { ANON_KEY: string; SERVICE_ROLE_KEY: string; PUBLISHABLE_KEY?: string }
export const stackKeys = (): StackKeys =>
  JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json', '--workdir', STACK_DIR], { encoding: 'utf8' }));

export interface TestUser { id: string; email: string; password: string; grant: string; lineage: string; token: string; session: string }

/** GoTrue user + password session + synthetic kakao identity + active contributor profile and consent grant. */
export async function createUser(svc: SupabaseClient, anonKey: string, label: string,
  opts: { kakao?: boolean; profile?: boolean; grant?: boolean } = {}): Promise<TestUser> {
  const email = `mr-${label}-${randomUUID().slice(0, 8)}@example.invalid`;
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const id = data.user!.id;
  if (opts.kakao !== false) {
    sql(`insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
         values ('${900000 + Math.floor(Math.random() * 99999)}-${id.slice(0, 8)}', '${id}', '{"sub":"synthetic"}', 'kakao', now(), now());`);
  }
  const grant = randomUUID(), lineage = randomUUID();
  if (opts.profile !== false) {
    sql(`insert into private.contributor_profiles (user_id, consent_version, privacy_policy_version) values ('${id}', '${POLICY}', '${POLICY}');`);
    if (opts.grant !== false) {
      sql(`insert into private.community_consent_grants (grant_id, lineage_id, user_id, policy_version, consent_text_sha256, granted_via, granted_session_id)
           values ('${grant}', '${lineage}', '${id}', '${POLICY}', '${'a'.repeat(64)}', 'safetyreport_server', '${randomUUID()}');`);
    }
  }
  const user = { id, email, password, grant, lineage, token: '', session: '' };
  await signIn(user, anonKey);
  return user;
}

export async function signIn(user: TestUser, anonKey: string): Promise<void> {
  const client = createClient(API, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  user.token = data.session!.access_token;
  user.session = JSON.parse(Buffer.from(user.token.split('.')[1], 'base64url').toString('utf8')).session_id;
}

export function deleteUsers(users: TestUser[]): void {
  const list = users.map((u) => `'${u.id}'`).join(',');
  if (!list) return;
  sql(`delete from private.community_report_facts where contributor_id in (${list});
    delete from private.community_consent_grants where user_id in (${list});
    delete from private.contributor_profiles where user_id in (${list});
    delete from auth.identities where user_id in (${list});
    delete from auth.sessions where user_id in (${list});
    delete from auth.users where id in (${list});`);
}

export interface Fact {
  user: TestUser;
  dataset: string;          // label → sha256
  key: string;              // label → sha256 source_report_key
  sourceId: string;
  number?: string | null;
  status?: string;          // default accepted
  category?: string;        // default parking
  disposition?: string;     // default none
  amountKind?: string;      // default unknown
  amount?: number | null;
  points?: number | null;
  vehicle?: string | null;
  reportDate?: string | null;
  completedDate?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  agencyKey?: string | null;
  agencyName?: string | null;
  agencyCurrent?: string | null;
  managerKey?: string | null;
  managerName?: string | null;
  law?: string | null;
  rating?: number | null;
  payload?: string;         // label of the answer content (same label = same payload_sha256)
  answerAt?: string;        // answer_accepted_at
  firstAt?: string;         // first_accepted_at
  grant?: string;           // default the user's grant
}

const ELIGIBLE = new Set(['accepted', 'partial', 'rejected', 'completed_unknown']);

export function insertFacts(facts: Fact[]): void {
  if (!facts.length) return;
  const values = facts.map((f) => {
    const status = f.status ?? 'accepted';
    const located = f.lat !== undefined && f.lat !== null;
    return `('${f.user.id}', '${hex(`ds|${f.dataset}`)}', '${hex(`key|${f.key}`)}', ${lit(f.sourceId)}, '${randomUUID()}',
      '${f.grant ?? f.user.grant}', 1, 1, '${hex(`payload|${f.payload ?? `${f.key}|${f.dataset}`}`)}',
      '${ELIGIBLE.has(status) ? 'completed' : 'not_completed'}', ${lit(f.category ?? 'parking')}, ${lit(status)},
      ${lit(f.disposition ?? 'none')}, ${lit(f.amountKind ?? 'unknown')}, ${lit(f.amount ?? null)}, ${lit(f.points ?? null)},
      ${lit(f.vehicle ?? null)}, ${lit(f.reportDate ?? null)}, ${lit(f.completedDate ?? null)}, ${lit(f.address ?? null)},
      ${located ? f.lat : 'null'}, ${located ? f.lng : 'null'}, ${located ? `'${f.lat}'` : 'null'}, ${located ? `'${f.lng}'` : 'null'},
      '${located ? 'geocode' : 'none'}', ${lit(f.agencyKey ?? null)}, ${lit(f.agencyName ?? null)}, ${lit(f.agencyCurrent ?? null)},
      ${lit(f.managerKey ?? null)}, ${lit(f.managerName ?? null)}, ${lit(f.law ?? null)}, ${lit(f.rating ?? null)}, ${lit(f.number ?? null)},
      ${lit(f.answerAt ?? '2026-09-01T00:00:00Z')}, ${lit(f.firstAt ?? f.answerAt ?? '2026-09-01T00:00:00Z')})`;
  }).join(',\n');
  sql(`insert into private.community_report_facts (contributor_id, dataset_key, source_report_key, source_report_id, latest_receipt_id,
    consent_grant_id, writer_epoch, source_revision, payload_sha256, public_state, category, status, disposition, amount_kind,
    amount_confirmed_won, penalty_points, vehicle_raw, report_date, completed_date, address, lat, lng, lat_text, lng_text, coord_source,
    agency_key, agency_name, agency_current_name, manager_key, manager_name, violation_law, rating, report_number,
    answer_accepted_at, first_accepted_at) values ${values};`);
}

export function serviceClient(keys: StackKeys): SupabaseClient {
  return createClient(API, keys.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Plates from digits at runtime (no literal plate string in the repository).
export const plate = (a: number, hangul: string, b: number) => `${a}${hangul}${b}`;
