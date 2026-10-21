import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBusinessProfileDraft, evidenceChanges, renderBusinessInsights } from '../src/business-dashboard.mjs';
import { attachPartnerEnrichment, derivePartnerProfile, setPartnerName } from '../src/business-profile.mjs';
import { renderEnrichment } from '../src/enrichment-view.mjs';
import { emptyWorkspace, validateBackup } from '../src/storage.mjs';

const BNO = '2208162517', OTHER = '1048137225', NOW = '2026-10-21T00:00:00Z';
function evidence(extra = {}) {
  return { businessNumber: BNO, entityType: 'corporation', collectedAt: NOW,
    sources: [{ id: 's', businessNumber: BNO, match: 'exact_bno', url: 'https://example.org/company', title: '확인한 등록자료', channel: 'public_data', collectedAt: NOW }],
    fields: [{ field: 'name', value: '공개 사업자명', sourceId: 's' }, { field: 'address', value: '경기도 광명시 공개 사업장', sourceId: 's' },
      { field: 'industry', value: '소프트웨어 개발', sourceId: 's' }, { field: 'foundedAt', value: '2024-02-29', sourceId: 's' }], ...extra };
}

test('formatted same-business drafts keep unsaved user names, finances, zero employees, and interests', () => {
  const current = { businessNumber: '220-81-62517', name: '내가 작성한 상호', revenue: '2500', employees: '0', interests: ['기술'] };
  const draft = buildBusinessProfileDraft(current, BNO, evidence());
  assert.equal(draft.businessNumber, BNO);
  assert.equal(draft.name, current.name);
  assert.equal(draft.revenue, current.revenue);
  assert.equal(draft.employees, '0');
  assert.deepEqual(draft.interests, ['기술']);
  assert.equal(draft.region, '경기');
  assert.equal(draft.foundedAt, '2024-02-29');
  assert.equal(draft.enrichment.businessNumber, BNO);
  assert.equal(current.region, undefined);
});

test('foreign evidence cannot assign company type or fields, and switching business never copies its finances', () => {
  const foreign = evidence({ businessNumber: OTHER });
  const empty = buildBusinessProfileDraft({}, BNO, foreign);
  assert.equal(empty.businessKind, '');
  assert.equal(empty.name, '');
  assert.equal(empty.enrichment, undefined);
  const current = { businessNumber: OTHER, name: '이전 사업', revenue: 100, employees: 7, interests: ['금융'], enrichment: foreign };
  const draft = buildBusinessProfileDraft(current, BNO, evidence());
  assert.equal(draft.name, '공개 사업자명');
  assert.equal(draft.revenue, undefined);
  assert.equal(draft.employees, undefined);
  assert.deepEqual(draft.interests, ['금융']);
  assert.equal(draft.enrichment.businessNumber, BNO);
});

test('only actual calendar dates are prefilled, while a supplied user date remains unchanged', () => {
  const source = evidence();
  source.fields.find(field => field.field === 'foundedAt').value = '2026-02-30';
  assert.equal(buildBusinessProfileDraft({}, BNO, source).foundedAt, '');
  source.fields.find(field => field.field === 'foundedAt').value = '2025-02-29';
  assert.equal(buildBusinessProfileDraft({}, BNO, source).foundedAt, '');
  assert.equal(buildBusinessProfileDraft({ foundedAt: '2020-01-10' }, BNO, source).foundedAt, '2020-01-10');
});

test('lookup, previously blank partner, restored detail, and business profile share the same numbered evidence', () => {
  const original = { id: 'p', businessNumber: BNO, name: '', note: '비공개 내부 메모', tags: [], history: [] };
  const lookup = derivePartnerProfile(original, evidence(), { now: NOW });
  let savedPartner = attachPartnerEnrichment(original, lookup.record, { now: NOW });
  savedPartner = setPartnerName(savedPartner, lookup.name);
  const restored = validateBackup(JSON.parse(JSON.stringify({ ...emptyWorkspace(), partners: [savedPartner] })));
  const detail = derivePartnerProfile(restored.partners[0], null, { now: NOW });
  assert.equal(detail.name, '공개 사업자명');
  assert.equal(detail.nameSourceLabel, '확인한 등록자료');
  const html = renderEnrichment({ businessNumber: BNO, record: detail.record, summary: detail.summary, name: detail.name, analysis: detail, compact: true });
  assert.match(html, /경기도 광명시 공개 사업장/);
  assert.match(html, /data-business-number="2208162517"/);
  assert.doesNotMatch(html, /비공개 내부 메모/);
  const draft = buildBusinessProfileDraft({}, BNO, detail.record);
  const profileSaved = validateBackup({ ...restored, profile: draft });
  assert.equal(profileSaved.profile.name, detail.publicName);
  assert.equal(profileSaved.profile.region, '경기');
  assert.deepEqual(profileSaved.profile.enrichment, detail.record);
  assert.equal(profileSaved.partners[0].note, '비공개 내부 메모');
});

test('evidence comparisons never cross businesses and visible counts describe information coverage', () => {
  assert.deepEqual(evidenceChanges(evidence(), evidence({ businessNumber: OTHER })), []);
  const view = derivePartnerProfile({ businessNumber: BNO, name: '' }, evidence(), { now: NOW });
  const html = renderBusinessInsights(view);
  assert.match(html, /기본정보 확보/);
  assert.match(html, /신용점수나 거래 안전성 점수가 아닙니다/);
  assert.equal(view.metrics.coverageCount, 3);
  assert.equal(view.metrics.coverageTotal, 5);
});
