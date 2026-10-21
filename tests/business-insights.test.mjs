import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeEnrichment } from '../src/enrichment.mjs';
import { BASIC_BUSINESS_FIELDS, buildBusinessInsights } from '../src/business-insights.mjs';
import { renderBusinessInsights } from '../src/business-insights-view.mjs';

const BNO = '6901100416';
const OTHER = '2208162517';
const NOW = '2026-10-21T14:00:00Z';
const STAMP = '2026-10-21T13:00:00Z';
const source = (overrides = {}) => ({
  id: 'directory', url: 'https://www.bizno.net/article/' + BNO, title: '공개 사업자정보',
  channel: 'directory', businessNumber: BNO, match: 'exact_bno', collectedAt: STAMP, scope: 'public_business', ...overrides,
});
const record = (overrides = {}) => ({
  businessNumber: BNO, collectedAt: STAMP, entityType: 'business', sources: [source()],
  fields: [
    ['name', '서해박속낙지전문점'], ['address', '경기도 광명시 오리로 1034-1'], ['phone', '02-2682-7211'],
    ['businessType', '숙박 및 음식점업'], ['businessCategory', '일반한식'],
  ].map(([field, value]) => ({ field, value, sourceId: 'directory' })), ...overrides,
});
const status = (overrides = {}) => ({
  businessNumber: BNO, outcome: 'ok', businessStatus: 'active', taxType: '부가가치세 일반과세자',
  checkedAt: STAMP, source: { name: '국세청 사업자등록정보', url: 'https://www.data.go.kr/data/15081808/openapi.do' }, ...overrides,
});
const build = (overrides = {}) => buildBusinessInsights({
  businessNumber: BNO, partner: { businessNumber: BNO, name: '', history: [] },
  check: status(), summary: summarizeEnrichment(record()), now: NOW, ...overrides,
});

test('the attached restaurant case joins blank saved name to confirmed public facts and yields actionable gaps', () => {
  const model = build();
  assert.equal(model.displayName, '서해박속낙지전문점');
  assert.equal(model.identityMatched, true);
  assert.equal(model.status.label, '계속사업자');
  assert.equal(model.status.taxType, '부가가치세 일반과세자');
  assert.equal(model.profile.confirmedCount, 5);
  assert.equal(model.profile.totalCount, 6);
  assert.deepEqual(model.profile.missing.map(item => item.field), ['website']);
  assert.equal(model.evidence.domainCount, 1);
  assert.equal(model.actions.find(item => item.id === 'profile-gaps').action, 'enrichment-request');
  assert.equal(model.actions.some(item => /credit|score|risk/.test(item.id)), false);
});

test('a user name is preserved as an alias without becoming a public conflict or verified name', () => {
  const model = build({ partner: { businessNumber: BNO, name: '우리 단골 식당' } });
  assert.equal(model.displayName, '우리 단골 식당');
  assert.equal(model.publicName, '서해박속낙지전문점');
  assert.equal(model.nameDifference, true);
  assert.equal(model.conflicts.length, 0);
  const userOnly = build({ summary: null, partner: { businessNumber: BNO, name: '우리 단골 식당' } });
  assert.equal(userOnly.profile.confirmedCount, 0);
});

test('mismatched partner, check or summary never leak into another business insight', () => {
  const model = build({
    partner: { businessNumber: OTHER, name: '다른 업체', lastSuccess: status({ businessNumber: OTHER }) },
    check: status({ businessNumber: OTHER }),
    summary: { ...summarizeEnrichment(record()), businessNumber: OTHER },
  });
  assert.equal(model.identityRejected, true);
  assert.equal(model.identityMatched, false);
  assert.equal(model.profile.confirmedCount, 0);
  assert.equal(model.status.businessStatus, 'unknown');
  assert.equal(model.displayName.includes('다른 업체'), false);
  assert.equal(model.actions[0].id, 'identity-mismatch');
});

test('unconfirmed search candidates and wrong source-level business numbers cannot supply facts', () => {
  const summary = summarizeEnrichment(record());
  summary.sources[0].businessNumber = OTHER;
  const model = build({ summary });
  assert.equal(model.profile.confirmedCount, 0);
  assert.equal(model.evidence.sourceCount, 0);
  assert.equal(model.evidence.candidateCount, 1);
  const candidate = build({ summary: summarizeEnrichment(record({ sources: [source({ match: 'candidate' })] })) });
  assert.equal(candidate.profile.confirmedCount, 0);
  assert.equal(candidate.evidence.candidateCount, 1);
});

test('forged summary profile and unsupported confirmed-domain claims cannot become identity evidence', () => {
  const forged = build({ summary: { businessNumber: BNO, profile: { name: '원천 없는 이름', address: '원천 없는 주소' }, sources: [], fields: [] } });
  assert.equal(forged.profile.confirmedCount, 0);
  assert.equal(forged.publicName, '');
  const summary = summarizeEnrichment(record());
  summary.sources[0].match = 'confirmed_domain';
  summary.sources[0].url = 'https://unrelated.example.com/';
  summary.officialDomain = 'restaurant.example.com';
  assert.equal(build({ summary }).profile.confirmedCount, 0);
});

test('failed latest lookup retains but clearly labels the last successful status and old timestamp', () => {
  const success = status({ checkedAt: '2026-10-11T10:00:00Z' });
  const failed = status({ outcome: 'error', businessStatus: 'unknown', checkedAt: STAMP });
  const model = build({ check: failed, partner: { businessNumber: BNO, name: '', lastSuccess: success, lastCheck: failed, history: [failed, success] } });
  assert.equal(model.status.usingPrevious, true);
  assert.equal(model.status.businessStatus, 'active');
  assert.equal(model.status.checkedAt, '2026-10-11T10:00:00.000Z');
  assert.equal(model.status.freshness.state, 'stale');
  assert.equal(model.status.needsRefresh, true);
  assert.equal(model.actions[0].id, 'latest-query-failed');
  assert.match(renderBusinessInsights(model), /직전 성공 기록/);
  assert.match(renderBusinessInsights(model), /직전 성공 시점의 기록/);
});

test('not-found and query failures do not invent a closure or erase a preceding successful status', () => {
  for (const outcome of ['not_found', 'not_configured', 'error']) {
    const model = build({ check: status({ outcome, businessStatus: 'unknown' }), summary: null });
    assert.equal(model.status.businessStatus, 'unknown');
    assert.equal(model.actions.some(item => item.id === 'operation-check'), false);
    assert.equal(model.actions[0].id, 'latest-query-failed');
  }
});

test('public freshness uses actual field-source collection time and cannot be refreshed by a manifest date', () => {
  const old = source({ collectedAt: '2026-09-01T00:00:00Z' });
  const model = build({ summary: summarizeEnrichment(record({ sources: [old], collectedAt: STAMP })) });
  assert.equal(model.evidence.staleFieldCount, 5);
  assert.equal(model.evidence.latestCollectedAt, '2026-09-01T00:00:00.000Z');
  assert.equal(model.actions.find(item => item.id === 'public-recheck').action, 'enrichment-request');
});

test('app recheck boundaries are strict, date anomalies never display fresh, invalid numbers stay unlinked', () => {
  const boundary = build({ check: status({ checkedAt: '2026-10-14T14:00:00Z' }) });
  assert.equal(boundary.status.freshness.state, 'fresh');
  assert.equal(boundary.status.needsRefresh, false);
  assert.equal(build({ check: status({ checkedAt: '2026-10-14T13:59:59Z' }) }).status.freshness.state, 'stale');
  for (const value of ['2026-10-23T00:00:00Z', '2026-02-31', 'bad-date']) {
    const model = build({ check: status({ checkedAt: value }) });
    assert.notEqual(model.status.freshness.state, 'fresh');
    assert.match(renderBusinessInsights(model), /조회 시각/);
  }
  const invalid = build({ businessNumber: '1234567890' });
  assert.equal(invalid.validNumber, false);
  assert.equal(invalid.profile.confirmedCount, 0);
  assert.equal(invalid.actions[0].id, 'invalid-number');
});

test('future and undated public evidence are visible but explicitly request collection-time review', () => {
  for (const collectedAt of ['2026-11-01T00:00:00Z', null]) {
    const summary = summarizeEnrichment(record({ sources: [source({ collectedAt })], collectedAt }));
    const model = build({ summary });
    assert.equal(model.profile.confirmedCount, 5);
    assert.equal(model.evidence.undatedFieldCount, 5);
    assert.equal(model.actions.some(item => item.id === 'public-recheck'), true);
  }
});

test('source counts deduplicate repeated URLs and hosts without calling them independent verification', () => {
  const sources = [source(), source({ id: 'again' }), source({ id: 'about', url: 'https://bizno.net/about' })];
  const model = build({ summary: summarizeEnrichment(record({ sources })) });
  assert.equal(model.evidence.sourceCount, 2);
  assert.equal(model.evidence.domainCount, 1);
  assert.match(renderBusinessInsights(model), /독립 검증 횟수가 아닙니다/);
});

test('conflicts retain differently valued same-business observations, while candidate values are excluded', () => {
  const base = record();
  const summary = summarizeEnrichment({
    ...base, sources: [...base.sources, source({ id: 'second', url: 'https://registry.example.com/entry', channel: 'registry' })],
    fields: [...base.fields, { field: 'address', value: '경기도 광명시 새주소 2', sourceId: 'second' }],
  });
  const model = build({ summary });
  assert.equal(model.conflicts.length, 1);
  assert.equal(model.conflicts[0].field, 'address');
  assert.equal(model.conflicts[0].values.length, 2);
  assert.equal(model.actions[0].id, 'field-conflicts');
  assert.match(renderBusinessInsights(model), /출처별 값 차이 1개/);
  assert.match(renderBusinessInsights(model), /data-action="insight-view-sources" data-insight-id="field-conflicts"/);
});


test('NAVER overview/history prose and differently scoped measurements stay as evidence without priority conflicts', () => {
  // Fixture values intentionally describe different pages, periods and measurement scopes.
  const observations = [
    ['description', 'NAVER 회사 소개: 검색·커머스·클라우드 서비스', 'NAVER 연혁: 창립 이후의 주요 서비스 출시 기록'],
    ['products', '검색, 커머스', '클라우드, 콘텐츠'],
    ['certifications', '정보보호 인증', '환경 경영 인증'],
    ['registration', '본사 통신판매업 신고', '사업장별 인허가 목록'],
    ['revenue', '2025년 연결 매출 10조 원', '2024년 별도 매출 6조 원'],
    ['employees', '2025년 말 연결 인원 10,000명', '2026년 9월 본사 인원 5,000명'],
    ['insuranceEmployeeCount', '2026년 9월 국민연금 가입자 4,800명', '2026년 10월 고용보험 가입자 4,700명'],
    ['insuranceEstablishedAt', '본사 보험 성립일 1999-06-01', '지점 보험 성립일 2010-01-01'],
    ['insuranceIndustry', '국민연금 적용 업종: 정보서비스업', '산재보험 적용 업종: 전문서비스업'],
    ['insuranceType', '국민연금', '고용보험'],
  ];
  const summary = summarizeEnrichment({
    businessNumber: OTHER, entityType: 'corporation', collectedAt: STAMP,
    sources: [
      source({ id: 'overview', businessNumber: OTHER, url: 'https://www.navercorp.com/company', title: 'NAVER 회사 소개', channel: 'official_website' }),
      source({ id: 'history', businessNumber: OTHER, url: 'https://www.navercorp.com/company/history', title: 'NAVER 연혁', channel: 'official_website' }),
    ],
    fields: [
      { field: 'name', value: 'NAVER', sourceId: 'overview' },
      ...observations.flatMap(([field, first, second]) => [
        { field, value: first, sourceId: 'overview' },
        { field, value: second, sourceId: 'history' },
      ]),
    ],
  });
  const model = build({
    businessNumber: OTHER, partner: { businessNumber: OTHER, name: '' },
    check: status({ businessNumber: OTHER }), summary,
  });
  assert.deepEqual(model.conflicts, []);
  assert.equal(model.actions.some(item => item.id === 'field-conflicts'), false);
  for (const [field, first, second] of observations) {
    const evidence = model.profile.fields.find(item => item.field === field);
    assert.equal(evidence.conflict, true, field + ' retains the observed value difference');
    assert.deepEqual(new Set([evidence.value, ...evidence.alternatives.map(item => item.value)]), new Set([first, second]));
  }
});

test('timeline compares successful statuses only for the same business and source', () => {
  const history = [
    status({ outcome: 'error', businessStatus: 'unknown', checkedAt: '2026-10-20T10:00:00Z' }),
    status({ checkedAt: '2026-10-19T10:00:00Z', businessStatus: 'active' }),
    status({ businessNumber: OTHER, businessStatus: 'closed', checkedAt: '2026-10-18T10:00:00Z' }),
  ];
  const model = build({ check: status({ businessStatus: 'suspended' }), partner: { businessNumber: BNO, history } });
  assert.equal(model.timeline.length, 3);
  assert.equal(model.timeline[0].change?.label, '계속사업자 → 휴업자');
  assert.equal(model.timeline[1].change, null);
  const otherSource = build({ check: status({ businessStatus: 'closed', source: '다른 출처' }), partner: { businessNumber: BNO, history } });
  assert.equal(otherSource.timeline[0].change, null);
});

test('no-data state offers usable actions and all buttons carry the exact business number', () => {
  const model = build({ check: null, summary: null, partner: null });
  assert.deepEqual(model.profile.missing.map(item => item.field), BASIC_BUSINESS_FIELDS);
  assert.equal(model.actions[0].action, 'insight-refresh-status');
  const html = renderBusinessInsights(model, { compact: true });
  assert.match(html, /기본정보 확인/);
  for (const match of html.matchAll(/<button\b[^>]*>/g)) assert.match(match[0], /data-bno="6901100416"/);
  assert.equal(renderBusinessInsights(null), '');
});

test('collection failures and candidates identify the exact section each source-view button needs', () => {
  const model = build({ summary: summarizeEnrichment(record({
    sources: [source({ match: 'candidate' })],
    collection: { status: 'failed', lastAttemptAt: STAMP },
  })) });
  const html = renderBusinessInsights(model);
  assert.match(html, /data-action="insight-view-sources" data-insight-id="collection-incomplete"/);
  assert.match(html, /data-action="insight-view-sources" data-insight-id="candidates"/);
});

test('renderer escapes aliases, labels and field values and rejects hostile source URLs', () => {
  const model = build({ partner: { businessNumber: BNO, name: '<img src=x onerror=alert(1)>' } });
  model.profile.basic[0].value = '<script>alert(1)</script>';
  model.profile.basic[0].source.url = 'javascript:alert(1)';
  model.actions[0].description = '<svg onload=alert(1)>';
  model.actions[0].label = '" onclick="alert(1)';
  model.status.sourceUrl = 'https://user:password@example.com/';
  const html = renderBusinessInsights(model);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('<svg'), false);
  assert.equal(html.includes('href="javascript:'), false);
  assert.equal(html.includes('href="https://user:'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot; onclick=&quot;/);
});
