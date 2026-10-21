import assert from 'node:assert/strict';
import test from 'node:test';
import { authErrorMessage, createAuthClient, matchesSocialMessage, normalizeAuthConfig } from '../src/auth.mjs';

const ORIGIN = 'https://softm.github.io';
const API = 'https://bizhannun.vercel.app';
const config = () => ({
  firebase: {
    apiKey: 'A'.repeat(39), projectId: 'bizhannun-test',
    authDomain: 'bizhannun-test.firebaseapp.com', appId: '1:123456789:web:abcdef123456',
  },
  providers: Object.fromEntries(['google', 'email', 'kakao', 'naver'].map(name => [name, { configured: true }])),
  firestore: { databaseId: '(default)', edition: 'STANDARD' },
});
const respond = value => async () => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

function fakeWindow() {
  const listeners = new Set();
  const popup = { closed: false, close() { this.closed = true; } };
  return {
    location: { origin: ORIGIN }, crypto: globalThis.crypto, popup, opened: [],
    open(url, name, features) { this.opened.push({ url, name, features }); return popup; },
    addEventListener(type, callback) { if (type === 'message') listeners.add(callback); },
    removeEventListener(type, callback) { if (type === 'message') listeners.delete(callback); },
    message(event) { for (const callback of listeners) callback(event); },
    listenerCount() { return listeners.size; },
  };
}

function fakeSdk(initialUser = null) {
  const auth = { currentUser: initialUser };
  let notify;
  const calls = [];
  const signedIn = (uid, email = '') => {
    auth.currentUser = {
      uid, email, displayName: '', emailVerified: false, providerData: [],
      stsTokenManager: { refreshToken: 'must-not-expose' },
    };
    notify?.(auth.currentUser);
    return { user: auth.currentUser };
  };
  return {
    calls, auth, getApps: () => [], initializeApp: (options, name) => ({ options, name }), getAuth: () => auth,
    browserLocalPersistence: {}, setPersistence: async () => {},
    onAuthStateChanged(_auth, callback) {
      notify = callback;
      queueMicrotask(() => callback(auth.currentUser));
      return () => { notify = undefined; };
    },
    GoogleAuthProvider: class { setCustomParameters(value) { this.parameters = value; } },
    signInWithPopup(_auth, provider) {
      calls.push(['google', provider.parameters]);
      return Promise.resolve(signedIn('google-user'));
    },
    signInWithCustomToken(_auth, token) {
      calls.push(['custom', token]);
      return Promise.resolve(signedIn('kakao:123'));
    },
    signInWithEmailAndPassword(_auth, email, password) {
      calls.push(['email', email, password]);
      return Promise.resolve(signedIn('email-user', email));
    },
    createUserWithEmailAndPassword(_auth, email) { return Promise.resolve(signedIn('new-user', email)); },
    sendEmailVerification: async () => {}, sendPasswordResetEmail: async () => {},
    async signOut() { auth.currentUser = null; notify?.(null); },
  };
}

async function clientFor({ sdk = fakeSdk(), windowRef = fakeWindow(), publicConfig = config(), ...options } = {}) {
  const client = createAuthClient({ apiBase: API, fetchImpl: respond(publicConfig), sdkLoader: async () => sdk, windowRef, ...options });
  await client.init();
  return { client, sdk, windowRef };
}

test('public configuration allowlist excludes private keys and disables incomplete Firebase configuration', () => {
  const input = config();
  input.firebase.privateKey = 'SECRET';
  input.firebase.clientSecret = 'SECRET';
  input.admin = { privateKey: 'SECRET' };
  const result = normalizeAuthConfig(input, ORIGIN);
  assert.equal(result.configured, true);
  assert.equal('privateKey' in result.firebase, false);
  assert.equal('clientSecret' in result.firebase, false);
  assert.equal('admin' in result, false);
  delete input.firebase.apiKey;
  const incomplete = normalizeAuthConfig(input, ORIGIN);
  assert.equal(incomplete.configured, false);
  assert.equal(incomplete.firebase, null);
  assert.ok(Object.values(incomplete.providers).every(provider => !provider.configured));
});

test('configuration rejects unsafe domains, database paths, and unknown editions', () => {
  for (const authDomain of ['https://example.com/path', 'example.com:123', 'user@example.com', 'localhost', 'x <script>.com']) {
    const input = config(); input.firebase.authDomain = authDomain;
    assert.throws(() => normalizeAuthConfig(input, ORIGIN), { code: 'configuration_error' });
  }
  for (const firestore of [{ databaseId: '../other' }, { edition: 'FAKE' }]) {
    const input = { ...config(), firestore };
    assert.throws(() => normalizeAuthConfig(input, ORIGIN), { code: 'configuration_error' });
  }
});

test('emulators only accept literal loopback page and service hosts', () => {
  const input = { ...config(), emulators: { auth: 'http://127.0.0.1:9099', firestore: { host: '127.0.0.1', port: 8080 } } };
  assert.throws(() => normalizeAuthConfig(input, ORIGIN), { code: 'configuration_error' });
  assert.deepEqual(normalizeAuthConfig(input, 'http://localhost:3000').emulators, input.emulators);
  for (const auth of ['http://localhost.evil.test:9099', 'https://127.0.0.1:9099', 'http://user:pass@localhost:9099', 'http://127.0.0.1:9099/path']) {
    assert.throws(() => normalizeAuthConfig({ ...input, emulators: { auth } }, 'http://localhost:3000'), { code: 'configuration_error' });
  }
  assert.throws(() => normalizeAuthConfig({ ...input, emulators: { firestore: { host: 'localhost.evil.test', port: 8080 } } }, 'http://localhost:3000'), { code: 'configuration_error' });
});

test('OAuth postMessage requires exact API origin, window source, type, provider, and nonce', () => {
  const popup = {};
  const expected = { apiOrigin: API, popup, provider: 'kakao', nonce: 'abc' };
  const event = { origin: API, source: popup, data: { type: 'bizhannun:oauth', provider: 'kakao', nonce: 'abc' } };
  assert.equal(matchesSocialMessage(event, expected), true);
  assert.equal(matchesSocialMessage({ ...event, origin: `${API}.evil.test` }, expected), false);
  assert.equal(matchesSocialMessage({ ...event, source: {} }, expected), false);
  for (const [key, value] of [['nonce', 'other'], ['provider', 'naver'], ['type', 'other']]) {
    assert.equal(matchesSocialMessage({ ...event, data: { ...event.data, [key]: value } }, expected), false);
  }
});

test('unconfigured app remains usable without importing the SDK and login is honestly gated', async () => {
  let sdkLoads = 0;
  const { client } = await clientFor({ publicConfig: { firebase: null }, sdkLoader: async () => { sdkLoads++; throw new Error('must not load'); } });
  assert.equal(client.getState().phase, 'unconfigured');
  assert.equal(client.getContext(), null);
  assert.equal(sdkLoads, 0);
  await assert.rejects(client.signIn('google'), { code: 'not_configured' });
  client.destroy();
});

test('initialization can retry deployment configuration without a page reload', async () => {
  let requests = 0, sdkLoads = 0;
  const sdk = fakeSdk();
  const client = createAuthClient({
    apiBase: API, windowRef: fakeWindow(),
    fetchImpl: async () => respond(++requests === 1 ? { firebase: null } : config())(),
    sdkLoader: async () => { sdkLoads++; return sdk; },
  });
  await client.init();
  assert.equal(client.getState().phase, 'unconfigured');
  assert.equal(sdkLoads, 0);
  await client.init();
  assert.equal(client.getState().phase, 'ready');
  assert.equal(client.getState().configured, true);
  assert.equal(sdkLoads, 1);
  await client.init();
  assert.equal(requests, 2);
  assert.equal(sdkLoads, 1);
  client.destroy();
});

test('configuration failures clear context and show safe errors without upstream secrets', async () => {
  const { client } = await clientFor({ fetchImpl: async () => { throw new Error('key=SECRET&email=private@example.com'); } });
  assert.equal(client.getState().phase, 'error');
  assert.equal(client.getContext(), null);
  assert.doesNotMatch(client.getState().error, /SECRET|private@/);
  client.destroy();
});

test('Google popup is invoked synchronously and state contains only a safe UID snapshot', async () => {
  const { client, sdk } = await clientFor();
  const pending = client.signIn('google');
  assert.deepEqual(sdk.calls[0], ['google', { prompt: 'select_account' }]);
  await pending;
  assert.equal(client.getState().user.uid, 'google-user');
  assert.equal('stsTokenManager' in client.getState().user, false);
  assert.doesNotMatch(JSON.stringify(client.getState().user), /must-not-expose/);
  await client.signOut();
  assert.equal(client.getState().user, null);
  client.destroy();
});

test('SNS tokens stay out of URLs and only exact bound callback is exchanged for Firebase sign-in', async () => {
  const { client, sdk, windowRef } = await clientFor();
  const pending = client.signIn('kakao');
  assert.equal(windowRef.opened.length, 1);
  const url = new URL(windowRef.opened[0].url);
  assert.equal(url.origin, API);
  assert.equal(url.pathname, '/api/auth');
  assert.equal(url.searchParams.get('returnOrigin'), ORIGIN);
  assert.equal(url.searchParams.get('provider'), 'kakao');
  assert.equal(url.searchParams.get('action'), 'start');
  const nonce = url.searchParams.get('nonce');
  assert.match(nonce, /^[a-f0-9]{64}$/);
  assert.equal(url.searchParams.has('token'), false);
  assert.equal(url.searchParams.has('customToken'), false);
  const token = `${'A'.repeat(30)}.${'B'.repeat(40)}.${'C'.repeat(30)}`;
  const data = { type: 'bizhannun:oauth', provider: 'kakao', nonce, customToken: token };
  windowRef.message({ origin: `${API}.evil.test`, source: windowRef.popup, data });
  windowRef.message({ origin: API, source: {}, data });
  assert.deepEqual(sdk.calls, []);
  windowRef.message({ origin: API, source: windowRef.popup, data });
  await pending;
  assert.deepEqual(sdk.calls, [['custom', token]]);
  assert.equal(client.getState().user.uid, 'kakao:123');
  assert.equal(windowRef.listenerCount(), 0);
  assert.equal(windowRef.popup.closed, true);
  client.destroy();
});

test('malformed SNS credentials and remote raw error messages are rejected safely', async () => {
  for (const payload of [{ customToken: 'not-a-jwt' }, { error: { code: 'unexpected', message: 'SECRET access_token=private' } }]) {
    const { client, sdk, windowRef } = await clientFor();
    const pending = client.signIn('naver');
    const nonce = new URL(windowRef.opened[0].url).searchParams.get('nonce');
    windowRef.message({ origin: API, source: windowRef.popup, data: { type: 'bizhannun:oauth', provider: 'naver', nonce, ...payload } });
    await assert.rejects(pending, error => !/SECRET|private/.test(error.message));
    assert.deepEqual(sdk.calls, []);
    assert.equal(windowRef.listenerCount(), 0);
    client.destroy();
  }
});

test('blocked popup, concurrent login, and client disposal leave no dangling SNS listener', async () => {
  const windowRef = fakeWindow(); windowRef.open = () => null;
  const blocked = await clientFor({ windowRef });
  await assert.rejects(blocked.client.signIn('kakao'), { code: 'auth/popup-blocked' });
  assert.equal(blocked.client.getState().phase, 'ready');
  blocked.client.destroy();
  const active = await clientFor();
  const pending = active.client.signIn('naver');
  await assert.rejects(active.client.signIn('google'), { code: 'auth_busy' });
  active.client.destroy();
  await assert.rejects(pending, { code: 'disposed' });
  assert.equal(active.windowRef.listenerCount(), 0);
  assert.deepEqual(active.sdk.calls, []);
});

test('signup validates input and preserves created account when verification mail fails', async () => {
  const sdk = fakeSdk();
  sdk.sendEmailVerification = async () => { throw new Error('smtp secret'); };
  const { client } = await clientFor({ sdk });
  await assert.rejects(client.signUpEmail('invalid', 'valid-pass-123'), { code: 'auth/invalid-email' });
  await assert.rejects(client.signUpEmail('user@example.com', 'short'), { code: 'auth/weak-password' });
  const result = await client.signUpEmail(' user@example.com ', 'valid-pass-123');
  assert.equal(result.user.uid, 'new-user');
  assert.equal(result.user.email, 'user@example.com');
  assert.equal(result.verificationSent, false);
  assert.equal(client.getState().user.uid, 'new-user');
  assert.equal('stsTokenManager' in result.user, false);
  assert.doesNotMatch(result.warning, /smtp|secret/);
  client.destroy();
});

test('password reset response does not reveal whether the email address has an account', async () => {
  const { client, sdk } = await clientFor();
  const existing = await client.resetPassword('exists@example.com');
  sdk.sendPasswordResetEmail = async () => { throw Object.assign(new Error('No such user'), { code: 'auth/user-not-found' }); };
  const absent = await client.resetPassword('absent@example.com');
  assert.deepEqual(absent, existing);
  client.destroy();
});

test('wrong credentials and unknown errors never disclose raw authentication details', () => {
  assert.equal(authErrorMessage({ code: 'auth/wrong-password' }), authErrorMessage({ code: 'auth/user-not-found' }));
  assert.doesNotMatch(authErrorMessage({ code: 'unknown', message: 'token=secret' }), /token|secret/);
});

test('Pages Firebase configuration initializes login without any API server request', async () => {
  const sdk = fakeSdk();
  const client = createAuthClient({ publicConfig: config(), sdkLoader: async () => sdk,
    windowRef: fakeWindow(), fetchImpl: () => { throw new Error('No API server permitted'); } });
  await client.init();
  await client.signIn('google');
  assert.equal(sdk.auth.currentUser.uid, 'google-user');
  client.destroy();
});
