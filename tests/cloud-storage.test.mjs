import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudWorkspace, mergeGuestWorkspace, splitCloudText, CLOUD_LIMITS } from '../src/cloud-storage.mjs';
import { emptyWorkspace, validateBackup } from '../src/storage.mjs';

const NOW = '2026-10-20T12:00:00.000Z';
const tick = () => new Promise(resolve => setImmediate(resolve));
function number(index = 0) {
  const first = String(100000000 + index);
  const digits = [...first].map(Number), weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  const sum = digits.reduce((total, digit, i) => total + digit * weights[i], 0) + Math.floor(digits[8] * 5 / 10);
  return first + ((10 - (sum % 10)) % 10);
}
function snapshot(index = 0, status = 'active') {
  return { businessNumber: number(index), outcome: 'ok', businessStatus: status, statusLabel: '계속사업자', taxType: '일반과세자', closedAt: null, checkedAt: NOW, source: { name: '국세청', url: 'https://www.data.go.kr/' } };
}
function partner(index = 0) {
  const last = snapshot(index);
  return { id: `p${index}`, businessNumber: number(index), name: `합성 거래처 ${index}`, note: '비공개 메모', tags: ['확인필요'], createdAt: NOW, updatedAt: NOW, history: [last], lastCheck: last, lastSuccess: last };
}
function example(count = 2) {
  return { ...emptyWorkspace(), partners: Array.from({ length: count }, (_, i) => partner(i)),
    profile: { name: '합성 사업', businessNumber: number(), region: '서울', businessKind: '개인사업자', employees: 0, interests: ['금융'] },
    events: [{ id: 'event1', partnerId: 'p0', businessNumber: number(), type: 'business_status_changed', from: 'suspended', to: 'active', source: '국세청', occurredAt: NOW, title: '상태 변경', message: '확인', acknowledgedAt: NOW }],
    checks: [{ id: 'check1', total: count, ok: count, failed: 0, checkedAt: NOW }],
    preferences: { apiBase: 'https://example.com' } };
}
class Stamp { constructor(ms = Date.parse(NOW)) { this.ms = ms; } toDate() { return new Date(this.ms); } }
function copy(value) {
  if (value instanceof Stamp) return new Stamp(value.ms);
  if (Array.isArray(value)) return value.map(copy);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]));
  return value;
}
function server() {
  const docs = new Map(), listeners = new Map(), batches = [], hooks = {};
  const db = {};
  const document = path => ({ exists: () => docs.has(path), data: () => copy(docs.get(path)), metadata: { fromCache: false, hasPendingWrites: false } });
  function resolve(value) {
    if (value?.__serverTimestamp) return new Stamp();
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolve(item)]));
    return value;
  }
  function notify(path) { for (const callback of listeners.get(path) || []) queueMicrotask(() => callback(document(path))); }
  function commit(writes) {
    for (const [type, reference, value] of writes) {
      if (type === 'delete') docs.delete(reference.path);
      else docs.set(reference.path, resolve(copy(value)));
      notify(reference.path);
    }
  }
  let lock = Promise.resolve();
  const sdk = {
    getFirestore: (_app, id) => { hooks.databaseId = id; return db; },
    doc: (_db, ...segments) => ({ path: segments.join('/') }),
    serverTimestamp: () => ({ __serverTimestamp: true }),
    getDocFromServer: async reference => { await hooks.beforeRead?.(reference); return document(reference.path); },
    writeBatch: () => {
      const writes = [];
      return { set: (reference, value) => writes.push(['set', reference, value]), delete: reference => writes.push(['delete', reference]),
        commit: async () => { batches.push(copy(writes)); await hooks.beforeBatch?.(writes); commit(writes); } };
    },
    runTransaction: async (_db, callback) => {
      await hooks.beforeTransaction?.();
      let release;
      const previous = lock; lock = new Promise(resolve => { release = resolve; });
      await previous;
      try {
        const writes = [];
        await callback({ get: async reference => document(reference.path), set: (reference, value) => writes.push(['set', reference, value]) });
        await hooks.beforePublish?.();
        commit(writes);
        await hooks.afterPublish?.();
      } finally { release(); }
    },
    onSnapshot: (reference, _options, callback) => {
      if (!listeners.has(reference.path)) listeners.set(reference.path, new Set());
      listeners.get(reference.path).add(callback);
      queueMicrotask(() => callback(document(reference.path)));
      return () => listeners.get(reference.path).delete(callback);
    },
  };
  function client(uid = 'alice', options = {}) {
    const auth = { currentUser: { uid } }, events = [], statuses = [];
    return { auth, events, statuses, cloud: createCloudWorkspace({ sdk, app: {}, auth, config: { firestore: { databaseId: 'bizhannun' } }, onStatus: value => statuses.push(value), onRemoteChange: value => events.push(value), ...options }) };
  }
  return { sdk, docs, hooks, batches, client, notify };
}
const headPath = 'users/alice/bizhannunWorkspace/main';

test('full business workspace survives another client, without local API preferences', async () => {
  const env = server(), first = env.client();
  const saved = await first.cloud.save('alice', example());
  const second = env.client(), loaded = await second.cloud.load('alice');
  assert.deepEqual(loaded, saved);
  assert.equal(loaded.revision, 1); assert.deepEqual(loaded.preferences, {});
  assert.equal(loaded.partners[0].lastCheck.businessStatus, 'active');
  assert.equal(loaded.profile.employees, 0); assert.equal(loaded.events[0].acknowledgedAt, NOW);
  assert.equal(env.hooks.databaseId, 'bizhannun');
});

test('memo edits replace only that entity, preserving unchanged references', async () => {
  const env = server(), { cloud } = env.client();
  let saved = await cloud.save('alice', example());
  await tick(); const before = env.batches.length;
  saved = structuredClone(saved); saved.partners[0].note = '수정 메모';
  const next = await cloud.save('alice', saved);
  await tick();
  const additions = env.batches.slice(before).flat().filter(([type]) => type === 'set');
  assert.equal(additions.filter(([, , data]) => data.kind === 'partner').length, 1);
  assert.equal(additions.filter(([, , data]) => data.kind === 'manifest').length, 1);
  assert.deepEqual(await env.client().cloud.load('alice'), next);
});

test('a stale device cannot overwrite a newer revision', async () => {
  const env = server(), first = env.client(), second = env.client();
  const saved = await first.cloud.save('alice', example());
  const stale = await second.cloud.load('alice');
  saved.partners[0].note = '첫 기기';
  await first.cloud.save('alice', saved);
  stale.partners[0].note = '오래된 기기';
  await assert.rejects(second.cloud.save('alice', stale), { code: 'cloud/conflict' });
  assert.equal((await second.cloud.load('alice')).partners[0].note, '첫 기기');
});

test('a failed fragment upload leaves the old published workspace intact', async () => {
  const env = server(), { cloud } = env.client();
  const saved = await cloud.save('alice', example());
  await tick(); const old = copy(env.docs.get(headPath));
  env.hooks.beforeBatch = writes => { if (writes.some(([kind]) => kind === 'set')) throw Object.assign(new Error('offline'), { code: 'unavailable' }); };
  saved.partners[0].note = '아직 저장 안 됨';
  await assert.rejects(cloud.save('alice', saved), { code: 'cloud/offline' });
  assert.deepEqual(env.docs.get(headPath), old);
});

test('changing accounts during upload prevents publication and cross-user data', async () => {
  const env = server(), { cloud, auth } = env.client();
  env.hooks.beforeBatch = () => { auth.currentUser = { uid: 'bob' }; };
  await assert.rejects(cloud.save('alice', example()), { code: 'cloud/account-changed' });
  assert.equal(env.docs.has(headPath), false);
  assert.equal([...env.docs.keys()].some(key => key.startsWith('users/bob/')), false);
});

test('missing or tampered immutable fragments fail integrity validation', async () => {
  const env = server();
  await env.client().cloud.save('alice', example());
  const [path, body] = [...env.docs].find(([, value]) => value.kind === 'partner');
  env.docs.set(path, { ...body, body: body.body.replace('비공개', '변조됨') });
  await assert.rejects(env.client().cloud.load('alice'), { code: 'cloud/invalid-data' });
  env.docs.delete(path);
  await assert.rejects(env.client().cloud.load('alice'), { code: 'cloud/invalid-data' });
});

test('realtime watcher ignores its own pending save and reports remote commits', async () => {
  const env = server(), first = env.client();
  await first.cloud.load('alice'); first.cloud.watch('alice'); await tick();
  const saved = await first.cloud.save('alice', example()); await tick();
  assert.equal(first.events.length, 0);
  const second = env.client(); await second.cloud.load('alice');
  saved.partners[0].note = '원격 수정'; await second.cloud.save('alice', saved); await tick();
  assert.equal(first.events.length, 1); assert.equal(first.events[0].revision, 2);
  first.cloud.dispose();
});

test('a history larger than one MiB is split and restored without losing entries', async () => {
  const env = server(), workspace = example(1);
  workspace.partners[0].history = Array.from({ length: 50 }, (_, i) => ({ ...snapshot(), id: 'x'.repeat(60000) + i }));
  assert.ok(Buffer.byteLength(JSON.stringify(workspace.partners[0])) > 1024 * 1024);
  const saved = await env.client().cloud.save('alice', workspace);
  assert.deepEqual(await env.client().cloud.load('alice'), saved);
  for (const value of env.docs.values()) if (value.body) assert.ok(Buffer.byteLength(value.body) <= CLOUD_LIMITS.chunkBytes);
});

test('UTF-8 fragments preserve Korean and emoji boundaries', () => {
  const input = '가😀abc나다🧪'.repeat(100);
  const chunks = splitCloudText(input, 17);
  assert.equal(chunks.join(''), input);
  for (const chunk of chunks) { assert.ok(Buffer.byteLength(chunk) <= 17); assert.equal(Buffer.from(chunk).toString(), chunk); }
});

test('guest merge keeps cloud duplicates and remaps colliding partner IDs and events', () => {
  const cloud = example(1); cloud.revision = 7; cloud.partners[0].note = '클라우드 메모';
  const guest = example(2); guest.partners[0].note = '기기 메모';
  guest.partners[0].id = 'duplicate'; guest.partners[1].id = 'p0';
  guest.events[0] = { ...guest.events[0], partnerId: 'p0', businessNumber: number(1), id: 'new-event' };
  const result = mergeGuestWorkspace(cloud, guest);
  assert.equal(result.addedPartners, 1); assert.equal(result.duplicatePartners, 1);
  assert.equal(result.workspace.revision, 7); assert.equal(result.workspace.partners[0].note, '클라우드 메모');
  assert.notEqual(result.workspace.partners[1].id, 'p0');
  assert.equal(result.workspace.events[1].partnerId, result.workspace.partners[1].id);
  assert.deepEqual(validateBackup(result.workspace).profile, validateBackup(cloud).profile);
  assert.equal(guest.partners[1].id, 'p0');
});

test('a different uid and a disposed adapter cannot operate', async () => {
  const { cloud } = server().client();
  await assert.rejects(cloud.load('bob'), { code: 'cloud/account-changed' });
  cloud.dispose();
  await assert.rejects(cloud.save('alice', example()), { code: 'cloud/account-changed' });
});

test('1,000 partners are uploaded in bounded batches and published once', async () => {
  const env = server(), input = example(1000);
  const saved = await env.client().cloud.save('alice', input);
  assert.equal(saved.partners.length, 1000); assert.equal(saved.revision, 1);
  assert.ok(env.batches.length > 1);
  for (const batch of env.batches) assert.ok(batch.length <= CLOUD_LIMITS.batchWrites);
  assert.deepEqual(await env.client().cloud.load('alice'), saved);
});

test('a timed-out transaction retains fragments so a late commit can be reloaded', async () => {
  const env = server(), { cloud } = env.client('alice', { timeoutMs: 30 });
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  env.hooks.beforePublish = () => barrier;
  await assert.rejects(cloud.save('alice', example()), { code: 'cloud/timeout' });
  assert.equal(env.docs.has(headPath), false);
  assert.ok([...env.docs.values()].some(value => value.kind === 'manifest'));
  release(); await tick();
  const loaded = await env.client().cloud.load('alice');
  assert.equal(loaded.revision, 1); assert.equal(loaded.partners.length, 2);
});
