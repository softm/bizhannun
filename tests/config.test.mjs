import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { getPublicConfig, handlePublicConfig } from '../server/config.mjs';

const firebase = { apiKey: 'public-web-api-key', authDomain: 'biz-hannun.firebaseapp.com', projectId: 'biz-hannun', appId: '1:123:web:456', messagingSenderId: '123' };
const readConfig = (data) => ({ readFile: async () => JSON.stringify(data) });
const configured = readConfig({ firebase, providers: { google: { configured: true }, email: { configured: true } }, firestore: { databaseId: 'bizhannun', edition: 'ENTERPRISE' } });
const request = (origin = 'https://softm.github.io', method = 'GET') => new Request('https://bizhannun.vercel.app/api/config', { method, headers: origin ? { Origin: origin } : {} });

test('public config explicitly allowlists fields and never leaks environment secrets', async () => {
  const env = { NTS_SERVICE_KEY: 'secret-nts', FTC_SERVICE_KEY: 'secret-ftc', AUTH_SESSION_SECRET: 'secret-session', FIREBASE_PRIVATE_KEY: 'secret-admin', KAKAO_CLIENT_SECRET: 'secret-kakao', FIREBASE_WEB_CONFIG: JSON.stringify({ ...firebase, private_key: 'secret-in-json', arbitrary: 'secret-nested' }) };
  const response = await handlePublicConfig(request(), env, configured);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.firebase, firebase);
  assert.equal(payload.configured, true);
  assert.equal(payload.providers.google.configured, true);
  assert.equal(payload.providers.email.configured, true);
  assert.equal(payload.providers.kakao.configured, false);
  assert.doesNotMatch(JSON.stringify(payload), /secret-|private_key|arbitrary/);
});

test('missing fallback file gives an honest unconfigured response', async () => {
  const deps = { readFile: async () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } };
  const response = await handlePublicConfig(request(), {}, deps);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.configured, false);
  assert.equal(payload.firebase, null);
  assert.equal(payload.providers.google.configured, false);
});

test('invalid JSON is a safe configuration error without echoing input', async () => {
  for (const env of [{ FIREBASE_WEB_CONFIG: '{private-secret-broken-json' }, { FIREBASE_WEB_CONFIG: '[]' }]) {
    const response = await handlePublicConfig(request(), env, configured);
    assert.equal(response.status, 503);
    const text = await response.text();
    assert.match(text, /configuration_error/);
    assert.doesNotMatch(text, /private-secret/);
  }
});

test('CORS allows exact configured origins and blocks lookalikes', async () => {
  for (const origin of ['https://evil.example', 'https://softm.github.io.evil.example', 'https://softm.github.io/', 'null', 'http://localhost:4444']) {
    const response = await handlePublicConfig(request(origin), {}, configured);
    assert.equal(response.status, 403);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  }
  for (const origin of ['https://softm.github.io', 'https://bizhannun.vercel.app']) {
    assert.equal((await handlePublicConfig(request(origin), {}, configured)).headers.get('access-control-allow-origin'), origin);
  }
  assert.equal((await handlePublicConfig(request('http://localhost:4444'), { ALLOWED_ORIGINS: 'http://localhost:4444' }, configured)).status, 200);
});

test('preflight is limited to GET/OPTIONS without credentials', async () => {
  const response = await handlePublicConfig(request(undefined, 'OPTIONS'), {}, configured);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  assert.equal((await handlePublicConfig(request(undefined, 'POST'), {}, configured)).status, 405);
});

test('provider flags are opt-in and explicit env overrides are validated', async () => {
  assert.equal((await getPublicConfig({}, readConfig({ firebase }))).providers.google.configured, false);
  const payload = await getPublicConfig({ FIREBASE_GOOGLE_ENABLED: 'false', FIREBASE_EMAIL_ENABLED: 'true' }, configured);
  assert.equal(payload.providers.google.configured, false);
  assert.equal(payload.providers.email.configured, true);
  assert.equal((await handlePublicConfig(request(), { FIREBASE_GOOGLE_ENABLED: 'maybe' }, configured)).status, 503);
});

test('named Enterprise database configuration is exposed and validated', async () => {
  assert.deepEqual((await getPublicConfig({}, configured)).firestore, { databaseId: 'bizhannun', edition: 'ENTERPRISE' });
  assert.deepEqual((await getPublicConfig({ FIRESTORE_DATABASE_ID: '(default)', FIRESTORE_EDITION: 'STANDARD' }, configured)).firestore, { databaseId: '(default)', edition: 'STANDARD' });
  assert.equal((await handlePublicConfig(request(), { FIRESTORE_DATABASE_ID: '../private' }, configured)).status, 503);
});

test('SNS availability requires Admin credentials for the same web project', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const env = { AUTH_SESSION_SECRET: 'fixture-secret-32-characters-or-more', KAKAO_CLIENT_ID: 'fixture', KAKAO_CLIENT_SECRET: 'fixture', FIREBASE_PROJECT_ID: 'biz-hannun', FIREBASE_CLIENT_EMAIL: 'fixture@biz-hannun.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: privateKey };
  assert.equal((await getPublicConfig(env, configured)).providers.kakao.configured, true);
  assert.equal((await getPublicConfig({ ...env, FIREBASE_PROJECT_ID: 'other-project' }, configured)).providers.kakao.configured, false);
});

test('invalid fallback content is never published or silently accepted', async () => {
  const response = await handlePublicConfig(request(), {}, { readFile: async () => '{private-config-file-error' });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private-config-file-error/);
});
