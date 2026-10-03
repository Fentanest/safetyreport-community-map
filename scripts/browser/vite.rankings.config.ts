/** LOCAL only: real frontend + actual DB ranking RPC + real GoTrue JWT. Invented users/reports; no cloud URL. */
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { createRankingHandler } from "../../server/rankings/handler.ts";
import { querySchema } from "../../contracts/user-rankings/types.ts";
import {
  createUser,
  deleteUsers,
  insertFacts,
  lit,
  serviceClient,
  sql,
  stackKeys,
  type TestUser,
} from "../../tests/integration/helpers/myReportsSeed.ts";
import { randomUUID } from "node:crypto";
const port = Number(process.env.RANKINGS_PORT || 5192),
  origin = `http://127.0.0.1:${port}`;
process.env.VITE_KAKAO_MAP_JS_KEY = "local-mock-key";
process.env.VITE_DATA_MODE = "live";
process.env.VITE_PUBLIC_ANALYTICS_URL = origin + "/functions/v1";
process.env.VITE_SUPABASE_URL = origin;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "local-synthetic-publishable";
const keys = stackKeys(), db = serviceClient(keys);
let viewer: TestUser | null = null;
let fakeSession: unknown;
const others: TestUser[] = [];
const logs: Array<
  {
    route: string;
    query: Record<string, string>;
    status: number;
    bytes: number;
  }
> = [];
let nextFailure = 0;
let seeding: Promise<void> | null = null;
async function seed() {
  if (!seeding) seeding = seedData().finally(() => { seeding = null; });
  await seeding;
}
async function seedData() {
  if (viewer) return;
  viewer = await createUser(db, keys.ANON_KEY, "ranking-browser");
  const claims = JSON.parse(
    Buffer.from(viewer.token.split(".")[1], "base64url").toString(),
  );
  fakeSession = {
    access_token: viewer.token,
    refresh_token: "local-test-no-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: claims.exp,
    user: {
      id: viewer.id,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "kakao" },
      user_metadata: { nickname: "합성검수" },
    },
  };
  for (let i = 0; i < 25; i++) {
    const id = randomUUID(), grant = randomUUID(), lineage = randomUUID();
    sql(
      `insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values('${id}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','ranking-browser-${id}@example.invalid',now(),now());
    insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at) values('${id}','${id}','{"sub":"synthetic"}','kakao',now(),now());
    insert into private.contributor_profiles(user_id,consent_version,privacy_policy_version) values('${id}','2026-09-28.3','2026-09-28.3');
    insert into private.community_consent_grants(grant_id,lineage_id,user_id,policy_version,consent_text_sha256,granted_via,granted_session_id) values('${grant}','${lineage}','${id}','2026-09-28.3',repeat('a',64),'safetyreport_server',gen_random_uuid());`,
    );
    others.push({
      id,
      grant,
      lineage,
      email: "",
      password: "",
      token: "",
      session: "",
    });
  }
  const current = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
  const all = [viewer, ...others];
  insertFacts(
    all.flatMap((user, i) =>
      Array.from({ length: i === 0 ? 50 : 10 + i }, (_, j) => ({
        user,
        key: "browser-" + j,
        dataset: "pc",
        sourceId: "9100000001",
        status: j % 4 === 0
          ? "partial"
          : j % 4 === 1
          ? "rejected"
          : j % 4 === 2
          ? "completed_unknown"
          : "accepted",
        disposition: j % 4 === 0 ? "fine" : "none",
        completedDate: `${current}-01`,
        reportDate: "2026-09-01",
      }))
    ),
  );
  // Historical month is a real local table cohort, not a static list of winners.
  insertFacts(all.flatMap((user, i) => Array.from({ length: 2 + i % 4 }, (_, j) => ({
    user, key: `july2023-${j}`, dataset: 'pc', sourceId: '9100000001',
    status: j % 3 === 0 ? 'rejected' : j % 3 === 1 ? 'partial' : 'accepted',
    disposition: j % 3 === 1 ? 'fine' : 'none',
    completedDate: j % 2 === 0 ? '2023-07-01' : '2023-07-31',
    reportDate: j === 0 ? '2023-06-30' : '2023-07-15',
  }))));
  insertFacts(
    all.map((user, i) => ({
      user,
      key: "past-month-" + i,
      dataset: "pc",
      sourceId: "9100000001",
      status: "rejected",
      completedDate: "2026-08-31",
      reportDate: "2026-08-01",
    })),
  );
}
async function cleanup() {
  if (viewer) {
    deleteUsers([viewer, ...others]);
    viewer = null;
    others.length = 0;
    fakeSession = undefined;
  }
}
function api(): Plugin {
  return {
    name: "local-real-ranking-db",
    configureServer(server) {
      server.httpServer?.on("close", () => {
        void cleanup();
      });
      server.middlewares.use(async (req, res, next) => {
        const u = new URL(req.url || "/", origin);
        if (u.pathname === "/__rankings/session") {
          await seed();
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify({ session: fakeSession }));
          return;
        }
        if (u.pathname === "/__rankings/log") {
          res.end(JSON.stringify(logs));
          return;
        }
        if (u.pathname === "/__rankings/fail") {
          nextFailure = Number(u.searchParams.get("status"));
          res.end("{}");
          return;
        }
        if (u.pathname === "/__rankings/withdraw") {
          if (viewer) {
            sql(
              `update private.community_consent_grants set revoked_at=now() where user_id='${viewer.id}'`,
            );
          }
          res.end("{}");
          return;
        }
        if (u.pathname === "/__rankings/restore") {
          if (viewer) {
            sql(
              `update private.community_consent_grants set revoked_at=null where user_id='${viewer.id}'`,
            );
          }
          res.end("{}");
          return;
        }
        if (u.pathname === "/__rankings/cleanup") {
          await cleanup();
          res.end("{}");
          return;
        }
        if (u.pathname.startsWith("/auth/v1/")) {
          const h = new Headers();
          h.set("apikey", keys.ANON_KEY);
          if (req.headers.authorization) {
            h.set("Authorization", req.headers.authorization);
          }
          const reply = await fetch(
            `http://127.0.0.1:56321${u.pathname}${u.search}`,
            { method: req.method, headers: h },
          );
          res.statusCode = reply.status;
          res.setHeader("Content-Type", "application/json");
          res.end(await reply.text());
          return;
        }
        // The neighboring dashboard uses its existing real handler over explicitly synthetic map facts.
        // Only rankings use the actual DB RPC; no map SDK/network claims are made from this fixture.
        if (u.pathname.startsWith("/functions/v1/public-analytics/")) {
          const pub = await server.ssrLoadModule("/server/publicHandler.ts");
          const demo = await server.ssrLoadModule("/src/data/demoEngine.ts");
          const h = pub.createPublicHandler({
            getState: async () => ({
              dataset_version: "ranking-browser-map-fixture",
              ready: true,
              source_updated_at: "2026-09-24T00:00:00Z",
              generated_at: "2026-09-24T00:00:00Z",
              published_at: null,
              data_min: "2025-09-25",
              data_max: "2026-09-24",
              coverage_note: "로컬 지도 합성 fixture",
              dedupe_policy_version: "synthetic",
            }),
            getFacts: async () => demo.demoFacts(),
            allowRequest: async () => true,
          }, {
            allowedOrigins: [origin, "http://127.0.0.1:5193"],
            jwtIssuer: null,
            getUser: async (token: string) => {
              const { data } = await db.auth.getUser(token);
              return data.user
                ? { id: data.user.id, isAnonymous: false }
                : null;
            },
            viewer: async (uid: string, sid: string) =>
              JSON.parse(
                sql(
                  `select public.internal_analytics_viewer('${uid}','${sid}')`,
                ),
              ),
          });
          const headers = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === "string") headers.set(k, v);
          }
          const reply = await h(
            new Request(u, { method: req.method, headers }),
          );
          res.statusCode = reply.status;
          reply.headers.forEach((v: string, k: string) => res.setHeader(k, v));
          res.end(await reply.text());
          return;
        }
        if (u.pathname !== "/functions/v1/user-rankings") {
          next();
          return;
        }
        if (nextFailure) {
          const status = nextFailure;
          nextFailure = 0;
          res.statusCode = status;
          res.setHeader("Retry-After", "2");
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({
            error: {
              code: status === 409
                ? "DATASET_CHANGED"
                : status === 429
                ? "rate_limited"
                : "service_unavailable",
              message: "로컬 합성 오류 검수",
            },
          }));
          logs.push({
            route: "rankings",
            query: Object.fromEntries(u.searchParams),
            status,
            bytes: 0,
          });
          return;
        }
        const h = createRankingHandler({
          allowedOrigins: [origin, "http://127.0.0.1:5193"],
          jwtIssuer: null,
          getUser: async (token) => {
            const { data, error } = await db.auth.getUser(token);
            if (error) return null;
            return data.user ? { id: data.user.id, isAnonymous: false } : null;
          },
          allowRequest: async () => true,
          rpc: async (user, session, query) =>
            JSON.parse(
              sql(
                `select public.internal_user_rankings('${user}','${session}',${
                  lit(JSON.stringify(querySchema.parse(query)))
                }::jsonb)`,
              ),
            ),
        });
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) {
          if (typeof v === "string") headers.set(k, v);
        }
        const result = await h(new Request(u, { method: req.method, headers }));
        res.statusCode = result.status;
        result.headers.forEach((v, k) => res.setHeader(k, v));
        const body = await result.text();
        logs.push({
          route: "rankings",
          query: Object.fromEntries(u.searchParams),
          status: result.status,
          bytes: Buffer.byteLength(body),
        });
        res.end(body);
      });
    },
  };
}
export default defineConfig({
  root: process.cwd(),
  plugins: [react(), api()],
  server: { host: "127.0.0.1", port, strictPort: true },
  logLevel: "warn",
});
