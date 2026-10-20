import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCloudWorkspace } from '../src/cloud-storage.mjs';
import { emptyWorkspace } from '../src/storage.mjs';

const NOW = '2026-10-20T12:00:00.000Z';
const uid = 'alice';
const freshId = () => crypto.randomUUID().replaceAll('-', '');
test('Firestore emulator: owner storage, cross-user isolation, schema and optimistic revision controls', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
  const { initializeTestEnvironment, assertFails, assertSucceeds } = await import('@firebase/rules-unit-testing');
  const sdk = await import('firebase/firestore');
  sdk.setLogLevel('silent');
  const env = await initializeTestEnvironment({ projectId: 'demo-bizhannun-rules', firestore: { rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
  t.after(() => env.cleanup());
  const alice = env.authenticatedContext(uid).firestore();
  const bob = env.authenticatedContext('bob').firestore();
  const anonymous = env.unauthenticatedContext().firestore();
  const ref = (db, kind, id) => sdk.doc(db, 'users', uid, kind, id);
  const head = db => ref(db, 'bizhannunWorkspace', 'main');
  const createCloud = () => createCloudWorkspace({ sdk: { ...sdk, getFirestore: () => alice }, app: {}, auth: { currentUser: { uid } }, config: { firestore: { databaseId: 'bizhannun' } } });
  const fragment = (objectId, changes = {}) => ({ ownerUid: uid, format: 1, kind: 'partner', objectId, part: 0, parts: 1, body: '{}', createdAt: sdk.serverTimestamp(), ...changes });
  let ownerCloud, latest, savedObjectPath;

  await t.test('the first profile save succeeds while its empty workspace is watched', async () => {
    const profileUid = 'first-profile-save';
    const database = env.authenticatedContext(profileUid).firestore();
    const changes = [];
    let ready;
    const listening = new Promise(resolve => { ready = resolve; });
    const cloud = createCloudWorkspace({ sdk: { ...sdk, getFirestore: () => database,
      onSnapshot: (reference, options, next, error) => sdk.onSnapshot(reference, options, snapshot => {
        if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) ready();
        next(snapshot);
      }, error),
    }, app: {}, auth: { currentUser: { uid: profileUid } }, onRemoteChange: change => changes.push(change) });
    try {
      const workspace = await cloud.load(profileUid);
      cloud.watch(profileUid); await listening;
      const saved = await cloud.save(profileUid, { ...workspace, profile: { name: '저장 연결 확인용 · 테스트' } });
      assert.equal(saved.revision, 1);
      assert.equal(saved.profile.name, '저장 연결 확인용 · 테스트');
      assert.equal(changes.length, 0);
      const reloaded = await cloud.load(profileUid);
      assert.equal(reloaded.revision, 1);
      assert.equal(reloaded.profile.name, saved.profile.name);
    } finally { cloud.dispose(); }
  });

  await t.test('owner can store, modify, reload and remove records with the real modular SDK', async () => {
    ownerCloud = createCloud();
    const snapshot = { businessNumber: '1000000009', outcome: 'ok', businessStatus: 'active', statusLabel: '계속사업자', taxType: '일반과세자', closedAt: null, checkedAt: NOW, source: '국세청' };
    const input = { ...emptyWorkspace(), partners: [{ id: 'synthetic-partner', businessNumber: snapshot.businessNumber, name: '합성 테스트 거래처', tags: ['확인'], note: '소유자 메모', history: [snapshot], lastCheck: snapshot, createdAt: NOW, updatedAt: NOW }], profile: { name: '합성 사업', employees: 0 } };
    latest = await ownerCloud.save(uid, input);
    assert.equal(latest.revision, 1);
    const second = createCloud(), stale = await second.load(uid);
    assert.deepEqual(stale, latest);
    latest.partners[0].note = '수정 후 보관';
    latest = await ownerCloud.save(uid, latest);
    assert.equal((await createCloud().load(uid)).partners[0].note, '수정 후 보관');
    await assert.rejects(second.save(uid, stale), { code: 'cloud/conflict' });
    latest = await ownerCloud.save(uid, { ...latest, partners: [] });
    assert.equal((await createCloud().load(uid)).partners.length, 0);
    const objectId = freshId(); savedObjectPath = `${objectId}-0`;
    await assertSucceeds(sdk.setDoc(ref(alice, 'bizhannunObjects', savedObjectPath), fragment(objectId)));
    const deletionId = freshId();
    await assertSucceeds(sdk.setDoc(ref(alice, 'bizhannunObjects', `${deletionId}-0`), fragment(deletionId)));
    await assertSucceeds(sdk.deleteDoc(ref(alice, 'bizhannunObjects', `${deletionId}-0`)));
    await assertSucceeds(sdk.getDocs(sdk.collection(alice, 'users', uid, 'bizhannunObjects')));
    ownerCloud.dispose(); second.dispose();
  });

  await t.test('anonymous clients cannot read, list, create or delete private data', async () => {
    await assertFails(sdk.getDoc(head(anonymous)));
    await assertFails(sdk.getDoc(ref(anonymous, 'bizhannunObjects', savedObjectPath)));
    await assertFails(sdk.getDocs(sdk.collection(anonymous, 'users', uid, 'bizhannunObjects')));
    const id = freshId();
    await assertFails(sdk.setDoc(ref(anonymous, 'bizhannunObjects', `${id}-0`), fragment(id)));
    await assertFails(sdk.deleteDoc(ref(anonymous, 'bizhannunObjects', savedObjectPath)));
  });

  await t.test('another authenticated account cannot read, list, write or delete owner records', async () => {
    await assertFails(sdk.getDoc(head(bob)));
    await assertFails(sdk.getDoc(ref(bob, 'bizhannunObjects', savedObjectPath)));
    await assertFails(sdk.getDocs(sdk.collection(bob, 'users', uid, 'bizhannunObjects')));
    const id = freshId();
    await assertFails(sdk.setDoc(ref(bob, 'bizhannunObjects', `${id}-0`), fragment(id)));
    await assertFails(sdk.deleteDoc(ref(bob, 'bizhannunObjects', savedObjectPath)));
    await assertFails(sdk.getDocs(sdk.collectionGroup(bob, 'bizhannunObjects')));
    await assertFails(sdk.getDocs(sdk.collection(alice, 'users')));
  });

  await t.test('fragments require matching owner, id, type, size, timestamp and exact schema', async () => {
    const invalid = [
      { ownerUid: 'bob' }, { format: 2 }, { kind: 'admin' }, { objectId: 'invalid' },
      { part: 1 }, { part: -1 }, { parts: 513 }, { parts: 1.5 },
      { body: '' }, { body: 'x'.repeat(180001) }, { body: {} },
      { createdAt: new Date(0) }, { isAdmin: true },
    ];
    for (const changes of invalid) {
      const id = freshId(); await assertFails(sdk.setDoc(ref(alice, 'bizhannunObjects', `${id}-0`), fragment(id, changes)));
    }
    const missingId = freshId(), missing = fragment(missingId); delete missing.body;
    await assertFails(sdk.setDoc(ref(alice, 'bizhannunObjects', `${missingId}-0`), missing));
    const pathId = freshId();
    await assertFails(sdk.setDoc(ref(alice, 'bizhannunObjects', `${pathId}-1`), fragment(pathId)));
    const manifestId = freshId();
    await assertFails(sdk.setDoc(ref(alice, 'bizhannunManifests', `${manifestId}-0`), fragment(manifestId)));
  });

  await t.test('existing fragments cannot be modified to bypass create validation', async () => {
    const target = ref(alice, 'bizhannunObjects', savedObjectPath);
    await assertFails(sdk.updateDoc(target, { body: 'changed' }));
    await assertFails(sdk.updateDoc(target, { ownerUid: 'bob' }));
    await assertFails(sdk.updateDoc(target, { isAdmin: true }));
    await assertFails(sdk.updateDoc(target, { createdAt: sdk.serverTimestamp() }));
  });

  await t.test('head cannot reset revision, hijack ownership, reference another path or be deleted', async () => {
    const current = (await sdk.getDoc(head(alice))).data();
    const generation = freshId();
    await assertSucceeds(sdk.setDoc(ref(alice, 'bizhannunManifests', `${generation}-0`), fragment(generation, { kind: 'manifest' })));
    const next = { ...current, revision: current.revision + 1, generation, manifestParts: 1, updatedAt: sdk.serverTimestamp() };
    for (const changes of [
      { revision: 1 }, { revision: current.revision }, { revision: current.revision + 2 }, { revision: 1.5 },
      { ownerUid: 'bob' }, { generation: current.generation }, { generation: '../bob' },
      { format: 2 }, { schemaVersion: 2 }, { partnerCount: 1001 }, { eventCount: -1 }, { checkCount: 101 },
      { manifestParts: 33 }, { manifestBytes: 0 }, { manifestDigest: 'bad' },
      { updatedAt: new Date(0) }, { isAdmin: true },
    ]) await assertFails(sdk.setDoc(head(alice), { ...next, ...changes }));
    const missing = { ...next }; delete missing.ownerUid;
    await assertFails(sdk.setDoc(head(alice), missing));
    await assertFails(sdk.setDoc(head(alice), { ...next, generation: freshId() }));
    await assertFails(sdk.deleteDoc(head(alice)));
    await assertFails(sdk.setDoc(sdk.doc(alice, 'users', uid, 'admin', 'roles'), { isAdmin: true }));
    assert.equal((await sdk.getDoc(head(alice))).data().revision, current.revision);
  });
});
