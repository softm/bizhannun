import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBusinessSearchIndex, classifyBusinessQuery, normalizeBusinessName, searchBusinesses } from '../src/business-search.mjs';

const NAVER = '2208162517', RESTAURANT = '6901100416', OTHER = '1048137225';
const stamp = '2026-10-21T13:00:00Z';
function record(businessNumber = NAVER, name = '주식회사 네이버', address = '경기도 성남시 분당구') {
  return {
    businessNumber, collectedAt: stamp,
    sources: [{ id: 'registry', url: 'https://registry.example.com/business/' + businessNumber,
      title: '공개 등록 자료', channel: 'registry', businessNumber, match: 'exact_bno', collectedAt: stamp }],
    fields: [{ field: 'name', value: name, sourceId: 'registry' },
      { field: 'address', value: address, sourceId: 'registry' },
      { field: 'industry', value: '서비스업', sourceId: 'registry' }],
  };
}

test('number classification preserves checksum validation and accepts full-width/hyphen input', () => {
  assert.deepEqual(classifyBusinessQuery('６９０－１１－００４１６'), {
    kind: 'number', query: '690-11-00416', businessNumber: RESTAURANT,
  });
  for (const value of ['123456789', '12345678901', '6901100417', '0000000000', '---']) {
    assert.equal(classifyBusinessQuery(value).kind, 'invalid', value);
  }
  assert.equal(classifyBusinessQuery('6901100416 사업자').kind, 'name');
  assert.equal(classifyBusinessQuery('365마트').kind, 'name');
  assert.equal(classifyBusinessQuery('7-ELEVEN').kind, 'name');
  assert.equal(classifyBusinessQuery('12345', { type: 'name' }).kind, 'name');
  assert.equal(classifyBusinessQuery('네이버', { type: 'number' }).kind, 'invalid');
});

test('empty, control-only, symbols-only, legal-marker-only and oversized queries are rejected', () => {
  for (const value of [null, {}, '', '   ', '\u0000', '(주)', '!!!', '가'.repeat(201)]) {
    assert.equal(classifyBusinessQuery(value).kind, 'invalid');
  }
  assert.equal(classifyBusinessQuery('서해\n박속').query, '서해 박속');
});

test('name matching normalizes Korean Unicode, whitespace, case and only boundary legal markers', () => {
  assert.equal(normalizeBusinessName('  ㈜ 네 이 버 '), '네이버');
  assert.equal(normalizeBusinessName('네이버 (주)'), '네이버');
  assert.equal(normalizeBusinessName('주식회사테스트'), '테스트');
  assert.equal(normalizeBusinessName('테스트주식회사'), '테스트');
  assert.equal(normalizeBusinessName('내주식회사서비스'), '내주식회사서비스');
  assert.equal(normalizeBusinessName('Ａｃｍｅ'), 'acme');
  const index = buildBusinessSearchIndex({ records: [record(RESTAURANT, '서해박속낙지전문점')] });
  for (const query of ['서해박속', '서해 박속', '박속낙지'.normalize('NFD')]) {
    assert.equal(searchBusinesses(index, query).results[0].businessNumber, RESTAURANT, query);
  }
});

test('same-number records merge aliases and private labels while different-number names remain separate', () => {
  const index = buildBusinessSearchIndex({ records: [record(), record(OTHER, '네이버')],
    partners: [{ businessNumber: NAVER, name: '인터넷 거래처' }],
    profile: { businessNumber: NAVER, name: '내 사업 별칭', region: '서울' } });
  assert.equal(index.totalCount, 2);
  assert.equal(index.publicCount, 2);
  assert.equal(index.savedCount, 1);
  const same = index.entries.find(entry => entry.businessNumber === NAVER);
  assert.equal(same.name, '주식회사 네이버');
  assert.equal(same.address, '경기도 성남시 분당구');
  assert.deepEqual(same.sourceLabels, ['공개 수집 자료', '내 거래처', '내 사업 프로필']);
  assert.equal(same.fromPublic && same.fromSaved && same.fromProfile, true);
  assert.equal(searchBusinesses(index, '네이버').total, 2);
  assert.equal(searchBusinesses(index, '인터넷 거래처').results[0].businessNumber, NAVER);
  assert.equal(searchBusinesses(index, '내 사업 별칭').results[0].businessNumber, NAVER);
});

test('unverified seed names, candidate fields and mismatched source business numbers never enter the public index', () => {
  const seed = { businessNumber: NAVER, name: '검색용 운영자 이름', sources: [], fields: [] };
  const candidate = record(); candidate.fields[0].match = 'candidate';
  const mismatch = record(); mismatch.sources[0].businessNumber = RESTAURANT;
  assert.equal(buildBusinessSearchIndex({ records: [seed, candidate, mismatch] }).totalCount, 0);
  const confirmed = record();
  confirmed.sources.push({ id: 'candidate', url: 'https://news.example.com/story', match: 'candidate', channel: 'news' });
  confirmed.fields.push({ field: 'name', value: '동명이인 다른 회사', sourceId: 'candidate', match: 'exact_bno' });
  const index = buildBusinessSearchIndex({ records: [confirmed] });
  assert.equal(searchBusinesses(index, '동명이인').total, 0);
  assert.equal(searchBusinesses(index, '네이버').total, 1);
});

test('confirmed alternative names are searchable and retain selected name provenance', () => {
  const input = record();
  input.fields.push({ field: 'name', value: 'NAVER Corporation', sourceId: 'registry' });
  const index = buildBusinessSearchIndex({ records: [input] });
  const result = searchBusinesses(index, 'naver').results[0];
  assert.equal(result.businessNumber, NAVER);
  assert.equal(result.matchedName, 'NAVER Corporation');
  assert.equal(result.name, '주식회사 네이버');
  assert.equal(result.sourceUrl, input.sources[0].url);
  assert.equal(result.collectedAt, '2026-10-21T13:00:00.000Z');
});

test('name and location tokens narrow ambiguous names without turning address-only terms into names', () => {
  const index = buildBusinessSearchIndex({ records: [
    record(RESTAURANT, '서해박속낙지전문점', '경기도 광명시 오리로 1034-1'),
    record(OTHER, '서해박속낙지전문점', '충청남도 서산시'),
  ] });
  assert.equal(searchBusinesses(index, '서해 박속').total, 2);
  assert.deepEqual(searchBusinesses(index, '광명 서해박속').results.map(entry => entry.businessNumber), [RESTAURANT]);
  assert.deepEqual(searchBusinesses(index, '서해 박속 서산').results.map(entry => entry.businessNumber), [OTHER]);
  assert.equal(searchBusinesses(index, '경기도 광명').total, 0);
  assert.equal(searchBusinesses(index, '서해 부산').total, 0);
});

test('exact names rank before partial names and pagination is deterministic without dropping total', () => {
  const index = buildBusinessSearchIndex({ partners: [
    { businessNumber: RESTAURANT, name: '가게 네이버' },
    { businessNumber: NAVER, name: '네이버' },
    { businessNumber: OTHER, name: '네이버 거래처' },
  ] });
  const first = searchBusinesses(index, '네이버', { limit: 1 });
  assert.equal(first.total, 3);
  assert.equal(first.results[0].businessNumber, NAVER);
  assert.equal(searchBusinesses(index, '네이버', { offset: 1, limit: 1 }).results[0].businessNumber, OTHER);
  assert.equal(searchBusinesses(index, '네이버', { offset: 10, limit: 1 }).results.length, 0);
  assert.equal(searchBusinesses(index, '네이버', { offset: -1, limit: 999 }).limit, 100);
  assert.equal(searchBusinesses(index, '네이버', { offset: -1, limit: 999 }).offset, 0);
});

test('accounts build independent indexes and neither search nor indexing mutates private data', () => {
  const partners = Object.freeze([Object.freeze({ businessNumber: NAVER, name: '계정 A 전용' })]);
  const accountA = buildBusinessSearchIndex({ partners });
  const accountB = buildBusinessSearchIndex({ partners: [{ businessNumber: RESTAURANT, name: '계정 B 전용' }] });
  assert.equal(searchBusinesses(accountB, '계정 A').total, 0);
  assert.equal(searchBusinesses(buildBusinessSearchIndex(), '계정 A').total, 0);
  const result = searchBusinesses(accountA, '계정 A').results[0];
  result.aliases.push('오염된 별칭'); result.sourceLabels.push('위조 출처');
  assert.equal(searchBusinesses(accountA, '오염된 별칭').total, 0);
  assert.equal(accountA.entries[0].sourceLabels.includes('위조 출처'), false);
});

test('literal private names remain text for view escaping, and only known public origins become links', () => {
  const name = '<img src=x onerror=alert(1)>거래처';
  const index = buildBusinessSearchIndex({ partners: [{ businessNumber: NAVER, name, sourceUrl: 'javascript:alert(1)' }] });
  const result = searchBusinesses(index, '거래처').results[0];
  assert.equal(result.name, name);
  assert.equal(result.sourceUrl, '');
  assert.equal(result.fromPublic, false);
  assert.deepEqual(result.sourceLabels, ['내 거래처']);
});

test('numeric names, profile-only businesses and invalid identities have predictable behavior', () => {
  const index = buildBusinessSearchIndex({
    partners: [{ businessNumber: NAVER, name: '12345' }, { businessNumber: '123', name: '무효 번호 업체' }],
    profile: { name: '내 사업', businessNumber: RESTAURANT, region: '충남', industry: '농업' },
    records: [null, {}],
  });
  assert.equal(index.totalCount, 2);
  assert.equal(index.savedCount, 2);
  assert.equal(searchBusinesses(index, '12345').results[0].businessNumber, NAVER);
  assert.equal(searchBusinesses(index, '내 사업 충남').results[0].fromProfile, true);
  assert.equal(searchBusinesses(index, '무효 번호').total, 0);
  assert.deepEqual(searchBusinesses(index, ''), { results: [], total: 0, offset: 0, limit: 20 });
  assert.equal(buildBusinessSearchIndex({ records: null, partners: null, profile: null }).totalCount, 0);
});
