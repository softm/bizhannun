import assert from 'node:assert/strict';
import test from 'node:test';
import { emptyWorkspace, validateBackup } from '../src/storage.mjs';
import { applyCheckResults } from '../src/domain.mjs';
import { attachPartnerEnrichment } from '../src/business-profile.mjs';

const BRN = '2208162517';
const OTHER_BRN = '1048137225';
const source = { name: '국세청', url: 'https://www.data.go.kr/data/15081808/openapi.do' };
const basePartner = () => ({ id: 'partner-1', businessNumber: BRN, name: '테스트 사업자', tags: [], note: '', history: [] });
const result = (overrides = {}) => ({
  businessNumber: BRN, outcome: 'ok', businessStatus: 'active', statusLabel: '계속사업자',
  taxType: null, closedAt: null, source, checkedAt: '2026-10-01T01:00:00.000Z', ...overrides,
});
const backup = (overrides = {}) => ({ ...emptyWorkspace(), partners: [basePartner()], ...overrides });

test('a real domain-generated status change survives a backup round trip', () => {
  const first = applyCheckResults([basePartner()], [result()]);
  const second = applyCheckResults(first.partners, [result({
    businessStatus: 'closed', statusLabel: '폐업자', closedAt: '2026-10-02',
    checkedAt: '2026-10-02T01:00:00.000Z',
  })]);
  const input = backup({
    partners: second.partners, events: second.events,
    checks: [{ id: 'batch-1', total: 1, ok: 1, failed: 0, checkedAt: '2026-10-02T01:00:00.000Z' }],
    profile: { name: '내 사업', businessNumber: BRN, interests: ['기술'], employees: 0, revenue: null },
  });
  const restored = validateBackup(JSON.parse(JSON.stringify(input)));
  assert.equal(restored.partners[0].lastSuccess.businessStatus, 'closed');
  assert.equal(restored.partners[0].history.length, 2);
  assert.equal(restored.events[0].businessNumber, BRN);
  assert.equal(restored.events[0].from, 'active');
  assert.equal(restored.checks[0].ok, 1);
  assert.equal(restored.profile.employees, 0);
  assert.equal(restored.profile.revenue, null);
});

test('malformed nested data that would crash rendering is rejected before restore', () => {
  for (const value of [
    backup({ events: [null] }), backup({ checks: [null] }), backup({ events: null }),
    backup({ checks: null }), backup({ profile: { interests: {} } }), backup({ profile: [] }),
    backup({ partners: [{ ...basePartner(), history: [null] }] }),
    backup({ partners: [{ ...basePartner(), tags: [{}] }] }),
    backup({ partners: [{ ...basePartner(), lastCheck: result({ source: null }) }] }),
  ]) assert.throws(() => validateBackup(value));
});

test('every stored snapshot and event must belong to its exact partner', () => {
  for (const field of ['lastCheck', 'lastSuccess', 'history']) {
    const foreign = result({ businessNumber: OTHER_BRN });
    const partner = { ...basePartner(), [field]: field === 'history' ? [foreign] : foreign };
    assert.throws(() => validateBackup(backup({ partners: [partner] })));
  }
  const first = applyCheckResults([basePartner()], [result()]);
  const second = applyCheckResults(first.partners, [result({ businessStatus: 'closed', checkedAt: '2026-10-02T01:00:00.000Z' })]);
  const event = second.events[0];
  assert.throws(() => validateBackup(backup({ partners: second.partners, events: [{ ...event, businessNumber: OTHER_BRN }] })));
  assert.throws(() => validateBackup(backup({ partners: second.partners, events: [{ ...event, partnerId: 'missing-partner' }] })));
});

test('duplicate identities, wrong business-number types, and future schemas are rejected', () => {
  for (const value of [
    backup({ partners: [basePartner(), { ...basePartner(), businessNumber: OTHER_BRN }] }),
    backup({ partners: [basePartner(), { ...basePartner(), id: 'other' }] }),
    backup({ partners: [{ ...basePartner(), businessNumber: Number(BRN) }] }),
    backup({ partners: [{ ...basePartner(), businessNumber: '1234567890' }] }),
    backup({ schemaVersion: 2 }), backup({ revision: -1 }),
  ]) assert.throws(() => validateBackup(value));
});

test('unknown result codes, impossible dates, unsafe links, and contradictory success records are rejected', () => {
  for (const override of [
    { outcome: 'success' }, { businessStatus: 'unrecognized' },
    { outcome: 'error', businessStatus: 'active' }, { checkedAt: '2026-02-30T00:00:00.000Z' },
    { closedAt: '2026-02-30' }, { sourceUrl: 'javascript:alert(1)' },
    { source: { name: '공개자료', url: 'https://user:password@example.com/' } },
  ]) assert.throws(() => validateBackup(backup({ partners: [{ ...basePartner(), lastCheck: result(override) }] })));
  assert.throws(() => validateBackup(backup({ partners: [{
    ...basePartner(), lastSuccess: result({ outcome: 'error', businessStatus: 'unknown' }),
  }] })));
});

test('profile and batch count types remain explicit and internally consistent', () => {
  for (const profile of [
    { employees: '0' }, { employees: -1 }, { revenue: Infinity },
    { revenueYear: 1800 }, { interests: ['unrecognized'] }, { foundedAt: '2026-02-30' },
  ]) assert.throws(() => validateBackup(backup({ profile })));
  assert.throws(() => validateBackup(backup({ checks: [{
    id: 'batch', total: 2, ok: 2, failed: 1, checkedAt: '2026-10-02T01:00:00.000Z',
  }] })));
});

test('restoring a backup drops unknown fields and cannot select an API destination', () => {
  const input = JSON.parse(JSON.stringify(backup({
    revision: 81, preferences: { apiBase: 'https://untrusted.example', secret: 'do-not-keep' },
    partners: [{ ...basePartner(), injected: { active: true } }],
    profile: { name: '내 사업', admin: true },
  })));
  Object.defineProperty(input, '__proto__', { value: { polluted: true }, enumerable: true });
  const restored = validateBackup(input);
  assert.deepEqual(restored.preferences, {});
  assert.equal(restored.revision, 0);
  assert.equal(Object.hasOwn(restored, '__proto__'), false);
  assert.equal(Object.hasOwn(restored.partners[0], 'injected'), false);
  assert.equal(Object.hasOwn(restored.profile, 'admin'), false);
  assert.equal({}.polluted, undefined);
});

function publicEvidence(businessNumber = BRN) {
  return { businessNumber, collectedAt: '2026-10-21T00:00:00Z',
    sources: [{ id: 'public-source', url: 'https://example.org/company', title: '공개 사업자자료',
      businessNumber, match: 'exact_bno', channel: 'public_data', collectedAt: '2026-10-21T00:00:00Z' }],
    fields: [{ field: 'name', value: '공개 상호', sourceId: 'public-source', match: 'exact_bno' },
      { field: 'address', value: '서울특별시 공개 사업장', sourceId: 'public-source', match: 'exact_bno' }] };
}

test('partner public snapshots and name attribution survive backup restoration separately from private notes', () => {
  const partner = attachPartnerEnrichment({ ...basePartner(), name: '', note: '내부 계약 메모' }, publicEvidence());
  const restored = validateBackup(JSON.parse(JSON.stringify(backup({ partners: [partner] }))));
  assert.deepEqual(restored.partners[0].enrichment, partner.enrichment);
  assert.deepEqual(restored.partners[0].nameOrigin, partner.nameOrigin);
  assert.equal(restored.partners[0].note, '내부 계약 메모');
  const again = validateBackup(JSON.parse(JSON.stringify(restored)));
  assert.deepEqual(again, restored);
});

test('business profile keeps its own source snapshot and rejects another business or a missing profile number', () => {
  const input = backup({ profile: { name: '내 사업', businessNumber: BRN, enrichment: publicEvidence() } });
  const restored = validateBackup(input);
  assert.equal(restored.profile.enrichment.businessNumber, BRN);
  assert.equal(restored.profile.enrichment.fields[1].value, '서울특별시 공개 사업장');
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(restored))).profile, restored.profile);
  for (const profile of [
    { businessNumber: OTHER_BRN, enrichment: publicEvidence() },
    { name: '번호 미입력', enrichment: publicEvidence() },
  ]) assert.throws(() => validateBackup(backup({ profile })), /일치/);
});

test('foreign or malformed public evidence is rejected before restore while legacy backups remain valid', () => {
  for (const enrichment of [publicEvidence(OTHER_BRN), { ...publicEvidence(), sources: null },
    { ...publicEvidence(), fields: [null] }, { ...publicEvidence(), bno: OTHER_BRN }]) {
    assert.throws(() => validateBackup(backup({ partners: [{ ...basePartner(), enrichment }] })));
  }
  const legacy = validateBackup(backup());
  assert.equal(legacy.partners[0].enrichment, undefined);
  assert.equal(legacy.partners[0].nameOrigin, undefined);
});

test('a manually changed public name cannot retain a false source attribution after restoring a backup', () => {
  const partner = attachPartnerEnrichment({ ...basePartner(), name: '' }, publicEvidence());
  partner.name = '나만의 거래처 별칭';
  const restored = validateBackup(backup({ partners: [partner] }));
  assert.equal(restored.partners[0].name, partner.name);
  assert.deepEqual(restored.partners[0].nameOrigin, { kind: 'user' });
  assert.equal(restored.partners[0].enrichment.fields[0].value, '공개 상호');
});
