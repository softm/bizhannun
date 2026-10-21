import test from 'node:test';
import assert from 'node:assert/strict';
import { attachPartnerEnrichment, derivePartnerProfile, normalizePartnerEnrichment, setPartnerName } from '../src/business-profile.mjs';

const BNO = '2208162517', OTHER = '1048137225';
const OLD = '2026-09-01T00:00:00.000Z', NOW = '2026-10-21T13:00:00.000Z';
const partner = (extra = {}) => ({ id: 'p1', businessNumber: BNO, name: '', note: '내부 거래 메모', tags: ['단골'], history: [], ...extra });
function record(name = '공개 상호', date = OLD, extra = {}) {
  return { businessNumber: BNO, collectedAt: date,
    sources: [{ id: 'registry', url: 'https://example.org/company', title: '공개 등록자료', channel: 'registry',
      match: 'exact_bno', businessNumber: BNO, collectedAt: date, scope: 'public_business' }],
    fields: [{ field: 'name', value: name, sourceId: 'registry', match: 'exact_bno' },
      { field: 'address', value: '서울특별시 중구 공개 사업장', sourceId: 'registry', match: 'exact_bno' }],
    collection: { status: 'success', lastAttemptAt: date, lastSuccessAt: date, sourceStatuses: [] }, ...extra };
}

test('public facts are attached separately from private notes and fill an empty name with provenance', () => {
  const original = partner(), snapshot = record();
  const saved = attachPartnerEnrichment(original, snapshot, { now: NOW });
  assert.equal(saved.name, '공개 상호');
  assert.deepEqual(saved.nameOrigin, { kind: 'public', value: '공개 상호', sourceId: 'registry' });
  assert.equal(saved.note, original.note);
  assert.deepEqual(saved.tags, original.tags);
  assert.equal(saved.enrichment.businessNumber, BNO);
  assert.equal(saved.updatedAt, NOW);
  assert.equal(original.enrichment, undefined);
  assert.equal(original.name, '');
  assert.deepEqual(attachPartnerEnrichment(saved, snapshot, { now: '2026-10-22T00:00:00Z' }), saved);
});

test('new confirmed names update automatic names but never overwrite user labels or unmarked legacy names', () => {
  const first = attachPartnerEnrichment(partner(), record(), { now: NOW });
  const latest = record('변경된 공개 상호', NOW);
  const updated = attachPartnerEnrichment(first, latest, { now: NOW });
  assert.equal(updated.name, '변경된 공개 상호');
  assert.equal(updated.nameOrigin.value, '변경된 공개 상호');
  const edited = setPartnerName(first, '우리 회사 납품처');
  assert.equal(edited.nameOrigin.kind, 'user');
  assert.equal(attachPartnerEnrichment(edited, latest, { now: NOW }).name, '우리 회사 납품처');
  assert.equal(attachPartnerEnrichment({ ...first, name: '직접 수정한 이름' }, latest, { now: NOW }).name, '직접 수정한 이름');
  assert.equal(attachPartnerEnrichment(partner({ name: '공개 상호' }), latest, { now: NOW }).name, '공개 상호');
  assert.equal(setPartnerName(first, first.name).nameOrigin.kind, 'public');
});

test('lookup and partner views share confirmed facts while preserving a private display name', () => {
  const saved = attachPartnerEnrichment(partner({ name: '납품처 A' }), record(), { now: NOW });
  const view = derivePartnerProfile(saved, record('새 법인명', NOW), { now: NOW });
  assert.equal(view.name, '납품처 A');
  assert.equal(view.publicName, '새 법인명');
  assert.equal(view.nameSourceLabel, '사용자 입력');
  assert.equal(view.profile.address, '서울특별시 중구 공개 사업장');
  assert.ok(view.insights.some(item => item.id === 'public-name-difference'));
  assert.equal(saved.enrichment.fields[0].value, '공개 상호');
});

test('foreign business evidence and contradictory identifiers cannot enter a partner snapshot or view', () => {
  const foreign = record('다른 회사', NOW, { businessNumber: OTHER });
  assert.throws(() => attachPartnerEnrichment(partner(), foreign), /일치/);
  assert.throws(() => derivePartnerProfile(partner(), foreign), /일치/);
  assert.throws(() => normalizePartnerEnrichment({ ...record(), bno: OTHER }, BNO), /일치/);
  assert.throws(() => normalizePartnerEnrichment({ ...record(), fields: 'invalid' }, BNO), /형식/);
});

test('candidate-only sources cannot supply a display name, official field, or automatic name provenance', () => {
  const candidate = record('동명이인 회사', NOW);
  candidate.sources[0].match = 'candidate';
  const saved = attachPartnerEnrichment(partner(), candidate, { now: NOW });
  const view = derivePartnerProfile(saved, null, { now: NOW });
  assert.equal(saved.name, '');
  assert.equal(saved.nameOrigin, undefined);
  assert.equal(view.fields.length, 0);
  assert.equal(view.publicName, '');
  assert.equal(view.metrics.candidateCount, 1);
  assert.equal(view.metrics.coverageCount, 0);
  assert.ok(view.insights.some(item => item.id === 'public-candidates'));
});

test('older and weakened source refreshes preserve the original fields and original evidence date', () => {
  const saved = attachPartnerEnrichment(partner(), record('현재 상호', NOW), { now: NOW });
  const older = attachPartnerEnrichment(saved, record('오래된 상호', OLD), { now: NOW });
  assert.equal(older.name, '현재 상호');
  assert.equal(older.enrichment.sources[0].collectedAt, NOW);
  const weakened = record('확인되지 않은 상호', '2026-10-22T00:00:00Z');
  weakened.sources[0].match = 'candidate';
  const kept = attachPartnerEnrichment(saved, weakened, { now: NOW });
  assert.equal(kept.name, '현재 상호');
  assert.equal(kept.enrichment.sources[0].collectedAt, NOW);
  assert.equal(kept.enrichment.collection.status, 'partial');
  assert.equal(kept.enrichment.fields.some(item => item.value === '확인되지 않은 상호'), false);
});

test('a refreshed source replaces its values atomically rather than dating previous values as new', () => {
  const saved = attachPartnerEnrichment(partner(), record(), { now: NOW });
  const latest = record('변경된 상호', NOW);
  latest.fields[1].value = '경기도 새 사업장 주소';
  const next = attachPartnerEnrichment(saved, latest, { now: NOW });
  assert.deepEqual(next.enrichment.fields.map(item => item.value), ['변경된 상호', '경기도 새 사업장 주소']);
  assert.equal(next.enrichment.sources[0].collectedAt, NOW);
  assert.equal(derivePartnerProfile(next, null, { now: NOW }).metrics.conflictCount, 0);
});

test('insights use individual source dates, preserve conflicting evidence, and disclose actual missing fields', () => {
  const evidence = record();
  evidence.collectedAt = NOW; // Recent job execution does not make the old source current.
  evidence.sources.push({ ...evidence.sources[0], id: 'official', url: 'https://other.example.org/company',
    collectedAt: NOW, title: '다른 공개 출처' });
  evidence.fields.push({ field: 'address', value: '다른 주소', sourceId: 'official', match: 'exact_bno' });
  const view = derivePartnerProfile(partner(), evidence, { now: NOW, staleDays: 30 });
  assert.equal(view.metrics.conflictCount, 1);
  assert.equal(view.metrics.staleCount, 1);
  assert.equal(view.metrics.coverageCount, 2);
  assert.equal(view.metrics.coverageTotal, 5);
  assert.equal(view.metrics.oldestCollectedAt, OLD);
  assert.ok(view.insights.some(item => item.id === 'public-conflicts' && item.sourceIds.length === 2));
  assert.ok(view.insights.some(item => item.id === 'public-stale'));
  assert.deepEqual(view.missingFields.map(item => item.field), ['industry', 'website', 'contact']);
});

test('missing or failed new collection keeps saved source-backed information available', () => {
  const saved = attachPartnerEnrichment(partner(), record(), { now: NOW });
  const failed = record('', NOW, { sources: [], fields: [], collection: { status: 'failed', lastAttemptAt: NOW } });
  const view = derivePartnerProfile(saved, failed, { now: NOW });
  assert.equal(view.publicName, '공개 상호');
  assert.equal(view.record.sources[0].collectedAt, OLD);
  assert.ok(view.insights.some(item => item.id === 'public-collection'));
  assert.equal(derivePartnerProfile(saved, null, { now: NOW }).fields.length, 2);
});

test('an explicit entity-scope correction withdraws old confirmed fields and their automatic display name', () => {
  const original = record();
  original.sources[0].channel = 'website';
  const saved = attachPartnerEnrichment(partner(), original, { now: OLD });
  const corrected = structuredClone(saved.enrichment);
  corrected.sources[0].match = 'candidate';
  corrected.fields = corrected.fields.map(field => ({ ...field, match: 'candidate' }));
  corrected.collection = { status: 'partial', lastAttemptAt: NOW, sourceStatuses: [{ provider: 'web_page',
    sourceUrl: original.sources[0].url, checkedAt: NOW, status: 'identity_mismatch', errorCode: 'entity_scope_mismatch' }] };
  const preview = derivePartnerProfile(saved, corrected, { now: NOW });
  assert.equal(preview.name, '');
  assert.equal(preview.publicName, '');
  assert.equal(preview.fields.length, 0);
  assert.ok(preview.insights.some(item => item.id === 'public-identity-review'));
  assert.equal(preview.record.sources[0].collectedAt, OLD);
  const withdrawn = attachPartnerEnrichment(saved, corrected, { now: NOW });
  assert.equal(withdrawn.name, '');
  assert.equal(withdrawn.nameOrigin, undefined);
  assert.equal(withdrawn.enrichment.fields[0].value, '공개 상호');
  assert.equal(withdrawn.enrichment.fields[0].match, 'candidate');
  assert.equal(withdrawn.note, '내부 거래 메모');
  // An older catalog must not silently reinstate facts whose identity was explicitly corrected.
  assert.equal(derivePartnerProfile(withdrawn, original, { now: NOW }).fields.length, 0);
  const reconfirmed = record('다시 번호를 확인한 상호', '2026-10-22T00:00:00Z');
  reconfirmed.sources[0].channel = 'website';
  assert.equal(attachPartnerEnrichment(withdrawn, reconfirmed, { now: NOW }).name, '다시 번호를 확인한 상호');
});

test('same-URL automatic web evidence replaces a reviewed snapshot with a different source ID', () => {
  const original = record();
  original.sources[0].channel = 'directory';
  const saved = attachPartnerEnrichment(partner(), original, { now: OLD });
  const latest = record('갱신한 공개 상호', NOW);
  latest.sources[0].channel = 'directory';
  latest.sources[0].id = 'automatic-page';
  latest.fields = latest.fields.map(field => ({ ...field, sourceId: 'automatic-page' }));
  const next = attachPartnerEnrichment(saved, latest, { now: NOW });
  assert.equal(next.enrichment.sources.length, 1);
  assert.equal(next.name, '갱신한 공개 상호');
  assert.equal(next.nameOrigin.sourceId, 'automatic-page');
  assert.equal(next.enrichment.fields.some(field => field.sourceId === 'registry'), false);
});

test('two independent registry records sharing one documentation URL are preserved', () => {
  const original = record(), next = record('새 등록 상호', NOW);
  next.sources[0].id = 'second-registry-record';
  next.fields = next.fields.map(field => ({ ...field, sourceId: 'second-registry-record' }));
  const saved = attachPartnerEnrichment(attachPartnerEnrichment(partner(), original), next);
  assert.equal(saved.enrichment.sources.length, 2);
  assert.equal(derivePartnerProfile(saved, null, { now: NOW }).metrics.conflictCount, 1);
});

test('reviewed history keeps omitted facts until the same page actually reobserves those fields', () => {
  const original = record();
  original.sources[0].channel = 'website';
  original.fields.push({ field: 'products', value: '검토한 제품', sourceId: 'registry' });
  const saved = attachPartnerEnrichment(partner(), original, { now: OLD });
  const current = record('공개 상호', NOW);
  current.sources[0].channel = 'website';
  current.sources[0].id = 'automatic-page';
  current.fields = [{ field: 'address', value: '새 주소', sourceId: 'automatic-page' }];
  current.sources.push({ ...original.sources[0], id: 'historical-reviewed-registry' });
  current.fields.push(...original.fields.filter(field => field.field !== 'address')
    .map(field => ({ ...field, sourceId: 'historical-reviewed-registry' })));
  const withHistory = attachPartnerEnrichment(saved, current, { now: NOW });
  const profile = derivePartnerProfile(withHistory, null, { now: NOW });
  assert.equal(profile.publicName, '공개 상호');
  assert.equal(profile.profile.products, '검토한 제품');
  assert.equal(profile.record.sources.length, 2);
  assert.equal(profile.record.sources.find(source => source.id.startsWith('historical-reviewed-')).collectedAt, OLD);
  const complete = record('다시 읽은 상호', '2026-10-22T00:00:00Z');
  complete.sources[0].channel = 'website';
  complete.sources[0].id = 'automatic-page';
  complete.fields = complete.fields.map(field => ({ ...field, sourceId: 'automatic-page' }));
  complete.fields.push({ field: 'products', value: '다시 읽은 제품', sourceId: 'automatic-page' });
  const refreshed = attachPartnerEnrichment(withHistory, complete, { now: NOW });
  assert.equal(refreshed.name, '다시 읽은 상호');
  assert.equal(refreshed.enrichment.sources.length, 1);
  assert.equal(refreshed.enrichment.fields.some(field => field.sourceId.startsWith('historical-reviewed-')), false);
});

test('same-URL identity correction also withdraws reviewed history and survives later fetch failures', () => {
  const original = record();
  original.sources[0].channel = 'website';
  original.sources.push({ ...original.sources[0], id: 'historical-reviewed-registry' });
  original.fields.push({ field: 'products', value: '이전 검토 제품', sourceId: 'historical-reviewed-registry' });
  const saved = attachPartnerEnrichment(partner(), original, { now: OLD });
  const corrected = { ...original, collection: { status: 'partial', lastAttemptAt: NOW, sourceStatuses: [{
    provider: 'web_page', sourceUrl: original.sources[0].url, checkedAt: NOW,
    status: 'identity_mismatch', errorCode: 'entity_scope_mismatch',
  }] } };
  const withdrawn = attachPartnerEnrichment(saved, corrected, { now: NOW });
  assert.equal(withdrawn.name, '');
  assert.ok(withdrawn.enrichment.sources.every(source => source.match === 'candidate' && source.identityMismatch));
  assert.equal(derivePartnerProfile(withdrawn, null, { now: NOW }).fields.length, 0);
  const failed = record('', '2026-10-22T00:00:00Z', { sources: [], fields: [],
    collection: { status: 'failed', lastAttemptAt: '2026-10-22T00:00:00Z', sourceStatuses: [{
      provider: 'web_page', sourceUrl: original.sources[0].url, checkedAt: '2026-10-22T00:00:00Z', status: 'error',
    }] } });
  const afterFailure = attachPartnerEnrichment(withdrawn, failed, { now: NOW });
  const stale = derivePartnerProfile(afterFailure, original, { now: NOW });
  assert.equal(stale.fields.length, 0);
  assert.equal(stale.name, '');
  assert.ok(stale.summary.collection.sourceStatuses.some(status => status.errorCode === 'entity_scope_mismatch'));
});
