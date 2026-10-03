// Local 500k distinct reports / 1000 users + 100k duplicate observations. Entire bulk seed rolls back.
// COMMUNITY_STACK=1 RANKINGS_MEASURE=1 npx vitest run tests/integration/user-rankings-measure.test.ts
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { frozenOriginalRankingSql, rankingMeasureSeed } from "./helpers/rankingMeasureSeed";
import {
  createUser,
  DB_CONTAINER,
  deleteUsers,
  insertFacts,
  lit,
  serviceClient,
  stackKeys,
} from "./helpers/myReportsSeed";
import {
  querySchema,
  type RankingResponse,
  responseSchema,
} from "../../contracts/user-rankings/types";
const enabled = process.env.COMMUNITY_STACK === "1" &&
  process.env.RANKINGS_MEASURE === "1";
const OUT = process.env.RANKINGS_MEASURE_OUT || "docs/implementation/user-rankings/evidence";
function admin(s: string): string {
  return execFileSync("docker", [
    "exec",
    "-i",
    DB_CONTAINER,
    "psql",
    "-U",
    "supabase_admin",
    "-d",
    "postgres",
    "-tAq",
    "-v",
    "ON_ERROR_STOP=1",
  ], { input: s, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}
function significant(log: string) {
  return log.split(/(?=^LOG:  duration: )/m).filter((b) => {
    const m = /^LOG:  duration: ([0-9.]+) ms/.exec(b);
    return !m || Number(m[1]) >= 1;
  }).join("");
}
describe.skipIf(!enabled)("rankings 500k query measurements", () => {
  it(
    "whole candidate ranking, exact ties/me/page boundary, bytes/time/RSS and EXPLAIN",
    async () => {
      const keys = stackKeys(),
        viewer = await createUser(
          serviceClient(keys),
          keys.ANON_KEY,
          "rankings-measure",
        );
      mkdirSync(OUT, { recursive: true });
      insertFacts(
        Array.from(
          { length: 10 },
          (_, i) => ({
            user: viewer,
            key: "perf-gate-" + i,
            dataset: "pc",
            sourceId: "9100000001",
            reportDate: "2040-01-01",
            completedDate: "2040-01-01",
          }),
        ),
      );
      const priorAboveViewer = Number(admin('select count(*) from (select contributor_id,count(*) n from private.ranking_representatives() group by contributor_id) s where n>10;'));
      // Isolated transaction; USER triggers skipped only while bulk-loading a synthetic fixture (ranking reads themselves
      // use the unchanged production tables/functions). Trigger settings, users, facts and ANALYZE roll back together.
      const paired = process.env.RANKINGS_COMPARE === '1';
      const diagnosticTimeout = Number(process.env.RANKINGS_DIAGNOSTIC_TIMEOUT ?? 25);
      if (!Number.isInteger(diagnosticTimeout) || diagnosticTimeout < 25 || diagnosticTimeout > 120) throw new Error('invalid diagnostic timeout');
      const variant = process.env.RANKINGS_CANDIDATE_SQL ? readFileSync(process.env.RANKINGS_CANDIDATE_SQL,'utf8').replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'') : '';
      const base = rankingMeasureSeed() + variant + (paired ? frozenOriginalRankingSql() + "set plan_cache_mode=force_generic_plan;\n" : '') + `
    set client_min_messages=log;
    load 'auto_explain';set statement_timeout='${diagnosticTimeout}s';set auto_explain.log_min_duration=50;set auto_explain.log_analyze=on;set auto_explain.log_buffers=on;
    set auto_explain.log_nested_statements=on;set auto_explain.log_parameter_max_length=0;
    create temporary table rk_results(label text,result jsonb,elapsed_ms double precision);
  `;
      const requests = [
        [
          "first",
          querySchema.parse({
            period: "range",
            start: "2040-09-01",
            end: "2040-09-30",
            page_size: 50,
          }),
        ],
        [
          "rates",
          querySchema.parse({
            theme: "fines",
            metric: "fine_rate",
            period: "range",
            start: "2040-09-01",
            end: "2040-09-30",
            page_size: 50,
          }),
        ],
        ["monthly-reporters", querySchema.parse({ period: "month", month: "2040-09", page_size: 50 })],
        ["monthly-fines", querySchema.parse({ theme: "fines", metric: "fine_rate", period: "month", month: "2040-09", page_size: 50 })],
        ["monthly-unlucky", querySchema.parse({ theme: "unlucky", metric: "partial_rate", period: "month", month: "2040-09", page_size: 50 })],
        ["cumulative-unlucky", querySchema.parse({ theme: "unlucky", metric: "partial_rate", period: "all", page_size: 50 })],
      ] as const;
      const call = (query: unknown) =>
        `public.internal_user_rankings('${viewer.id}','${viewer.session}',${
          lit(JSON.stringify(query))
        }::jsonb)`;
      const repetitions = Number(process.env.RANKINGS_REPEATS || '1');
      if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 30) throw new Error('invalid repeats');
      const measured = (label: string, expression: string) => `with started as materialized(select clock_timestamp() as at), computed as materialized(select ${expression} as result, at from started)
        insert into rk_results select '${label}',result,extract(epoch from clock_timestamp()-at)*1000 from computed;`;
      const beforeCall = (query: unknown) => call(query).replace('public.internal_user_rankings(', 'private.user_rankings_before_measure(');
      const beforeSamples = paired ? Array.from({length: repetitions}, (_, i) => requests.slice(0,2).map(([label,query]) => measured(`before-${label}-${i+1}`,beforeCall(query))).join('\n')).join('\n') : '';
      const repeated = Array.from({ length: repetitions - 1 }, (_, i) => requests.slice(0, 2).map(([label, query]) =>
        measured(`repeat-${label}-${i + 2}`, call(query))
      ).join('\n')).join('\n');
      const alternate = paired && process.env.RANKINGS_INTERLEAVE === '1';
      const mainSamples = alternate ? requests.slice(2).map(([label,query])=>measured(label,call(query))).join('\n') +
        Array.from({length:repetitions},(_,i)=>requests.slice(0,2).map(([label,query])=>
          measured(`before-${label}-${i+1}`,beforeCall(query)) +
          measured(i===0?label:`repeat-${label}-${i+1}`,call(query))).join('\n')).join('\n') :
        requests.map(([label,query])=>measured(label,call(query))).join('\n') +
        "\nset auto_explain.log_min_duration=-1;\n" + beforeSamples + "\n" + repeated;
      let script = base + mainSamples + "\nset auto_explain.log_min_duration=50;\n" +
        measured('next', `public.internal_user_rankings('${viewer.id}','${viewer.session}',${lit(JSON.stringify({ ...requests[0][1], page: 2 }))}::jsonb||jsonb_build_object('expected_version',(select result->>'dataset_version' from rk_results where label='first')))`)+
        measured('all',call(querySchema.parse({})))+measured('withdrawn',call(requests[0][1]))+
        `update private.community_consent_grants set revoked_at=now() where user_id in(select id from rk_users where idx%50=49);`+
        measured('after-withdrawal',call(requests[0][1]))+
        `select jsonb_build_object('label',label,'elapsed_ms',elapsed_ms,'bytes',octet_length(result::text),'response',result) from rk_results; rollback;`;
      // Paired primary timing can omit nested EXPLAIN instrumentation on BOTH variants.
      // Separate retained runs carry plans; this changes evidence collection, not product budgets.
      if (process.env.RANKINGS_PLANS === '0') script = script.replaceAll('set auto_explain.log_min_duration=50;', 'set auto_explain.log_min_duration=-1;');
      // Sample RSS of the owned database connection only, from its application_name. Each sample is retained.
      const rss: number[] = [];
      let sampling = true;
      const sampler = (async () => {
        while (sampling) {
          try {
            const x = admin(
              `select pid from pg_stat_activity where application_name='rankings-measure'`,
            );
            for (const pid of x.trim().split("\n").filter(Boolean)) {
              const status = execFileSync("docker", [
                "exec",
                DB_CONTAINER,
                "cat",
                `/proc/${pid}/status`,
              ], { encoding: "utf8" });
              const m = /VmRSS:\s+(\d+)/.exec(status);
              if (m) {
                rss.push(Number(m[1]));
              }
            }
          } catch {
            /* connection ended */
          }
          await new Promise((r) =>
            setTimeout(r, 500)
          );
        }
      })();
      const started = performance.now();
      let stdout = "", stderr = "";
      try {
        await new Promise<void>((resolve, reject) => {
          const child = spawn("docker", [
            "exec",
            "-i",
            DB_CONTAINER,
            "psql",
            "-U",
            "supabase_admin",
            "-d",
            "postgres",
            "-tAq",
            "-v",
            "ON_ERROR_STOP=1",
          ], { stdio: ["pipe", "pipe", "pipe"] });
          child.stdout.on("data", (d) => stdout += d);
          child.stderr.on("data", (d) => stderr += d);
          child.on("exit", (code) =>
            code === 0 ? resolve() : reject(Error(stderr.slice(-3000))));
          child.stdin.end(
            "set application_name='rankings-measure';\n" + script,
          );
        });
        const result = Object.fromEntries(
          stdout.trim().split("\n").filter((l) =>
            l.startsWith("{")
          ).map((l) => {
            const x = JSON.parse(l);
            return [x.label, x];
          }),
        );
        writeFileSync(`${OUT}/500k-prevalidation.json`, JSON.stringify({ seed: 'refactor-rank-deterministic-v1', measurements: Object.entries(result).map(([label,value]) => ({ label, elapsed_ms: (value as {elapsed_ms:number}).elapsed_ms, bytes: (value as {bytes:number}).bytes })) }, null, 2));
        writeFileSync(`${OUT}/500k-plans.txt`, significant(stderr).replaceAll(viewer.id, '[synthetic-viewer-uuid]').replaceAll(viewer.session, '[redacted-local-session]'));
        if(paired) {
          for(let i=1;i<=repetitions;i++)for(const label of ['first','rates']) {
            const a = {...result[`before-${label}-${i}`].response}; const b = {...result[label].response};
            delete a.generated_at;delete b.generated_at;expect(a).toEqual(b);
          }
        }
        const first = responseSchema.parse(result.first.response),
          next = responseSchema.parse(result.next.response),
          rates = responseSchema.parse(result.rates.response),
          all = responseSchema.parse(result.all.response);
        expect(first.total_participants).toBe(1000);
        expect(first.rows.every((r) =>
          r.reports === 500 && r.rank === 1 && r.tie_count === 1000
        )).toBe(true);
        expect(
          new Set([...first.rows, ...next.rows].map((r) =>
            r.uuid
          )).size,
        ).toBe(100);
        expect(next.dataset_version).toBe(first.dataset_version);
        expect(
          rates.rows.slice(0, 20).every((r) =>
            r.fine === 491 && r.numerator === 491 && r.denominator === 500 &&
            r.rank === 1 && r.tie_count === 20
          ),
        ).toBe(true);
        expect(rates.rows[20].rank).toBe(21);
        expect(rates.rows[20].fine).toBe(481);
        expect(responseSchema.parse(result["monthly-reporters"].response).rows).toEqual(first.rows);
        expect(responseSchema.parse(result["monthly-fines"].response).rows).toEqual(rates.rows);
        for (const label of ["monthly-unlucky", "cumulative-unlucky"]) {
          const r = responseSchema.parse(result[label].response);
          expect(r.rows.map(x => [x.uuid, x.rank, x.tie_count, x.numerator, x.denominator])).toEqual(
            rates.rows.map(x => [x.uuid, x.rank, x.tie_count, x.numerator, x.denominator]),
          );
          // Existing LOCAL accounts outside the synthetic month remain eligible in all-time queries.
          // Preserve them and compare the cumulative themes' common cohort rather than assuming an empty DB.
          expect(r.total_participants).toBe(label === "monthly-unlucky" ? 1000 : all.total_participants);
        }
        expect(all.me).toMatchObject({
          uuid: viewer.id,
          reports: 10,
          rank: 1001 + priorAboveViewer,
        });
        expect(result["after-withdrawal"].response.total_participants).toBe(
          980,
        );
        expect(result["after-withdrawal"].response.dataset_version).not.toBe(
          result.withdrawn.response.dataset_version,
        );
        // Store aggregate measurements, never the bulk UUID lists or raw facts.
        writeFileSync(`${OUT}/500k-plans.txt`, significant(stderr).replaceAll(viewer.id, '[synthetic-viewer-uuid]').replaceAll(viewer.session, '[redacted-local-session]'));
        const durations = Array.from(
          stderr.matchAll(/duration: ([0-9.]+) ms/g),
          (m) =>
            Number(m[1]),
        );
        const report = {
          measured_at: new Date().toISOString(),
          paired_original: paired,
          interleaved: alternate,
          experimental_candidate: process.env.RANKINGS_CANDIDATE_SQL??null,
          plan_cache_mode: paired ? 'force_generic_plan for both original and candidate' : 'auto',
          environment:
            "LOCAL Docker Supabase PostgreSQL; synthetic; seed rollback; not production",
          seed: 'refactor-rank-deterministic-v1',
          existing_participants_above_viewer: priorAboveViewer,
          unique_reports: 500000,
          observations: 600000,
          users: 1000,
          repetitions_first_and_rates: repetitions,
          page_size: 50,
          elapsed_seed_queries_rollback_ms: Math.round(
            performance.now() - started,
          ),
          query_total_ms: Object.fromEntries(Object.entries(result).map(([label,value]) => [label,(value as { elapsed_ms: number }).elapsed_ms])),
          query_plan_durations_ms: durations.filter((x) =>
            x > 10
          ),
          plans_instrumented: process.env.RANKINGS_PLANS !== '0',
          diagnostic_outer_timeout_seconds: diagnosticTimeout,
          candidate_head: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
          installed_function_md5: JSON.parse(admin("select jsonb_object_agg(n.nspname||'.'||p.proname,md5(p.prosrc)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='private' and p.proname='ranking_representatives') or (n.nspname='public' and p.proname in('internal_user_rankings','internal_analytics_viewer'));")),
          db_process_peak_rss_kib: Math.max(...rss),
          rss_samples: rss,
          responses: Object.fromEntries(
            Object.entries(result).map((
              [k, v],
            ) => [k, {
              bytes: (v as { bytes: number }).bytes,
              participants: (v as { response: RankingResponse }).response
                .total_participants,
            }]),
          ),
          correctness:
            "1000 tied count participants, 100 unique UUIDs across two pages; monthly reporters/fines equal the same range; monthly and cumulative partial rates match fine fractions: 491/500 joint first20, next rank21; own rank1001 beyond page; withdrawal980",
          memory_note:
            "RSS sampled /proc DB backend; includes caches and shared pages, not exclusive query allocation. Sort memory/temp disk in EXPLAIN.",
        };
        writeFileSync(
          `${OUT}/500k-measurements.json`,
          JSON.stringify(report, null, 2) + "\n",
        );
        console.log(JSON.stringify(report, null, 2));
      } catch (e) {
        writeFileSync(`${OUT}/500k-failure.txt`, stderr.replaceAll(viewer.id, '[synthetic-viewer-uuid]').replaceAll(viewer.session, '[redacted-local-session]'));
        writeFileSync(`${OUT}/500k-failure.json`, JSON.stringify({status:'FAIL',mode:'direct local SQL synthetic seed',plans_instrumented:process.env.RANKINGS_PLANS!=='0',diagnostic_outer_timeout_seconds:diagnosticTimeout,partial_stdout:stdout,message:String(e)},null,2));
        throw e;
      } finally {
        sampling = false;
        await sampler;
        deleteUsers([viewer]);
      }
    },
    1800000,
  );
});
