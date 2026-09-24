import { createClient } from 'npm:@supabase/supabase-js@2.117.1';
import { createPublicHandler, type AnalyticsState } from '../../../server/publicHandler.ts';
import type { PrivateFact } from '../../../server/aggregate.ts';
import type { Scope } from '../../../src/domain/public.ts';

// This function is public to call, but its database client remains inside the Edge runtime.
// The service key never enters a VITE variable, response, log, or Pages artifact.
const supabaseUrl = Deno.env.get('SUPABASE_URL');
const secretMap = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}') as Record<string, string>;
const serverKey = secretMap.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const rateSalt = Deno.env.get('ANALYTICS_RATE_SALT');
if (!supabaseUrl || !serverKey || !rateSalt) throw new Error('public analytics server configuration incomplete');

const db = createClient(supabaseUrl, serverKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function rpc(name: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(name, args);
  if (error) throw new Error('analytics repository unavailable');
  return data;
}

async function rateBucket(request: Request): Promise<string> {
  // Gateway-supplied address is used only as a salted one-minute rate bucket.
  const address = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const encoded = new TextEncoder().encode(`${rateSalt}|${address.trim()}`);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

const handle = createPublicHandler({
  async getState(): Promise<AnalyticsState> {
    const value = await rpc('internal_analytics_v2_state');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('analytics state unavailable');
    return value as AnalyticsState;
  },
  async getFacts(scope: Scope): Promise<PrivateFact[]> {
    const value = await rpc('internal_analytics_v2_facts', {
      p_start: scope.start, p_end: scope.end, p_category: scope.category,
      p_region_code: scope.region_code, p_agency_key: scope.agency_key,
      p_manager_key: scope.manager_key, p_bbox: scope.bbox,
    });
    if (!Array.isArray(value) || value.length > 100000) throw new Error('analytics source budget exceeded');
    return value as PrivateFact[];
  },
  async allowRequest(request: Request): Promise<boolean> {
    const value = await rpc('internal_analytics_v2_rate_limit', { p_bucket: await rateBucket(request) });
    return value === true;
  },
});

Deno.serve(handle);
