// Minimal CDP client over Node built-in WebSocket. No npm deps. Review helper only.
export class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id !== undefined && this.pending.has(msg.id)) {
        const { res, rej } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) rej(new Error(`CDP ${msg.method ?? ''}: ${JSON.stringify(msg.error)}`));
        else res(msg.result);
      } else if (msg.method) {
        const list = this.handlers.get(msg.method) ?? [];
        for (const fn of list) { try { fn(msg.params); } catch {} }
      }
    };
    this.ws.onerror = () => {};
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error(`CDP timeout ${method}`)); } }, 30000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

export async function cdpTargets(cdpPort) {
  const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
  return res.json();
}

// Evaluate a function in the page; args are JSON-serialized.
export async function evaluate(cdp, fnSource, ...args) {
  const expression = `(${fnSource})(${args.map((a) => JSON.stringify(a)).join(',')})`;
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`page eval: ${r.exceptionDetails.text ?? JSON.stringify(r.exceptionDetails)}`);
  if (r.result?.subtype === 'error') throw new Error(`page eval: ${r.result?.description ?? 'js error'}`);
  return r.result?.value;
}

export async function waitFor(cdp, fnSource, timeoutMs = 20000, ...args) {
  const start = Date.now();
  for (;;) {
    const v = await evaluate(cdp, fnSource, ...args).catch(() => undefined);
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor timeout: ${fnSource.slice(0, 120)}`);
    await new Promise((r) => setTimeout(r, 120));
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
