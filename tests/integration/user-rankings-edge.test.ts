// Executes the actual Edge index in local Deno, using HTTP PostgREST + GoTrue (not a stub RPC).
// Local loopback bind replaces only Deno.serve's default listener address; entrypoint/dependencies are unchanged.
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createUser,
  deleteUsers,
  insertFacts,
  serviceClient,
  sql,
  stackKeys,
  type TestUser,
} from "./helpers/myReportsSeed";
import { responseSchema } from "../../contracts/user-rankings/types";
const enabled = process.env.COMMUNITY_STACK === "1";
const base = "http://127.0.0.1:56999";
let proc: ChildProcess;
let user: TestUser;
let stderr = "";
const wrapper = ".agent-runtime/rankings-edge-runtime.ts";
describe.skipIf(!enabled)(
  "actual user-rankings Edge entry in local Deno",
  () => {
    beforeAll(async () => {
      const keys = stackKeys();
      user = await createUser(
        serviceClient(keys),
        keys.ANON_KEY,
        "ranking-edge",
      );
      insertFacts(Array.from({ length: 10 }, (_, i) => ({
        user,
        key: "edge-" + i,
        dataset: "pc",
        sourceId: "9100000001",
        status: i % 2 ? "partial" : "accepted",
        disposition: i % 2 ? "fine" : "warning",
        reportDate: "2041-09-01",
        completedDate: "2041-09-30",
      })));
      sql("notify pgrst, 'reload schema';");
      mkdirSync(".agent-runtime", { recursive: true });
      writeFileSync(
        wrapper,
        `const serve=Deno.serve; Deno.serve=((h: Deno.ServeHandler)=>serve({hostname:'127.0.0.1',port:56999},h)) as typeof Deno.serve; await import('../supabase/functions/user-rankings/index.ts');`,
      );
      proc = spawn("deno", [
        "run",
        "--allow-net=127.0.0.1:56321,127.0.0.1:56999",
        "--allow-env",
        "--allow-read",
        "--config",
        "supabase/functions/user-rankings/deno.json",
        wrapper,
      ], {
        env: {
          ...process.env,
          SUPABASE_URL: "http://127.0.0.1:56321",
          SUPABASE_SERVICE_ROLE_KEY: keys.SERVICE_ROLE_KEY,
          ANALYTICS_RATE_SALT: "local-ranking-evidence-salt",
          ANALYTICS_ALLOWED_ORIGINS: "http://127.0.0.1:5192",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      proc.stderr?.on("data", (x) => stderr += x);
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(base + "/user-rankings")).status === 401) return;
        } catch {}
        if (proc.exitCode !== null) {
          throw new Error(
            "Local Deno failed: " +
              stderr.replace(/eyJ[A-Za-z0-9._-]+/g, "[redacted]"),
          );
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("local Edge listener unavailable");
    }, 60000);
    afterAll(async () => {
      proc?.kill("SIGTERM");
      if (user) deleteUsers([user]);
      rmSync(wrapper, { force: true });
    }, 60000);
    it("all three monthly themes and cumulative unlucky pass the actual Edge and SQL period validation", async () => {
      for (const [theme, metric, numerator] of [["reporters", "reports_count", 10], ["fines", "fine_rate", 5], ["unlucky", "partial_rate", 5]] as const) {
        const r = await fetch(`${base}/user-rankings?theme=${theme}&metric=${metric}&period=month&month=2041-09`, {
          headers: { authorization: `Bearer ${user.token}` },
        });
        const raw = await r.json();
        expect(r.status, JSON.stringify(raw)).toBe(200);
        const data = responseSchema.parse(raw);
        expect(data.scope).toMatchObject({ theme, period: "month", month: "2041-09", start: "2041-09-01", end: "2041-09-30" });
        expect(data.me).toMatchObject({ uuid: user.id, reports: 10, numerator, denominator: 10 });
        expect(r.headers.get("cache-control")).toContain("no-store");
      }
      const r = await fetch(`${base}/user-rankings?theme=unlucky&metric=partial_count&period=all`, {
        headers: { authorization: `Bearer ${user.token}` },
      });
      expect(r.status).toBe(200);
      expect(responseSchema.parse(await r.json()).me).toMatchObject({ reports: 10, partial: 5, numerator: 5, denominator: 10 });
    });
    it("actual getUser, claims, SQL gate/RPC, whitelist and no-store succeed over HTTP", async () => {
      const r = await fetch(
        base +
          "/user-rankings?theme=fines&metric=fine_rate&period=range&start=2041-09-01&end=2041-09-30",
        { headers: { authorization: `Bearer ${user.token}` } },
      );
      const raw = await r.json();
      expect(r.status, JSON.stringify(raw)).toBe(200);
      const data = responseSchema.parse(raw);
      expect(data.me).toMatchObject({
        uuid: user.id,
        reports: 10,
        fine: 5,
        numerator: 5,
        denominator: 10,
        value: 50,
        rank: 1,
      });
      expect(r.headers.get("cache-control")).toContain("no-store");
      expect(JSON.stringify(data)).not.toMatch(
        /source_report|dataset_key|report_number|vehicle|email|token/,
      );
      const anon = await fetch(base + "/user-rankings");
      expect(anon.status).toBe(401);
      const forged = await fetch(base + "/user-rankings?user_id=" + user.id, {
        headers: { authorization: `Bearer ${user.token}` },
      });
      expect(forged.status).toBe(400);
      sql(
        `update private.community_consent_grants set revoked_at=now() where user_id='${user.id}'`,
      );
      const revoked = await fetch(base + "/user-rankings", {
        headers: { authorization: `Bearer ${user.token}` },
      });
      expect(revoked.status).toBe(403);
      expect((await revoked.json()).error.code).toBe("contributor_required");
      const report = {
        runtime:
          "local Deno actual supabase/functions/user-rankings/index.ts; real HTTP GoTrue/PostgREST; synthetic reports; no hosted gateway/deploy",
        statuses: {
          success: r.status,
          anonymous: anon.status,
          forged: forged.status,
          revoked: revoked.status,
        },
        me: {
          reports: data.me?.reports,
          fine: data.me?.fine,
          value: data.me?.value,
          rank: data.me?.rank,
        },
        headers: {
          cache_control: r.headers.get("cache-control"),
          vary: r.headers.get("vary"),
        },
        result: "PASS",
      };
      mkdirSync("docs/implementation/user-rankings/evidence", {
        recursive: true,
      });
      writeFileSync(
        "docs/implementation/user-rankings/evidence/deno-edge.json",
        JSON.stringify(report, null, 2) + "\n",
      );
    });
  },
);
