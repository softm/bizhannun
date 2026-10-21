import assert from 'node:assert/strict';
import test from 'node:test';
import { ENRICHMENT_FIELDS, safeEnrichmentUrl, normalizeEnrichment, summarizeEnrichment, loadEnrichment, loadEnrichmentIndex, loadEnrichmentCatalog } from '../src/enrichment.mjs';
const BNO = '2208162517';
const stamp = '2026-10-21T13:00:00Z';
const record = () => ({
  businessNumber: BNO, collectedAt: stamp, officialDomain: 'company.example.com', entityType: 'corporation',
  sources: [
    { id: 'registry', url: 'https://registry.example.com/company/123', title: '등록정보', channel: 'registry', match: 'exact_bno', businessNumber: BNO, collectedAt: stamp, scope: 'public_business' },
    { id: 'site', url: 'https://company.example.com/about', title: '회사 소개', channel: 'website', match: 'confirmed_domain', collectedAt: stamp, scope: 'public_business' },
    { id: 'news', url: 'https://news.example.com/article/123', title: '동명 회사 기사', channel: 'news', match: 'candidate', collectedAt: stamp },
  ],
  fields: [
    { field: 'name', value: '주식회사 테스트', sourceId: 'registry' },
    { field: 'address', value: '서울시 테스트길 1', sourceId: 'registry' },
    { field: 'address', value: '서울시 테스트길 2', sourceId: 'site' },
    { field: 'phone', value: '02-123-4567', sourceId: 'site' },
    { field: 'email', value: 'contact@company.example.com', sourceId: 'site' },
    { field: 'representative', value: '공개법인대표', sourceId: 'registry' },
    { field: 'name', value: '다른 테스트 회사', sourceId: 'news', match: 'exact_bno' },
  ],
});
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('confirmed facts retain field-level origins and conflicting values are not discarded', () => {
  const result = summarizeEnrichment(record());
  assert.equal(result.profile.name, '주식회사 테스트');
  assert.equal(result.profile.phone, '02-123-4567');
  assert.equal(result.confirmedCount, 2);
  assert.equal(result.candidateCount, 1);
  const address = result.fields.find(item => item.field === 'address');
  assert.equal(address.conflict, true);
  assert.equal(address.sourceId, 'registry');
  assert.equal(address.alternatives[0].value, '서울시 테스트길 2');
  assert.equal(result.candidateFields[0].value, '다른 테스트 회사');
});

test('same names, missing BRN evidence and lookalike domains never upgrade candidate identities', () => {
  const input = record();
  delete input.sources[0].businessNumber;
  input.sources[1].url = 'https://company.example.com.attacker.com/about';
  const result = summarizeEnrichment(input);
  assert.deepEqual(result.profile, {});
  assert.equal(result.confirmedCount, 0);
  assert.equal(result.candidateCount, 3);
  input.sources[0].matchedBusinessNumber = '1048137225';
  assert.equal(normalizeEnrichment(input).sources[0].match, 'candidate');
});

test('explicit candidate fields cannot be promoted by a verified source', () => {
  const input = record();
  input.fields[0].match = 'candidate';
  const result = summarizeEnrichment(input);
  assert.equal(result.profile.name, undefined);
  assert.equal(result.candidateFields.filter(item => item.field === 'name').length, 2);
});

test('personal contacts and representative of a sole trader are excluded', () => {
  const input = record();
  input.entityType = 'business';
  input.sources[1].scope = 'personal';
  input.fields.push({ field: 'homeAddress', value: '개인 집 주소', sourceId: 'registry' },
    { field: 'residentRegistrationNumber', value: '주민번호', sourceId: 'registry' },
    { field: 'personalPhone', value: '010-1234-5678', sourceId: 'registry' });
  const result = summarizeEnrichment(input);
  assert.equal(result.profile.phone, undefined);
  assert.equal(result.profile.email, undefined);
  assert.equal(result.profile.representative, undefined);
  assert.equal(result.fields.some(item => /personal|resident|home/.test(item.field)), false);
  input.fields.find(item => item.field === 'phone').scope = 'public_business';
  assert.equal(summarizeEnrichment(input).profile.phone, '02-123-4567');
});

test('malicious URL schemes, credentials, API key queries, private IPs and unusual ports are rejected', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'https://name:password@example.com/',
    'https://example.com/?serviceKey=abc', 'https://example.com/?%61piKey=abc',
    'https://example.com/?key=abc', 'https://example.com/?access_token=abc',
    'http://127.0.0.1/', 'https://2130706433/', 'http://[::1]/', 'https://internal.local/',
    'https://intranet/', 'https://example.com:444/']) assert.equal(safeEnrichmentUrl(value), null, value);
  assert.equal(safeEnrichmentUrl('https://example.com/news?id=123#footer'), 'https://example.com/news?id=123');
});

test('unknown/prototype fields, HTML and oversized input stay outside profile fields', () => {
  const input = JSON.parse(JSON.stringify(record()));
  input.fields.push({ field: '__proto__', value: 'pollution', sourceId: 'registry' }, { field: 'constructor', value: 'pollution', sourceId: 'registry' });
  input.fields[0].value = '<img onerror="alert(1)">회사명\u0000';
  input.fields.push({ field: 'description', value: '가'.repeat(3000), sourceId: 'registry' });
  const result = summarizeEnrichment(input);
  assert.equal(result.profile.name, '회사명');
  assert.equal(result.profile.description.length, 2000);
  assert.deepEqual(Object.keys(result.profile).filter(key => !Object.hasOwn(ENRICHMENT_FIELDS, key)), []);
  assert.equal({}.pollution, undefined);
});

test('invalid dates normalize to unknown, valid observations are idempotent and newer same-tier source wins', () => {
  const input = record();
  input.sources[0].publishedAt = '2026-02-31';
  const first = normalizeEnrichment(input);
  assert.equal(first.sources[0].publishedAt, null);
  assert.deepEqual(normalizeEnrichment(first), first);
  input.sources.push({ ...input.sources[0], id: 'registry-new', collectedAt: '2026-10-22T01:00:00Z' });
  input.fields.push({ field: 'name', value: '변경상호', sourceId: 'registry-new' });
  assert.equal(summarizeEnrichment(input).profile.name, '변경상호');
});

test('snapshot loading matches exact BRN, sends no credentials, and returns honest missing coverage', async () => {
  let options;
  const loaded = await loadEnrichment(BNO, { fetcher: async (_url, init) => { options = init; return json({ businesses: [record()], meta: { generatedAt: stamp, arbitrarySecret: 'hidden' } }); } });
  assert.equal(options.credentials, 'omit');
  assert.equal(loaded.summary.profile.name, '주식회사 테스트');
  assert.equal(loaded.meta.arbitrarySecret, undefined);
  const absent = await loadEnrichment('1048137225', { fetcher: async () => json({ businesses: [record()] }) });
  assert.equal(absent.record, null);
  assert.equal(absent.summary, null);
  const notCollected = await loadEnrichment(BNO, { fetcher: async () => new Response('', { status: 404 }) });
  assert.equal(notCollected.meta.status, 'not_collected');
});

test('bad input, duplicate BRNs, invalid JSON and oversized payloads do not silently pass', async () => {
  await assert.rejects(loadEnrichment('invalid', { fetcher: () => { throw new Error('No request expected'); } }));
  await assert.rejects(loadEnrichment(BNO, { fetcher: async () => json({ businesses: [record(), record()] }) }));
  await assert.rejects(loadEnrichment(BNO, { fetcher: async () => new Response('not-json') }));
  await assert.rejects(loadEnrichment(BNO, { fetcher: async () => new Response('{}', { headers: { 'content-length': '8000001' } }) }));
  await assert.rejects(loadEnrichment(BNO, { fetcher: async () => new Response(' '.repeat(8_000_001)) }));
});

test('candidate discovery retains only a safe referring public URL',()=>{
 const input=record();input.sources[2].discoveredFrom='https://company.example.com/about';
 assert.equal(normalizeEnrichment(input).sources[2].discoveredFrom,input.sources[2].discoveredFrom);
 input.sources[2].discoveredFrom='https://company.example.com/?token=secret';
 assert.equal(normalizeEnrichment(input).sources[2].discoveredFrom,undefined);
});

test('a shared index rejects duplicate identities anywhere instead of joining by first match', async () => {
  const other = record();
  other.businessNumber = '6901100416';
  const duplicate = { ...record(), businessNumber: '220-81-62517' };
  const fetcher = async () => json({ businesses: [other, record(), duplicate] });
  await assert.rejects(loadEnrichmentIndex({ fetcher }), /중복/);
  await assert.rejects(loadEnrichment('6901100416', { fetcher }), /중복/);
});

test('shared index accounts for malformed identities and does not truncate excess records', async () => {
  const index = await loadEnrichmentIndex({ fetcher: async () => json({ businesses: [record(), null, { businessNumber: 'invalid' }] }) });
  assert.equal(index.records.length, 1);
  assert.equal(index.records[0].businessNumber, BNO);
  assert.equal(index.meta.loadedCount, 1);
  assert.equal(index.meta.rejectedCount, 2);
  await assert.rejects(loadEnrichmentIndex({ fetcher: async () => json({ businesses: Array(5001).fill(null) }) }), /건수/);
  const missing = await loadEnrichmentIndex({ fetcher: async () => new Response('', { status: 404 }) });
  assert.deepEqual(missing.records, []);
  assert.equal(missing.meta.status, 'not_collected');
});

test('contradictory identity aliases cannot silently establish an exact match', () => {
  const input = record();
  input.bno = '6901100416';
  assert.equal(normalizeEnrichment(input), null);
  delete input.bno;
  input.sources[0].matchedBusinessNumber = '6901100416';
  const result = summarizeEnrichment(input);
  assert.equal(result.sources.find(value => value.id === 'registry').match, 'candidate');
  assert.equal(result.profile.name, undefined);
});

test('a confirmed domain never overrides an explicitly different source business number', () => {
  const input = record();
  input.sources = [{ id: 'site', url: 'https://company.example.com', match: 'confirmed_domain', businessNumber: '1048137225' }];
  input.fields = [{ field: 'name', value: '다른 기업', sourceId: 'site' }];
  const normalized = normalizeEnrichment(input);
  assert.equal(normalized.sources[0].match, 'candidate');
  assert.equal(normalized.sources[0].identityMismatch, true);
  assert.equal(normalized.sources[0].businessNumber, '1048137225');
  assert.deepEqual(normalizeEnrichment(normalized), normalized);
  assert.equal(summarizeEnrichment(normalized).profile.name, undefined);
});

test('catalog loading normalizes records, counts exclusions and whitelists metadata', async () => {
  const first = record();
  first.businessNumber = '220-81-62517';
  const controller = new AbortController();
  const requestedUrl = new URL('https://example.com/data/enrichment/index.json');
  let actualUrl, options;
  const loaded = await loadEnrichmentCatalog({
    url: requestedUrl, signal: controller.signal,
    fetcher: async (url, init) => {
      actualUrl = url; options = init;
      return json({ businesses: [null, first, { businessNumber: 'invalid' }], meta: {
        status: 'partial', generatedAt: stamp, collectedAt: '2026-02-31', arbitrarySecret: 'hidden', loadedCount: 999,
      } });
    },
  });
  assert.equal(actualUrl, requestedUrl);
  assert.equal(options.signal, controller.signal);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.cache, 'no-cache');
  assert.equal(loaded.records[0].businessNumber, BNO);
  assert.equal(summarizeEnrichment(loaded.records[0]).profile.name, '주식회사 테스트');
  assert.deepEqual(loaded.meta, {
    status: 'partial', generatedAt: '2026-10-21T13:00:00.000Z', collectedAt: null,
    loadedCount: 1, inputCount: 3, excludedCount: 2,
  });
});

test('catalog distinguishes missing, empty, failed and malformed snapshots', async () => {
  const missing = await loadEnrichmentCatalog({ fetcher: async () => new Response('', { status: 404 }) });
  assert.deepEqual(missing.records, []);
  assert.equal(missing.meta.status, 'not_collected');
  assert.equal(missing.meta.excludedCount, 0);
  const empty = await loadEnrichmentCatalog({ fetcher: async () => json({ businesses: [] }) });
  assert.equal(empty.meta.status, 'available');
  assert.equal(empty.meta.loadedCount, 0);
  for (const malformed of [null, [], {}, { businesses: {} }]) {
    await assert.rejects(loadEnrichmentCatalog({ fetcher: async () => json(malformed) }), /형식/);
  }
  await assert.rejects(loadEnrichmentCatalog({ fetcher: async () => new Response('', { status: 503 }) }), /불러오지/);
});

test('catalog rejects ambiguous identities and excessive records without silent truncation', async () => {
  const duplicate = { ...record(), businessNumber: '220-81-62517' };
  await assert.rejects(loadEnrichmentCatalog({ fetcher: async () => json({ businesses: [record(), duplicate] }) }), /중복/);
  // The duplicate is not the requested number: exact-number detail still rejects an ambiguous catalog.
  await assert.rejects(loadEnrichment('1048137225', { fetcher: async () => json({ businesses: [record(), duplicate] }) }), /중복/);
  await assert.rejects(loadEnrichmentCatalog({ fetcher: async () => json({ businesses: Array(5001).fill(null) }) }), /허용 건수/);
});

test('catalog preserves HTTP cancellation and enforces streaming byte limits', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(loadEnrichmentCatalog({ signal: controller.signal, fetcher: async (_url, options) => {
    options.signal.throwIfAborted();
  } }), { name: 'AbortError' });
  await assert.rejects(loadEnrichmentCatalog({ fetcher: async () => new Response('{}', {
    headers: { 'content-length': '8000001' },
  }) }), /허용 크기/);
  await assert.rejects(loadEnrichmentCatalog({ fetcher: async () => new Response(' '.repeat(8_000_001)) }), /허용 크기/);
});
