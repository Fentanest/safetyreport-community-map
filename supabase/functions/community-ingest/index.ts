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
  jwtIssuer: Deno.env.get('AUTH_JWT_ISSUER') || null,
  allowedOrigins: (Deno.env.get('COMMUNITY_ALLOWED_ORIGINS') || 'https://safemap.worklazy.net,https://safeauth.worklazy.net')
    .split(',').map(s => s.trim()).filter(Boolean),
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
