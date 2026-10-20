import { emptyWorkspace, validateBackup } from './storage.mjs';

// Publish a small revision pointer only after all immutable record fragments
// have been acknowledged. Large imports never expose a partial workspace.
export const CLOUD_LIMITS = Object.freeze({ chunkBytes: 180_000, totalBytes: 64 * 1024 * 1024, recordParts: 512, manifestParts: 32, batchBytes: 3_500_000, batchWrites: 180 });
const ID = /^[a-f0-9]{32}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const KINDS = new Set(['partner', 'event', 'check', 'profile']);
const encoder = new TextEncoder();
const emulatorConnections = new WeakSet();

export class CloudStorageError extends Error {
  constructor(code, message) { super(message); this.name = 'CloudStorageError'; this.code = code; }
}
export class CloudConflictError extends CloudStorageError {
  constructor() { super('cloud/conflict', '다른 기기에서 정보가 변경되었습니다. 최신 정보를 불러온 뒤 다시 저장해 주세요. 현재 입력은 자동으로 덮어쓰지 않았습니다.'); }
}
const fail = (code, message) => { throw new CloudStorageError(code, message); };
const corrupt = () => fail('cloud/invalid-data', '저장된 정보의 형식이나 무결성을 확인하지 못했습니다. 원본 백업을 보관하고 다시 불러와 주세요.');
const validUid = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\/\u0000-\u001f]/.test(value) && !['.', '..'].includes(value);
const timestampIso = value => value?.toDate instanceof Function ? value.toDate().toISOString() : null;
const size = text => encoder.encode(text).byteLength;
const createId = () => globalThis.crypto.randomUUID().replaceAll('-', '');
const objectKey = (kind, value) => `${kind}:${kind === 'profile' ? 'profile' : value.id}`;
const partId = (objectId, part) => `${objectId}-${part}`;
const sameHead = (left, right) => left?.revision === right?.revision && left?.generation === right?.generation;

export function splitCloudText(text, maximum = CLOUD_LIMITS.chunkBytes) {
  if (typeof text !== 'string' || !Number.isInteger(maximum) || maximum < 4) throw new TypeError('올바른 문자열과 분할 크기가 필요합니다.');
  const chunks = [];
  let start = 0, cursor = 0, bytes = 0;
  for (const character of text) {
    const point = character.codePointAt(0);
    const next = point > 0xffff ? 4 : point > 0x7ff ? 3 : point > 0x7f ? 2 : 1;
    if (bytes + next > maximum) { chunks.push(text.slice(start, cursor)); start = cursor; bytes = 0; }
    bytes += next; cursor += character.length;
  }
  chunks.push(text.slice(start));
  return chunks;
}

async function sha256(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(text));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function friendlyError(error) {
  if (error instanceof CloudStorageError) return error;
  const code = String(error?.code || '');
  if (/permission-denied/.test(code)) return new CloudStorageError('cloud/permission-denied', '계정의 저장 권한을 확인하지 못했습니다. Firestore 보안 규칙과 로그인 상태를 확인해 주세요.');
  if (/unauthenticated/.test(code)) return new CloudStorageError('cloud/signed-out', '로그인이 만료되었습니다. 다시 로그인해 주세요.');
  if (/unavailable|deadline-exceeded|network/.test(code)) return new CloudStorageError('cloud/offline', '서버에 저장 완료를 확인하지 못했습니다. 네트워크를 확인하고 최신 정보를 다시 불러와 주세요.');
  if (/resource-exhausted/.test(code)) return new CloudStorageError('cloud/quota', '클라우드 저장 한도에 도달했습니다. Firebase 사용량을 확인해 주세요.');
  return new CloudStorageError('cloud/unavailable', '클라우드 정보를 처리하지 못했습니다. 현재 입력을 보관하고 잠시 후 다시 시도해 주세요.');
}
function validateHead(value, uid) {
  if (!value || value.ownerUid !== uid || value.format !== 1 || value.schemaVersion !== 1
    || !Number.isSafeInteger(value.revision) || value.revision < 1 || !ID.test(value.generation)
    || !DIGEST.test(value.manifestDigest) || !Number.isInteger(value.manifestParts)
    || value.manifestParts < 1 || value.manifestParts > CLOUD_LIMITS.manifestParts
    || !Number.isInteger(value.manifestBytes) || value.manifestBytes < 1 || value.manifestBytes > CLOUD_LIMITS.chunkBytes * CLOUD_LIMITS.manifestParts
    || !Number.isInteger(value.partnerCount) || value.partnerCount < 0 || value.partnerCount > 1000
    || !Number.isInteger(value.eventCount) || value.eventCount < 0 || value.eventCount > 1000
    || !Number.isInteger(value.checkCount) || value.checkCount < 0 || value.checkCount > 100
    || !timestampIso(value.updatedAt)) corrupt();
  return value;
}
function validateDescriptor(value) {
  if (!value || !KINDS.has(value.kind) || !ID.test(value.ref) || !DIGEST.test(value.digest)
    || !Number.isInteger(value.parts) || value.parts < 1 || value.parts > CLOUD_LIMITS.recordParts
    || !Number.isInteger(value.bytes) || value.bytes < 1 || value.bytes > CLOUD_LIMITS.totalBytes) corrupt();
  return value;
}
async function mapLimited(values, mapper, concurrency = 8) {
  const results = new Array(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    for (;;) { const index = next++; if (index >= values.length) return; results[index] = await mapper(values[index], index); }
  }));
  return results;
}

/** Existing cloud records win duplicate BRNs; guest data is never uploaded implicitly. */
export function mergeGuestWorkspace(cloud, guest) {
  const base = validateBackup(cloud), local = validateBackup(guest);
  const numbers = new Set(base.partners.map(value => value.businessNumber));
  const ids = new Set(base.partners.map(value => value.id));
  const added = local.partners.filter(value => !numbers.has(value.businessNumber));
  const mapping = new Map();
  for (const item of added) {
    const previous = item.id;
    if (ids.has(item.id)) item.id = createId();
    ids.add(item.id); mapping.set(previous, item.id);
  }
  if (base.partners.length + added.length > 1000) fail('cloud/import-limit', '클라우드와 이 기기의 거래처를 합치면 1,000곳을 초과합니다. 일부 거래처를 정리한 뒤 다시 가져와 주세요.');
  const eventIds = new Set(base.events.map(value => value.id));
  const events = [...base.events, ...local.events.filter(value => mapping.has(value.partnerId) && !eventIds.has(value.id)).map(value => ({ ...value, partnerId: mapping.get(value.partnerId) }))];
  const checkIds = new Set(base.checks.map(value => value.id));
  const checks = [...base.checks, ...local.checks.filter(value => !checkIds.has(value.id))];
  if (events.length > 1000 || checks.length > 100) fail('cloud/import-limit', '가져올 확인 기록이 저장 한도를 초과합니다. 현재 정보와 기기 정보를 각각 백업한 뒤 필요한 범위를 선택해 주세요.');
  const hasProfile = ['name', 'businessNumber', 'region', 'industry', 'foundedAt', 'businessKind'].some(key => base.profile[key])
    || ['employees', 'revenue', 'revenueYear'].some(key => base.profile[key] !== null && base.profile[key] !== undefined)
    || base.profile.interests?.length;
  return { workspace: { ...base, revision: cloud.revision || 0, partners: [...base.partners, ...added], events, checks,
    profile: hasProfile ? base.profile : local.profile, preferences: cloud.preferences || {}, updatedAt: cloud.updatedAt || null },
    addedPartners: added.length, duplicatePartners: local.partners.length - added.length };
}

/** Cloud is authoritative; only server-confirmed loads and commits are returned. */
export function createCloudWorkspace({ sdk, app, auth, config = {}, onStatus = () => {}, onRemoteChange = () => {}, timeoutMs = 25_000 }) {
  const databaseId = config.firestore?.databaseId || '(default)';
  const db = sdk.getFirestore(app, databaseId);
  const emulator = config.emulators?.firestore;
  if (emulator && !emulatorConnections.has(db)) {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(globalThis.location?.hostname || '');
    if (!local || !['localhost', '127.0.0.1', '::1'].includes(emulator.host) || !Number.isInteger(emulator.port) || emulator.port < 1 || emulator.port > 65535) fail('cloud/config', '로컬 개발 환경에서만 Firestore 에뮬레이터에 연결할 수 있습니다.');
    sdk.connectFirestoreEmulator(db, emulator.host, emulator.port); emulatorConnections.add(db);
  }
  let disposed = false, epoch = 0, unsubscribe = null, busy = false, loaded = null, pendingGeneration = null;
  const assertUser = (uid, operationEpoch = epoch) => {
    if (disposed || operationEpoch !== epoch || !validUid(uid) || auth.currentUser?.uid !== uid) fail('cloud/account-changed', '로그인 계정이 변경되었습니다. 계정의 정보를 다시 불러와 주세요.');
  };
  const status = value => { if (!disposed) onStatus(value); };
  const ref = (uid, collection, id) => sdk.doc(db, 'users', uid, collection, id);
  const headRef = uid => ref(uid, 'bizhannunWorkspace', 'main');
  const timed = promise => {
    let timer;
    const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new CloudStorageError('cloud/timeout', '서버의 완료 응답을 받지 못했습니다. 저장 여부를 확인하려면 최신 정보를 다시 불러와 주세요.')), timeoutMs); });
    return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
  };
  const getHead = async (uid, operationEpoch) => {
    assertUser(uid, operationEpoch);
    const snapshot = await timed(sdk.getDocFromServer(headRef(uid)));
    assertUser(uid, operationEpoch);
    return snapshot.exists() ? validateHead(snapshot.data(), uid) : null;
  };

  async function readBody(uid, collection, descriptor, kind, operationEpoch) {
    const chunks = await mapLimited(Array.from({ length: descriptor.parts }, (_, part) => part), async part => {
      assertUser(uid, operationEpoch);
      const snapshot = await timed(sdk.getDocFromServer(ref(uid, collection, partId(descriptor.ref, part))));
      assertUser(uid, operationEpoch);
      if (!snapshot.exists()) corrupt();
      const value = snapshot.data();
      if (value.ownerUid !== uid || value.format !== 1 || value.objectId !== descriptor.ref || value.kind !== kind
        || value.part !== part || value.parts !== descriptor.parts || typeof value.body !== 'string'
        || size(value.body) > CLOUD_LIMITS.chunkBytes) corrupt();
      return value.body;
    });
    const body = chunks.join('');
    if (size(body) !== descriptor.bytes || await sha256(body) !== descriptor.digest) corrupt();
    return body;
  }

  async function load(uid) {
    const operationEpoch = epoch;
    assertUser(uid, operationEpoch);
    status({ phase: 'loading', message: '계정의 정보를 불러오는 중입니다.' });
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const head = await getHead(uid, operationEpoch);
        if (!head) {
          const workspace = emptyWorkspace();
          loaded = { uid, head: null, workspace, records: new Map() };
          status({ phase: 'synced', revision: 0, lastSyncedAt: new Date().toISOString(), message: '계정 저장소에 연결되었습니다.' });
          return workspace;
        }
        try {
          const manifestText = await readBody(uid, 'bizhannunManifests', { ref: head.generation, parts: head.manifestParts, bytes: head.manifestBytes, digest: head.manifestDigest }, 'manifest', operationEpoch);
          let manifest;
          try { manifest = JSON.parse(manifestText); } catch { corrupt(); }
          if (manifest?.format !== 1 || !Array.isArray(manifest.records) || manifest.records.length !== head.partnerCount + head.eventCount + head.checkCount + 1) corrupt();
          const descriptors = manifest.records.map(validateDescriptor);
          if (new Set(descriptors.map(value => value.ref)).size !== descriptors.length || descriptors.reduce((total, value) => total + value.bytes, 0) > CLOUD_LIMITS.totalBytes) corrupt();
          const previous = loaded?.uid === uid ? loaded.records : new Map();
          const previousByRef = new Map([...previous.values()].map(value => [value.descriptor.ref, value]));
          const records = await mapLimited(descriptors, async descriptor => {
            const cached = previousByRef.get(descriptor.ref);
            const reusable = cached && ['digest', 'kind', 'parts', 'bytes'].every(key => cached.descriptor[key] === descriptor[key]);
            const body = reusable ? cached.body : await readBody(uid, 'bizhannunObjects', descriptor, descriptor.kind, operationEpoch);
            let value;
            try { value = JSON.parse(body); } catch { corrupt(); }
            return { descriptor, body, value };
          });
          const groups = kind => records.filter(value => value.descriptor.kind === kind).map(value => value.value);
          if (groups('partner').length !== head.partnerCount || groups('event').length !== head.eventCount || groups('check').length !== head.checkCount || groups('profile').length !== 1) corrupt();
          const workspace = { ...validateBackup({ ...emptyWorkspace(), partners: groups('partner'), events: groups('event'), checks: groups('check'), profile: groups('profile')[0], updatedAt: timestampIso(head.updatedAt) }), revision: head.revision };
          const latest = await getHead(uid, operationEpoch);
          if (!sameHead(head, latest)) continue;
          loaded = { uid, head, workspace, records: new Map(records.map(value => [objectKey(value.descriptor.kind, value.value), value])) };
          status({ phase: 'synced', revision: head.revision, lastSyncedAt: new Date().toISOString(), message: '클라우드 정보를 불러왔습니다.' });
          return workspace;
        } catch (error) {
          // An obsolete fragment may have been cleaned while loading. Retry only
          // when the authoritative pointer changed, never ignore corrupt data.
          if (error?.code === 'cloud/invalid-data') {
            const latest = await getHead(uid, operationEpoch);
            if (!sameHead(head, latest)) continue;
          }
          throw error;
        }
      }
      throw new CloudConflictError();
    } catch (error) {
      const safe = friendlyError(error);
      status({ phase: safe.code === 'cloud/conflict' ? 'conflict' : 'error', message: safe.message });
      throw safe;
    }
  }

  async function writePieces(uid, items, operationEpoch, deleting = false) {
    let batch = sdk.writeBatch(db), writes = 0, bytes = 0;
    const flush = async () => {
      if (!writes) return;
      assertUser(uid, operationEpoch);
      await timed(batch.commit());
      assertUser(uid, operationEpoch);
      batch = sdk.writeBatch(db); writes = 0; bytes = 0;
    };
    for (const item of items) {
      const itemBytes = deleting ? 256 : size(item.body) + 1024;
      if (writes && (writes >= CLOUD_LIMITS.batchWrites || bytes + itemBytes > CLOUD_LIMITS.batchBytes)) await flush();
      const document = ref(uid, item.collection, partId(item.ref, item.part));
      if (deleting) batch.delete(document);
      else batch.set(document, { ownerUid: uid, format: 1, kind: item.kind, objectId: item.ref, part: item.part, parts: item.parts, body: item.body, createdAt: sdk.serverTimestamp() });
      writes++; bytes += itemBytes;
    }
    await flush();
  }
  const pieces = (descriptor, chunks, collection) => chunks.map((body, part) => ({ collection, ref: descriptor.ref, kind: descriptor.kind, parts: chunks.length, part, body }));
  const deletionPieces = (descriptor, collection) => Array.from({ length: descriptor.parts }, (_, part) => ({ collection, ref: descriptor.ref, part }));
  const cleanup = (uid, items, operationEpoch) => { if (items.length) void writePieces(uid, items, operationEpoch, true).catch(() => {}); };

  async function save(uid, next) {
    const operationEpoch = epoch;
    assertUser(uid, operationEpoch);
    if (busy) fail('cloud/busy', '이전 저장이 끝난 뒤 다시 시도해 주세요.');
    if (globalThis.navigator?.onLine === false) fail('cloud/offline', '인터넷에 연결한 뒤 다시 저장해 주세요. 오프라인 변경은 자동 업로드하지 않습니다.');
    if (!Number.isSafeInteger(next?.revision) || next.revision < 0) fail('cloud/invalid-data', '저장 버전을 확인하지 못했습니다. 최신 정보를 다시 불러와 주세요.');
    busy = true;
    const staged = [];
    let publicationStarted = false, published = false;
    try {
      const normalized = validateBackup(next), expected = next.revision;
      if (!loaded || loaded.uid !== uid) await load(uid);
      assertUser(uid, operationEpoch);
      const base = loaded;
      if ((base.head?.revision || 0) !== expected) throw new CloudConflictError();
      const actual = await getHead(uid, operationEpoch);
      if (!sameHead(actual, base.head)) throw new CloudConflictError();
      status({ phase: 'saving', message: '클라우드에 저장하는 중입니다.' });
      const values = [
        ...normalized.partners.map(value => ({ kind: 'partner', value })),
        ...normalized.events.map(value => ({ kind: 'event', value })),
        ...normalized.checks.map(value => ({ kind: 'check', value })),
        { kind: 'profile', value: normalized.profile },
      ];
      const records = new Map();
      let total = 0;
      for (const { kind, value } of values) {
        const key = objectKey(kind, value), body = JSON.stringify(value), bytes = size(body);
        total += bytes;
        if (total > CLOUD_LIMITS.totalBytes) fail('cloud/size-limit', '계정 저장 정보가 64MiB를 초과합니다. 백업 후 오래된 기록을 정리해 주세요.');
        const previous = base.records.get(key);
        if (previous?.body === body) { records.set(key, previous); continue; }
        const chunks = splitCloudText(body);
        if (chunks.length > CLOUD_LIMITS.recordParts) fail('cloud/size-limit', '개별 기록의 저장 한도를 초과했습니다.');
        const descriptor = { kind, ref: createId(), parts: chunks.length, digest: await sha256(body), bytes };
        assertUser(uid, operationEpoch);
        records.set(key, { descriptor, body, value });
        staged.push(...pieces(descriptor, chunks, 'bizhannunObjects'));
      }
      const generation = createId();
      const manifestBody = JSON.stringify({ format: 1, records: [...records.values()].map(value => value.descriptor) });
      const manifestChunks = splitCloudText(manifestBody);
      if (manifestChunks.length > CLOUD_LIMITS.manifestParts) fail('cloud/size-limit', '저장 목록의 한도를 초과했습니다.');
      const manifest = { kind: 'manifest', ref: generation, parts: manifestChunks.length, digest: await sha256(manifestBody), bytes: size(manifestBody) };
      staged.push(...pieces(manifest, manifestChunks, 'bizhannunManifests'));
      const head = { ownerUid: uid, format: 1, schemaVersion: 1, revision: expected + 1, generation,
        manifestParts: manifest.parts, manifestDigest: manifest.digest, manifestBytes: manifest.bytes,
        partnerCount: normalized.partners.length, eventCount: normalized.events.length, checkCount: normalized.checks.length, updatedAt: sdk.serverTimestamp() };
      pendingGeneration = generation;
      await writePieces(uid, staged, operationEpoch);
      assertUser(uid, operationEpoch);
      publicationStarted = true;
      await timed(sdk.runTransaction(db, async transaction => {
        assertUser(uid, operationEpoch);
        const snapshot = await transaction.get(headRef(uid));
        assertUser(uid, operationEpoch);
        const current = snapshot.exists() ? validateHead(snapshot.data(), uid) : null;
        if ((current?.revision || 0) !== expected || !sameHead(current, base.head)) throw new CloudConflictError();
        transaction.set(headRef(uid), head);
      }, { maxAttempts: 3 }));
      published = true;
      const confirmed = await getHead(uid, operationEpoch);
      if (confirmed?.generation !== generation || confirmed.revision !== expected + 1) throw new CloudConflictError();
      const workspace = { ...normalized, revision: confirmed.revision, updatedAt: timestampIso(confirmed.updatedAt) };
      loaded = { uid, head: confirmed, workspace, records };
      const activeRefs = new Set([...records.values()].map(value => value.descriptor.ref));
      const obsolete = [...base.records.values()].filter(value => !activeRefs.has(value.descriptor.ref)).flatMap(value => deletionPieces(value.descriptor, 'bizhannunObjects'));
      if (base.head) obsolete.push(...deletionPieces({ ref: base.head.generation, parts: base.head.manifestParts }, 'bizhannunManifests'));
      cleanup(uid, obsolete, operationEpoch);
      status({ phase: 'synced', revision: workspace.revision, lastSyncedAt: new Date().toISOString(), message: '클라우드에 저장했습니다.' });
      return workspace;
    } catch (error) {
      const safe = friendlyError(error);
      // A timed-out transaction may still commit. Never remove its records.
      const knownFailure = (!publicationStarted && safe.code !== 'cloud/timeout') || safe.code === 'cloud/conflict';
      if (!published && knownFailure) cleanup(uid, staged, operationEpoch);
      status({ phase: safe.code === 'cloud/conflict' ? 'conflict' : 'error', message: safe.message });
      throw safe;
    } finally { busy = false; pendingGeneration = null; }
  }

  function watch(uid) {
    assertUser(uid);
    unsubscribe?.();
    const operationEpoch = epoch;
    unsubscribe = sdk.onSnapshot(headRef(uid), { includeMetadataChanges: true }, snapshot => {
      if (disposed || operationEpoch !== epoch || auth.currentUser?.uid !== uid || snapshot.metadata?.fromCache || snapshot.metadata?.hasPendingWrites) return;
      try {
        const head = snapshot.exists() ? validateHead(snapshot.data(), uid) : null;
        if (head?.generation === pendingGeneration || (loaded?.uid === uid && sameHead(head, loaded.head))) return;
        onRemoteChange({ uid, revision: head?.revision || 0, updatedAt: head ? timestampIso(head.updatedAt) : null });
      } catch (error) { status({ phase: 'error', message: friendlyError(error).message }); }
    }, error => {
      if (!disposed && operationEpoch === epoch && auth.currentUser?.uid === uid) status({ phase: 'error', message: friendlyError(error).message });
    });
    return unsubscribe;
  }
  function dispose() { disposed = true; epoch++; unsubscribe?.(); unsubscribe = null; loaded = null; pendingGeneration = null; }
  return { load, save, watch, dispose, getState: () => ({ busy, revision: loaded?.head?.revision || 0 }) };
}
