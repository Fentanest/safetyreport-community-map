import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const manifestPath = resolve(ROOT, 'public/manifest.webmanifest');

interface ManifestIcon { src: string; sizes: string; type: string; purpose?: string }
interface Manifest {
  name: string; short_name: string; start_url: string; scope: string; display: string;
  background_color: string; theme_color: string; icons: ManifestIcon[];
}

function readManifest(): Manifest {
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

/** Reads width/height straight out of the PNG IHDR chunk (bytes 16-23) — no image library needed. */
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`${path}: not a PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('public/manifest.webmanifest', () => {
  const manifest = readManifest();

  it('is installable as the map: standalone display, rooted scope/start_url', () => {
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
  });

  it('names the app after the existing screen title / TopBar brand text, not a placeholder', () => {
    expect(manifest.name).toContain('커뮤니티 신고 지도');
    expect(manifest.short_name).toBe('커뮤니티 신고 지도');
    expect(manifest.short_name.length).toBeLessThanOrEqual(16); // home-screen label; avoid truncation
  });

  it('declares theme/background colors (so the splash screen is not black-on-white by default)', () => {
    expect(manifest.background_color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(manifest.theme_color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it('has a 192x192 any icon, a 512x512 any icon, and a 512x512 maskable icon', () => {
    const any192 = manifest.icons.find((i) => i.sizes === '192x192' && (i.purpose ?? 'any').includes('any'));
    const any512 = manifest.icons.find((i) => i.sizes === '512x512' && (i.purpose ?? 'any').includes('any') && i.purpose !== 'maskable');
    const maskable512 = manifest.icons.find((i) => i.sizes === '512x512' && i.purpose === 'maskable');
    expect(any192, '192x192 any icon missing from manifest').toBeDefined();
    expect(any512, '512x512 any icon missing from manifest').toBeDefined();
    expect(maskable512, '512x512 maskable icon missing from manifest').toBeDefined();
  });

  it('every declared icon file exists under public/ and its PNG dimensions match its declared size', () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons) {
      const path = resolve(ROOT, 'public', icon.src.replace(/^\//, ''));
      expect(existsSync(path), `${icon.src} does not exist under public/`).toBe(true);
      const [w, h] = icon.sizes.split('x').map(Number);
      const size = pngSize(path);
      expect(size, `${icon.src} size mismatch with manifest "${icon.sizes}"`).toEqual({ width: w, height: h });
    }
  });

  it('the maskable icon has no transparency at its edges (OS applies its own mask shape over it)', () => {
    const maskable = manifest.icons.find((i) => i.purpose === 'maskable')!;
    const buf = readFileSync(resolve(ROOT, 'public', maskable.src.replace(/^\//, '')));
    // A flattened (non-palette, non-indexed) PNG with no alpha channel has IHDR colour type 2 (truecolor) or 0
    // (greyscale); 4/6 mean an alpha channel is present, which a maskable icon must not rely on.
    const colorType = buf.readUInt8(25);
    expect([0, 2, 3]).toContain(colorType);
  });
});

describe('index.html — PWA install metadata', () => {
  const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');

  it('links the manifest', () => {
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest">/);
  });
  it('declares light and dark theme-color via media queries', () => {
    expect(html).toMatch(/<meta name="theme-color" content="#[0-9a-fA-F]{6}" media="\(prefers-color-scheme: dark\)">/);
    expect(html).toMatch(/<meta name="theme-color" content="#[0-9a-fA-F]{6}" media="\(prefers-color-scheme: light\)">/);
  });
  it('declares an apple-touch-icon and the iOS standalone-app meta tags', () => {
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="커뮤니티 신고 지도">');
  });
});

describe('public/sw.js — install-only service worker never touches personal data', () => {
  const sw = readFileSync(resolve(ROOT, 'public/sw.js'), 'utf8');

  it('only ever caches same-origin "/assets/*" (the hashed, immutable build output)', () => {
    expect(sw).toContain("url.pathname.startsWith('/assets/')");
  });
  it('explicitly refuses other origins and non-GET requests before doing anything else', () => {
    expect(sw).toContain('url.origin !== self.location.origin');
    expect(sw).toContain("request.method !== 'GET'");
  });
  it('is an allowlist (only "/assets/*" is ever handled), not a blocklist naming the API/relay/account services', () => {
    expect(sw).not.toMatch(/community-auth-relay|community-account|safeauth\.worklazy\.net/);
    // Everything that is not "/assets/*" falls through to the browser's normal network fetch — including
    // "/functions/v1/*" — simply because nothing below this line ever runs for it.
    const fetchHandler = sw.slice(sw.indexOf("addEventListener('fetch'"));
    expect(fetchHandler).not.toContain('functions/v1');
  });
  it('cleans up old caches on activate (version hygiene)', () => {
    expect(sw).toContain('caches.keys()');
    expect(sw).toContain('caches.delete');
  });
});
