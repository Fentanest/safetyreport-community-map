// App version strings (2026-10-22, backfill-resume 2-10·2-11). Same rule as SQL private.community_version_parts and
// contracts/community-ingest-v2/version-vectors.json: `[v]N[.N[.N[.N]]][+build]`, each N 1..6 digits, missing parts = 0.
// Anything else (pre-release `-beta`, empty, inner spaces, > 40 chars) is unparseable → null, and callers never block on it.

const VERSION = /^v?([0-9]{1,6})(?:\.([0-9]{1,6}))?(?:\.([0-9]{1,6}))?(?:\.([0-9]{1,6}))?(?:\+[0-9A-Za-z.-]{1,32})?$/;

export function parseVersion(v: unknown): [number, number, number, number] | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const m = VERSION.exec(v.replace(/^ +| +$/g, '')); // SQL btrim: spaces only
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0), Number(m[4] ?? 0)];
}

/** -1 / 0 / 1, or null when either side is unparseable. */
export function compareVersions(a: unknown, b: unknown): -1 | 0 | 1 | null {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
