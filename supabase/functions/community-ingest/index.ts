import { createClient } from 'npm:@supabase/supabase-js@2.117.1';
import { createIngestHandler } from '../../../server/ingest/handler.ts';

// User-only ingest (verify_jwt = true in config.toml AND getUser + claims in the handler). The service client is
// used only for the internal_* RPCs after the handler verified the user; there is no admin-key fallback.
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const secretMap = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}') as Record<string, string>;
const serverKey = secretMap.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const enabled = Deno.env.get('COMMUNITY_INGEST_ENABLED') !== 'false' && !!supabaseUrl && !!serverKey;
if (!enabled) console.error(JSON.stringify({ event: 'community_ingest_config_invalid' }));

const client = createClient(supabaseUrl ?? 'http://invalid.local', serverKey ?? 'missing', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

Deno.serve(createIngestHandler({
  enabled,
  // Read once per authenticated request (v1, v2, manifest, progress) BEFORE any database write: upload pause (2-9),
  // v1 sunset, required version (2-10). A throw makes v2 a retryable 503 and lets v1/manifest/progress continue
  // (not paused, no sunset, no requirement); the error text is never logged.
  capabilities: async () => {
    const { data, error } = await client.rpc('internal_community_ingest_capabilities');
    if (error || !data || !Array.isArray(data.contracts)) throw new Error('capabilities_unavailable');
    return data;
  },
  jwtIssuer: Deno.env.get('AUTH_JWT_ISSUER') || null,
  allowedOrigins: (Deno.env.get('COMMUNITY_ALLOWED_ORIGINS') || 'https://safemap.worklazy.net,https://safeauth.worklazy.net')
    .split(',').map(s => s.trim()).filter(Boolean),
  // Per-minute refusal counters for the operations console (best-effort). The handler does not await this (the 503/426
  // answer goes first, R3-M3); waitUntil keeps the worker alive until the small upsert finishes. Failures are ignored.
  noteRejection: (code, app, route) => {
    const p = Promise.resolve(client.rpc('internal_community_ingest_note_rejection', { p_code: code, p_app: app, p_route: route }))
      .then(() => undefined, () => undefined);
    try { (globalThis as { EdgeRuntime?: { waitUntil?(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil?.(p); } catch { /* not in Edge runtime */ }
    return p;
  },
  rpc: async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(`rpc ${error.code ?? 'failed'}`); // codes only (40P01 → busy); details stay server-side
    return data;
  },
  getUser: async token => {
    const { data, error } = await client.auth.getUser(token);
    if (error) {
      const status = (error as { status?: number }).status ?? 0;
      if ([400, 401, 403, 404].includes(status)) return null;
      throw new Error('auth unavailable');
    }
    return data.user ? { id: data.user.id, isAnonymous: data.user.is_anonymous === true } : null;
  },
  log: entry => console.log(JSON.stringify(entry)),
}));
