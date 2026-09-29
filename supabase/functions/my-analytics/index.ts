import { createClient } from 'npm:@supabase/supabase-js@2.117.1';
import { createPersonalHandler } from '../../../server/personalHandler.ts';

// User-only personal comparison (verify_jwt = true in config.toml AND getUser + claims in the handler).
// The viewer id is taken from the verified user only. The service client runs the service_role-only
// internal_* RPCs after that check; responses are private/no-store and never written to the public snapshot.
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const secretMap = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}') as Record<string, string>;
const serverKey = secretMap.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const enabled = Deno.env.get('MY_ANALYTICS_ENABLED') !== 'false' && !!supabaseUrl && !!serverKey;
if (!enabled) console.error(JSON.stringify({ event: 'my_analytics_config_invalid' }));

const client = createClient(supabaseUrl ?? 'http://invalid.local', serverKey ?? 'missing', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

Deno.serve(createPersonalHandler({
  enabled,
  jwtIssuer: Deno.env.get('AUTH_JWT_ISSUER') || null,
  allowedOrigins: (Deno.env.get('MY_ANALYTICS_ALLOWED_ORIGINS') || 'https://safemap.worklazy.net')
    .split(',').map(s => s.trim()).filter(Boolean),
  rpc: async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(/RESULT_TOO_LARGE/.test(error.message ?? '') ? 'RESULT_TOO_LARGE' : `rpc ${error.code ?? 'failed'}`);
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
