import { createClient } from 'npm:@supabase/supabase-js@2.117.1';
import { createMyReportsHandler, RPC_INVALID, RPC_TIMEOUT } from '../../../server/myReports/handler.ts';

// User-only read of the signed-in user's own completed reports for the Chrome extension (contracts/my-reports).
// verify_jwt = true in config.toml AND getUser + claims + DB identity/session gate in the handler/RPC. The service
// client runs only the service_role-only internal_* RPCs after that check; there is no admin-key fallback.
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const secretMap = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}') as Record<string, string>;
const serverKey = secretMap.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const cursorSecret = Deno.env.get('MY_REPORTS_CURSOR_SECRET') || '';
// kill switch: MY_REPORTS_ENABLED=false answers 503 SERVICE_UNAVAILABLE without touching the database
const enabled = Deno.env.get('MY_REPORTS_ENABLED') !== 'false' && !!supabaseUrl && !!serverKey && cursorSecret.length >= 32;
if (!enabled) console.error(JSON.stringify({ event: 'my_reports_config_invalid' }));

const client = createClient(supabaseUrl ?? 'http://invalid.local', serverKey ?? 'missing', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

Deno.serve(createMyReportsHandler({
  enabled,
  cursorSecret,
  jwtIssuer: Deno.env.get('AUTH_JWT_ISSUER') || null,
  // exact chrome-extension://<id> origins only; no default (an unset list admits no browser origin)
  allowedOrigins: (Deno.env.get('MY_REPORTS_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean),
  rpc: async (name, args, signal) => {
    const { data, error } = await client.rpc(name, args).abortSignal(signal);
    if (error) {
      // 57014 = statement timeout; INVALID_QUERY = the RPC's own input check. Nothing else is passed on.
      if (error.code === '57014' || signal.aborted) throw new Error(RPC_TIMEOUT);
      if (/INVALID_QUERY/.test(error.message ?? '')) throw new Error(RPC_INVALID);
      throw new Error(`rpc ${error.code ?? 'failed'}`);
    }
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
