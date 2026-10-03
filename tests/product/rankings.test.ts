import { readFileSync } from "node:fs";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  kstMonth,
  monthBounds,
  querySchema,
  responseSchema,
} from "../../contracts/user-rankings/types";
import { createRankingHandler } from "../../server/rankings/handler";
const uid = "11111111-2222-4333-8444-555555555555",
  session = "66666666-7777-4888-9999-aaaaaaaaaaaa";
const b64 = (v: unknown) =>
  Buffer.from(JSON.stringify(v)).toString("base64url");
const token = `${b64({ alg: "none" })}.${
  b64({
    sub: uid,
    role: "authenticated",
    aud: "authenticated",
    session_id: session,
  })
}.test`;
export const rankingFixture = () => ({
  schema_version: "user-rankings-v1",
  cohort_policy_version: "single-date-v1",
  dataset_version: "a".repeat(32),
  generated_at: "2026-10-03T00:00:00.000Z",
  scope: {
    theme: "reporters",
    metric: "reports_count",
    period: "all",
    start: null,
    end: null,
    month: null,
    date_basis: "completed_date",
    category: "all",
    min_reports: 1,
    timezone: "Asia/Seoul",
    in_progress: false,
  },
  total_participants: 0,
  rows: [],
  me: null,
  page: 1,
  page_size: 20,
  next_page: null,
  diagnostics: {
    selected_date_missing: 0,
    completed_unknown: 0,
    inconsistent_disposition: 0,
  },
});
const setup = (extra = {}) => {
  const rpc = vi.fn(async (
      _user: string,
      _session: string,
      _query: Record<string, unknown>,
      _signal: AbortSignal,
    ) => rankingFixture()
    ),
    allowRequest = vi.fn(async () => true);
  const h = createRankingHandler({
    allowedOrigins: ["https://example.invalid"],
    jwtIssuer: null,
    getUser: async () => ({ id: uid, isAnonymous: false }),
    rpc,
    allowRequest,
    ...extra,
  });
  return { h, rpc, allowRequest };
};
const req = (q = "", auth = true) =>
  new Request(`https://example.invalid/functions/v1/user-rankings${q}`, {
    headers: auth ? { Authorization: `Bearer ${token}` } : {},
  });
describe("ranking strict contract and authenticated boundary", () => {
  it("rejects anon without calling DB", async () => {
    const { h, rpc } = setup();
    expect((await h(req("", false))).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("binds own user exclusively to verified JWT; rejects client ids/raw filters", async () => {
    const { h, rpc } = setup();
    for (
      const q of [
        "?user_id=" + uid,
        "?contributor_id=" + uid,
        "?result=rejected",
        "?disposition=fine",
        "?page=2",
        "?page_size=51",
        "?page=1&page=2",
        "?theme=fines&metric=reports_count",
      ]
    ) expect((await h(req(q))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    await h(req());
    expect(rpc.mock.calls[0]?.[0]).toBe(uid);
  });
  it("fails claims mismatch and anonymous Supabase user", async () => {
    expect(
      (await setup({
        getUser: async () => ({ id: session, isAnonymous: false }),
      }).h(req())).status,
    ).toBe(401);
    expect(
      (await setup({ getUser: async () => ({ id: uid, isAnonymous: true }) }).h(
        req(),
      )).status,
    ).toBe(403);
  });
  it("private no-store on success/refusal; rate limits and safe errors", async () => {
    const { h } = setup();
    const r = await h(req());
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(r.headers.get("vary")).toContain("Authorization");
    const limited = await setup({ allowRequest: async () => false }).h(req());
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("60");
    const failure = await setup({
      rpc: async () => {
        throw Error("secret private report");
      },
    }).h(req());
    expect(await failure.text()).not.toContain("secret");
  });
  it("whitelist rejects nested raw canaries and forged me", async () => {
    const leak = rankingFixture() as unknown as Record<string, unknown>;
    leak.vehicle_raw = "PRIVATE_CANARY";
    expect((await setup({ rpc: async () => leak }).h(req())).status).toBe(503);
    expect(responseSchema.safeParse(leak).success).toBe(false);
    const row = {
      uuid: session,
      rank: 1,
      tie_count: 1,
      reports: 1,
      fine: 0,
      partial: 0,
      rejected: 0,
      completed_unknown: 0,
      numerator: 1,
      denominator: 1,
      value: 1,
      is_me: false,
    };
    const nested = {
      ...rankingFixture(),
      total_participants: 1,
      rows: [{ ...row, report_number: "PRIVATE_CANARY" }],
    };
    const denied = await setup({ rpc: async () => nested }).h(req());
    expect(denied.status).toBe(503);
    expect(await denied.text()).not.toContain("PRIVATE_CANARY");
    const wrongMe = {
      ...rankingFixture(),
      total_participants: 1,
      me: { ...row, is_me: true },
    };
    expect((await setup({ rpc: async () => wrongMe }).h(req())).status).toBe(
      503,
    );
  });
  it("maps eligibility/changed-version refusals and does not expose DB extras", async () => {
    for (
      const [code, status] of [["upload_required", 403], [
        "contributor_required",
        403,
      ], ["DATASET_CHANGED", 409]] as const
    ) {
      const r = await setup({
        rpc: async () => ({
          error: code,
          private: "CANARY",
          details: { current: 3, secret: "CANARY" },
        }),
      }).h(req());
      expect(r.status).toBe(status);
      expect(await r.text()).not.toContain("CANARY");
    }
  });
  it("origin and method deny; preflight has no stats", async () => {
    const { h, rpc } = setup();
    expect(
      (await h(
        new Request("https://api/user-rankings", {
          headers: { origin: "https://bad.invalid" },
        }),
      )).status,
    ).toBe(403);
    expect(
      (await h(new Request("https://api/user-rankings", { method: "POST" })))
        .status,
    ).toBe(405);
    expect(
      (await h(new Request("https://api/user-rankings", { method: "OPTIONS" })))
        .status,
    ).toBe(204);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("generated JSON schemas stay synchronized with runtime allowlists", () => {
    for (
      const [name, schema] of [["query", querySchema], [
        "response",
        responseSchema,
      ]] as const
    ) {
      expect(
        JSON.parse(
          readFileSync(
            new URL(
              `../../contracts/user-rankings/${name}.schema.json`,
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      ).toEqual(z.toJSONSchema(schema));
    }
  });
  it("one sample default, no artificial time cap, no contradictory range conditions", () => {
    expect(querySchema.parse({}).min_reports).toBe(1);
    expect(
      querySchema.safeParse({
        period: "range",
        start: "2000-01-01",
        end: "2026-10-03",
      }).success,
    ).toBe(true);
    for (
      const q of [{ period: "range", start: "2026-02-30", end: "2026-03-01" }, {
        period: "all",
        start: "2026-01-01",
      }, { theme: "unlucky", metric: "partial_rate", period: "all", month: "2023-07" }]
    ) expect(querySchema.safeParse(q).success).toBe(false);
  });
  it("KST midnight/month/year/leap boundaries", () => {
    expect(kstMonth(new Date("2026-09-30T14:59:59Z"))).toBe("2026-09");
    expect(kstMonth(new Date("2026-09-30T15:00:00Z"))).toBe("2026-10");
    expect(kstMonth(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01");
    expect(monthBounds("2024-02").end).toBe("2024-02-29");
    expect(monthBounds("2026-12").end).toBe("2026-12-31");
  });
});
