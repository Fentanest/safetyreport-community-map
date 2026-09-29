import { createClient } from 'npm:@supabase/supabase-js@2.117.1';
import { createMyReportsHandler } from '../../../server/myReportsHandler.ts';

const url = Deno.env.get('SUPABASE_URL');
const secretMap = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}') as Record<string, string>;
const key = secretMap.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const origins = (Deno.env.get('MY_REPORTS_ALLOWED_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean);
const enabled = !!url && !!key && origins.length > 0 && Deno.env.get('MY_REPORTS_ENABLED') !== 'false';
const client = createClient(url ?? 'http://invalid.local', key ?? 'missing', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

Deno.serve(createMyReportsHandler({
  enabled,
  allowedOrigins: origins,
  jwtIssuer: Deno.env.get('AUTH_JWT_ISSUER') || null,
  rpc: async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  },
  getUser: async token => {
    const { data, error } = await client.auth.getUser(token);
    if (error) {
      if ([400,401,403,404].includes((error as { status?: number }).status ?? 0)) return null;
      throw new Error('auth unavailable');
    }
    return data.user ? { id: data.user.id, isAnonymous: data.user.is_anonymous === true } : null;
  },
  log: entry => console.log(JSON.stringify(entry)),
}));
