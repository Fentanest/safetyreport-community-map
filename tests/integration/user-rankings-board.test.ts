// Board SQL equivalence on the LOCAL stack: every metric's top K, own rank and participant count must equal the paged
// public.internal_user_rankings page 1 (page_size = K) over the SAME statement snapshot. Everything (latest function
// bodies, the five-category patch, the board migration, synthetic users and reports) runs in ONE transaction that is
// rolled back — the shared local stack is left as it was. Only the viewer is a real GoTrue user (deleted afterAll).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createUser, deleteUsers, factsSql, lit, serviceClient, sql, stackKeys, type Fact, type TestUser,
} from './helpers/myReportsSeed';
import { querySchema } from '../../contracts/user-rankings/types';
import { BOARD_METRICS, boardQuerySchema, boardResponseSchema } from '../../contracts/user-rankings-board/types';

const enabled = process.env.COMMUNITY_STACK === '1';
const users: TestUser[] = [];
const read = (path: string) => readFileSync(path, 'utf8').replace(/^begin;\s*$/gm, '').replace(/^commit;\s*$/gm, '');
const THREE = /'traffic'(\s*),(\s*)'parking'(\s*),(\s*)'other'/g;
const toFive = (s: string) => s.replace(THREE, "'traffic',$2'parking',$4'safety',$4'living',$4'other'");

/** Latest ranking bodies (060200 election, 060600 paged RPC) + five categories, whatever the stack's migration level. */
function latestPrelude(): string {
  const reps = read('supabase/migrations/202610060200_query_read_paths.sql')
    .match(/CREATE OR REPLACE FUNCTION private\.ranking_representatives\(\)[\s\S]*?\$function\$\s*;/)![0];
  const paged = read('supabase/migrations/202610060600_analytics_read_snapshot.sql')
    .match(/create or replace function public\.internal_user_rankings\([\s\S]*?\$\$;/)![0];
  const needsFive = sql(`select exists(select 1 from pg_constraint c join pg_namespace n on n.oid=c.connamespace where c.contype='c'
    and n.nspname in ('public','private') and pg_get_constraintdef(c.oid) ~ $re$'traffic'::text,\\s*'parking'::text,\\s*'other'::text$re$)`) === 't';
  return needsFive
    ? `${reps}\n${paged}\n${read('supabase/migrations/202610110100_five_categories.sql')}\n`
    : `${toFive(reps)}\n${toFive(paged)}\n`;
}

/** Synthetic contributors created INSIDE the transaction (no GoTrue session needed: only the viewer is gated). */
function syntheticUser(): { user: TestUser; sql: string } {
  const id = randomUUID(), grant = randomUUID(), lineage = randomUUID();
  return {
    user: { id, grant, lineage, email: '', password: '', token: '', session: '' },
    sql: `insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values('${id}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','board-${id}@example.invalid',now(),now());
insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at) values('${id}','${id}','{"sub":"synthetic"}','kakao',now(),now());
insert into private.contributor_profiles(user_id,consent_version,privacy_policy_version) values('${id}','2026-09-28.3','2026-09-28.3');
insert into private.community_consent_grants(grant_id,lineage_id,user_id,policy_version,consent_text_sha256,granted_via,granted_session_id) values('${grant}','${lineage}','${id}','2026-09-28.3',repeat('a',64),'safetyreport_server',gen_random_uuid());`,
  };
}

const CATS = ['traffic', 'parking', 'safety', 'living', 'other'] as const;
const STATUS = ['accepted', 'partial', 'rejected', 'completed_unknown'] as const;
function f(user: TestUser, key: string, extra: Partial<Fact> = {}): Fact {
  return { user, key, dataset: 'pc', sourceId: '9100000001', reportDate: '2040-09-01', completedDate: '2040-09-20', ...extra };
}
/** Deterministic mixed cohort: categories, outcomes, fines, dates on both sides of the month, missing dates, ties. */
function cohort(viewer: TestUser, others: TestUser[]): Fact[] {
  const out: Fact[] = Array.from({ length: 10 }, (_, i) => f(viewer, `gate-${i}`, { completedDate: '2025-01-01', reportDate: '2024-12-01' }));
  const people = [viewer, ...others];
  people.forEach((u, p) => {
    const n = 2 + ((p * 7) % 11);
    for (let j = 0; j < n; j++) {
      const status = STATUS[(p + j) % 4];
      out.push(f(u, `b-${p}-${j}`, {
        status,
        category: CATS[(p + 2 * j) % 5],
        disposition: (status === 'accepted' || status === 'partial') && (p + j) % 3 === 0 ? 'fine' : j % 5 === 4 ? 'warning' : 'none',
        completedDate: j % 6 === 5 ? null : j % 3 === 0 ? '2040-10-02' : '2040-09-1' + (j % 9),
        reportDate: j % 7 === 6 ? null : j % 2 ? '2040-08-30' : '2040-09-05',
      }));
    }
  });
  // exact ties: two contributors with identical outcomes; equal fractions with different N (1/2 vs 2/4)
  const [t1, t2, t3] = others.slice(-3);
  for (const u of [t1, t2]) for (let j = 0; j < 4; j++) out.push(f(u, `tie-${j}`, { status: j < 2 ? 'rejected' : 'accepted', disposition: j === 3 ? 'fine' : 'none' }));
  for (let j = 0; j < 2; j++) out.push(f(t3, `half-${j}`, { status: j === 0 ? 'rejected' : 'accepted' }));
  return out;
}

describe.skipIf(!enabled)('user rankings board = paged rankings page 1 per metric (one snapshot)', () => {
  let viewer: TestUser, lonely: TestUser;
  beforeAll(async () => {
    const keys = stackKeys();
    viewer = await createUser(serviceClient(keys), keys.ANON_KEY, 'ranking-board');
    lonely = await createUser(serviceClient(keys), keys.ANON_KEY, 'ranking-board-lonely'); // 9 shared reports: below the gate
    users.push(viewer, lonely);
  }, 60000);
  afterAll(() => deleteUsers(users), 60000);

  it('every period/basis/category/minimum/top combination matches the paged RPC; gate, errors and grants', () => {
    const synth = Array.from({ length: 16 }, syntheticUser);
    const others = synth.map((s) => s.user);
    const cases: Array<ReturnType<typeof boardQuerySchema.parse>> = [];
    for (const date_basis of ['completed_date', 'report_date'] as const)
      for (const period of ['all', 'month', 'range'] as const)
        for (const category of ['all', 'parking', 'safety', 'living'] as const)
          for (const min_reports of [1, 3])
            for (const top of [1, 5, 10])
              cases.push(boardQuerySchema.parse({ date_basis, period, category, min_reports, top,
                ...(period === 'month' ? { month: '2040-09' } : period === 'range' ? { start: '2040-09-15', end: '2040-10-31' } : {}) }));
    const call = (fn: string, q: unknown, u = viewer) => `public.${fn}('${u.id}','${u.session}',${lit(JSON.stringify(q))}::jsonb)`;
    const compare = (q: typeof cases[number]) => {
      const refs = BOARD_METRICS.map(({ theme, metric }) => {
        const r = querySchema.parse({ theme, metric, period: q.period, start: q.start, end: q.end, month: q.month,
          date_basis: q.date_basis, category: q.category, min_reports: q.min_reports, page: 1, page_size: q.top });
        return `'${metric}',${call('internal_user_rankings', r)}`;
      });
      return `select jsonb_build_object('board',${call('internal_user_rankings_board', q)},'ref',jsonb_build_object(${refs.join(',')}));`;
    };
    const errors = [
      {}, { period: 'all', date_basis: 'completed_date', category: 'all', min_reports: 1 }, // top missing
      { ...cases[0], top: 11 }, { ...cases[0], top: 0 }, { ...cases[0], top: '2.5' }, { ...cases[0], category: 'unknown' },
      { ...cases[0], theme: 'reporters' }, { ...cases[0], page: 1 }, { ...cases[0], user_id: viewer.id },
      { ...cases[0], period: 'range', start: '2040-10-01', end: '2040-09-01' }, { ...cases[0], month: '2040-09' },
      { ...cases[0], period: 'month', month: '2040-13' }, { ...cases[0], consistency: 'stale' }, { ...cases[0], min_reports: 0 },
    ];
    const script = ['begin;', latestPrelude(), read('supabase/migrations/202610111200_user_rankings_board.sql'),
      ...synth.map((s) => s.sql), factsSql(cohort(viewer, others)),
      factsSql(Array.from({ length: 9 }, (_, i) => f(lonely, `lonely-${i}`))),
      `create function pg_temp.err(q jsonb) returns text language plpgsql as $e$ begin perform public.internal_user_rankings_board('${viewer.id}','${viewer.session}',q); return 'ok'; exception when others then return sqlerrm; end $e$;`,
      ...cases.map(compare),
      `select to_jsonb(t) from (select ${errors.map((e, i) => `pg_temp.err(${lit(JSON.stringify(e))}::jsonb) as e${i}`).join(',')}) t;`,
      `select jsonb_build_object('lonely',${call('internal_user_rankings_board', cases[0], lonely)});`,
      `select jsonb_build_object('grants',jsonb_build_array(has_function_privilege('anon','public.internal_user_rankings_board(uuid,uuid,jsonb)','execute'),
        has_function_privilege('authenticated','public.internal_user_rankings_board(uuid,uuid,jsonb)','execute'),
        has_function_privilege('service_role','public.internal_user_rankings_board(uuid,uuid,jsonb)','execute')),
        'config',(select to_jsonb(proconfig) from pg_proc where oid='public.internal_user_rankings_board(uuid,uuid,jsonb)'::regprocedure),
        'definer',(select prosecdef from pg_proc where oid='public.internal_user_rankings_board(uuid,uuid,jsonb)'::regprocedure));`,
      // the same snapshot twice: same version; a ranking-relevant change: new version
      `select jsonb_build_object('v1',${call('internal_user_rankings_board', cases[0])}->>'dataset_version','v2',${call('internal_user_rankings_board', cases[0])}->>'dataset_version');`,
      `update private.community_report_facts set status='rejected' where contributor_id='${others[0].id}';`,
      `select jsonb_build_object('v3',${call('internal_user_rankings_board', cases[0])}->>'dataset_version');`,
      'rollback;'].join('\n');
    const lines = sql(script).split('\n').filter((l) => l.startsWith('{'));
    expect(lines.length).toBe(cases.length + 5);
    let nonEmpty = 0, tiesSeen = 0, meOutside = 0;
    cases.forEach((q, i) => {
      const { board, ref } = JSON.parse(lines[i]);
      const parsed = boardResponseSchema.parse(board);
      const label = JSON.stringify(q);
      expect(parsed.scope, label).toMatchObject({ period: q.period, date_basis: q.date_basis, category: q.category, min_reports: q.min_reports, top: q.top });
      parsed.boards.forEach((b, k) => {
        const r = ref[BOARD_METRICS[k].metric];
        expect(b.rows, `${label} ${b.metric} rows`).toEqual(r.rows);
        expect(b.me, `${label} ${b.metric} me`).toEqual(r.me);
        expect(b.total_participants, `${label} ${b.metric} total`).toBe(r.total_participants);
        expect(parsed.diagnostics, `${label} diagnostics`).toEqual(r.diagnostics);
        expect({ start: parsed.scope.start, end: parsed.scope.end, month: parsed.scope.month, in_progress: parsed.scope.in_progress })
          .toEqual({ start: r.scope.start, end: r.scope.end, month: r.scope.month, in_progress: r.scope.in_progress });
        if (b.rows.length) nonEmpty++;
        if (b.rows.some((row) => row.tie_count > 1)) tiesSeen++;
        if (b.me && b.me.rank > q.top) meOutside++;
      });
      expect(parsed.total_participants).toBe(parsed.boards[0].total_participants);
    });
    // the cohort must actually exercise the rules (not an all-empty comparison)
    expect(nonEmpty).toBeGreaterThan(cases.length * 3);
    expect(tiesSeen).toBeGreaterThan(0);
    expect(meOutside).toBeGreaterThan(0);
    const errs = JSON.parse(lines[cases.length]);
    expect(Object.values(errs)).toEqual(errors.map(() => 'INVALID_QUERY'));
    expect(JSON.parse(lines[cases.length + 1]).lonely).toEqual({ error: 'upload_required', details: { required: 10, current: 9 } });
    const sec = JSON.parse(lines[cases.length + 2]);
    expect(sec.grants).toEqual([false, false, true]);
    expect(sec.definer).toBe(true);
    expect(sec.config).toContain('search_path=""');
    const v = JSON.parse(lines[cases.length + 3]), v3 = JSON.parse(lines[cases.length + 4]).v3;
    expect(v.v1).toBe(v.v2);
    expect(v3).not.toBe(v.v1);
  }, 300000);
});
