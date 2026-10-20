import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeProgram, rankPrograms, koreanToday, periodState, loadPrograms } from '../src/programs.mjs';
import { collectPrograms } from '../scripts/collect-programs.mjs';
const notice = changes => ({ id: 'test-only', title: '테스트 공고', sourceUrl: 'https://www.bizinfo.go.kr/example', regions: ['서울'], categories: ['기술'], industryTags: [], regionSoft: true, endDate: '2026-10-20', ...changes });
test('KST day changes at UTC 15:00 and end date remains inclusive', () => {
  assert.equal(koreanToday(new Date('2026-10-19T15:00:00Z')), '2026-10-20');
  assert.equal(periodState(notice(), '2026-10-20'), 'open');
  assert.equal(periodState(notice(), '2026-10-21'), 'closed');
});
test('conditional period never obtains a guessed closing date', () => {
  const p = normalizeProgram(notice({ periodText: '2026-10-20부터 예산 소진 시까지' }));
  assert.equal(p.endDate, null); assert.equal(periodState(p, '2026-12-31'), 'unknown');
});
test('soft regions cannot establish disqualification and empty industries remain unknown', () => {
  const [result] = rankPrograms([notice()], { region: '경기', industry: '농업', employees: '', revenue: null }, { today: '2026-10-19' });
  assert.equal(result.assessment, 'unknown');
  assert.ok(result.missing.some(t => t.includes('대상 업종')));
  assert.ok(result.missing.some(t => t.includes('상시근로자')));
  assert.ok(result.missing.some(t => t.includes('매출')));
});
test('explicit zero employees is provided data, not blank', () => {
  const [r] = rankPrograms([notice()], { region: '서울', employees: 0, revenue: 0 }, { today: '2026-10-19' });
  assert.equal(r.assessment, 'candidate');
  assert.equal(r.missing.some(t => t.includes('상시근로자 수가 입력')), false);
  assert.equal(r.missing.some(t => t.includes('매출 정보가 입력')), false);
  assert.ok(r.missing.length > 0);
});
test('unsafe URLs and malformed dates are rejected and HTML is not retained', () => {
  assert.equal(normalizeProgram(notice({ sourceUrl: 'javascript:alert(1)' })), null);
  assert.equal(normalizeProgram(notice({ sourceUrl: 'https://user:pass@example.com' })), null);
  const p = normalizeProgram(notice({ title: '<b>공고</b>', endDate: '2026-02-30', applyUrl: 'data:text/html,x' }));
  assert.equal(p.title, '공고'); assert.equal(p.endDate, null); assert.equal(p.applyUrl, undefined);
});
test('hard region mismatch is separate from soft discovery tags', () => {
  const [r] = rankPrograms([notice({ regionSoft: false })], { region: '부산' }, { today: '2026-10-19' });
  assert.equal(r.assessment, 'mismatch');
});
test('loading handles empty actual dataset without manufacturing examples', async () => {
  const data = await loadPrograms({ fetcher: async () => new Response(JSON.stringify({ meta: { status: 'not_collected' }, programs: [] })) });
  assert.equal(data.programs.length, 0); assert.equal(data.meta.status, 'not_collected');
});
test('upstream failure preserves successful catalog bytes and records failed attempt', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bizhannun-programs-'));
  try {
    const original = JSON.stringify({ meta: { lastSuccessAt: '2026-10-18T00:00:00Z' }, programs: [notice()] });
    await writeFile(join(dir, 'programs.json'), original);
    const r = await collectPrograms({ outputDir: dir, fetcher: async () => new Response('', { status: 503 }), now: new Date('2026-10-20T00:00:00Z') });
    assert.equal(r.status, 'failed'); assert.equal(r.errorType, 'upstream');
    assert.equal(await readFile(join(dir, 'programs.json'), 'utf8'), original);
    const s = JSON.parse(await readFile(join(dir, 'collection-status.json'), 'utf8'));
    assert.equal(s.lastSuccessAt, '2026-10-18T00:00:00Z'); assert.equal(s.preservedPrevious, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
