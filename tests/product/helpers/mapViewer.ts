import type { PublicAccess } from '../../../server/publicHandler';

export const TEST_MAP_ORIGIN = 'https://safemap.worklazy.net';
const SESSION = '11111111-2222-4333-8444-555555555555';
const ISSUER = 'https://fixture.supabase.co/auth/v1';
const payload = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** A syntactically valid fixture; getUser below stands in for Supabase's signature and session verification. */
export function viewerToken(uid = 'fixture-viewer'): string {
  return `${payload({ alg: 'HS256' })}.${payload({ sub: uid, role: 'authenticated', aud: 'authenticated',
    iss: ISSUER, session_id: SESSION, is_anonymous: false })}.fixture`;
}

export function fixtureAccess(uid = 'fixture-viewer'): PublicAccess {
  return {
    allowedOrigins: [TEST_MAP_ORIGIN], jwtIssuer: ISSUER,
    getUser: async token => token === viewerToken(uid) ? { id: uid, isAnonymous: false } : null,
    // eligible contributor fixture: active share consent with 10 publicly-listed reports (2026-09-28 threshold)
    viewer: async () => ({ user_ok: true, kakao: true, session: true, contributor: 'active', has_public_facts: true, public_fact_count: 10 }),
  };
}

export function viewerRequest(url: string, init: RequestInit = {}, uid = 'fixture-viewer'): Request {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${viewerToken(uid)}`);
  headers.set('Origin', TEST_MAP_ORIGIN);
  return new Request(url, { ...init, headers });
}
