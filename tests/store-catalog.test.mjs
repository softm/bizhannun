import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { searchBusinesses } from '../src/business-search.mjs';
import {
  STORE_CATALOG_LIMITS, StoreSearchAccumulator, compileStoreQuery, matchStoreRow,
  selectStoreShardIndices, storeNameGrams, validateStoreManifest, validateStoreRouting, validateStoreRows,
} from '../src/store-catalog.mjs';
import { DecodedStoreCache } from '../src/store-catalog-worker.mjs';
import { fixture, MANIFEST_URL, pack, row } from './store-catalog-fixtures.mjs';

test('manifest confines every fetch to named gzip files and reconciles coverage counts', () => {
  const original = fixture([[row('A', '서해박속낙지전문점')]]).manifest;
  const manifest = validateStoreManifest(original);
  assert.equal(manifest.acceptedCount, 1);
  assert.equal(manifest.source.provider, 'semas');
  for (const path of ['../other.json.gz', 'shards/../../other.json.gz', 'https://evil.test/x.json.gz',
    '//evil.test/x.json.gz', 'shards/%2e%2e.json.gz', 'shards/file.json.gz?x=1', 'shards/a/b.json.gz', 'shards/a..b.json.gz']) {
    const bad = structuredClone(original); bad.shards[0].path = path;
    assert.throws(() => validateStoreManifest(bad), { code: 'invalid_manifest' }, path);
  }
  for (const edit of [
    value => { value.routing.path = 'shards/routing.json.gz'; },
    value => { value.shards[0].uncompressedBytes = STORE_CATALOG_LIMITS.shardBytes + 1; },
    value => { value.routing.uncompressedBytes = STORE_CATALOG_LIMITS.routingBytes + 1; },
    value => { value.shards[0].sha256 = 'bad'; },
    value => { value.source.url = 'javascript:alert(1)'; },
    value => { value.regions[0].count++; },
    value => { value.sourceCount++; },
    value => { value.sourceDate = '2026-02-30'; },
  ]) {
    const bad = structuredClone(original); edit(bad);
    assert.throws(() => validateStoreManifest(bad), { code: 'invalid_manifest' });
  }
});

test('catalog matching has the existing LIKE grammar, including literal regex punctuation and address tokens', () => {
  const rows = [
    row('naver', '주식회사 네 이 버', { road: '경기도 성남시 분당구' }),
    row('naver2', '가게 네이버 거래처'),
    row('west', '서해박속낙지전문점', { road: '경기도 광명시 오리로 1' }),
    row('coast', '서해박속낙지전문점', { road: '충청남도 서산시' }),
    row('regex', 'A[0-9]+.(서울)_지점'),
    row('slash', 'A\\센터'),
    row('num', '12345'),
    row('middle', '내주식회사서비스'),
    row('branch', '이디야커피', { branch: '강남점' }),
  ];
  const source = fixture([rows]);
  const existing = { entries: rows.map(item => ({ id: `semas:${item[0]}`, businessNumber: item[0],
    name: item[1], aliases: item[2] ? [item[1], `${item[1]} ${item[2]}`] : [item[1]],
    address: `${item[3]} ${item[4]} ${item[6]}`, sourceLabels: [] })) };
  for (const query of ['네이버', '네 이 버', '%네이버%', '*네이버*', '%%**네이버**%%', '% (주) 네 이 버 %',
    '＊네이버％', '네%네', '서해 박속', '박속낙지'.normalize('NFD'), '서해%전문점', '전문점%서해',
    '%광명% %서해*전문점%', '서해 박속 서산', '경기도 광명', '서해 부산', '이디야 강남',
    '강남점', '[0-9]+.', 'A%[0-9]+.*_지점', '%_지점%', 'A\\%', 'A[0-9]+$', 'A_Z',
    '12345', '내주식회사', '%', '*', '%(주)%', '(주)', '', '가'.repeat(201)]) {
    const compiled = compileStoreQuery(query), actual = new StoreSearchAccumulator();
    for (const item of rows) {
      const match = matchStoreRow(item, compiled);
      if (match) actual.add(item, match, source.manifest);
    }
    const expected = searchBusinesses(existing, query, { limit: 100 });
    assert.deepEqual(actual.results().map(item => [item.id, item.matchedName]),
      expected.results.map(item => [item.id, item.matchedName]), query);
    assert.equal(actual.total, expected.total, query);
  }
});

test('routing preserves middle fragments, wildcard order candidates, name+branch and name/address paths', async () => {
  const groups = [
    [row('west', '서해박속낙지전문점', { road: '경기도 광명시' })],
    [row('east', '서해박속낙지전문점', { road: '부산광역시', region: '26' })],
    [row('branch', '이디야커피', { branch: '강남점' })],
    [row('literal', 'A[0-9]+.(서울)_지점')],
  ];
  const source = fixture(groups), engine = source.engine();
  for (const query of ['속낙', '지전문', '서해*전문점', '전문점%서해', '광명 서해*전문점', '서해 부산',
    '이디야 강남', '커피강남점', '이디야*점', '[0-9]+.', '%_지점%']) {
    const expected = groups.flat().filter(item => matchStoreRow(item, compileStoreQuery(query))).map(item => `semas:${item[0]}`).sort();
    const result = await engine.search({ manifest: source.manifest, manifestUrl: MANIFEST_URL, query });
    assert.equal(result.complete, true, query);
    assert.deepEqual(result.results.map(item => item.id).sort(), expected, query);
    assert.equal(result.total, expected.length, query);
  }
  const regional = await engine.search({ manifest: source.manifest, manifestUrl: MANIFEST_URL, query: '서해', regionCode: '26' });
  assert.deepEqual(regional.results.map(item => item.id), ['semas:east']);
  assert.equal(regional.progress.totalShards, 1);
  await assert.rejects(engine.search({ manifest: source.manifest, manifestUrl: MANIFEST_URL, query: '서해', regionCode: '99' }), { code: 'invalid_region' });
  engine.close();
});

test('routing validates sorted unique numeric postings and uses Unicode code-point grams', () => {
  assert.deepEqual(storeNameGrams('㈜ Ａ 😀점').sort(), ['a', 'a😀', '😀', '😀점', '점'].sort());
  for (const indices of [[1, 0], [0, 0], [-1], [2], ['0']]) {
    assert.throws(() => validateStoreRouting({ schemaVersion: 1, grams: { 가: indices } }, 2), { code: 'invalid_routing' });
  }
  assert.throws(() => validateStoreRouting({ schemaVersion: 1, grams: { 가나다: [0] } }, 1), { code: 'invalid_routing' });
  const manifest = fixture([[row('A', '커피')], [row('B', '커피', { region: '26' })]]).manifest;
  const routing = validateStoreRouting({ schemaVersion: 1, grams: { 커: [0, 1], 피: [0, 1], 커피: [0, 1] } }, 2);
  assert.deepEqual(selectStoreShardIndices(manifest, routing, compileStoreQuery('커피'), { regionCode: '26' }), [1]);
});

test('store IDs stay separate from business numbers and matching names at different IDs remain separate', async () => {
  const first = row('2208162517', '이름이 같은 상가'), second = row('OTHER', '이름이 같은 상가');
  const source = fixture([[first, second]]), engine = source.engine();
  const result = await engine.search({ manifest: source.manifest, manifestUrl: MANIFEST_URL, query: '같은' });
  assert.equal(result.total, 2);
  assert.equal(result.results[0].businessNumber, null);
  assert.equal(result.results[0].id, 'semas:2208162517');
  assert.equal(result.results[0].sourceRecordId, '2208162517');
  assert.equal(result.results[0].sourceDate, '2026-06-30');
  assert.equal(result.results[0].collectedAt, '2026-10-21T18:00:00.000Z');
  assert.equal(result.results[0].industryCode, 'I21201');
  assert.equal(result.results[0].kind, 'store');
  assert.equal('businessStatus' in result.results[0], false);
  const descriptor = { rowCount: 2, regionCode: '11' };
  assert.throws(() => validateStoreRows([first, first], descriptor), { code: 'duplicate_store_id' });
  assert.throws(() => validateStoreRows([[...first, '2208162517']], { rowCount: 1, regionCode: '11' }), { code: 'invalid_shard' });
  engine.close();
});

test('broad searches retain deterministic top 200 and count all rows without presenting interim totals', async () => {
  const rows = Array.from({ length: 550 }, (_, index) => row(`ID${index}`, `상가${String(549 - index).padStart(4, '0')}`));
  const source = fixture([rows.slice(0, 220), rows.slice(220, 440), rows.slice(440)]), engine = source.engine();
  const updates = [];
  const result = await engine.search({ manifest: source.manifest, manifestUrl: MANIFEST_URL, query: '상가', limit: 999,
    onProgress: value => updates.push(value) });
  assert.equal(result.total, 550);
  assert.equal(result.foundCount, 550);
  assert.equal(result.shownCount, 200);
  assert.equal(result.results.length, 200);
  assert.equal(result.capped, true);
  assert.equal(result.finished, true);
  assert.equal(result.complete, true);
  assert.equal(result.progress.scannedRows, 550);
  assert.equal(result.results[0].name, '상가0000');
  assert.equal(result.results.at(-1).name, '상가0199');
  assert.ok(updates.length >= 2);
  assert.ok(updates.every(item => item.total === null && !item.complete && !item.finished));
  const smaller = await engine.search({ manifest: source.manifest, manifestUrl: MANIFEST_URL, query: '상가', limit: 5 });
  assert.equal(smaller.total, 550);
  assert.equal(smaller.shownCount, 5);
  assert.deepEqual(smaller.results, result.results.slice(0, 5));
  engine.close();
});

test('exact and prefix matches displace earlier contains results in the bounded heap', async () => {
  const first = Array.from({ length: 250 }, (_, index) => row(`A${index}`, `가게 네이버 ${index}`));
  const source = fixture([first, [row('Z', '네이버'), row('Y', '네이버 지점')]]), engine = source.engine();
  const result = await engine.search({ manifest: source.manifest, manifestUrl: MANIFEST_URL, query: '%네이버%', limit: 2 });
  assert.equal(result.total, 252);
  assert.deepEqual(result.results.map(item => item.id), ['semas:Z', 'semas:Y']);
  engine.close();
});

test('decoded byte LRU is strictly bounded and version changes cannot reuse an old snapshot', async () => {
  const cache = new DecodedStoreCache(10);
  cache.set('a', new Uint8Array(4)); cache.set('b', new Uint8Array(4));
  assert.ok(cache.get('a'));
  cache.set('c', new Uint8Array(4));
  assert.equal(cache.get('b'), null);
  assert.equal(cache.stats().bytes, 8);
  cache.set('oversized', new Uint8Array(11));
  assert.equal(cache.get('oversized'), null);
  assert.ok(cache.stats().bytes <= 10);
  assert.equal(new DecodedStoreCache(999_000_000).stats().maxBytes, 64 * 1024 * 1024);
  const source = fixture([[row('A', '커피')]]), engine = source.engine();
  const request = { manifest: source.manifest, manifestUrl: MANIFEST_URL, query: '커피' };
  await engine.search(request);
  const count = source.calls.length;
  const cached = await engine.search(request);
  assert.equal(source.calls.length, count);
  assert.equal(cached.progress.cachedFiles, 2);
  await engine.search({ ...request, manifest: { ...source.manifest, version: 'semas-next' } });
  assert.equal(source.calls.length, count * 2);
  assert.ok(source.calls.every(call => call.url.startsWith('https://softm.github.io/bizhannun/data/store-catalog/')));
  assert.equal(new URL(source.calls.at(-1).url).searchParams.get('v'), 'semas-next');
  assert.equal(new URL(source.calls.at(-1).url).searchParams.get('sha'), source.manifest.shards[0].sha256);
  assert.ok(engine.cacheStats().bytes <= engine.cacheStats().maxBytes);
  engine.close(); assert.equal(engine.cacheStats().bytes, 0);
});

test('protected same-origin routing and shard assets use the page session without allowing redirects', async () => {
  const source = fixture([[row('A', '커피')]]);
  const manifestUrl = 'https://preview.example.test/bizhannun/data/store-catalog/manifest.json';
  const engine = source.engine({ fetchImpl: (url, options) => options.credentials === 'same-origin'
    ? source.fetchImpl(url, options) : new Response('Unauthorized', { status: 401 }) });
  const result = await engine.search({ manifest: source.manifest, manifestUrl, query: '커피' });
  assert.equal(result.complete, true);
  assert.equal(result.total, 1);
  assert.equal(source.calls.length, 2);
  assert.deepEqual(new Set(source.calls.map(call => call.path)), new Set(['routing.json.gz', source.manifest.shards[0].path]));
  for (const call of source.calls) {
    assert.equal(new URL(call.url).origin, new URL(manifestUrl).origin);
    assert.equal(call.options.credentials, 'same-origin');
    assert.equal(call.options.redirect, 'error');
  }
  engine.close();
});

test('one missing region shard yields explicit partial scope and never a definitive total', async () => {
  const source = fixture([[row('A', '커피')], [row('B', '커피', { region: '26' })]]), engine = source.engine();
  source.files.delete(source.manifest.shards[1].path);
  const result = await engine.search({ manifest: source.manifest, manifestUrl: MANIFEST_URL, query: '커피' });
  assert.equal(result.status, 'partial');
  assert.equal(result.finished, true);
  assert.equal(result.complete, false);
  assert.equal(result.total, null);
  assert.equal(result.foundCount, 1);
  assert.equal(result.progress.completedShards, 2);
  assert.equal(result.progress.failedShards, 1);
  assert.equal(result.progress.failedRows, 1);
  assert.equal(result.failures[0].regionCode, '26');
  assert.equal(result.failures[0].code, 'http_error');
  assert.deepEqual(result.results.map(item => item.id), ['semas:A']);
  engine.close();
});

test('a corrected shard for the same source version does not reuse stale CDN bytes', async () => {
  const source = fixture([[row('A', '커피원본')]]), responses = new Map();
  const engine = source.engine({ fetchImpl: async (url, options) => {
    // Model force-cache keyed by the full request URL, independent of the
    // engine's own verified-byte cache.
    if (!responses.has(url)) {
      const response = await source.fetchImpl(url, options);
      responses.set(url, await response.arrayBuffer());
    }
    return new Response(responses.get(url));
  } });
  const request = { manifest: source.manifest, manifestUrl: MANIFEST_URL, query: '커피' };
  assert.equal((await engine.search(request)).results[0].name, '커피원본');
  const shard = source.manifest.shards[0];
  const correction = pack([row('A', '커피수정')], shard.path);
  source.files.set(shard.path, correction.bytes);
  Object.assign(shard, correction.descriptor);
  const corrected = await engine.search(request);
  assert.equal(corrected.complete, true);
  assert.equal(corrected.total, 1);
  assert.equal(corrected.results[0].name, '커피수정');
  assert.equal(responses.size, 3);
  engine.close();
});

test('checksum, compression, byte-size, JSON and row-count failures never become zero-result success', async () => {
  for (const kind of ['checksum', 'gzip', 'raw-size', 'compressed-size', 'json', 'row-count']) {
    const source = fixture([[row('A', '커피')]]);
    const descriptor = source.manifest.shards[0];
    if (kind === 'checksum') descriptor.sha256 = '0'.repeat(64);
    if (kind === 'gzip') {
      const bytes = Buffer.from('not gzip at all'); source.files.set(descriptor.path, bytes);
      descriptor.compressedBytes = bytes.length; descriptor.sha256 = createHash('sha256').update(bytes).digest('hex');
    }
    if (kind === 'raw-size') descriptor.uncompressedBytes--;
    if (kind === 'compressed-size') descriptor.compressedBytes++;
    if (kind === 'json') {
      const invalid = pack('{invalid', descriptor.path); source.files.set(descriptor.path, invalid.bytes);
      Object.assign(descriptor, invalid.descriptor);
    }
    if (kind === 'row-count') {
      descriptor.rowCount++; source.manifest.sourceCount++; source.manifest.acceptedCount++; source.manifest.regions[0].count++;
    }
    const engine = source.engine();
    const result = await engine.search({ manifest: source.manifest, manifestUrl: MANIFEST_URL, query: '커피' });
    assert.equal(result.complete, false, kind);
    assert.equal(result.total, null, kind);
    assert.equal(result.status, 'error', kind);
    assert.equal(result.failures.length, 1, kind);
    assert.equal(result.foundCount, 0, kind);
    engine.close();
  }
});

test('a broken routing file reports unknown coverage without downloading the entire catalog', async () => {
  const source = fixture([[row('A', '커피')], [row('B', '커피')]]), engine = source.engine();
  source.manifest.routing.sha256 = '0'.repeat(64);
  const result = await engine.search({ manifest: source.manifest, manifestUrl: MANIFEST_URL, query: '커피' });
  assert.equal(result.total, null);
  assert.equal(result.complete, false);
  assert.equal(result.failures[0].kind, 'routing');
  assert.equal(result.failures[0].code, 'checksum_mismatch');
  assert.equal(source.calls.length, 1);
  engine.close();
});

test('a valid empty route has a final zero total and fetches no row files', async () => {
  const source = fixture([[row('A', '커피')]]), engine = source.engine();
  const result = await engine.search({ manifest: source.manifest, manifestUrl: MANIFEST_URL, query: '전혀다른상호' });
  assert.equal(result.total, 0);
  assert.equal(result.complete, true);
  assert.equal(result.progress.totalShards, 0);
  assert.equal(source.calls.length, 1);
  engine.close();
});

test('network concurrency stays bounded at two or four file requests', async () => {
  for (const concurrency of [2, 4]) {
    const source = fixture(Array.from({ length: 8 }, (_, index) => [row(`A${index}`, '커피')]));
    let current = 0, maximum = 0;
    const engine = source.engine({ concurrency, fetchImpl: async (...args) => {
      current++; maximum = Math.max(maximum, current);
      await new Promise(resolve => setTimeout(resolve, 8));
      try { return await source.fetchImpl(...args); } finally { current--; }
    } });
    const result = await engine.search({ manifest: source.manifest, manifestUrl: MANIFEST_URL, query: '커피' });
    assert.equal(result.total, 8);
    assert.equal(maximum, concurrency);
    engine.close();
  }
});

test('cancellation aborts in-flight fetches and stale searches cannot report a final result', async () => {
  const source = fixture([[row('A', '커피')]]);
  let started;
  const fetchStarted = new Promise(resolve => { started = resolve; });
  let aborted = false;
  const engine = source.engine({ fetchImpl: async (url, options) => {
    started();
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        aborted = true; const error = new Error('abort'); error.name = 'AbortError'; reject(error);
      }, { once: true });
    });
  } });
  const old = engine.search({ manifest: source.manifest, manifestUrl: MANIFEST_URL, query: '커피' });
  const rejected = assert.rejects(old, { name: 'AbortError' });
  await fetchStarted; engine.cancel();
  await rejected;
  assert.equal(aborted, true);
  engine.close();

  const reusable = source.engine();
  await reusable.search({ manifest: source.manifest, manifestUrl: MANIFEST_URL, query: '커피' });
  const canceled = reusable.search({ manifest: source.manifest, manifestUrl: MANIFEST_URL, query: '커피',
    onProgress: result => { if (result.progress.phase === 'search') reusable.cancel(); } });
  await assert.rejects(canceled, { name: 'AbortError' });
  const fresh = await reusable.search({ manifest: source.manifest, manifestUrl: MANIFEST_URL, query: '없음' });
  assert.equal(fresh.complete, true);
  assert.equal(fresh.total, 0);
  reusable.close();
});
