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

test('saved evidence supplies confirmed names, alternatives and location without inflating public coverage', () => {
  const evidence = record();
  evidence.fields.push({ field: 'name', value: 'NAVER Corporation', sourceId: 'registry' });
  evidence.sources.push({ id: 'candidate', url: 'https://news.example.com/unverified', match: 'candidate', channel: 'news' });
  evidence.fields.push({ field: 'name', value: '동명이인 후보 업체', sourceId: 'candidate', match: 'exact_bno' });
  const partner = { businessNumber: NAVER, name: '포털 거래처', enrichment: evidence };
  const original = structuredClone(partner);
  const index = buildBusinessSearchIndex({ partners: [partner] });
  assert.equal(index.publicCount, 0);
  assert.equal(index.savedCount, 1);
  assert.equal(index.totalCount, 1);
  for (const query of ['네이버', 'naver', '포털', '성남 네이버']) {
    assert.equal(searchBusinesses(index, query).results[0].businessNumber, NAVER, query);
  }
  assert.equal(searchBusinesses(index, '동명이인').total, 0);
  const entry = index.entries[0];
  assert.equal(entry.name, '주식회사 네이버');
  assert.equal(entry.fromPublic, false);
  assert.equal(entry.fromSaved, true);
  assert.equal(entry.fromSavedEvidence, true);
  assert.equal(entry.sourceUrl, evidence.sources[0].url);
  assert.equal(entry.collectedAt, '2026-10-21T13:00:00.000Z');
  assert.deepEqual(entry.sourceLabels, ['내 거래처', '저장한 공개자료']);
  assert.deepEqual(partner, original);

  const profileOnly = buildBusinessSearchIndex({ profile: { ...partner, name: '' } });
  assert.equal(searchBusinesses(profileOnly, 'naver').results[0].fromProfile, true);
  assert.equal(profileOnly.publicCount, 0);
  assert.equal(profileOnly.savedCount, 1);
  assert.equal(profileOnly.entries[0].fromSavedEvidence, true);
  assert.equal(buildBusinessSearchIndex().totalCount, 0, 'saved names never enter another account index');
});

test('fresh canonical source observations replace automatic names while real user aliases stay searchable', () => {
  const old = record(NAVER, '이전 공개 상호');
  old.fields.push({ field: 'name', value: '이전 영문 별칭', sourceId: 'registry' });
  const partner = { businessNumber: NAVER, name: '이전 공개 상호',
    nameOrigin: { kind: 'public', value: '이전 공개 상호', sourceId: 'registry' }, enrichment: old };
  const latest = record(NAVER, '새 공개 상호');
  latest.collectedAt = latest.sources[0].collectedAt = '2026-10-22T00:00:00Z';
  const refreshed = buildBusinessSearchIndex({ records: [latest], partners: [partner] });
  assert.equal(searchBusinesses(refreshed, '새 공개').total, 1);
  assert.equal(searchBusinesses(refreshed, '이전').total, 0, 'retired source values are not restored as private aliases');
  assert.equal(refreshed.publicCount, 1);
  assert.equal(refreshed.savedCount, 1);
  assert.equal(refreshed.entries[0].fromSavedEvidence, false);
  assert.equal(refreshed.entries[0].collectedAt, '2026-10-22T00:00:00.000Z');

  for (const alias of [{ ...partner, name: '내 포털 거래처' }, { ...partner, name: '내 포털 거래처', nameOrigin: null }]) {
    const index = buildBusinessSearchIndex({ records: [latest], partners: [alias] });
    assert.equal(searchBusinesses(index, '내 포털').total, 1);
    assert.equal(searchBusinesses(index, '새 공개').total, 1);
    assert.equal(searchBusinesses(index, '이전').total, 0);
  }
});

test('scope corrections shared across public, partner and profile evidence cannot revive automatic names', () => {
  const old = record(NAVER, '철회할 상호');
  const automatic = { businessNumber: NAVER, name: '철회할 상호',
    nameOrigin: { kind: 'public', value: '철회할 상호', sourceId: 'registry' }, enrichment: old };
  const corrected = record(NAVER, '철회할 상호');
  corrected.collectedAt = corrected.sources[0].collectedAt = '2026-10-22T00:00:00Z';
  corrected.sources[0].match = 'candidate';
  corrected.sources[0].identityMismatch = true;
  corrected.collection = { status: 'partial', lastAttemptAt: corrected.collectedAt, sourceStatuses: [{
    provider: 'web_page', sourceUrl: corrected.sources[0].url, status: 'identity_mismatch',
    errorCode: 'entity_scope_mismatch', checkedAt: corrected.collectedAt,
  }] };
  for (const input of [
    { records: [corrected], partners: [automatic] },
    { partners: [automatic], profile: { businessNumber: NAVER, name: '', enrichment: corrected } },
    { partners: [{ businessNumber: NAVER, name: '', enrichment: corrected }], profile: automatic },
  ]) {
    const index = buildBusinessSearchIndex(input);
    assert.equal(searchBusinesses(index, '철회').total, 0);
    assert.equal(index.totalCount, 0);
  }
  const alias = buildBusinessSearchIndex({ records: [corrected], partners: [{ ...automatic, name: '사용자 별칭' }] });
  assert.equal(searchBusinesses(alias, '사용자').total, 1);
  assert.equal(searchBusinesses(alias, '철회').total, 0);
  assert.equal(alias.entries[0].fromSavedEvidence, false);
  assert.equal(alias.entries[0].sourceUrl, '');
});

test('foreign or malformed saved evidence supplies no identity or address and untouched imported names stay excluded', () => {
  const foreign = record(OTHER, '다른 사업자 상호', '부산시 다른 주소');
  const manual = { businessNumber: NAVER, name: '수동 거래처', enrichment: foreign };
  const index = buildBusinessSearchIndex({ partners: [manual] });
  assert.equal(searchBusinesses(index, '수동').total, 1);
  assert.equal(searchBusinesses(index, '다른 사업자').total, 0);
  assert.equal(searchBusinesses(index, '수동 부산').total, 0);
  assert.equal(index.entries[0].fromSavedEvidence, false);
  assert.equal(index.entries[0].address, '');
  for (const enrichment of [foreign, {}, { ...record(), bno: OTHER }]) {
    const automatic = { businessNumber: NAVER, name: '검증되지 않은 자동 이름',
      nameOrigin: { kind: 'public', value: '검증되지 않은 자동 이름', sourceId: 'registry' }, enrichment };
    assert.equal(buildBusinessSearchIndex({ partners: [automatic] }).totalCount, 0);
  }
});

test('selected name provenance distinguishes retained private evidence from catalog observations', () => {
  const saved = record(NAVER, '저장한 공개 상호');
  const addressOnly = record(NAVER, '이름 제외 자료');
  addressOnly.sources[0].id = 'address';
  addressOnly.sources[0].url = 'https://address.example.com/' + NAVER;
  addressOnly.fields = [{ field: 'address', value: '경기도 성남시', sourceId: 'address' }];
  const retained = buildBusinessSearchIndex({ records: [addressOnly], partners: [{ businessNumber: NAVER, name: '', enrichment: saved }] });
  assert.equal(retained.totalCount, 1);
  assert.equal(retained.publicCount, 0, 'an address-only catalog entry is not a public searchable name');
  assert.equal(retained.savedCount, 1);
  assert.equal(retained.entries[0].fromSavedEvidence, true);
  assert.equal(retained.entries[0].sourceUrl, saved.sources[0].url);

  const both = buildBusinessSearchIndex({ records: [saved], partners: [{ businessNumber: NAVER, name: '', enrichment: saved }] });
  assert.equal(both.totalCount, 1);
  assert.equal(both.publicCount, 1);
  assert.equal(both.savedCount, 1);
  assert.equal(both.entries[0].fromSavedEvidence, false, 'the same observation already available publicly keeps catalog provenance');
});

test('percent and asterisk wildcards retain contains semantics, legal normalization and ordered gaps', () => {
  const index = buildBusinessSearchIndex({ partners: [
    { businessNumber: NAVER, name: '네이버' },
    { businessNumber: OTHER, name: '가게 네이버 거래처' },
    { businessNumber: RESTAURANT, name: '서해박속낙지전문점' },
  ] });
  const expected = searchBusinesses(index, '네이버');
  for (const query of ['%네이버%', '*네이버*', '%%**네이버**%%', '% (주) 네 이 버 %', '＊네이버％']) {
    assert.equal(classifyBusinessQuery(query).kind, 'name', query);
    assert.deepEqual(searchBusinesses(index, query), expected, query);
  }
  for (const query of ['서해%전문점', '서해*전문점', '%서해%낙지*전문점%']) {
    assert.deepEqual(searchBusinesses(index, query).results.map(entry => entry.businessNumber), [RESTAURANT], query);
  }
  assert.equal(searchBusinesses(index, '전문점%서해').total, 0, 'wildcard pieces retain their input order');
  assert.equal(searchBusinesses(index, '네%네').total, 0, 'separate literal pieces cannot reuse the same character');
  for (const query of ['%', '*', '%% ***', '%(주)%', '＊％']) {
    assert.equal(classifyBusinessQuery(query).kind, 'invalid', query);
    assert.equal(searchBusinesses(index, query).total, 0, query);
  }
});

test('wildcards treat regex metacharacters, escapes and underscore as literal text', () => {
  const index = buildBusinessSearchIndex({ partners: [
    { businessNumber: NAVER, name: 'A[0-9]+.(서울)_지점' },
    { businessNumber: RESTAURANT, name: 'A7x서울Z지점' },
    { businessNumber: OTHER, name: 'A\\센터' },
  ] });
  for (const query of ['[0-9]+.', 'A%[0-9]+.*_지점', '%_지점%', 'A\\%']) {
    const expected = query.includes('\\') ? OTHER : NAVER;
    assert.deepEqual(searchBusinesses(index, query).results.map(entry => entry.businessNumber), [expected], query);
  }
  assert.equal(searchBusinesses(index, 'A[0-9]+$').total, 0, 'regex syntax is never evaluated');
  assert.equal(searchBusinesses(index, 'A_Z').total, 0, 'underscore is not a single-character wildcard');
  const repeated = buildBusinessSearchIndex({ partners: [{ businessNumber: NAVER, name: 'a'.repeat(180) + 'b' }] });
  assert.equal(searchBusinesses(repeated, 'a%'.repeat(90) + 'c').total, 0);
  assert.equal(searchBusinesses(repeated, 'a*'.repeat(90) + 'b').total, 1);
});

test('wildcards preserve name-and-address narrowing, exact-first ordering and deterministic pagination', () => {
  const regional = buildBusinessSearchIndex({ records: [
    record(RESTAURANT, '서해박속낙지전문점', '경기도 광명시'),
    record(OTHER, '서해박속낙지전문점', '충청남도 서산시'),
  ] });
  assert.deepEqual(searchBusinesses(regional, '%광명% %서해*전문점%').results.map(entry => entry.businessNumber), [RESTAURANT]);
  assert.equal(searchBusinesses(regional, '%경기도% %광명%').total, 0, 'address-only terms do not become business names');
  assert.equal(searchBusinesses(regional, '서해*전문점 부산').total, 0);
  const ranked = buildBusinessSearchIndex({ partners: [
    { businessNumber: RESTAURANT, name: '가게 네이버' },
    { businessNumber: NAVER, name: '네이버' },
    { businessNumber: OTHER, name: '네이버 거래처' },
  ] });
  const expected = [NAVER, OTHER, RESTAURANT];
  for (const query of ['네이버', '%네이버%', '*네이버*']) {
    assert.deepEqual(searchBusinesses(ranked, query).results.map(entry => entry.businessNumber), expected);
    assert.equal(searchBusinesses(ranked, query, { limit: 1, offset: 1 }).results[0].businessNumber, OTHER);
    assert.equal(searchBusinesses(ranked, query, { limit: 1 }).total, 3);
  }
});
