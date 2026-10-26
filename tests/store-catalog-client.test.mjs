import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as nextTask } from 'node:timers/promises';
import { createStoreCatalogClient } from '../src/store-catalog-client.mjs';
import { fixture, MANIFEST_URL, row } from './store-catalog-fixtures.mjs';

class FakeWorker {
  constructor() { this.listeners = new Map(); this.messages = []; this.terminated = false; }
  addEventListener(type, callback) { (this.listeners.get(type) || this.listeners.set(type, new Set()).get(type)).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  postMessage(message) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  emit(type, data) { for (const callback of this.listeners.get(type) || []) callback({ data }); }
  searchMessage() { return this.messages.filter(message => message.type === 'search').at(-1); }
}

test('manifest loads once for metadata and searches, while the worker remains lazy', async () => {
  const source = fixture([[row('A', '커피')]]), worker = new FakeWorker();
  let workers = 0;
  const client = createStoreCatalogClient({ manifestUrl: MANIFEST_URL, fetchImpl: source.fetchImpl,
    workerFactory: (url, options) => { workers++; assert.equal(options.type, 'module'); assert.match(url, /store-catalog-worker\.mjs$/); return worker; } });
  const [a, b] = await Promise.all([client.loadManifest(), client.loadManifest()]);
  assert.equal(a, b);
  assert.equal(Object.isFrozen(a), true);
  assert.equal(source.calls.length, 1);
  assert.equal(source.calls[0].options.cache, 'no-cache');
  assert.equal(workers, 0);
  const pending = client.search('커피', { regionCode: '11', limit: 12 });
  await nextTask();
  const message = worker.searchMessage();
  assert.equal(workers, 1);
  assert.equal(message.manifestUrl, MANIFEST_URL);
  assert.equal(message.manifest.acceptedCount, 1);
  assert.equal(message.regionCode, '11');
  assert.equal(message.limit, 12);
  const final = { results: [], total: 0, complete: true, finished: true, status: 'complete' };
  worker.emit('message', { type: 'result', id: message.id, result: final });
  assert.deepEqual(await pending, final);
  assert.equal(source.calls.length, 1);
  client.close(); assert.equal(worker.terminated, true);
});

test('a new query rejects its predecessor and ignores stale progress, errors and results', async () => {
  const source = fixture([[row('A', '커피')]]), worker = new FakeWorker();
  const client = createStoreCatalogClient({ manifestUrl: MANIFEST_URL, fetchImpl: source.fetchImpl, workerFactory: () => worker });
  const oldProgress = [], newProgress = [];
  const old = client.search('커피', { onProgress: value => oldProgress.push(value) });
  const oldRejected = assert.rejects(old, { name: 'AbortError' });
  await nextTask();
  const oldId = worker.searchMessage().id;
  const latest = client.search('상가', { onProgress: value => newProgress.push(value) });
  await nextTask();
  const id = worker.searchMessage().id;
  assert.notEqual(id, oldId);
  worker.emit('message', { type: 'progress', id: oldId, result: { foundCount: 10 } });
  worker.emit('message', { type: 'result', id: oldId, result: { total: 10 } });
  worker.emit('message', { type: 'error', id: oldId, error: { code: 'bad', message: 'stale' } });
  worker.emit('message', { type: 'progress', id, result: { total: null, foundCount: 2, complete: false } });
  worker.emit('message', { type: 'result', id, result: { total: 2, complete: true } });
  await oldRejected;
  assert.deepEqual(await latest, { total: 2, complete: true });
  assert.equal(oldProgress.length, 0);
  assert.equal(newProgress.length, 1);
  assert.ok(worker.messages.some(message => message.type === 'cancel'));
  client.close();
});

test('cancel during manifest loading never starts a stale worker search', async () => {
  const source = fixture([[row('A', '커피')]]);
  let finish, workerCount = 0;
  const client = createStoreCatalogClient({ manifestUrl: MANIFEST_URL,
    fetchImpl: () => new Promise(resolve => { finish = () => resolve(new Response(JSON.stringify(source.manifest))); }),
    workerFactory: () => { workerCount++; return new FakeWorker(); } });
  const search = client.search('커피');
  const rejected = assert.rejects(search, { name: 'AbortError' });
  await nextTask(); client.cancel(); finish();
  await rejected; await nextTask();
  assert.equal(workerCount, 0);
  assert.equal((await client.loadManifest()).acceptedCount, 1);
  client.close();
});

test('partial worker coverage resolves explicitly and UI callback failures do not corrupt a query', async () => {
  const source = fixture([[row('A', '커피')]]), worker = new FakeWorker();
  const client = createStoreCatalogClient({ manifestUrl: MANIFEST_URL, fetchImpl: source.fetchImpl, workerFactory: () => worker });
  const search = client.search('커피', { onProgress() { throw new Error('UI unavailable'); } });
  await nextTask();
  const id = worker.searchMessage().id;
  worker.emit('message', { type: 'progress', id, result: { total: null } });
  const partial = { total: null, foundCount: 1, complete: false, finished: true, status: 'partial', failures: [{ regionCode: '26' }] };
  worker.emit('message', { type: 'result', id, result: partial });
  assert.deepEqual(await search, partial);
  client.close();
});

test('worker faults reject the active query, release the worker, and allow a clean retry', async () => {
  const source = fixture([[row('A', '커피')]]), workers = [];
  const client = createStoreCatalogClient({ manifestUrl: MANIFEST_URL, fetchImpl: source.fetchImpl,
    workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; } });
  const first = client.search('커피');
  const rejected = assert.rejects(first, { code: 'worker_failed' });
  await nextTask(); workers[0].emit('error'); await rejected;
  assert.equal(workers[0].terminated, true);
  const next = client.search('커피');
  await nextTask();
  const id = workers[1].searchMessage().id;
  workers[1].emit('message', { type: 'result', id, result: { total: 1, complete: true } });
  assert.equal((await next).total, 1);
  assert.equal(source.calls.length, 1);
  client.close();
});

test('unpublished or malformed manifests are retryable failures, never an empty successful catalog', async () => {
  const source = fixture([[row('A', '커피')]]);
  let attempts = 0;
  const client = createStoreCatalogClient({ manifestUrl: MANIFEST_URL, fetchImpl: async () => {
    attempts++;
    if (attempts === 1) return new Response('not found', { status: 404 });
    if (attempts === 2) return new Response('{bad');
    return new Response(JSON.stringify(source.manifest));
  } });
  await assert.rejects(client.loadManifest(), { code: 'manifest_http_error' });
  await assert.rejects(client.loadManifest(), { code: 'invalid_manifest' });
  assert.equal((await client.loadManifest()).acceptedCount, 1);
  assert.equal(attempts, 3);
  client.close();
});

test('the worker URL inherits the deployed module version', async () => {
  const { createStoreCatalogClient: versionedClient } = await import('../src/store-catalog-client.mjs?v=release-test');
  const source = fixture([[row('A', '커피')]]), worker = new FakeWorker();
  let requestedUrl;
  const client = versionedClient({ manifestUrl: MANIFEST_URL, fetchImpl: source.fetchImpl,
    workerFactory: url => { requestedUrl = url; return worker; } });
  const pending = client.search('커피');
  const canceled = assert.rejects(pending, { name: 'AbortError' });
  await nextTask();
  assert.ok(requestedUrl.endsWith('store-catalog-worker.mjs?v=release-test'));
  client.close(); await canceled;
  await assert.rejects(client.loadManifest(), { code: 'closed' });
  await assert.rejects(client.search('커피'), { code: 'closed' });
});

test('a synchronous transport error does not poison future manifest retries', async () => {
  const source = fixture([[row('A', '커피')]]);
  let attempts = 0;
  const client = createStoreCatalogClient({ manifestUrl: MANIFEST_URL, fetchImpl: () => {
    if (++attempts === 1) throw new Error('transport not ready');
    return new Response(JSON.stringify(source.manifest));
  } });
  await assert.rejects(client.loadManifest(), { code: 'manifest_fetch_failed' });
  assert.equal((await client.loadManifest()).acceptedCount, 1);
  assert.equal(attempts, 2);
  client.close();
});

test('explicit refresh cancels the active search and replaces only a validated manifest', async () => {
  const source = fixture([[row('A', '커피')]]), worker = new FakeWorker();
  const replacement = { ...source.manifest, version: 'refreshed-source' };
  let attempts = 0;
  const client = createStoreCatalogClient({ manifestUrl: MANIFEST_URL,
    fetchImpl: async () => new Response(JSON.stringify(++attempts === 1 ? source.manifest : replacement)),
    workerFactory: () => worker });
  const original = await client.loadManifest();
  const search = client.search('커피');
  const canceled = assert.rejects(search, { name: 'AbortError' });
  await nextTask();
  const oldId = worker.searchMessage().id;
  const refreshed = await client.loadManifest({ force: true });
  await canceled;
  assert.equal(original.version, source.manifest.version);
  assert.equal(refreshed.version, 'refreshed-source');
  assert.equal(attempts, 2);
  worker.emit('message', { type: 'result', id: oldId, result: { total: 999, complete: true } });
  assert.equal((await client.loadManifest()).version, 'refreshed-source');
  assert.equal(attempts, 2);
  client.close();
});

test('a search during refresh waits for that same request, and refreshes coalesce', async () => {
  const source = fixture([[row('A', '커피')]]), worker = new FakeWorker();
  let attempts = 0, release;
  const client = createStoreCatalogClient({ manifestUrl: MANIFEST_URL, fetchImpl: () => {
    if (++attempts === 1) return new Response(JSON.stringify(source.manifest));
    return new Promise(resolve => { release = () => resolve(new Response(JSON.stringify({ ...source.manifest, version: 'fresh' }))); });
  }, workerFactory: () => worker });
  await client.loadManifest();
  const first = client.loadManifest({ force: true });
  const second = client.loadManifest({ force: true });
  await nextTask();
  const query = client.search('커피');
  await nextTask();
  assert.equal(worker.searchMessage(), undefined);
  assert.equal(attempts, 2);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b);
  await nextTask();
  const sent = worker.searchMessage();
  assert.equal(sent.manifest.version, 'fresh');
  worker.emit('message', { type: 'result', id: sent.id, result: { total: 1, complete: true } });
  assert.equal((await query).total, 1);
  client.close();
});

test('failed explicit refresh reports failure while preserving the last verified snapshot', async () => {
  const source = fixture([[row('A', '커피')]]);
  let attempts = 0;
  const client = createStoreCatalogClient({ manifestUrl: MANIFEST_URL,
    fetchImpl: async () => ++attempts === 1 ? new Response(JSON.stringify(source.manifest))
      : new Response(JSON.stringify({ ...source.manifest, acceptedCount: 999 })) });
  const first = await client.loadManifest();
  await assert.rejects(client.loadManifest({ force: true }), { code: 'invalid_manifest' });
  assert.equal(await client.loadManifest(), first);
  assert.equal(attempts, 2);
  client.close();
});
