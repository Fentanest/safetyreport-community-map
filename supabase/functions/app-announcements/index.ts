import { createClient } from 'npm:@supabase/supabase-js@2.117.1';
import { createAnnouncementHandler } from '../../../server/announcements/handler.ts';

// Public read of live app announcements (contracts/app-announcements). verify_jwt = false in config.toml AND the 206
// router's JWT exception list (same as community-auth-relay): apps call it with the publishable key only, before any
// Kakao sign-in. The server key is used only for the one read-only RPC below and never leaves this runtime.
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const secretMap = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}') as Record<string, string>;
const serverKey = secretMap.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const enabled = Deno.env.get('APP_ANNOUNCEMENTS_ENABLED') !== 'false' && !!supabaseUrl && !!serverKey;
if (!enabled) console.error(JSON.stringify({ event: 'app_announcements_config_invalid' }));

const client = createClient(supabaseUrl ?? 'http://invalid.local', serverKey ?? 'missing', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

Deno.serve(createAnnouncementHandler({
  enabled,
  rpc: async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error('rpc failed'); // details stay server-side
    return data;
  },
  log: entry => console.log(JSON.stringify(entry)),
}));
