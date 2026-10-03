// Local 500k distinct reports / 1000 users + 100k duplicate observations. Entire bulk seed rolls back.
// COMMUNITY_STACK=1 RANKINGS_MEASURE=1 npx vitest run tests/integration/user-rankings-measure.test.ts
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
      // Isolated transaction; USER triggers skipped only while bulk-loading a synthetic fixture (ranking reads themselves
      // use the unchanged production tables/functions). Trigger settings, users, facts and ANALYZE roll back together.
      const base = `begin;
    alter table private.community_report_facts disable trigger user;
    create temporary table rk_users as select g as idx,gen_random_uuid() as id,gen_random_uuid() as grant_id,gen_random_uuid() as lineage from generate_series(1,1000) g;
    insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at)
      select id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','ranking-perf-'||id||'@example.invalid',now(),now() from rk_users;
    insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at)
      select id::text,id,jsonb_build_object('sub',id::text),'kakao',now(),now() from rk_users;
    insert into private.contributor_profiles(user_id,consent_version,privacy_policy_version) select id,'2026-09-28.3','2026-09-28.3' from rk_users;
    insert into private.community_consent_grants(grant_id,lineage_id,user_id,policy_version,consent_text_sha256,granted_via,granted_session_id)
      select grant_id,lineage,id,'2026-09-28.3',repeat('a',64),'safetyreport_server',gen_random_uuid() from rk_users;
    insert into private.community_report_facts(contributor_id,dataset_key,source_report_key,source_report_id,latest_receipt_id,consent_grant_id,writer_epoch,source_revision,payload_sha256,public_state,category,status,disposition,amount_kind,report_date,completed_date,coord_source,report_number,answer_accepted_at,first_accepted_at)
      select u.id,repeat('a',64),encode(sha256(convert_to('perf-'||g,'UTF8')),'hex'),'9100000001',gen_random_uuid(),u.grant_id,1,1,repeat('b',64),'completed','parking',
        case when g<=1+u.idx%50*10 then 'partial' when g%17=0 then 'completed_unknown' else 'accepted' end,
        case when g<=1+u.idx%50*10 then 'fine' else 'warning' end,'unknown','2040-09-01','2040-09-30','none',null,now(),now()
      from rk_users u cross join generate_series(1,500) g;
    insert into private.community_report_facts select (jsonb_populate_record(null::private.community_report_facts,to_jsonb(f)||jsonb_build_object('dataset_key',repeat('c',64)))).*
      from private.community_report_facts f join rk_users u on u.id=f.contributor_id where u.idx<=200;
    analyze private.community_report_facts;
    alter table private.community_report_facts enable trigger user;
    set client_min_messages=log;
    load 'auto_explain';set auto_explain.log_min_duration=1;set auto_explain.log_analyze=on;set auto_explain.log_buffers=on;
    set auto_explain.log_nested_statements=on;set auto_explain.log_parameter_max_length=0;
    create temporary table rk_results(label text,result jsonb);
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
      const script = base + requests.map(([label, query]) =>
        `insert into rk_results values('${label}',${call(query)});`
      ).join("\n") +
        `insert into rk_results values('next',public.internal_user_rankings('${viewer.id}','${viewer.session}',${
          lit(JSON.stringify({ ...requests[0][1], page: 2 }))
        }::jsonb||jsonb_build_object('expected_version',(select result->>'dataset_version' from rk_results where label='first'))));
    insert into rk_results values('all',${call(querySchema.parse({}))});
    insert into rk_results values('withdrawn',${call(requests[0][1])});
    update private.community_consent_grants set revoked_at=now() where user_id in(select id from rk_users where idx%50=49);
    insert into rk_results values('after-withdrawal',${call(requests[0][1])});
    select jsonb_build_object('label',label,'bytes',octet_length(result::text),'response',result) from rk_results;
    rollback;`;
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
          rank: 1001,
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
          environment:
            "LOCAL Docker Supabase PostgreSQL; synthetic; seed rollback; not production",
          unique_reports: 500000,
          observations: 600000,
          users: 1000,
          page_size: 50,
          elapsed_seed_queries_rollback_ms: Math.round(
            performance.now() - started,
          ),
          query_total_ms: Object.fromEntries(
            Array.from(
              stderr.matchAll(
                /LOG:  duration: ([0-9.]+) ms  plan:\nQuery Text: insert into rk_results values\('([^']+)'/g,
              ),
              (m) => [m[2], Number(m[1])],
            ),
          ),
          query_plan_durations_ms: durations.filter((x) =>
            x > 10
          ),
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
      } finally {
        sampling = false;
        await sampler;
        deleteUsers([viewer]);
      }
    },
    600000,
  );
});
