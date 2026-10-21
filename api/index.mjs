import { createHash } from 'node:crypto';
import { InputError, normalizeNumber, normalizeBusinesses } from '../src/provider-input.mjs';
import {
  getProviderHealth,
  queryNtsStatuses,
  validateNtsBusinesses,
  queryCommerce,
} from '../server/providers.mjs';

const MAX_BODY_BYTES = 256_000;
const MAX_RATE_BUCKETS = 2_048;
const rateBuckets = new Map();
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, name) => Object.hasOwn(value, name);

// This controls browser origins only. Clients can omit Origin, so CORS is not
// authentication or protection for the provider's account-wide API quota.
function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return { allowed: true, origin: null };
  let parsed;
  try { parsed = new URL(origin); } catch { return { allowed: false, origin }; }
  if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol)) return { allowed: false, origin };
  const configured = String(env.ALLOWED_ORIGINS ?? '')
    .split(/[\s,]+/).filter(Boolean).flatMap((value) => {
      try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) ? [url.origin] : [];
      } catch { return []; }
    });
  const sameHost = origin === new URL(request.url).origin;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  return { allowed: sameHost || local || origin === 'https://softm.github.io' || configured.includes(origin), origin };
}

function responseJson(payload, status, cors, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
    ...extraHeaders,
  };
  if (cors.allowed && cors.origin) headers['Access-Control-Allow-Origin'] = cors.origin;
  return new Response(JSON.stringify(payload), { status, headers });
}

async function readBody(request) {
  const size = Number(request.headers.get('content-length'));
  if (size > MAX_BODY_BYTES) {
    request.body?.cancel().catch(() => {});
    throw new InputError('요청 본문이 너무 큽니다.');
  }
  if (!request.body) throw new InputError('올바른 JSON 본문을 전송하세요.');
  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        // Stop consuming immediately, including when Content-Length is absent
        // or dishonest. Do not await an untrusted stream's cancellation hook.
        reader.cancel().catch(() => {});
        throw new InputError('요청 본문이 너무 큽니다.');
      }
      parts.push(decoder.decode(chunk.value, { stream: true }));
    }
    parts.push(decoder.decode());
  } catch (error) {
    if (error instanceof InputError) throw error;
    reader.cancel().catch(() => {});
    throw new InputError('요청 본문을 올바른 UTF-8 JSON으로 읽을 수 없습니다.');
  } finally {
    reader.releaseLock();
  }
  let value;
  try { value = JSON.parse(parts.join('')); } catch { throw new InputError('올바른 JSON 본문을 전송하세요.'); }
  if (!object(value)) throw new InputError('요청 본문은 JSON 객체여야 합니다.');
  return value;
}

function boundedSetting(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? Math.min(parsed, maximum) : fallback;
}

/** Best effort only: memory is per process/instance, never a distributed quota. */
function consumeRateLimit(request, env, units) {
  const timestamp = Date.now();
  const rawAddress = request.headers.get('x-vercel-forwarded-for')
    ?? request.headers.get('x-forwarded-for') ?? 'anonymous';
  const address = rawAddress.split(',')[0].trim().slice(0, 128);
  const key = createHash('sha256').update(address).digest('hex');
  for (const [name, value] of rateBuckets) if (value.resetAt <= timestamp) rateBuckets.delete(name);
  let bucket = rateBuckets.get(key);
  if (!bucket) {
    if (rateBuckets.size >= MAX_RATE_BUCKETS) rateBuckets.delete(rateBuckets.keys().next().value);
    bucket = { requests: 0, units: 0, resetAt: timestamp + 60_000 };
    rateBuckets.set(key, bucket);
  }
  const requests = boundedSetting(env.API_RATE_LIMIT_PER_MINUTE, 60, 10_000);
  const records = boundedSetting(env.API_RATE_LIMIT_RECORDS_PER_MINUTE, 1_000, 100_000);
  if (bucket.requests + 1 > requests || bucket.units + units > records) {
    return Math.max(1, Math.ceil((bucket.resetAt - timestamp) / 1_000));
  }
  bucket.requests += 1;
  bucket.units += units;
  return 0;
}

export async function handleApi(request, env = process.env, fetchImpl = fetch) {
  const checkedAt = new Date().toISOString();
  const cors = allowedOrigin(request, env);
  if (!cors.allowed) {
    return responseJson({ error: { code: 'origin_not_allowed', message: '허용되지 않은 웹사이트의 요청입니다.' }, checkedAt }, 403, cors);
  }
  const path = new URL(request.url).pathname.replace(/\/$/, '');
  const methods = path === '/api/health' ? ['GET']
    : ['/api/status', '/api/validate', '/api/commerce'].includes(path) ? ['POST'] : null;
  if (!methods) return responseJson({ error: { code: 'not_found', message: 'API 경로를 찾을 수 없습니다.' }, checkedAt }, 404, cors);
  if (request.method === 'OPTIONS') {
    const headers = {
      'Access-Control-Allow-Methods': [...methods, 'OPTIONS'].join(', '),
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
    if (cors.origin) headers['Access-Control-Allow-Origin'] = cors.origin;
    return new Response(null, { status: 204, headers });
  }
  if (!methods.includes(request.method)) {
    return responseJson({ error: { code: 'method_not_allowed', message: '지원하지 않는 요청 방식입니다.' }, checkedAt }, 405, cors, { Allow: [...methods, 'OPTIONS'].join(', ') });
  }
  if (path === '/api/health') {
    return responseJson({
      service: 'bizhannun-api',
      deployed: true,
      providers: getProviderHealth(env),
      rateLimit: { scope: 'instance', distributed: false },
      checkedAt,
    }, 200, cors);
  }
  try {
    const body = await readBody(request);
    let validated;
    let units = 1;
    if (path === '/api/status') {
      if (!Array.isArray(body.businessNumbers) || !body.businessNumbers.length || body.businessNumbers.length > 100) {
        throw new InputError('businessNumbers에는 1개 이상 100개 이하의 사업자등록번호를 입력하세요.');
      }
      validated = body.businessNumbers.map(normalizeNumber);
      units = validated.length;
    } else if (path === '/api/validate') {
      validated = normalizeBusinesses(body);
      units = validated.length;
    } else {
      validated = normalizeNumber(body.businessNumber);
    }
    const retryAfter = consumeRateLimit(request, env, units);
    if (retryAfter) {
      return responseJson({ error: { code: 'rate_limited', message: '조회 요청이 많습니다. 잠시 후 다시 시도하세요.' }, checkedAt }, 429, cors, { 'Retry-After': String(retryAfter) });
    }
    if (path === '/api/status') {
      return responseJson({ results: await queryNtsStatuses(validated, env, fetchImpl), checkedAt: new Date().toISOString() }, 200, cors);
    }
    if (path === '/api/validate') {
      return responseJson({ results: await validateNtsBusinesses(validated, env, fetchImpl), checkedAt: new Date().toISOString() }, 200, cors);
    }
    return responseJson(await queryCommerce(validated, env, fetchImpl), 200, cors);
  } catch (error) {
    if (error instanceof InputError) {
      return responseJson({ error: { code: 'invalid_input', message: error.message }, checkedAt }, 400, cors);
    }
    // Never serialize an upstream exception or URL; it could contain a key.
    return responseJson({ error: { code: 'internal_error', message: '요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요.' }, checkedAt }, 500, cors);
  }
}

// Vercel's documented Web Handler exports; local development imports handleApi.
export const GET = (request) => handleApi(request);
export const POST = (request) => handleApi(request);
export const OPTIONS = (request) => handleApi(request);
