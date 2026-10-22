// `GET /functions/v1/app-announcements?app=&mode=&platform=&version=` (2026-10-22, task 2-11).
// Public: no Kakao login, no user token (PC admin screen and a phone before sign-in must see notices). The 206 router
// runs functions with VERIFY_JWT=true, so this function sits in the same JWT exception as community-auth-relay
// (docs/deployment.md). Returns at most 3 live announcements for the audience; no personal data in or out.
// Contract: contracts/app-announcements/. Every item is re-validated here (links on the allowlist, plain text) so a bad
// row never reaches an app; the apps check again before showing anything.
import { parseVersion } from '../ingest/version.ts';

export type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export interface AnnouncementDeps {
  enabled: boolean;
  rpc: Rpc;
  now?(): number;
  log?(entry: Record<string, string | number>): void;
}

const APPS = ['pc', 'mobile'];
const MODES: Record<string, string[]> = { pc: ['server'], mobile: ['standalone', 'client', 'demo'] };
const PLATFORMS = ['windows', 'linux', 'macos', 'docker', 'android', 'ios', 'other'];
const ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const CACHE_MS = 60_000;
const CACHE_MAX = 200;
const APP_ACTIONS = ['open_mode_switch'];

/** Same allowlist as SQL private.app_announcement_url_allowed. */
export function announcementUrlAllowed(url: unknown): boolean {
  if (typeof url !== 'string' || url.length > 500 || /[\s\u0000-\u001f\u007f<>"\\]/.test(url)) return false;
  return /^https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.fentanest\.mysafetyreport(&[A-Za-z0-9._~=%-]+)*$/.test(url)
    || /^https:\/\/github\.com\/Fentanest\/[A-Za-z0-9._~/%?=&#+-]*$/.test(url)
    || /^https:\/\/([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*worklazy\.net(\/[A-Za-z0-9._~/%?=&#+-]*)?$/.test(url);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const cp = (s: string) => [...s].length;
const iso = (v: unknown): string | null | undefined => v === null ? null
  : typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : undefined;

/** One item of the response; null drops it. */
export function cleanAnnouncement(v: unknown): Record<string, unknown> | null {
  if (!isObj(v)) return null;
  const { id, title, body, primary_action: a, snooze_days: snooze, starts_at: starts, ends_at: ends, priority } = v;
  if (typeof id !== 'string' || !ID.test(id)) return null;
  if (typeof title !== 'string' || cp(title) < 1 || cp(title) > 40 || /[\u0000-\u001f\u007f]/.test(title)) return null;
  if (typeof body !== 'string' || cp(body) < 1 || cp(body) > 600 || /[\u0000-\u0009\u000b-\u001f\u007f]/.test(body)) return null;
  if (!Number.isInteger(snooze) || (snooze as number) < 0 || (snooze as number) > 365) return null;
  if (!Number.isInteger(priority)) return null;
  const s = iso(starts), e = iso(ends);
  if (s === undefined || s === null || e === undefined) return null;
  let action: Record<string, string> | null = null;
  if (a !== null && a !== undefined) {
    if (!isObj(a) || typeof a.label !== 'string' || cp(a.label) < 1 || cp(a.label) > 20 || /[\u0000-\u001f\u007f]/.test(a.label)) return null;
    const keys = Object.keys(a).sort().join(',');
    if (keys === 'label,url' && announcementUrlAllowed(a.url)) action = { label: a.label, url: a.url as string };
    else if (keys === 'app_action,label' && APP_ACTIONS.includes(a.app_action as string)) action = { label: a.label, app_action: a.app_action as string };
    else return null;
  }
  return { id, title, body, primary_action: action, snooze_days: snooze, starts_at: s, ends_at: e, priority };
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff', ...headers } });
}
const error = (status: number, code: string, extra: Record<string, string> = {}) =>
  json(status, { error: { code } }, { 'Cache-Control': 'no-store', ...extra });

export function createAnnouncementHandler(deps: AnnouncementDeps): (request: Request) => Promise<Response> {
  // Per-instance cache: a public endpoint must not turn every app start into a database read.
  const cache = new Map<string, { at: number; body: unknown }>();
  const now = deps.now ?? Date.now;
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET') return error(405, 'method_not_allowed', { Allow: 'GET' });
    if (!deps.enabled) return error(503, 'service_unavailable', { 'Retry-After': '300' });
    const url = new URL(request.url);
    const q = url.searchParams;
    const names = [...q.keys()];
    if (names.length !== 4 || !['app', 'mode', 'platform', 'version'].every(k => q.getAll(k).length === 1)) return error(400, 'invalid_request');
    const app = q.get('app')!, mode = q.get('mode')!, platform = q.get('platform')!, version = q.get('version')!;
    if (!APPS.includes(app) || !MODES[app].includes(mode) || !PLATFORMS.includes(platform) || version.length > 40
        || /[^\x20-\x7e]/.test(version)) return error(400, 'invalid_request');
    // An unparseable version is not an error: it only receives announcements without a version condition (SQL rule).
    const key = `${app}|${mode}|${platform}|${parseVersion(version) ? version : '?'}`;
    const hit = cache.get(key);
    let body: unknown;
    if (hit && now() - hit.at < CACHE_MS) body = hit.body;
    else {
      let rows: unknown;
      try { rows = await deps.rpc('internal_app_announcements', { p_app: app, p_mode: mode, p_platform: platform, p_version: version }); }
      catch { deps.log?.({ event: 'app_announcements', outcome: 'rpc_failed' }); return error(503, 'service_unavailable', { 'Retry-After': '300' }); }
      const items = (Array.isArray(rows) ? rows : []).map(cleanAnnouncement).filter((x): x is Record<string, unknown> => !!x).slice(0, 3);
      body = { protocol: 1, announcements: items };
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(key, { at: now(), body });
    }
    deps.log?.({ event: 'app_announcements', outcome: 'ok' });
    return json(200, { ...(body as Record<string, unknown>), server_time: new Date(now()).toISOString() }, { 'Cache-Control': 'public, max-age=300' });
  };
}
