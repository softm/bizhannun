import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBusinessNumber, formatBusinessNumber, isValidBusinessNumber,
  parseCsv, parseBusinessImport, toCsv, exportPartnersCsv,
  applyCheckResults, buildInsights,
} from '../src/domain.mjs';

const BRN = '2208162517';
const BRN2 = '1248100998';
const SOURCE = { name: '국세청', url: 'https://api.odcloud.kr/api/nts-businessman/v1/status' };
const T0 = '2026-10-19T01:00:00.000Z';
const T1 = '2026-10-20T01:00:00.000Z';
const T2 = '2026-10-20T02:00:00.000Z';
const makePartner = (businessNumber = BRN, id = 'partner-1') => ({
  id, businessNumber, name: '시험 업체', tags: [], note: '', history: [],
});
const makeResult = (overrides = {}) => ({
  businessNumber: BRN, outcome: 'ok', businessStatus: 'active', statusLabel: '계속사업자',
  taxType: '부가가치세 일반과세자', closedAt: '', checkedAt: T0, source: SOURCE,
  ...overrides,
});

test('business number validation uses checksum and never removes letters', () => {
  assert.equal(normalizeBusinessNumber(' 220-81-62517 '), BRN);
  assert.equal(formatBusinessNumber(BRN), '220-81-62517');
  assert.equal(isValidBusinessNumber(BRN), true);
  assert.equal(isValidBusinessNumber(BRN2), true);
  assert.equal(isValidBusinessNumber('2208162518'), false);
  assert.equal(isValidBusinessNumber('0000000000'), false);
  assert.equal(isValidBusinessNumber('220816251'), false);
  assert.equal(normalizeBusinessNumber(`abc${BRN}`), '');
  assert.equal(isValidBusinessNumber(`사업자번호: ${BRN}`), false);
  assert.equal(isValidBusinessNumber('22081e62517'), false);
  assert.equal(normalizeBusinessNumber({ toString: () => BRN }), '');
});

test('CSV parser preserves quoted commas, double quotes, multiline content and empty cells', () => {
  const csv = '\uFEFF사업자등록번호,업체명,메모\r\n220-81-62517,"상호, 지점","첫째 줄\r\n""둘째"" 줄"\r\n124-81-00998,,\r\n';
  assert.deepEqual(parseCsv(csv), [
    ['사업자등록번호', '업체명', '메모'],
    ['220-81-62517', '상호, 지점', '첫째 줄\r\n"둘째" 줄'],
    ['124-81-00998', '', ''],
  ]);
  assert.deepEqual(parseCsv('""'), [['']]);
  assert.deepEqual(parseCsv('a,b,'), [['a', 'b', '']]);
  assert.throws(() => parseCsv('a,b\n"unterminated'), (error) => error.row === 2 && error instanceof SyntaxError);
  assert.throws(() => parseCsv('"a"stray,b'), SyntaxError);
  assert.throws(() => parseCsv('ab"cd,b'), SyntaxError);
});

test('import understands aliases, reports invalid rows and deduplicates normalized numbers', () => {
  const imported = parseBusinessImport(
    '\uFEFF사업자번호,상호,태그,메모\n220-81-62517,"A, B","농업|거래처|농업","첫 줄\n둘째 줄"\n2208162517,중복,,\n1248100998,두 번째,제조,메모\nabc2208162517,잘못된 번호,,',
  );
  assert.deepEqual(imported.rows, [
    { businessNumber: BRN, name: 'A, B', tags: ['농업', '거래처'], note: '첫 줄\n둘째 줄' },
    { businessNumber: BRN2, name: '두 번째', tags: ['제조'], note: '메모' },
  ]);
  assert.equal(imported.duplicates, 1);
  assert.equal(imported.errors.length, 1);
  assert.equal(imported.errors[0].row, 5);
  assert.equal(parseBusinessImport(`businessNumber,name,tags,note\n${BRN},영문 헤더,A;B,보존`).rows[0].note, '보존');
  assert.equal(parseBusinessImport(`${BRN}\n\n${BRN2}\n${BRN}`).duplicates, 1);
});

test('over-limit and malformed imports are explicit and cannot silently save a prefix', () => {
  const overLimit = parseBusinessImport(Array.from({ length: 1001 }, () => BRN).join('\n'));
  assert.equal(overLimit.rows.length, 0);
  assert.match(overLimit.errors[0].message, /1,000/);
  assert.match(overLimit.errors[0].message, /1,001/);
  assert.equal(parseBusinessImport('사업자번호,메모\n2208162517,"broken').rows.length, 0);
  assert.ok(parseBusinessImport('사업자번호,메모\n2208162517,"broken').errors.length);
  assert.ok(parseBusinessImport('업체명,메모\n상호,기록').errors.length);
  assert.ok(parseBusinessImport('사업자번호,businessNumber\n2208162517,1248100998').errors.length);
});

test('CSV export escapes syntax and guards spreadsheet formulas, including whitespace prefixes', () => {
  const csv = toCsv([
    { name: '=HYPERLINK("https://example.com")', note: 'a,b\n"quoted"', tags: ['농업', '제조'] },
    { name: ' \t+SUM(1,1)', note: '@SUM(1,1)', tags: [] },
    { name: '-1+2', note: '\tformula', tags: [] },
  ], ['name', 'note', 'tags']);
  assert.equal(csv.startsWith('\uFEFF'), true);
  const records = parseCsv(csv);
  assert.equal(records[1][0], '\'=HYPERLINK("https://example.com")');
  assert.equal(records[1][1], 'a,b\n"quoted"');
  assert.equal(records[1][2], '농업|제조');
  assert.equal(records[2][0], "' \t+SUM(1,1)");
  assert.equal(records[2][1], "'@SUM(1,1)");
  assert.equal(records[3][0], "'-1+2");
  assert.equal(records[3][1], "'\tformula");
});

test('partner CSV can be imported again without losing number, tags or multiline note', () => {
  const partner = { ...makePartner(), name: '회사, "지점"', tags: ['농업', '거래처'], note: '두 줄\n메모' };
  const imported = parseBusinessImport(exportPartnersCsv([partner]));
  assert.deepEqual(imported.errors, []);
  assert.deepEqual(imported.rows[0], {
    businessNumber: BRN, name: partner.name, tags: partner.tags, note: partner.note,
  });
});

test('first successful observation establishes a baseline and does not mutate inputs', () => {
  const original = makePartner();
  const result = makeResult();
  const updated = applyCheckResults([original], [result], T0);
  assert.deepEqual(updated.events, []);
  assert.equal(updated.partners[0].lastSuccess.businessStatus, 'active');
  assert.equal(updated.partners[0].history.length, 1);
  assert.equal(original.lastCheck, undefined);
  assert.deepEqual(original.history, []);
  assert.equal(result.id, undefined);
});

test('mixed failures preserve last success and cannot manufacture a closure event', () => {
  const baseline = applyCheckResults([makePartner(), makePartner(BRN2, 'partner-2')], [
    makeResult(), makeResult({ businessNumber: BRN2 }),
  ], T0).partners;
  const failed = applyCheckResults(baseline, [
    makeResult({ outcome: 'error', businessStatus: 'closed', checkedAt: T1, message: 'timeout' }),
    makeResult({ businessNumber: BRN2, outcome: 'not_found', businessStatus: 'closed', checkedAt: T1 }),
  ], T1);
  assert.deepEqual(failed.events, []);
  for (const partner of failed.partners) {
    assert.equal(partner.lastSuccess.businessStatus, 'active');
    assert.equal(partner.lastSuccess.checkedAt, T0);
    assert.equal(partner.lastCheck.businessStatus, 'unknown');
  }
  const unconfigured = applyCheckResults(failed.partners, [makeResult({ outcome: 'not_configured', checkedAt: T2 })], T2);
  assert.deepEqual(unconfigured.events, []);
  assert.equal(unconfigured.partners[0].lastSuccess.businessStatus, 'active');
});

test('reliable changes produce deterministic events and replay is idempotent', () => {
  const baseline = applyCheckResults([makePartner()], [makeResult()], T0).partners;
  const closed = makeResult({ businessStatus: 'closed', statusLabel: '폐업자', checkedAt: T1, closedAt: '20261019' });
  const first = applyCheckResults(baseline, [closed, closed], T1);
  assert.equal(first.events.length, 1);
  assert.equal(first.events[0].from, 'active');
  assert.equal(first.events[0].to, 'closed');
  assert.equal(first.events[0].occurredAt, T1);
  assert.equal(first.events[0].id, applyCheckResults(baseline, [closed], T1).events[0].id);
  const replay = applyCheckResults(first.partners, [closed], T1);
  assert.deepEqual(replay.events, []);
  assert.equal(replay.partners[0].history.length, 2);
  const sameStatusLater = applyCheckResults(replay.partners, [{ ...closed, checkedAt: T2 }], T2);
  assert.deepEqual(sameStatusLater.events, []);
});

test('different sources, different businesses and unknown states are not compared as a change', () => {
  const baseline = applyCheckResults([makePartner()], [makeResult()], T0).partners;
  assert.deepEqual(applyCheckResults(baseline, [makeResult({
    source: { name: '다른 기관', url: 'https://example.com/source' },
    businessStatus: 'closed', checkedAt: T1,
  })], T1).events, []);
  assert.deepEqual(applyCheckResults(baseline, [makeResult({ businessNumber: BRN2, businessStatus: 'closed', checkedAt: T1 })], T1).events, []);
  assert.deepEqual(applyCheckResults(baseline, [makeResult({ businessStatus: 'unknown', checkedAt: T1 })], T1).events, []);
  const mismatched = [{ ...makePartner(), lastSuccess: makeResult({ businessNumber: BRN2 }) }];
  assert.deepEqual(applyCheckResults(mismatched, [makeResult({ businessStatus: 'closed', checkedAt: T1 })], T1).events, []);
});

test('source URL equality works across labels and source strings are supported', () => {
  const baseline = applyCheckResults([makePartner()], [makeResult()], T0).partners;
  const changed = applyCheckResults(baseline, [makeResult({
    source: { name: '국세청 상태조회', url: `${SOURCE.url}/` }, businessStatus: 'suspended', checkedAt: T1,
  })], T1);
  assert.equal(changed.events.length, 1);
  const stringBaseline = applyCheckResults([makePartner()], [makeResult({ source: 'nts' })], T0).partners;
  assert.equal(applyCheckResults(stringBaseline, [makeResult({ source: 'nts', businessStatus: 'closed', checkedAt: T1 })], T1).events.length, 1);
});

test('late responses cannot roll back a newer observation; history remains bounded', () => {
  const baseline = applyCheckResults([makePartner()], [makeResult()], T0).partners;
  const latest = applyCheckResults(baseline, [makeResult({ businessStatus: 'closed', checkedAt: T2 })], T2);
  const delayed = applyCheckResults(latest.partners, [makeResult({ checkedAt: T1 })], T2);
  assert.deepEqual(delayed.events, []);
  assert.equal(delayed.partners[0].lastSuccess.businessStatus, 'closed');
  let partners = baseline;
  for (let index = 1; index <= 55; index += 1) {
    const checkedAt = new Date(Date.parse(T0) + index * 60000).toISOString();
    partners = applyCheckResults(partners, [makeResult({ checkedAt })], checkedAt).partners;
  }
  assert.equal(partners[0].history.length, 50);
  assert.ok(Date.parse(partners[0].history[0].checkedAt) > Date.parse(partners[0].history[49].checkedAt));
});

test('insights distinguish missing data and failed checks from the last known state', () => {
  assert.equal(buildInsights(makePartner())[0].id, 'check-needed');
  const baseline = applyCheckResults([makePartner()], [makeResult()], T0).partners;
  const failed = applyCheckResults(baseline, [makeResult({ outcome: 'error', checkedAt: T1 })], T1).partners[0];
  const insights = buildInsights(failed);
  assert.equal(insights[0].id, 'check-failed');
  assert.ok(insights.some((item) => item.id === 'status-active'));
  assert.equal(insights.some((item) => item.id === 'status-closed'), false);
  assert.equal(insights.some((item) => /신용점수|안전한 업체|우량기업/.test(item.description)), false);
  const missing = applyCheckResults([makePartner()], [makeResult({ outcome: 'not_found' })], T0).partners[0];
  assert.equal(buildInsights(missing)[0].id, 'record-not-found');
  assert.equal(buildInsights(missing).some((item) => item.id === 'status-closed'), false);
});
