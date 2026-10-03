import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createUser,
  signIn,
  deleteUsers,
  type Fact,
  insertFacts,
  lit,
  serviceClient,
  sql,
  stackKeys,
  type TestUser,
} from "./helpers/myReportsSeed";
import {
  querySchema,
  type RankingQuery,
  type RankingResponse,
  responseSchema,
} from "../../contracts/user-rankings/types";
import { createRankingHandler } from "../../server/rankings/handler";
const enabled = process.env.COMMUNITY_STACK === "1";
const users: TestUser[] = [];
let a: TestUser, b: TestUser, c: TestUser, d: TestUser;
const q = (v: Partial<RankingQuery> = {}) => querySchema.parse(v);
const run = (v: Partial<RankingQuery> = {}, user = a): RankingResponse =>
  responseSchema.parse(
    JSON.parse(
      sql(
        `select public.internal_user_rankings('${user.id}','${user.session}',${
          lit(JSON.stringify(q(v)))
        }::jsonb)`,
      ),
    ),
  );
const error = (v: Partial<RankingQuery>, user = a) =>
  JSON.parse(
    sql(
      `select public.internal_user_rankings('${user.id}','${user.session}',${
        lit(JSON.stringify(q(v)))
      }::jsonb)`,
    ),
  );
const month = {
  theme: "unlucky",
  metric: "partial_rate",
  period: "month",
  month: "2040-09",
} as const;
function f(user: TestUser, key: string, extra: Partial<Fact> = {}): Fact {
  return {
    user,
    key,
    dataset: "pc",
    sourceId: "9100000001",
    completedDate: "2040-09-30",
    reportDate: "2040-08-01",
    ...extra,
  };
}
describe.skipIf(!enabled)(
  "user rankings real tables / lineage / sessions",
  () => {
    beforeAll(async () => {
      const keys = stackKeys(), svc = serviceClient(keys);
      for (
        const label of ["ranking-a", "ranking-b", "ranking-c", "ranking-empty"]
      ) users.push(await createUser(svc, keys.ANON_KEY, label));
      [a, b, c, d] = users;
    }, 60000);
    beforeEach(() => {
      const ids = users.map((u) => lit(u.id)).join(",");
      sql(
        `delete from private.community_report_facts where contributor_id in (${ids});update private.community_consent_grants set revoked_at=null where user_id in (${ids});update private.contributor_profiles set status='active' where user_id in (${ids});update auth.users set banned_until=null where id in (${ids});`,
      );
      insertFacts(Array.from({ length: 10 }, (_, i) =>
        f(a, "gate-" + i, {
          completedDate: "2025-01-01",
          reportDate: "2024-01-01",
        })));
    });
    afterAll(() => deleteUsers(users), 60000);
    it("same own PC/mobile/restored report once, cross-user each once; parity with my-reports", () => {
      insertFacts([
        f(a, "shared", {
          status: "partial",
          disposition: "fine",
          payload: "same",
        }),
        f(a, "shared", {
          dataset: "mobile",
          status: "partial",
          disposition: "fine",
          payload: "same",
        }),
        f(a, "shared", {
          dataset: "restored",
          status: "partial",
          disposition: "fine",
          payload: "same",
        }),
        f(b, "shared", {
          status: "rejected",
          answerAt: "2040-10-01T00:00:00Z",
        }),
        f(c, "another", { status: "partial" }),
      ]);
      const r = run(month);
      expect(r.me?.reports).toBe(1);
      expect(r.me?.fine).toBe(1);
      expect(r.me?.partial).toBe(1);
      expect(r.rows.find((x) => x.uuid === b.id)?.reports).toBe(1);
      expect(r.rows.find((x) => x.uuid === b.id)?.rejected).toBe(1);
      expect(
        sql(
          `select count(*) from ((select identity from private.my_reports_own('${a.id}') except select identity from private.ranking_representatives() where contributor_id='${a.id}') union all (select identity from private.ranking_representatives() where contributor_id='${a.id}' except select identity from private.my_reports_own('${a.id}'))) s`,
        ),
      ).toBe("0");
    });
    it("July2023 is the same cohort for monthly reporters, fines and outcomes; cumulative unlucky includes other months", () => {
      insertFacts([
        f(a, "july-start", { status: "rejected", completedDate: "2023-07-01", reportDate: "2023-06-30" }),
        f(a, "july-end", { status: "partial", disposition: "fine", completedDate: "2023-07-31", reportDate: "2023-07-31" }),
        f(a, "july-unknown", { status: "completed_unknown", completedDate: "2023-07-15", reportDate: "2023-07-15" }),
        f(a, "june", { status: "rejected", completedDate: "2023-06-30", reportDate: "2023-07-01" }),
        f(a, "august", { status: "rejected", completedDate: "2023-08-01", reportDate: "2023-08-01" }),
        f(b, "july-many1", { completedDate: "2023-07-15" }),
        f(b, "july-many2", { completedDate: "2023-07-15" }),
        f(b, "july-many3", { completedDate: "2023-07-15" }),
        f(b, "july-many4", { completedDate: "2023-07-15" }),
      ]);
      for(const [theme,metric,num] of [["reporters","reports_count",3],["fines","fine_rate",1],["unlucky","rejected_rate",1],["unlucky","partial_rate",1]] as const){
        const r=run({theme,metric,period:"month",month:"2023-07"});
        expect(r.scope).toMatchObject({start:"2023-07-01",end:"2023-07-31",month:"2023-07",in_progress:false});
        expect(r.me).toMatchObject({reports:3,denominator:3,numerator:num,fine:1,rejected:1,partial:1,completed_unknown:1});
        if(metric==="reports_count")expect(r.rows[0]?.uuid).toBe(b.id);
        if(metric.endsWith("_rate"))expect(r.me?.value).toBeCloseTo(100/3);
        const range=run({theme,metric,period:"range",start:"2023-07-01",end:"2023-07-31"});
        expect(range.rows).toEqual(r.rows);expect(range.me).toEqual(r.me);
      }
      const all=run({theme:"unlucky",metric:"rejected_count",period:"all"});
      expect(all.me).toMatchObject({reports:15,rejected:3,numerator:3,denominator:15});
      const reportDay=run({theme:"unlucky",metric:"rejected_rate",period:"month",month:"2023-07",date_basis:"report_date"});
      expect(reportDay.me).toMatchObject({reports:3,rejected:1,fine:1,partial:1,completed_unknown:1});
      // July and June give the same count here but represent different rows; the date axis stays explicit.
      expect(reportDay.scope.date_basis).toBe("report_date");
    });
    it("newest observation elected before July filtering also for monthly reporter/fine and cumulative unlucky", () => {
      insertFacts([
        f(a,"moved-month",{status:"rejected",completedDate:"2023-07-31",answerAt:"2023-07-31T00:00:00Z",payload:"old"}),
        f(a,"moved-month",{dataset:"mobile",status:"partial",disposition:"fine",completedDate:"2023-08-01",answerAt:"2023-08-01T00:00:00Z",payload:"new"}),
      ]);
      for(const [theme,metric]of [["reporters","reports_count"],["fines","fine_count"],["unlucky","rejected_count"]]as const){
        expect(run({theme,metric,period:"month",month:"2023-07"}).me).toBeNull();
        expect(run({theme,metric,period:"range",start:"2023-07-01",end:"2023-07-31"}).me).toBeNull();
      }
      expect(run({theme:"unlucky",metric:"partial_count",period:"all"}).me).toMatchObject({reports:11,partial:1,rejected:0});
      expect(run({theme:"fines",metric:"fine_count",period:"month",month:"2023-08"}).me).toMatchObject({reports:1,fine:1});
    });
    it("monthly version restarts across themes/months and year/month bounds apply to all three", () => {
      insertFacts([
        f(a,"dec-last",{status:"rejected",completedDate:"2023-12-31"}),
        f(a,"jan-first",{status:"partial",disposition:"fine",completedDate:"2024-01-01"}),
        f(a,"leap-last",{completedDate:"2024-02-29"}),
        f(a,"march-first",{completedDate:"2024-03-01"}),
        f(b,"dec-other",{completedDate:"2023-12-31"}),
      ]);
      for(const [theme,metric]of [["reporters","reports_count"],["fines","fine_count"],["unlucky","rejected_count"]]as const){
        const dec=run({theme,metric,period:"month",month:"2023-12",page_size:1});
        expect(dec.me?.reports).toBe(1);expect(dec.scope.end).toBe("2023-12-31");
        expect(run({theme,metric,period:"month",month:"2024-01"}).me?.reports).toBe(1);
        expect(run({theme,metric,period:"month",month:"2024-02"}).scope.end).toBe("2024-02-29");
        expect(error({theme,metric,period:"month",month:"2024-01",page_size:1,page:2,expected_version:dec.dataset_version}).error).toBe("DATASET_CHANGED");
      }
      const first=run({theme:"reporters",metric:"reports_count",period:"month",month:"2023-12",page_size:1});
      expect(error({theme:"unlucky",metric:"rejected_count",period:"month",month:"2023-12",page_size:1,page:2,expected_version:first.dataset_version}).error).toBe("DATASET_CHANGED");
    });
    it("new representative status/disposition/category/date before filtering; old result never revived", () => {
      insertFacts([
        f(a, "changed", {
          status: "partial",
          disposition: "fine",
          payload: "old",
          completedDate: "2040-09-01",
          answerAt: "2040-09-01T00:00:00Z",
        }),
        f(a, "changed", {
          dataset: "mobile",
          status: "rejected",
          disposition: "none",
          category: "other",
          payload: "new",
          completedDate: "2040-10-01",
          answerAt: "2040-10-01T00:00:00Z",
        }),
      ]);
      const all = run();
      expect(all.me?.reports).toBe(11);
      expect(all.me?.fine).toBe(0);
      expect(all.me?.rejected).toBe(1);
      expect(run(month).me).toBeNull();
      expect(run({ ...month, month: "2040-10" }).me?.rejected).toBe(1);
      expect(run({ ...month, month: "2040-10", category: "parking" }).me)
        .toBeNull();
    });
    it("partial real fine amount missing, accepted warning, unknown, non-final, contradictions, missing dates", () => {
      insertFacts([
        f(a, "partial-fine", { status: "partial", disposition: "fine" }),
        f(a, "accepted-warning", {
          disposition: "warning",
          amountKind: "fine",
          amount: 40000,
          points: 15,
        }),
        f(a, "unknown", { status: "completed_unknown" }),
        f(a, "unknown-missing", {
          status: "completed_unknown",
          completedDate: null,
        }),
        f(a, "not-final", { status: "processing" }),
        f(a, "contradiction", { status: "rejected", disposition: "fine" }),
        f(a, "penalty", { status: "accepted", disposition: "penalty" }),
      ]);
      const r = run({
        theme: "fines",
        metric: "fine_rate",
        period: "range",
        start: "2040-09-01",
        end: "2040-09-30",
      });
      expect(r.me).toMatchObject({
        reports: 5,
        fine: 1,
        partial: 1,
        rejected: 1,
        completed_unknown: 1,
        numerator: 1,
        denominator: 5,
        value: 20,
      });
      expect(r.diagnostics).toEqual({
        selected_date_missing: 1,
        completed_unknown: 1,
        inconsistent_disposition: 1,
      });
      expect(run({ ...month, metric: "partial_rate" }).me?.value).toBe(20);
      expect(run({ ...month, metric: "rejected_rate" }).me?.value).toBe(20);
      expect(
        run({ ...month, month: "2040-08", date_basis: "report_date" }).me
          ?.reports,
      ).toBe(6);
    });
    it("global competition ranks, ties with bigger denominator first, UUID stability, own rank off page", () => {
      insertFacts([
        f(a, "a1", { status: "partial" }),
        f(a, "a2"),
        f(b, "b1", { status: "partial" }),
        f(b, "b2"),
        f(b, "b3", { status: "partial" }),
        f(b, "b4"),
        f(c, "c1", { status: "partial" }),
      ]);
      const first = run({ ...month, page_size: 1 });
      expect(first.total_participants).toBe(3);
      expect(first.rows[0]).toMatchObject({
        uuid: c.id,
        rank: 1,
        tie_count: 1,
        reports: 1,
      });
      expect(first.me).toMatchObject({ uuid: a.id, rank: 2, tie_count: 2 });
      const second = run({
        ...month,
        page_size: 1,
        page: 2,
        expected_version: first.dataset_version,
      });
      expect(second.rows[0]).toMatchObject({
        uuid: b.id,
        rank: 2,
        tie_count: 2,
      });
      const third = run({
        ...month,
        page_size: 1,
        page: 3,
        expected_version: first.dataset_version,
      });
      expect(third.rows[0]).toMatchObject({ uuid: a.id, rank: 2 });
      expect(third.next_page).toBeNull();
      expect(run({ ...month, min_reports: 3 }).rows.map((x) => x.uuid)).toEqual(
        [b.id],
      );
      expect(run({ ...month, month: "2020-01" }).total_participants).toBe(0);
      expect(run({ ...month, month: "2020-01" }).me).toBeNull();
    });
    it("exact rational keys distinguish extreme and display-rounded equal rates, equivalent fractions tie", () => {
      const max = 9007199254740991n, scale = 10n ** 40n;
      const pairs = [[1n, 3n, 2n, 6n], [1n, 1001n, 1n, 1000n], [
        max - 1n,
        max,
        max - 2n,
        max - 1n,
      ]];
      for (const [n1, d1, n2, d2] of pairs) {
        const sign = n1 * d2 === n2 * d1 ? 0 : n1 * d2 < n2 * d1 ? -1 : 1;
        const k1 = n1 * scale / d1, k2 = n2 * scale / d2;
        expect(k1 === k2 ? 0 : k1 < k2 ? -1 : 1).toBe(sign);
        expect(
          Number(
            sql(
              `select sign(div(${n1}::numeric*1e40,${d1})-div(${n2}::numeric*1e40,${d2}))`,
            ),
          ),
        ).toBe(sign);
      }
      insertFacts([
        f(a, "a1", { status: "partial" }),
        f(b, "b1", { status: "partial" }),
      ]);
      expect(run(month).rows.map((x) => x.uuid)).toEqual([a.id, b.id].sort());
    });
    it("display-rounded equal percentages remain different whole-table ranks", () => {
      insertFacts([
        ...Array.from(
          { length: 1001 },
          (_, i) =>
            f(b, "round-b-" + i, { status: i === 0 ? "partial" : "accepted" }),
        ),
        ...Array.from(
          { length: 1000 },
          (_, i) =>
            f(c, "round-c-" + i, { status: i === 0 ? "partial" : "accepted" }),
        ),
      ]);
      const r = run(month);
      const rb = r.rows.find((x) => x.uuid === b.id)!,
        rc = r.rows.find((x) => x.uuid === c.id)!;
      expect(rb.value.toFixed(1)).toBe(rc.value.toFixed(1));
      expect(rc.rank).toBe(1);
      expect(rb.rank).toBe(2);
      expect(rc.tie_count).toBe(1);
      expect(rb.denominator).toBe(1001);
    });
    it("period/basis/category/page size versions cannot mix; changed numbers reject subsequent pages", () => {
      insertFacts([f(b, "b1"), f(c, "c1")]);
      const first = run({ page_size: 1 });
      expect(
        error({
          page_size: 1,
          page: 2,
          expected_version: first.dataset_version,
          date_basis: "report_date",
        }).error,
      ).toBe("DATASET_CHANGED");
      expect(
        error({
          page_size: 2,
          page: 2,
          expected_version: first.dataset_version,
        }).error,
      ).toBe("DATASET_CHANGED");
      insertFacts([f(b, "b2")]);
      expect(
        error({
          page_size: 1,
          page: 2,
          expected_version: first.dataset_version,
        }).error,
      ).toBe("DATASET_CHANGED");
    });
    it("withdrawal, fact deletion, profile suspension, banned/deleted account remove exposure and versions immediately", () => {
      for (const change of ["revoke", "delete", "suspend", "ban"]) {
        insertFacts([f(b, "b-" + change)]);
        const view = {
          period: "range",
          start: "2040-09-01",
          end: "2040-09-30",
        } as const;
        const first = run(view);
        expect(first.rows.some((x) => x.uuid === b.id)).toBe(true);
        if (change === "revoke") {
          sql(
            `update private.community_consent_grants set revoked_at=now() where user_id='${b.id}'`,
          );
        }
        if (change === "delete") {
          sql(
            `delete from private.community_report_facts where contributor_id='${b.id}'`,
          );
        }
        if (change === "suspend") {
          sql(
            `update private.contributor_profiles set status='suspended' where user_id='${b.id}'`,
          );
        }
        if (change === "ban") {
          sql(
            `update auth.users set banned_until=now()+interval '1 day' where id='${b.id}'`,
          );
        }
        const next = run(view);
        expect(next.rows.some((x) => x.uuid === b.id)).toBe(false);
        expect(next.dataset_version).not.toBe(first.dataset_version);
        expect(
          error({ ...view, expected_version: first.dataset_version }).error,
        ).toBe(
          "DATASET_CHANGED",
        );
        sql(
          `update private.community_consent_grants set revoked_at=null where user_id='${b.id}';update private.contributor_profiles set status='active' where user_id='${b.id}';update auth.users set banned_until=null where id='${b.id}';delete from private.community_report_facts where contributor_id='${b.id}'`,
        );
      }
    });
    it("month/year ends including leap day; current month flag is KST and prior month false", () => {
      insertFacts([
        f(a, "year-end", { completedDate: "2026-12-31" }),
        f(a, "next-year", { completedDate: "2027-01-01" }),
        f(a, "leap", { completedDate: "2024-02-29" }),
      ]);
      expect(run({ ...month, month: "2026-12" }).me?.reports).toBe(1);
      expect(run({ ...month, month: "2027-01" }).me?.reports).toBe(1);
      expect(run({ ...month, month: "2024-02" }).scope.end).toBe("2024-02-29");
      expect(run({ ...month, month: null }).scope.in_progress).toBe(true);
      expect(run({ ...month, month: "2024-02" }).scope.in_progress).toBe(false);
    });
    it("real sessions and DB eligibility, denied direct client RPC/private tables, raw other-user id disallowed", async () => {
      expect(error({}, d).error).toBe("upload_required");
      sql(
        `update private.community_consent_grants set revoked_at=now() where user_id='${a.id}'`,
      );
      expect(error({}).error).toBe("contributor_required");
      expect(
        sql(
          `select has_function_privilege('anon','public.internal_user_rankings(uuid,uuid,jsonb)','execute'),has_function_privilege('authenticated','public.internal_user_rankings(uuid,uuid,jsonb)','execute'),has_function_privilege('service_role','public.internal_user_rankings(uuid,uuid,jsonb)','execute')`,
        ),
      ).toBe("f|f|t");
      expect(
        sql(
          `select has_table_privilege('authenticated','private.community_report_facts','select')`,
        ),
      ).toBe("f");
      // This case tests consent denial for a CURRENT GoTrue session; earlier lifecycle cases
      // may invalidate the original session. Verify a fresh session instead of weakening403.
      const currentKeys=stackKeys();await signIn(a,currentKeys.ANON_KEY);
      const svc = serviceClient(currentKeys);
      const verified=await svc.auth.getUser(a.token);
      expect(verified.error).toBeNull();expect(verified.data.user?.id).toBe(a.id);
      const h = createRankingHandler({
        allowedOrigins: [],
        jwtIssuer: null,
        getUser: async (token) => {
          const { data } = await svc.auth.getUser(token);
          return data.user ? { id: data.user.id, isAnonymous: false } : null;
        },
        allowRequest: async () => true,
        rpc: async (user, session, query) =>
          JSON.parse(
            sql(
              `select public.internal_user_rankings('${user}','${session}',${
                lit(JSON.stringify(query))
              }::jsonb)`,
            ),
          ),
      });
      const request = (query = "") =>
        new Request("http://local/user-rankings" + query, {
          headers: { authorization: `Bearer ${a.token}` },
        });
      const denied=await h(request());
      expect(denied.status,JSON.stringify(await denied.json())).toBe(403);
      expect((await h(request("?user_id=" + b.id))).status).toBe(400);
    });
  },
);
