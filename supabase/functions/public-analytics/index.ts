import { createClient } from 'npm:@supabase/supabase-js@2.117.1';
import { createPublicHandler, type AnalyticsState, type ViewerCheck } from '../../../server/publicHandler.ts';
import type { PrivateFact } from '../../../server/aggregate.ts';
import type { Scope } from '../../../src/domain/public.ts';

// The database client remains inside the Edge runtime; the service key never enters a VITE variable, response,
// log, or Pages artifact. Every read requires a verified Kakao contributor; no runtime public-mode switch.
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

async function rateBucket(viewerId: string): Promise<string> {
  const encoded = new TextEncoder().encode(`${rateSalt}|user|${viewerId}`);
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
      // Region filtering happens in server/aggregate.ts on official codes (시도 includes its 시군구); the SQL filter
      // only knows the raw display key, so it is not used here.
      p_region_code: null, p_agency_key: scope.agency_key,
      p_manager_key: scope.manager_key, p_bbox: scope.bbox,
    });
    if (!Array.isArray(value) || value.length > 100000) throw new Error('analytics source budget exceeded');
    return value as PrivateFact[];
  },
  async allowRequest(_request: Request, viewerId: string): Promise<boolean> {
    const value = await rpc('internal_analytics_v2_rate_limit', { p_bucket: await rateBucket(viewerId) });
    return value === true;
  },
}, {
  allowedOrigins: (Deno.env.get('ANALYTICS_ALLOWED_ORIGINS') || Deno.env.get('MY_ANALYTICS_ALLOWED_ORIGINS') ||
    'https://safemap.worklazy.net').split(',').map(s => s.trim()).filter(Boolean),
  jwtIssuer: Deno.env.get('AUTH_JWT_ISSUER') || null,
  async getUser(token) {
    const { data, error } = await db.auth.getUser(token);
    if (error) {
      const status = (error as { status?: number }).status ?? 0;
      if ([400, 401, 403, 404].includes(status)) return null;
      throw new Error('auth unavailable');
    }
    return data.user ? { id: data.user.id, isAnonymous: data.user.is_anonymous === true } : null;
  },
  async viewer(uid, session): Promise<ViewerCheck> {
    const value = await rpc('internal_analytics_viewer', { p_user: uid, p_session: session });
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('viewer state unavailable');
    return value as ViewerCheck;
  },
});

Deno.serve(handle);
