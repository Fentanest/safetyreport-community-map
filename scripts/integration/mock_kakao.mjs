#!/usr/bin/env node
// Mock Kakao OAuth for the composed LOCAL integration stack only (never production).
// Same behaviour as safetyreport-community-auth tests/stack/mock-kakao.mjs, but it can listen on the docker
// bridge address so GoTrue inside the stack reaches it as host.docker.internal.
//
//   node scripts/integration/mock_kakao.mjs --host 172.17.0.1 --port 56410 --redirect http://127.0.0.1:56321/auth/v1/callback
// The client secret is read from .integration-stack/.stack-secrets.json (KAKAO_SECRET) and never printed.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ACCOUNTS = {
  A: { id: 920001, nickname: '통합테스트A', email: null },
  B: { id: 920002, nickname: '통합테스트B', email: 'int-b@example.invalid' },
  C: { id: 920003, nickname: '통합테스트C', email: null },
  D: { id: 920004, nickname: '통합테스트D', email: null },
};

export function startMockKakao({ host = '127.0.0.1', port = 56410, clientSecret, clientId = 'mock-kakao-client', redirectUri }) {
  const codes = new Map();
  const tokens = new Map();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);
    const send = (status, type, body, headers = {}) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers }); res.end(body); };
    if (url.pathname === '/oauth/authorize') {
      if (url.searchParams.get('client_id') !== clientId || url.searchParams.get('redirect_uri') !== redirectUri) {
        return send(400, 'text/plain', 'mock kakao: client or redirect mismatch');
      }
      return send(200, 'text/html; charset=utf-8', '<!doctype html><title>MOCK Kakao</title><p>MOCK Kakao (local integration only)</p>');
    }
    if (url.pathname === '/oauth/decide') {
      const target = new URL(redirectUri);
      target.searchParams.set('state', url.searchParams.get('state') ?? '');
      const choice = url.searchParams.get('choice');
      if (!ACCOUNTS[choice]) return send(400, 'text/plain', 'unknown choice');
      const code = randomBytes(16).toString('hex');
      codes.set(code, choice);
      target.searchParams.set('code', code);
      return send(302, 'text/plain', '', { Location: target.toString() });
    }
    if (url.pathname === '/oauth/token' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw);
      const account = codes.get(form.get('code') ?? '');
      if (form.get('client_secret') !== clientSecret || form.get('client_id') !== clientId || !account) {
        return send(400, 'application/json', JSON.stringify({ error: 'invalid_grant' }));
      }
      codes.delete(form.get('code'));
      const accessToken = randomBytes(24).toString('hex');
      tokens.set(accessToken, account);
      return send(200, 'application/json', JSON.stringify({ access_token: accessToken, token_type: 'bearer',
        refresh_token: randomBytes(24).toString('hex'), expires_in: 21599 }));
    }
    if (url.pathname === '/v2/user/me') {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
      const account = ACCOUNTS[tokens.get(token)];
      if (!account) return send(401, 'application/json', '{"msg":"invalid token"}');
      const body = { id: account.id, kakao_account: { profile: { nickname: account.nickname } } };
      if (account.email) Object.assign(body.kakao_account, { email: account.email, is_email_valid: true, is_email_verified: true });
      return send(200, 'application/json', JSON.stringify(body));
    }
    return send(404, 'text/plain', 'not found');
  });
  return new Promise(done => server.listen(port, host, () => done(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
  const here = dirname(fileURLToPath(import.meta.url));
  const stack = resolve(opt('--stack', join(here, '../../.integration-stack')));
  const secrets = JSON.parse(readFileSync(join(stack, '.stack-secrets.json'), 'utf8'));
  const host = opt('--host', '127.0.0.1');
  const port = Number(opt('--port', '56410'));
  await startMockKakao({ host, port, clientSecret: secrets.KAKAO_SECRET, redirectUri: opt('--redirect', 'http://127.0.0.1:56321/auth/v1/callback') });
  console.log(`mock kakao listening on ${host}:${port}`);
}
