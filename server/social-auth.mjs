import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createFirebaseSocialToken, isFirebaseAdminConfigured } from './firebase-admin.mjs';

const MAX_AGE_MS = 10 * 60_000;
const MAX_UPSTREAM_BYTES = 64 * 1024;
const PROVIDERS = {
  kakao: { authorize: 'https://kauth.kakao.com/oauth/authorize', token: 'https://kauth.kakao.com/oauth/token', profile: 'https://kapi.kakao.com/v2/user/me', prefix: 'KAKAO' },
  naver: { authorize: 'https://nid.naver.com/oauth2.0/authorize', token: 'https://nid.naver.com/oauth2.0/token', profile: 'https://openapi.naver.com/v1/nid/me', prefix: 'NAVER' },
};
const attempts = new Map();
const consumed = new Map();
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const baseHeaders = { 'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' };

function exactOrigin(value) {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return url.origin === value && !url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'http:' && local)) ? value : null;
  } catch { return null; }
}

export function getAuthPublicOrigin(env = process.env) {
  return exactOrigin(env.AUTH_PUBLIC_ORIGIN || 'https://bizhannun.vercel.app');
}

export function getAllowedAuthOrigins(env = process.env, selfOrigin) {
  return new Set(['https://softm.github.io', getAuthPublicOrigin(env), exactOrigin(selfOrigin), ...String(env.ALLOWED_ORIGINS ?? '').split(/[\s,]+/).map(exactOrigin)].filter(Boolean));
}

function providerConfig(provider, env) {
  const detail = PROVIDERS[provider];
  if (!detail) return null;
  const clientId = env[`${detail.prefix}_CLIENT_ID`];
  const clientSecret = env[`${detail.prefix}_CLIENT_SECRET`];
  const secret = env.AUTH_SESSION_SECRET;
  if (typeof clientId !== 'string' || !clientId.trim() || clientId.length > 512 || typeof clientSecret !== 'string' || !clientSecret.trim() || clientSecret.length > 2048) return null;
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 4096 || !getAuthPublicOrigin(env) || !isFirebaseAdminConfigured(env)) return null;
  return { ...detail, clientId: clientId.trim(), clientSecret: clientSecret.trim(), secret };
}

export function getSocialAuthStatus(env = process.env) {
  return Object.fromEntries(Object.keys(PROVIDERS).map((provider) => {
    const configured = Boolean(providerConfig(provider, env));
    return [provider, { configured, ...(configured ? {} : { reason: '서버 인증 설정이 필요합니다.' }) }];
  }));
}

function jsonError(code, message, status = 400, headers = {}) {
  return new Response(JSON.stringify({ error: { code, message } }), { status, headers: { ...baseHeaders, 'Content-Type': 'application/json; charset=utf-8', ...headers } });
}

function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function cookieName(provider, secure) { return `${secure ? '__Host-' : ''}bizhannun-oauth-${provider}`; }
function cookieHeader(provider, value, secure, expire = false) {
  return `${cookieName(provider, secure)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expire ? 0 : MAX_AGE_MS / 1000}${secure ? '; Secure' : ''}`;
}
function signedState(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
function readState(request, provider, config, secure) {
  const header = request.headers.get('cookie') ?? '';
  if (header.length > 16_384) return null;
  const name = cookieName(provider, secure);
  const matches = header.split(';').map((item) => item.trim()).filter((item) => item.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const encoded = matches[0].slice(name.length + 1);
  if (encoded.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(encoded)) return null;
  const [body, signature] = encoded.split('.');
  if (!equal(signature, createHmac('sha256', config.secret).update(body).digest('base64url'))) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
}
function uniqueParam(url, name) { return url.searchParams.getAll(name).length === 1 ? url.searchParams.get(name) : null; }
function jsJSON(value) { return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`); }

function callbackHtml(payload, state, clearCookie, success = false) {
  const scriptNonce = randomBytes(24).toString('base64');
  const message = success ? '로그인을 확인했습니다. 이 창을 닫아도 됩니다.' : '로그인을 완료하지 못했습니다. 앱에서 다시 시도해 주세요.';
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>사업자한눈 로그인</title><body><p>${message}</p><script nonce="${scriptNonce}">history.replaceState(null, '', '/api/auth');if(window.opener&&!window.opener.closed){window.opener.postMessage(${jsJSON({ type: 'bizhannun:oauth', provider: state.provider, nonce: state.nonce, ...payload })},${jsJSON(state.returnOrigin)});window.close();}</script></body></html>`;
  return new Response(html, { status: 200, headers: { ...baseHeaders, 'Content-Type': 'text/html; charset=utf-8', 'Set-Cookie': clearCookie, 'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${scriptNonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`, 'Cross-Origin-Opener-Policy': 'unsafe-none' } });
}

/** Per-process abuse control only; provider authorization codes remain single-use. */
function consumeAttempt(request, now) {
  for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
  const rawAddress = request.headers.get('x-vercel-forwarded-for') ?? request.headers.get('x-forwarded-for') ?? 'anonymous';
  const key = createHash('sha256').update(rawAddress.split(',')[0].slice(0, 128)).digest('hex');
  const current = attempts.get(key) ?? { count: 0, until: now + 60_000 };
  if (current.count >= 30) return false;
  if (!attempts.has(key) && attempts.size >= 2048) attempts.delete(attempts.keys().next().value);
  current.count += 1;
  attempts.set(key, current);
  return true;
}

async function boundedJson(fetchImpl, url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: controller.signal });
    if (!response.ok || Number(response.headers.get('content-length')) > MAX_UPSTREAM_BYTES || !response.body) {
      response.body?.cancel().catch(() => {});
      throw new Error('Provider request failed');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_UPSTREAM_BYTES) { reader.cancel().catch(() => {}); throw new Error('Provider response too large'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!object(body)) throw new Error('Invalid provider response');
    return body;
  } finally { clearTimeout(timer); }
}

async function providerIdentity(provider, code, state, config, fetchImpl, callback) {
  const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: callback });
  if (provider === 'naver') form.set('state', state.state);
  const token = await boundedJson(fetchImpl, config.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8', Accept: 'application/json' }, body: form.toString() });
  if (token.error || typeof token.access_token !== 'string' || token.access_token.length < 1 || token.access_token.length > 8192 || /[\u0000-\u0020\u007f]/.test(token.access_token) || (token.token_type && String(token.token_type).toLowerCase() !== 'bearer')) throw new Error('Invalid provider token');
  const profile = await boundedJson(fetchImpl, config.profile, { method: 'GET', headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' } });
  if (provider === 'kakao') {
    const id = profile.id;
    if ((typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) && (typeof id !== 'string' || !/^[1-9]\d{0,30}$/.test(id))) throw new Error('Invalid provider identity');
    const name = profile.kakao_account?.profile?.nickname ?? profile.properties?.nickname;
    return { provider, subject: String(id), displayName: typeof name === 'string' ? name.slice(0, 100) : '카카오 사용자' };
  }
  if (profile.resultcode !== '00' || !object(profile.response) || typeof profile.response.id !== 'string' || !profile.response.id || profile.response.id.length > 512 || /[\u0000-\u0020\u007f]/.test(profile.response.id)) throw new Error('Invalid provider identity');
  const name = profile.response.nickname ?? profile.response.name;
  return { provider, subject: profile.response.id, displayName: typeof name === 'string' ? name.slice(0, 100) : '네이버 사용자' };
}

async function withTimeout(operation, milliseconds) {
  let timer;
  try { return await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Authentication timed out')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

export async function handleSocialAuth(request, env = process.env, deps = {}) {
  if (request.method !== 'GET') return jsonError('method_not_allowed', '지원하지 않는 요청 방식입니다.', 405, { Allow: 'GET' });
  const url = new URL(request.url);
  const provider = uniqueParam(url, 'provider');
  const action = uniqueParam(url, 'action');
  if (!Object.hasOwn(PROVIDERS, provider ?? '') || !['start', 'callback'].includes(action)) return jsonError('invalid_input', '로그인 요청을 확인하세요.');
  const config = providerConfig(provider, env);
  if (!config) return jsonError('not_configured', '이 로그인 방식의 서버 인증 설정이 필요합니다.', 503);
  const publicOrigin = getAuthPublicOrigin(env);
  if (url.origin !== publicOrigin) return jsonError('origin_not_allowed', '등록된 인증 서버 주소를 사용하세요.', 403);
  const secure = url.protocol === 'https:';
  const callback = `${publicOrigin}/api/auth?action=callback&provider=${provider}`;
  const now = deps.now ? deps.now() : Date.now();
  const origins = getAllowedAuthOrigins(env, publicOrigin);
  if (action === 'start') {
    const returnOrigin = uniqueParam(url, 'returnOrigin');
    const nonce = uniqueParam(url, 'nonce');
    if (!exactOrigin(returnOrigin) || !origins.has(returnOrigin)) return jsonError('origin_not_allowed', '허용되지 않은 웹사이트의 로그인 요청입니다.', 403);
    if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{22,128}$/.test(nonce)) return jsonError('invalid_input', '로그인 요청 식별자를 확인하세요.');
    if (!consumeAttempt(request, now)) return jsonError('rate_limited', '로그인 요청이 많습니다. 잠시 후 다시 시도하세요.', 429, { 'Retry-After': '60' });
    const state = { v: 1, provider, returnOrigin, nonce, state: randomBytes(32).toString('base64url'), issuedAt: now, expiresAt: now + MAX_AGE_MS };
    const authorize = new URL(config.authorize);
    for (const [name, value] of Object.entries({ response_type: 'code', client_id: config.clientId, redirect_uri: callback, state: state.state })) authorize.searchParams.set(name, value);
    return new Response(null, { status: 302, headers: { ...baseHeaders, Location: authorize.toString(), 'Set-Cookie': cookieHeader(provider, signedState(state, config.secret), secure) } });
  }
  const clearCookie = cookieHeader(provider, '', secure, true);
  const state = readState(request, provider, config, secure);
  const returnedState = uniqueParam(url, 'state');
  if (!object(state) || state.v !== 1 || state.provider !== provider || !origins.has(state.returnOrigin) || !exactOrigin(state.returnOrigin) || typeof state.nonce !== 'string' || !/^[A-Za-z0-9_-]{22,128}$/.test(state.nonce) || !Number.isSafeInteger(state.issuedAt) || !Number.isSafeInteger(state.expiresAt) || state.issuedAt > now + 5000 || state.expiresAt <= now || state.expiresAt - state.issuedAt !== MAX_AGE_MS || !equal(state.state, returnedState)) {
    return jsonError('invalid_state', '로그인 요청이 만료되었거나 일치하지 않습니다. 앱에서 다시 시작하세요.', 400, { 'Set-Cookie': clearCookie });
  }
  for (const [key, expiry] of consumed) if (expiry <= now) consumed.delete(key);
  if (consumed.has(state.state)) return jsonError('invalid_state', '이미 처리한 로그인 요청입니다. 앱에서 다시 시작하세요.', 400, { 'Set-Cookie': clearCookie });
  if (consumed.size >= 4096) consumed.delete(consumed.keys().next().value);
  consumed.set(state.state, state.expiresAt);
  if (url.searchParams.has('error')) return callbackHtml({ error: { code: 'cancelled', message: '로그인이 취소되었거나 승인되지 않았습니다.' } }, state, clearCookie);
  const code = uniqueParam(url, 'code');
  if (typeof code !== 'string' || !code || code.length > 4096 || /[\u0000-\u001f\u007f]/.test(code)) return callbackHtml({ error: { code: 'invalid_response', message: '로그인 응답을 확인할 수 없습니다.' } }, state, clearCookie);
  try {
    const identity = await providerIdentity(provider, code, state, config, deps.fetchImpl ?? fetch, callback);
    const mint = deps.createCustomToken ?? createFirebaseSocialToken;
    const customToken = await withTimeout(() => mint(identity, env), 8000);
    if (typeof customToken !== 'string' || !customToken || customToken.length > 16_384) throw new Error('Invalid custom token');
    return callbackHtml({ customToken }, state, clearCookie, true);
  } catch {
    // Never serialize upstream exceptions, access tokens, service-account keys,
    // provider profile values, or URLs that may contain an authorization code.
    return callbackHtml({ error: { code: 'authentication_failed', message: '로그인을 완료하지 못했습니다. 잠시 후 다시 시도하세요.' } }, state, clearCookie);
  }
}
