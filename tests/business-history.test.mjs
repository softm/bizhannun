import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBusinessHistory, buildBusinessHistoryCsv } from '../src/business-history.mjs';
import { parseCsv } from '../src/domain.mjs';

const BNO = '6901100416';
const OTHER = '2208162517';
const NOW = '2026-10-22T03:00:00Z';
const SOURCE = { name: '국세청 사업자등록정보', url: 'https://www.data.go.kr/data/15081808/openapi.do' };
const check = (overrides = {}) => ({
  businessNumber: BNO, outcome: 'ok', businessStatus: 'active', taxType: '부가가치세 일반과세자',
  taxTypeCode: '01', checkedAt: '2026-10-21T13:00:00Z', source: { ...SOURCE }, ...overrides,
});
const build = (history, options = {}) => buildBusinessHistory({
  businessNumber: BNO, partner: { businessNumber: BNO, history }, now: NOW, ...options,
});
const at = (day, overrides = {}) => check({ checkedAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`, ...overrides });

test('derives the complete retained history beyond the eight-row insight preview without mutating source evidence', () => {
  const history = Array.from({ length: 12 }, (_, index) => at(index + 1, { businessStatus: index % 2 ? 'suspended' : 'active' }));
  const original = structuredClone(history);
  const model = build(history);
  assert.equal(model.allRows.length, 12);
  assert.equal(model.summary.statusChanges, 11);
  assert.equal(model.allRows[9].statusChange.label, '휴업자 → 계속사업자');
  assert.equal(model.allRows[9].statusChange.previousCheckedAt, '2026-10-02T00:00:00.000Z');
  assert.equal(model.allRows.at(-1).statusChange, null);
  assert.deepEqual(history, original);
});

test('compares before the 50-record cap and before selected-period/type filters', () => {
  const history = Array.from({ length: 51 }, (_, index) => check({
    checkedAt: new Date(Date.parse('2026-08-01T00:00:00Z') + index * 86_400_000).toISOString(),
    businessStatus: index % 2 ? 'suspended' : 'active',
  }));
  const model = build(history, { period: '30', filter: 'status', now: '2026-09-20T03:00:00Z' });
  assert.equal(model.allRows.length, 50);
  assert.equal(model.summary.statusChanges, 50);
  assert.equal(model.allRows.at(-1).statusChange.previousCheckedAt, '2026-08-01T00:00:00.000Z');
  assert.equal(model.counts.all, 30);
  assert.equal(model.rows.length, 30);
  assert.ok(model.rows.at(-1).statusChange);
});

test('normalizes business identity and rejects foreign partners, foreign checks, malformed outcomes and invalid numbers', () => {
  const model = build([
    check({ businessNumber: '690-11-00416' }), check({ businessNumber: OTHER }),
    check({ outcome: '__proto__' }), null, [], 'bad', check({ businessNumber: 'not a number' }),
  ]);
  assert.equal(model.allRows.length, 1);
  assert.equal(model.allRows[0].businessNumber, BNO);
  assert.equal(build([check()], { businessNumber: '0000000000' }).rows.length, 0);
  assert.equal(build([check()], { partner: { businessNumber: OTHER, history: [check()] } }).rows.length, 0);
  assert.equal(buildBusinessHistory().rows.length, 0);
});

test('deduplicates lastCheck, lastSuccess and history by canonical source URL despite changed labels or trailing slashes', () => {
  const previous = at(1);
  const latest = at(2, { businessStatus: 'closed', source: { name: '현재 출처 이름', url: SOURCE.url + '/' } });
  const model = build([previous, latest, { ...latest, source: { name: '이전 출처 이름', url: SOURCE.url } }], {
    partner: { businessNumber: BNO, lastCheck: latest, lastSuccess: latest, history: [previous, latest, { ...latest, source: { name: '다른 표기', url: SOURCE.url + '//#부분' } }] },
  });
  assert.equal(model.allRows.length, 2);
  assert.equal(model.allRows[0].sourceUrl, SOURCE.url);
  assert.equal(model.allRows[0].sourceName, '현재 출처 이름');
  assert.equal(model.allRows[0].statusChange.label, '계속사업자 → 폐업자');
});

test('different sources and missing source identities never establish a status or tax transition', () => {
  const model = build([
    at(1),
    at(2, { businessStatus: 'closed', taxType: '간이과세자', taxTypeCode: '02', source: { name: SOURCE.name, url: 'https://example.org/status' } }),
    at(3, { businessStatus: 'suspended', source: '' }), at(4, { businessStatus: 'closed', source: null }),
  ]);
  assert.equal(model.summary.statusChanges, 0);
  assert.equal(model.summary.taxChanges, 0);
  const names = build([at(1, { source: '동일 제공자' }), at(2, { businessStatus: 'closed', source: '동일 제공자' })]);
  assert.equal(names.summary.statusChanges, 1);
  const urls = build([at(1, { source: { url: 'https://example.org/' } }), at(2, { businessStatus: 'closed', source: { url: 'https://example.org' } })]);
  assert.equal(urls.summary.statusChanges, 1);
});

test('a legacy copy missing its tax code does not duplicate one observation, while conflicting explicit codes remain visible', () => {
  const legacy = at(2, { businessStatus: 'closed', taxType: '일반과세자', taxTypeCode: null });
  const current = at(2, { businessStatus: 'closed' });
  const model = build([at(1), legacy, current]);
  assert.equal(model.rows.length, 2);
  assert.equal(model.summary.statusChanges, 1);
  assert.equal(model.rows[0].taxTypeCode, '01');
  const conflict = build([at(1), legacy, current, { ...current, taxTypeCode: '02' }]);
  assert.equal(conflict.rows.length, 3);
  assert.equal(conflict.rows.filter(row => row.taxConflict).length, 2);
  for (const taxTypeCode of ['00', '99']) {
    const placeholders = build([at(1), { ...legacy, taxTypeCode }, current, { ...current, taxTypeCode: '02' }]);
    assert.equal(placeholders.rows.length, 3);
    assert.equal(placeholders.rows.filter(row => row.taxConflict).length, 2);
    assert.ok(placeholders.rows.filter(row => row.taxConflict).every(row => ['01', '02'].includes(row.taxTypeCode)));
  }
});

test('rejected source URLs never fall back to a shared label and invent a cross-source change', () => {
  const model = build([
    at(1, { source: { name: '공공 조회', url: 'https://first.example.com/status?serviceKey=placeholder' } }),
    at(2, { businessStatus: 'closed', taxType: '간이과세자', taxTypeCode: '02', source: { name: '공공 조회', url: 'https://second.example.com/status?serviceKey=placeholder' } }),
  ]);
  assert.equal(model.summary.statusChanges, 0);
  assert.equal(model.summary.taxChanges, 0);
  assert.ok(model.rows.every(row => row.sourceUrl === null && row.sourceIdentity === ''));
  assert.ok(model.rows.every(row => row.sourceName === '공공 조회'));
  assert.doesNotMatch(buildBusinessHistoryCsv({ businessNumber: BNO, rows: model.rows }), /serviceKey|placeholder/);
});

test('failed and unknown observations remain issues and cannot manufacture a closure or a change baseline', () => {
  const model = build([
    at(1), at(2, { outcome: 'error', businessStatus: 'closed', taxType: '간이과세자' }),
    at(3, { outcome: 'not_found', businessStatus: 'closed' }), at(4, { outcome: 'not_configured' }),
    at(5, { businessStatus: 'toString', taxType: '미확인', taxTypeCode: null }),
    at(6, { businessStatus: 'closed' }),
  ]);
  assert.equal(model.summary.statusChanges, 1);
  assert.equal(model.counts.issues, 4);
  assert.equal(model.allRows[0].statusChange.previousCheckedAt, '2026-10-01T00:00:00.000Z');
  assert.match(model.allRows.find(row => row.checkedAt === '2026-10-05T00:00:00.000Z').issueReason, /상태/);
  for (const row of model.allRows.filter(row => row.outcome !== 'ok')) {
    assert.equal(row.businessStatus, 'unknown');
    assert.equal(row.taxType, '');
    assert.equal(row.statusChange, null);
    assert.equal(row.taxChange, null);
  }
  assert.equal(build([at(1, { businessStatus: 'unknown' }), at(2)]).summary.statusChanges, 0);
});

test('known status and tax changes can share one observation and have independent prior successful comparison times', () => {
  const model = build([
    at(1), at(2, { taxType: '해당 없음', taxTypeCode: '99' }),
    at(3, { businessStatus: 'suspended', taxType: '부가가치세 간이과세자', taxTypeCode: '02' }),
  ], { filter: 'tax' });
  assert.equal(model.rows.length, 1);
  const latest = model.rows[0];
  assert.deepEqual(latest.statusChange, { from: 'active', to: 'suspended', label: '계속사업자 → 휴업자', previousCheckedAt: '2026-10-02T00:00:00.000Z' });
  assert.deepEqual(latest.taxChange, { from: '부가가치세 일반과세자', to: '부가가치세 간이과세자', label: '부가가치세 일반과세자 → 부가가치세 간이과세자', previousCheckedAt: '2026-10-01T00:00:00.000Z' });
  assert.deepEqual(model.counts, { all: 3, status: 1, tax: 1, issues: 0 });
});

test('tax placeholders, code-only values and reported previousTaxType are not invented historical changes', () => {
  const model = build([
    at(1, { taxType: null, taxTypeCode: '01' }),
    at(2, { taxType: '  N/A  ', taxTypeCode: '99' }),
    at(3, { taxType: '간이과세자', taxTypeCode: '02', previousTaxType: '일반과세자', taxTypeChangedAt: '2026-09-01' }),
  ]);
  assert.equal(model.summary.taxChanges, 0);
  const labels = build([
    at(1, { taxType: '일반과세자', taxTypeCode: null }),
    at(2, { taxType: '부가가치세 일반과세자', taxTypeCode: '01' }),
    at(3, { taxType: '일반 과세자', taxTypeCode: '01' }),
  ]);
  assert.equal(labels.summary.taxChanges, 0);
});

test('conflicting same-time responses suppress changes and interrupt only the conflicting dimension until a new baseline', () => {
  const model = build([
    at(1), at(2, { businessStatus: 'closed' }), at(2, { businessStatus: 'suspended' }),
    at(3, { businessStatus: 'closed', taxType: '간이과세자', taxTypeCode: '02' }),
    at(4, { businessStatus: 'active', taxType: '간이과세자', taxTypeCode: '02' }),
  ]);
  const conflicts = model.allRows.filter(row => row.statusConflict);
  assert.equal(conflicts.length, 2);
  assert.ok(conflicts.every(row => row.issue && !row.statusChange));
  assert.equal(model.allRows.find(row => row.checkedAt === '2026-10-03T00:00:00.000Z').statusChange, null);
  assert.equal(model.summary.statusChanges, 1);
  assert.equal(model.summary.taxChanges, 1);
  assert.equal(model.allRows[0].statusChange.previousCheckedAt, '2026-10-03T00:00:00.000Z');
  const taxConflict = build([
    at(1), at(2, { taxType: '간이과세자', taxTypeCode: '02' }), at(2),
    at(3, { businessStatus: 'closed', taxType: '간이과세자', taxTypeCode: '02' }),
  ]);
  assert.equal(taxConflict.summary.taxChanges, 0);
  assert.equal(taxConflict.summary.statusChanges, 1);
  assert.equal(taxConflict.allRows.filter(row => row.taxConflict).length, 2);
});

test('equal instants with different timezone representations never compare against each other', () => {
  const model = build([
    check({ checkedAt: '2026-10-21T15:00:00Z', businessStatus: 'active' }),
    check({ checkedAt: '2026-10-22T00:00:00+09:00', businessStatus: 'closed' }),
  ]);
  assert.equal(model.summary.statusChanges, 0);
  assert.equal(model.counts.issues, 2);
  assert.ok(model.rows.every(row => row.statusConflict));
});

test('future and invalid dates remain visible only in all-time history and cannot create transitions', () => {
  const model = build([
    at(1), check({ checkedAt: '2026-10-22T03:00:01Z', businessStatus: 'closed' }),
    check({ checkedAt: '2026-02-30T00:00:00Z', businessStatus: 'closed' }),
    check({ checkedAt: '2026-10-21T13:00:00', businessStatus: 'suspended' }),
  ]);
  assert.equal(model.summary.statusChanges, 0);
  assert.equal(model.counts.issues, 3);
  assert.equal(model.summary.latestCheckedAt, '2026-10-01T00:00:00.000Z');
  assert.equal(build([check({ checkedAt: '2026-10-22T03:00:01Z' })]).summary.latestCheckedAt, null);
  assert.equal(model.groups.at(-1).key, 'undated');
  assert.equal(model.groups.at(-1).label, '조회 시각 없음');
  assert.equal(model.groups.at(-1).rows.length, 2);
  const period = build([
    at(1), check({ checkedAt: '2026-10-22T03:00:01Z', businessStatus: 'closed' }),
    check({ checkedAt: null, businessStatus: 'closed' }),
  ], { period: '30' });
  assert.deepEqual(period.counts, { all: 1, status: 0, tax: 0, issues: 0 });
  assert.equal(period.summary.issues, 2);
});

test('KST grouping and recent-calendar-day windows use the local midnight boundary, not UTC date slices or rolling hours', () => {
  const history = [
    check({ checkedAt: '2026-09-22T14:59:59.999Z' }),
    check({ checkedAt: '2026-09-22T15:00:00Z', businessStatus: 'suspended' }),
    check({ checkedAt: '2026-10-21T14:59:59.999Z' }),
    check({ checkedAt: '2026-10-21T15:00:00Z', businessStatus: 'closed' }),
    check({ checkedAt: NOW, businessStatus: 'closed' }),
    check({ checkedAt: '2026-10-22T03:00:00.001Z', businessStatus: 'active' }),
  ];
  const model = build(history, { period: '30' });
  assert.equal(model.rows.length, 4);
  assert.deepEqual(model.groups.map(group => group.key), ['2026-10-22', '2026-10-21', '2026-09-23']);
  assert.equal(model.groups[0].label, '2026년 10월 22일');
  assert.ok(model.rows.at(-1).statusChange, 'a baseline just outside the period still proves the first included change');
  for (const days of [30, 90, 365]) {
    const midnight = Date.parse('2026-10-21T15:00:00Z') - (days - 1) * 86_400_000;
    const records = [-1, 0, 1].map(offset => check({ checkedAt: new Date(midnight + offset).toISOString() }));
    assert.equal(build(records, { period: String(days) }).rows.length, 2);
  }
});

test('counts apply the period before the type filter, summary always uses retained history, and oldest sorting keeps undated last', () => {
  const history = [at(1), at(2, { businessStatus: 'suspended' }), at(3, { outcome: 'error' }), check({ checkedAt: null })];
  const newest = build(history);
  const oldest = build(history, { sort: 'oldest' });
  assert.deepEqual(oldest.rows.map(row => row.checkedAt), ['2026-10-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z', '2026-10-03T00:00:00.000Z', null]);
  assert.deepEqual(oldest.allRows, newest.allRows);
  assert.equal(oldest.groups.at(-1).key, 'undated');
  const issues = build(history, { filter: 'issues', period: '30' });
  assert.equal(issues.rows.length, 1);
  assert.deepEqual(issues.counts, { all: 3, status: 1, tax: 0, issues: 1 });
  assert.equal(issues.summary.issues, 2);
  const invalid = build(history, { filter: '__proto__', period: 'yesterday', sort: 'random' });
  assert.deepEqual([invalid.filter, invalid.period, invalid.sort], ['all', 'all', 'newest']);
});

test('CSV preserves comparison evidence, UTC/KST time and selected row order while excluding private partner data', () => {
  const history = [at(1), at(2, { businessStatus: 'closed', taxType: '간이과세자', taxTypeCode: '02' })];
  const model = build(history, { sort: 'oldest' });
  const rows = model.rows.map(row => ({ ...row, name: '비공개 별칭', note: '거래처 개인 메모', tags: ['중요 비밀'] }));
  const csv = buildBusinessHistoryCsv({ businessNumber: BNO, rows });
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.endsWith('\r\n'));
  assert.doesNotMatch(csv, /비공개|개인 메모|중요 비밀/);
  const [header, first, second] = parseCsv(csv);
  const cell = (row, label) => row[header.indexOf(label)];
  assert.equal(cell(first, '사업자등록번호'), '690-11-00416');
  assert.equal(cell(first, '조회 시각 (UTC)'), '2026-10-01T00:00:00.000Z');
  assert.equal(cell(first, '조회 시각 (KST)'), '2026-10-01 09:00:00.000 +09:00');
  assert.equal(cell(second, '기록 유형'), '사업자 상태 변경 / 과세 유형 변경');
  assert.equal(cell(second, '변경 전 사업자 상태'), '계속사업자');
  assert.equal(cell(second, '변경 후 사업자 상태'), '폐업자');
  assert.equal(cell(second, '변경 전 과세 유형'), '부가가치세 일반과세자');
  assert.equal(cell(second, '상태 비교 기준 조회 (UTC)'), '2026-10-01T00:00:00.000Z');
  assert.equal(cell(second, '과세 비교 기준 조회 (KST)'), '2026-10-01 09:00:00.000 +09:00');
  assert.equal(cell(second, '출처 URL'), SOURCE.url);
});

test('CSV protects formula-like source and tax text, blocks credential URLs, and rejects foreign-business mixtures', () => {
  const model = build([check({ source: { name: '=HYPERLINK("https://evil.example", "열기")', url: 'https://api.example.com/query?serviceKey=secret-value' }, taxType: '+SUM(1,2)' })]);
  const csv = buildBusinessHistoryCsv({ businessNumber: BNO, rows: model.rows });
  const [header, row] = parseCsv(csv);
  assert.equal(row[header.indexOf('출처명')], '\'=HYPERLINK("https://evil.example", "열기")');
  assert.equal(row[header.indexOf('확인한 과세 유형')], "'+SUM(1,2)");
  assert.equal(row[header.indexOf('출처 URL')], '');
  assert.doesNotMatch(csv, /secret-value/);
  for (const text of ['=1+1', '+SUM(1,2)', '-1+2', '@SUM(A1)', '\t=1', '\n=1', '  =1']) {
    const output = buildBusinessHistoryCsv({ businessNumber: BNO, rows: [{ ...model.rows[0], sourceName: text }] });
    const records = parseCsv(output);
    assert.equal(records[1][records[0].indexOf('출처명')], "'" + text);
  }
  assert.throws(() => buildBusinessHistoryCsv({ businessNumber: BNO, rows: [{ ...model.rows[0], businessNumber: OTHER }] }), /다른 사업자/);
  assert.throws(() => buildBusinessHistoryCsv({ businessNumber: '=1', rows: [] }), /사업자등록번호/);
  assert.throws(() => buildBusinessHistoryCsv({ businessNumber: BNO, rows: [null] }), /형식/);
});
