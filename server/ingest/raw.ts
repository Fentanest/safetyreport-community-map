/** v2 reception validates bytes and structure only. Semantic parsing runs in Python. */
import { canonicalJson, sha256Hex } from './observation.ts';

export class RawFailure extends Error {
  constructor(readonly code: 'raw_hash_mismatch' | 'raw_invalid' | 'raw_reporter_keys_present' | 'supplement_invalid' |
    'supplement_hash_mismatch' | 'client_observation_hash_mismatch') { super(code); }
}
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const exact = (x: Record<string, unknown>, keys: string[]) => Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const hex = (x: unknown) => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
/** 짝 없는 UTF-16 surrogate. 그대로 jsonb 로 넘기면 Postgres 가 거절해 500 이 되므로 수신 단계에서 422 로 거절한다. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** 값(객체 키 포함) 어딘가에 짝 없는 surrogate 가 있으면 true. */
export function hasLoneSurrogate(x: unknown): boolean {
  if (typeof x === 'string') return LONE_SURROGATE.test(x);
  if (Array.isArray(x)) return x.some(hasLoneSurrogate);
  if (x && typeof x === 'object') return Object.entries(x).some(([k, v]) => LONE_SURROGATE.test(k) || hasLoneSurrogate(v));
  return false;
}
/** 문법상 올바른 JSON 텍스트에서 같은 객체 안에 같은 키(이스케이프를 푼 값 기준)가 두 번 나오면 true.
 *  JSON.parse 는 마지막 값을 남기므로 `{"result":{"C_NAME":"x"},"result":{}}` 처럼 검사를 비켜 갈 수 있다. */
export function hasDuplicateKeys(json: string): boolean {
  const stack: (Set<string> | null)[] = [];
  let expectKey = false;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    if (c === 0x22) {
      let j = i + 1;
      while (j < json.length && json.charCodeAt(j) !== 0x22) j += json.charCodeAt(j) === 0x5c ? 2 : 1;
      const top = stack.length ? stack[stack.length - 1] : null;
      if (top && expectKey) {
        const key = JSON.parse(json.slice(i, j + 1)) as string;
        if (top.has(key)) return true;
        top.add(key);
        expectKey = false;
      }
      i = j;
    } else if (c === 0x7b) { stack.push(new Set()); expectKey = true; }
    else if (c === 0x5b) { stack.push(null); expectKey = false; }
    else if (c === 0x7d || c === 0x5d) { stack.pop(); expectKey = false; }
    else if (c === 0x2c) { expectKey = !!(stack.length && stack[stack.length - 1]); }
  }
  return false;
}
const text = (x: unknown, max: number) => x === null || (typeof x === 'string' && x.length > 0 && [...x].length <= max && !x.includes('\u0000') && !LONE_SURROGATE.test(x));
const integer = (x: unknown, min: number, max: number) => x === null || (Number.isSafeInteger(x) && Number(x) >= min && Number(x) <= max);
export const REPORTER_KEYS = ['C_NAME', 'C_EMAIL', 'C_PHONE', 'C_PHONE2', 'C_ID'];
export function validSupplement(x: unknown): boolean {
  if (!object(x) || !exact(x, ['rating', 'rating_cause', 'survey_state', 'photo_first_at', 'photo_last_at', 'photo_count', 'list'])) return false;
  const l = x.list;
  return integer(x.rating, 1, 5) && text(x.rating_cause, 10000) && text(x.survey_state, 80) &&
    text(x.photo_first_at, 80) && text(x.photo_last_at, 80) && integer(x.photo_count, 0, 1000000) &&
    object(l) && exact(l, ['title', 'report_date', 'status', 'entry_value', 'ssnpc_cd', 'ssnpc_type']) &&
    text(l.title, 1000) && text(l.report_date, 80) && text(l.status, 80) && text(l.entry_value, 200) && text(l.ssnpc_cd, 32) && text(l.ssnpc_type, 32);
}

export async function validateRaw(e: Record<string, unknown>): Promise<void> {
  const r = e.raw;
  if (!object(r) || !exact(r, ['body', 'sha256', 'size', 'fetched_at', 'source']) ||
      typeof r.body !== 'string' || !hex(r.sha256) || !Number.isSafeInteger(r.size) || Number(r.size) < 1 || Number(r.size) > 1048576 ||
      typeof r.fetched_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(r.fetched_at) || Number.isNaN(Date.parse(r.fetched_at)) ||
      typeof r.source !== 'string' || !r.source.length || [...r.source].length > 80 || r.body.includes('\u0000') ||
      LONE_SURROGATE.test(r.body) || LONE_SURROGATE.test(r.source)) throw new RawFailure('raw_invalid');
  if (new TextEncoder().encode(r.body).length !== r.size || await sha256Hex(r.body) !== r.sha256) throw new RawFailure('raw_hash_mismatch');
  let parsed: unknown;
  try { parsed = JSON.parse(r.body); } catch { throw new RawFailure('raw_invalid'); }
  // 중복 키(신고자 키 검사 우회)와 이스케이프로 만든 짝 없는 surrogate("\\ud800")도 형식 오류로 본다.
  if (!object(parsed) || !object(parsed.result) || hasDuplicateKeys(r.body) || hasLoneSurrogate(parsed)) throw new RawFailure('raw_invalid');
  if (Object.hasOwn(parsed.result, 'C_NO') && String(parsed.result.C_NO) !== e.source_report_id) throw new RawFailure('raw_invalid');
  if (REPORTER_KEYS.some(k => Object.hasOwn(parsed.result as object, k))) throw new RawFailure('raw_reporter_keys_present');
  if (!validSupplement(e.supplement)) throw new RawFailure('supplement_invalid');
  if (!hex(e.supplement_sha256) || await sha256Hex(canonicalJson(e.supplement)) !== e.supplement_sha256) throw new RawFailure('supplement_hash_mismatch');
  if (Object.hasOwn(e, 'client_observation')) {
    if (!hex(e.client_observation_sha256) || await sha256Hex(canonicalJson(e.client_observation)) !== e.client_observation_sha256) throw new RawFailure('client_observation_hash_mismatch');
  }
}

/** Ledger fingerprint covers raw metadata as well as all three content hashes; no private body is journalled. */
export async function rawEventFingerprint(e: Record<string, unknown>): Promise<string> {
  const r = e.raw as Record<string, unknown>;
  return sha256Hex(canonicalJson({ raw: { sha256: r.sha256, size: r.size, fetched_at: r.fetched_at, source: r.source },
    supplement_sha256: e.supplement_sha256, client_observation_sha256: e.client_observation_sha256 ?? null }));
}
