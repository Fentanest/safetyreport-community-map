import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import { createRankingHandler } from "../../../server/rankings/handler.ts";
const url = Deno.env.get("SUPABASE_URL");
const secretMap = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const key = secretMap.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const salt = Deno.env.get("ANALYTICS_RATE_SALT");
if (!url || !key || !salt) {
  throw new Error("ranking server configuration incomplete");
}
const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
Deno.serve(createRankingHandler({
  allowedOrigins: (Deno.env.get("ANALYTICS_ALLOWED_ORIGINS") ||
    Deno.env.get("MY_ANALYTICS_ALLOWED_ORIGINS") ||
    "https://safemap.worklazy.net").split(",").map((x) => x.trim()).filter(
      Boolean,
    ),
  jwtIssuer: Deno.env.get("AUTH_JWT_ISSUER") || null,
  async getUser(token) {
    const { data, error } = await db.auth.getUser(token);
    if (error) {
      if ([400, 401, 403, 404].includes(error.status ?? 0)) return null;
      throw new Error("auth unavailable");
    }
    return data.user
      ? { id: data.user.id, isAnonymous: data.user.is_anonymous === true }
      : null;
  },
  async allowRequest(user) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${salt}|ranking|${user}`),
    );
    const bucket = Array.from(
      new Uint8Array(digest),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const { data, error } = await db.rpc("internal_analytics_v2_rate_limit", {
      p_bucket: bucket,
    });
    if (error) throw new Error("rate unavailable");
    return data === true;
  },
  async rpc(user, session, query, signal) {
    const { data, error } = await db.rpc("internal_user_rankings", {
      p_user: user,
      p_session: session,
      p_query: query,
    }).abortSignal(signal);
    if (error) {
      throw new Error(
        /INVALID_QUERY/.test(error.message)
          ? "INVALID_QUERY"
          : "ranking unavailable",
      );
    }
    return data;
  },
}));
