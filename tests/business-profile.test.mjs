import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveBusinessProfile } from '../src/business-profile.mjs';
import { summarizeEnrichment } from '../src/enrichment.mjs';

const businessNumber = '6901100416';
const otherNumber = '2208162517';
const collectedAt = '2026-10-21T13:00:00.000Z';
const record = () => ({
  businessNumber,
  entityType: 'business',
  collectedAt,
  sources: [{ id: 'directory', url: 'https://www.bizno.net/article/6901100416', title: '공개 사업자정보',
    channel: 'directory', match: 'exact_bno', businessNumber, scope: 'public_business', collectedAt }],
  fields: [{ field: 'name', value: '서해박속낙지전문점', sourceId: 'directory' },
    { field: 'address', value: '경기도 광명시 오리로 1034-1', sourceId: 'directory' }],
});

test('saved empty counterparty name joins public identity by normalized business number', () => {
  const partner = { id: 'saved', businessNumber, name: '', note: '기존 메모', tags: ['식당'] };
  const original = structuredClone(partner);
  const result = resolveBusinessProfile({ businessNumber: '690-11-00416', partner, record: record() });
  assert.equal(result.businessNumber, businessNumber);
  assert.equal(result.displayName, '서해박속낙지전문점');
  assert.equal(result.publicName, '서해박속낙지전문점');
  assert.equal(result.nameSource, 'public');
  assert.equal(result.nameMatch, 'exact_bno');
  assert.equal(result.nameSourceLabel, '민간 기업정보 · 공개 사업자정보');
  assert.equal(result.nameSourceUrl, 'https://www.bizno.net/article/6901100416');
  assert.equal(result.nameCollectedAt, collectedAt);
  assert.equal(result.identityMatched, true);
  assert.deepEqual(partner, original, 'resolving does not mutate saved private information');
});

test('a user alias remains the display name while the public company name retains its source', () => {
  const result = resolveBusinessProfile({ businessNumber, partner: { businessNumber, name: '주 거래 식당' }, record: record() });
  assert.equal(result.displayName, '주 거래 식당');
  assert.equal(result.userName, '주 거래 식당');
  assert.equal(result.publicName, '서해박속낙지전문점');
  assert.equal(result.hasCustomName, true);
  assert.equal(result.nameSource, 'user');
  assert.equal(result.nameSourceLabel, '사용자 입력');
  assert.equal(result.nameSourceUrl, null, 'user alias must not be attributed to a directory');
  assert.equal(result.nameCollectedAt, null);
  assert.equal(result.publicNameSourceUrl, 'https://www.bizno.net/article/6901100416');
});

test('mismatched partner and public record cannot leak names from another business', () => {
  const otherRecord = record();
  otherRecord.businessNumber = otherNumber;
  otherRecord.sources[0].businessNumber = otherNumber;
  const result = resolveBusinessProfile({ businessNumber, partner: { businessNumber: otherNumber, name: '다른 회사' }, record: otherRecord });
  assert.equal(result.displayName, '이름 미입력');
  assert.equal(result.userName, '');
  assert.equal(result.publicName, '');
  assert.equal(result.summary, null);
  assert.equal(result.identityMatched, false);
  assert.equal(result.hasPublicRecord, false);
});

test('a matching candidate source does not establish or supply a public company name', () => {
  const candidate = record();
  candidate.sources[0].match = 'candidate';
  candidate.fields[0].match = 'exact_bno';
  const result = resolveBusinessProfile({ businessNumber, record: candidate });
  assert.equal(result.displayName, '이름 미입력');
  assert.equal(result.publicName, '');
  assert.equal(result.nameSource, 'missing');
  assert.equal(result.identityMatched, false);
  assert.equal(result.hasPublicRecord, true);
  assert.equal(result.summary.candidateCount, 1);
});

test('a summary must have attributable fields; a fabricated profile alone is ignored', () => {
  const summary = summarizeEnrichment(record());
  summary.profile.name = '위조된 화면용 상호';
  const result = resolveBusinessProfile({ businessNumber, summary });
  assert.equal(result.displayName, '서해박속낙지전문점');
  assert.equal(resolveBusinessProfile({ businessNumber, summary: { businessNumber, profile: { name: '근거 없는 상호' } } }).publicName, '');
  assert.equal(resolveBusinessProfile({ businessNumber: otherNumber, summary }).summary, null);
});

test('summary round trips preserve domain provenance, alternatives and candidate separation', () => {
  const input = record();
  input.officialDomain = 'restaurant.example.com';
  input.sources.push({ id: 'site', url: 'https://restaurant.example.com/about', title: '음식점 소개',
    channel: 'official_website', match: 'confirmed_domain', collectedAt });
  input.fields.push({ field: 'name', value: '서해낙지', sourceId: 'site' });
  const original = summarizeEnrichment(input);
  const once = resolveBusinessProfile({ businessNumber, summary: original });
  const twice = resolveBusinessProfile({ businessNumber, summary: once.summary });
  assert.equal(once.nameHasConflict, true);
  assert.equal(once.summary.confirmedCount, 2);
  assert.equal(once.summary.fields.find(value => value.field === 'name').alternatives.length, 1);
  assert.deepEqual(once, twice);
});

test('malformed identity, contradictory record aliases and missing data stay unlinked', () => {
  assert.equal(resolveBusinessProfile({ businessNumber: 'not-a-number', partner: { businessNumber: 'not-a-number', name: '잘못된 거래처' }, record: record() }).displayName, '이름 미입력');
  assert.equal(resolveBusinessProfile({ businessNumber, record: { ...record(), bno: otherNumber } }).identityMatched, false);
  assert.equal(resolveBusinessProfile().businessNumber, '');
  assert.equal(resolveBusinessProfile({ businessNumber }).publicName, '');
  const mismatch = { ...record(), businessNumber: otherNumber };
  assert.equal(resolveBusinessProfile({ businessNumber, record: mismatch, summary: summarizeEnrichment(record()) }).summary, null,
    'a contradictory explicit record must not be repaired using a possibly stale summary');
});

test('failed collection keeps previous attributable facts and the failure timestamp', () => {
  const input = record();
  input.collection = { status: 'failed', lastAttemptAt: '2026-10-22T01:00:00Z', lastSuccessAt: collectedAt };
  const result = resolveBusinessProfile({ businessNumber, record: input });
  assert.equal(result.displayName, '서해박속낙지전문점');
  assert.equal(result.nameCollectedAt, collectedAt);
  assert.equal(result.summary.collection.status, 'failed');
  assert.equal(result.summary.collection.lastAttemptAt, '2026-10-22T01:00:00.000Z');
});

test('canonical resolution includes saved snapshots and keeps automatic names attributed to public evidence', () => {
  const evidence = record();
  const saved = { businessNumber, name: '서해박속낙지전문점',
    nameOrigin: { kind: 'public', value: '서해박속낙지전문점', sourceId: 'directory' }, enrichment: evidence };
  const original = structuredClone(saved);
  const offline = resolveBusinessProfile({ businessNumber, partner: saved });
  assert.equal(offline.displayName, '서해박속낙지전문점');
  assert.equal(offline.nameSource, 'public');
  assert.equal(offline.userName, '');
  assert.equal(offline.nameSourceLabel, '민간 기업정보 · 공개 사업자정보');
  const latest = record();
  latest.collectedAt = latest.sources[0].collectedAt = '2026-10-22T01:00:00.000Z';
  latest.fields[0].value = '새로 확인한 공개 상호';
  const refreshed = resolveBusinessProfile({ businessNumber, partner: saved, record: latest });
  assert.equal(refreshed.displayName, '새로 확인한 공개 상호');
  assert.equal(refreshed.nameCollectedAt, latest.collectedAt);
  assert.equal(refreshed.hasCustomName, false);
  const alias = resolveBusinessProfile({ businessNumber, partner: { ...saved, name: '우리 단골 식당' }, record: latest });
  assert.equal(alias.displayName, '우리 단골 식당');
  assert.equal(alias.nameSource, 'user');
  assert.equal(alias.publicName, '새로 확인한 공개 상호');
  assert.deepEqual(saved, original);
});
