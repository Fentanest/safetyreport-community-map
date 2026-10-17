import { describe, expect, it } from 'vitest';
import { analyticsEnabled, analyticsLocation, analyticsReferrer } from '../../src/analytics/googleAnalytics';

describe('analyticsLocation — only the path and the screen name reach Google', () => {
  it('drops the OAuth callback code and the scope parameters', () => {
    expect(analyticsLocation('https://safemap.worklazy.net/?code=abc123&date_basis=completed_date&start=2025-09-25&end=2026-09-24&category=all', 'dashboard'))
      .toBe('https://safemap.worklazy.net/');
  });
  it('keeps the screen name but drops the share recipe, ranking state and agency/manager filters', () => {
    const href = 'https://safemap.worklazy.net/?screen=rankings&sr=recipe&rk_period=month&agency=%EA%B2%BD%EA%B8%B0&manager=%ED%99%8D%EA%B8%B8%EB%8F%99#x';
    expect(analyticsLocation(href, 'rankings')).toBe('https://safemap.worklazy.net/?screen=rankings');
    expect(analyticsLocation(href, 'statistics')).toBe('https://safemap.worklazy.net/?screen=statistics');
  });
});

describe('analyticsReferrer — external origin only', () => {
  const self = 'https://safemap.worklazy.net';
  it('reduces an external referrer to its origin', () => {
    expect(analyticsReferrer('https://kauth.kakao.com/oauth/authorize?client_id=x&state=y', self)).toBe('https://kauth.kakao.com/');
  });
  it('sends nothing for same-site, empty or malformed referrers', () => {
    expect(analyticsReferrer('https://safemap.worklazy.net/?screen=statistics&start=2026-01-01', self)).toBe('');
    expect(analyticsReferrer('', self)).toBe('');
    expect(analyticsReferrer('not a url', self)).toBe('');
  });
});

describe('analyticsEnabled', () => {
  it('runs on production live builds only, unless VITE_GA overrides it', () => {
    expect(analyticsEnabled({ PROD: true, VITE_DATA_MODE: 'live' })).toBe(true);
    expect(analyticsEnabled({ PROD: true })).toBe(true);
    expect(analyticsEnabled({ PROD: true, VITE_DATA_MODE: 'demo' })).toBe(false);
    expect(analyticsEnabled({ PROD: false, VITE_DATA_MODE: 'live' })).toBe(false);
    expect(analyticsEnabled({ PROD: true, VITE_DATA_MODE: 'live', VITE_GA: 'off' })).toBe(false);
    expect(analyticsEnabled({ PROD: false, VITE_GA: 'on' })).toBe(true);
  });
});
