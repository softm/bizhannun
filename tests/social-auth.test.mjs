import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { handleSocialAuth, getSocialAuthStatus } from '../server/social-auth.mjs';
import { socialUid, isFirebaseAdminConfigured } from '../server/firebase-admin.mjs';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const env = {
  AUTH_PUBLIC_ORIGIN: 'https://bizhannun.vercel.app', AUTH_SESSION_SECRET: 'fixture-only-signing-secret-with-more-than-32-characters',
  KAKAO_CLIENT_ID: 'fixture-kakao-client', KAKAO_CLIENT_SECRET: 'fixture-kakao-secret',
  NAVER_CLIENT_ID: 'fixture-naver-client', NAVER_CLIENT_SECRET: 'fixture-naver-secret',
  FIREBASE_PROJECT_ID: 'biz-hannun', FIREBASE_CLIENT_EMAIL: 'fixture@biz-hannun.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: privateKey,
};
const origin = env.AUTH_PUBLIC_ORIGIN;
const nonce = 'browser-nonce-at-least-22-characters';
let attempt = 0;

async function start(provider = 'kakao', options = {}) {
  const url = new URL(`${origin}/api/auth`);
  for (const [key, value] of Object.entries({ action: 'start', provider, returnOrigin: 'https://softm.github.io', nonce, ...options.query })) url.searchParams.set(key, value);
  const response = await handleSocialAuth(new Request(url, { headers: { 'x-forwarded-for': `fixture-${++attempt}` } }), options.env ?? env, options.deps ?? {});
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  const location = response.headers.get('location');
  return { response, cookie, state: location ? new URL(location).searchParams.get('state') : null, location };
}
function callback(session, provider = 'kakao', params = {}, cookie = session.cookie) {
  const url = new URL(`${origin}/api/auth`);
  for (const [key, value] of Object.entries({ action: 'callback', provider, state: session.state, code: 'fixture-provider-code', ...params })) url.searchParams.set(key, value);
  return new Request(url, { headers: cookie ? { cookie } : {} });
}
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
function messageFrom(html) {
  const begin = html.indexOf('window.opener.postMessage(') + 'window.opener.postMessage('.length;
  const end = html.indexOf(',"https://softm.github.io")', begin);
  assert.ok(end > begin);
  return JSON.parse(html.slice(begin, end));
}

test('missing settings disable providers and reject start without exposing credentials', async () => {
  assert.deepEqual(Object.values(getSocialAuthStatus({})).map((entry) => entry.configured), [false, false]);
  const { response } = await start('kakao', { env: {} });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'not_configured');
  assert.equal(isFirebaseAdminConfigured({ ...env, FIREBASE_PRIVATE_KEY: 'invalid secret key' }), false);
  assert.equal(getSocialAuthStatus(env).kakao.configured, true);
});

test('start validates exact return origin and nonce', async () => {
  for (const returnOrigin of ['https://evil.example', 'https://softm.github.io.evil.example', 'https://softm.github.io/', 'null', 'javascript:alert(1)']) {
    assert.equal((await start('kakao', { query: { returnOrigin } })).response.status, 403);
  }
  assert.equal((await start('kakao', { query: { nonce: 'short' } })).response.status, 400);
});

test('authorization redirect binds a secure host cookie and never sends the client secret', async () => {
  const session = await start();
  assert.equal(session.response.status, 302);
  const cookie = session.response.headers.get('set-cookie');
  assert.match(cookie, /^__Host-bizhannun-oauth-kakao=/);
  assert.match(cookie, /HttpOnly; SameSite=Lax; Max-Age=600; Secure$/);
  const target = new URL(session.location);
  assert.equal(target.origin, 'https://kauth.kakao.com');
  assert.equal(target.searchParams.get('redirect_uri'), `${origin}/api/auth?action=callback&provider=kakao`);
  assert.equal(target.searchParams.has('client_secret'), false);
  assert.ok(session.state.length >= 32);
});

test('missing, mismatched, tampered and duplicate cookies fail before token exchange', async () => {
  const session = await start();
  let upstreamCalls = 0;
  const deps = { fetchImpl: async () => { upstreamCalls++; throw new Error('must not execute'); } };
  const requests = [
    callback(session, 'kakao', {}, ''),
    callback(session, 'kakao', { state: 'forged-state' }),
    callback(session, 'kakao', {}, `${session.cookie.slice(0, -1)}!`),
    callback(session, 'kakao', {}, `${session.cookie}; ${session.cookie}`),
  ];
  for (const request of requests) {
    const response = await handleSocialAuth(request, env, deps);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'invalid_state');
    assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  }
  assert.equal(upstreamCalls, 0);
});

test('expired state and provider mixup fail before exchange', async () => {
  const createdAt = Date.now();
  const session = await start('kakao', { deps: { now: () => createdAt } });
  assert.equal((await handleSocialAuth(callback(session), env, { now: () => createdAt + 600_001 })).status, 400);
  assert.equal((await handleSocialAuth(callback(session, 'naver'), env)).status, 400);
});

test('kakao verified server profile is the only source of custom-token identity', async () => {
  const session = await start();
  const calls = [];
  const response = await handleSocialAuth(callback(session, 'kakao', { subject: 'attacker-id' }), env, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return json({ access_token: 'private-provider-access', refresh_token: 'private-provider-refresh', token_type: 'bearer' });
      return json({ id: 123456, kakao_account: { profile: { nickname: '사용자 <script>' }, email: 'same@example.test' } });
    },
    createCustomToken: async (identity) => {
      assert.deepEqual(identity, { provider: 'kakao', subject: '123456', displayName: '사용자 <script>' });
      return 'firebase-custom-token';
    },
  });
  assert.equal(response.status, 200);
  assert.equal(calls[0].url, 'https://kauth.kakao.com/oauth/token');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(new URLSearchParams(calls[0].options.body).get('client_secret'), env.KAKAO_CLIENT_SECRET);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer private-provider-access');
  const html = await response.text();
  assert.deepEqual(messageFrom(html), { type: 'bizhannun:oauth', provider: 'kakao', nonce, customToken: 'firebase-custom-token' });
  assert.doesNotMatch(html, /private-provider|fixture-kakao-secret|same@example|attacker-id/);
  assert.equal(response.headers.get('location'), null);
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'; script-src 'nonce-/);
  assert.match(html, /history\.replaceState/);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
});

test('naver token request includes state and validates its profile result code', async () => {
  const session = await start('naver');
  let call = 0;
  const response = await handleSocialAuth(callback(session, 'naver'), env, {
    fetchImpl: async (url, options) => {
      call++;
      if (call === 1) {
        assert.equal(url, 'https://nid.naver.com/oauth2.0/token');
        assert.equal(new URLSearchParams(options.body).get('state'), session.state);
        return json({ access_token: 'naver-private-token', token_type: 'bearer' });
      }
      assert.equal(url, 'https://openapi.naver.com/v1/nid/me');
      return json({ resultcode: '00', response: { id: 'naver-subject', nickname: '네이버 사용자' } });
    },
    createCustomToken: async (identity) => { assert.equal(identity.subject, 'naver-subject'); return 'naver-custom-token'; },
  });
  assert.equal(messageFrom(await response.text()).customToken, 'naver-custom-token');
});

test('provider cancellation is sanitized and a consumed state cannot be reused', async () => {
  const session = await start();
  const response = await handleSocialAuth(callback(session, 'kakao', { error: 'access_denied', error_description: '<script>private-value</script>' }), env);
  const html = await response.text();
  assert.equal(messageFrom(html).error.code, 'cancelled');
  assert.doesNotMatch(html, /private-value/);
  assert.equal((await handleSocialAuth(callback(session), env)).status, 400);
});

test('failed token exchange does not leak provider messages or keys', async () => {
  const session = await start();
  const response = await handleSocialAuth(callback(session), env, { fetchImpl: async () => json({ error: 'invalid_grant', error_description: 'private-upstream-token-and-key' }, 401), createCustomToken: async () => assert.fail('must not mint') });
  const html = await response.text();
  assert.equal(messageFrom(html).error.code, 'authentication_failed');
  assert.doesNotMatch(html, /private-upstream|fixture-kakao|BEGIN PRIVATE/);
});

test('missing access token, invalid provider identity and oversized responses cannot mint', async () => {
  for (const [provider, tokenBody, profileBody] of [
    ['kakao', { token_type: 'bearer' }, {}],
    ['kakao', { access_token: 'token' }, { id: 9007199254740992 }],
    ['naver', { access_token: 'token' }, { resultcode: '024', response: { id: 'unverified' } }],
    ['naver', { access_token: 'token' }, { resultcode: '00', response: {} }],
    ['kakao', { access_token: 'x'.repeat(70_000) }, {}],
  ]) {
    const session = await start(provider);
    let call = 0;
    const response = await handleSocialAuth(callback(session, provider), env, { fetchImpl: async () => json(++call === 1 ? tokenBody : profileBody), createCustomToken: async () => assert.fail('must not mint') });
    assert.equal(messageFrom(await response.text()).error.code, 'authentication_failed');
  }
});

test('custom-token creation failures are safe and never treated as success', async () => {
  const session = await start();
  let call = 0;
  const response = await handleSocialAuth(callback(session), env, { fetchImpl: async () => json(++call === 1 ? { access_token: 'token' } : { id: 123 }), createCustomToken: async () => { throw new Error('private-service-account-value'); } });
  const html = await response.text();
  assert.equal(messageFrom(html).error.code, 'authentication_failed');
  assert.doesNotMatch(html, /private-service-account/);
});

test('social UID is stable and separated by provider without email auto-merge', () => {
  assert.equal(socialUid('kakao', '123'), socialUid('kakao', '123'));
  assert.notEqual(socialUid('kakao', '123'), socialUid('naver', '123'));
  assert.match(socialUid('kakao', '123'), /^kakao:[a-f0-9]{64}$/);
  assert.throws(() => socialUid('google', '123'));
  assert.throws(() => socialUid('kakao', ''));
});

test('method and ambiguous parameters are rejected', async () => {
  assert.equal((await handleSocialAuth(new Request(`${origin}/api/auth`, { method: 'POST' }), env)).status, 405);
  assert.equal((await handleSocialAuth(new Request(`${origin}/api/auth?action=start&provider=kakao&provider=naver`), env)).status, 400);
});
