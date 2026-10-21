import test from 'node:test';
import assert from 'node:assert/strict';
import { noteDraft, editorNoteDraft, sameNoteDraft, parseNoteDraft, applyNoteDraft } from '../src/business-detail-state.mjs';

const NOW = '2026-10-22T03:00:00.000Z';

test('saved notes and tags become an independent text draft with empty defaults', () => {
  assert.deepEqual(noteDraft(), { note: '', tags: '' });
  assert.deepEqual(noteDraft({ id: 'partner-1' }), { note: '', tags: '' });
  const partner = { note: '첫 거래\n다음 주 연락', tags: ['납품', '확인 필요'] };
  const draft = noteDraft(partner);
  assert.deepEqual(draft, { note: partner.note, tags: '납품, 확인 필요' });
  draft.note = '새 내용';
  assert.equal(partner.note, '첫 거래\n다음 주 연락');
  assert.deepEqual(partner.tags, ['납품', '확인 필요']);
});

test('draft equality compares exact text without trimming or tag normalization', () => {
  const draft = { note: '메모\n', tags: '납품, 정기' };
  assert.equal(sameNoteDraft(draft, { ...draft }), true);
  assert.equal(sameNoteDraft(draft, { ...draft, note: '메모' }), false);
  assert.equal(sameNoteDraft(draft, { ...draft, tags: '납품;정기' }), false);
  assert.equal(sameNoteDraft(draft, { ...draft, note: '메모\r\n' }), false);
  for (const malformed of [null, undefined, [], {}, { note: '', tags: [] }, { note: 0, tags: '' }]) {
    assert.equal(sameNoteDraft(malformed, malformed), false);
  }
});

test('editor baseline matches textarea LF values without mutating saved text or removing blank lines', () => {
  const saved = { note: '\r\n\r\n첫 줄\r둘째 줄\n\n끝\r\n\r\n', tags: ['납품', '정기'] };
  const original = structuredClone(saved);
  const textareaDraft = { note: '\n\n첫 줄\n둘째 줄\n\n끝\n\n', tags: '납품, 정기' };
  assert.equal(sameNoteDraft(editorNoteDraft(saved), textareaDraft), true);
  assert.deepEqual(saved, original);
  assert.equal(noteDraft(saved).note, original.note);
  assert.equal(parseNoteDraft(noteDraft(saved)).note, original.note);
  assert.equal(applyNoteDraft(saved, noteDraft(saved), NOW).note, original.note);
});

test('parsing keeps note whitespace and Unicode while splitting and deduplicating tags', () => {
  const note = '  납품 확인\r\n한글 조합: 가 · 가나다 · 🌾\n\n마지막 줄  ';
  const draft = { note, tags: '  정기 거래,납품; 정기 거래 | 긴급 연락 || ; , 🌾 ' };
  assert.deepEqual(parseNoteDraft(draft), { note, tags: ['정기 거래', '납품', '긴급 연락', '🌾'] });
  assert.equal(draft.tags, '  정기 거래,납품; 정기 거래 | 긴급 연락 || ; , 🌾 ');
  assert.deepEqual(parseNoteDraft({ note: '', tags: ' , ; | ' }), { note: '', tags: [] });
});

test('length limits accept the boundary and reject overflow without truncation', () => {
  assert.equal(parseNoteDraft({ note: '한'.repeat(5000), tags: '' }).note.length, 5000);
  assert.throws(() => parseNoteDraft({ note: '한'.repeat(5001), tags: '' }), /5,000자/);
  assert.equal(parseNoteDraft({ note: '', tags: '가'.repeat(500) }).tags[0].length, 500);
  assert.throws(() => parseNoteDraft({ note: '', tags: '가'.repeat(501) }), /500자/);
  // HTML maxlength and the existing storage layer count UTF-16 code units.
  assert.equal(parseNoteDraft({ note: '🌾'.repeat(2500), tags: '' }).note.length, 5000);
  assert.throws(() => parseNoteDraft({ note: '🌾'.repeat(2501), tags: '' }), /5,000자/);
});

test('the ten-tag limit applies after trimming, removing empties and deduplicating', () => {
  const ten = Array.from({ length: 10 }, (_, index) => `태그${index + 1}`);
  assert.deepEqual(parseNoteDraft({ note: '', tags: [...ten, '태그1', ' 태그2 ', ''].join(',') }).tags, ten);
  assert.throws(() => parseNoteDraft({ note: '', tags: [...ten, '태그11'].join('|') }), /최대 10개/);
});

test('memo save preserves the latest identity, evidence, name origin and lookup history', () => {
  const latest = {
    id: 'partner-1', businessNumber: '2208162517', name: '공개 상호',
    nameOrigin: { kind: 'public', sourceId: 'registry', value: '공개 상호' },
    enrichment: { businessNumber: '2208162517', sources: [{ id: 'registry' }], fields: [] },
    note: '이전 메모', tags: ['이전'],
    history: [{ businessNumber: '2208162517', outcome: 'ok', businessStatus: 'active', checkedAt: NOW }],
    lastCheck: { checkedAt: NOW, businessStatus: 'active' },
    lastSuccess: { checkedAt: NOW, businessStatus: 'active' },
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z',
  };
  const before = structuredClone(latest);
  const result = applyNoteDraft(latest, { note: '새 메모\n연락 완료', tags: '납품;정기', name: '덮어쓰기 금지', history: [] }, NOW);
  assert.deepEqual(result, { ...latest, note: '새 메모\n연락 완료', tags: ['납품', '정기'], updatedAt: NOW });
  assert.notEqual(result, latest);
  for (const key of ['enrichment', 'nameOrigin', 'history', 'lastCheck', 'lastSuccess']) {
    assert.equal(result[key], latest[key]);
  }
  assert.deepEqual(latest, before);
});

test('malformed or inherited inputs cannot silently erase a saved memo', () => {
  for (const value of [null, undefined, [], 'note', 12, new Date(), Object.create({ note: '상속', tags: '' })]) {
    assert.throws(() => parseNoteDraft(value), /문자로 입력/);
  }
  for (const value of [{}, { note: '', tags: [] }, { note: null, tags: '' }, { note: '', tags: null }]) {
    assert.throws(() => parseNoteDraft(value), /문자로 입력/);
  }
  for (const value of [null, [], 'partner', Object.create({ note: '상속', tags: [] })]) {
    assert.throws(() => noteDraft(value), /거래처 정보/);
    assert.throws(() => applyNoteDraft(value, { note: '', tags: '' }, NOW), /거래처 정보/);
  }
  assert.throws(() => noteDraft({ note: 123, tags: [] }), /저장된 거래 메모/);
  assert.throws(() => noteDraft({ note: '', tags: ['태그', 123] }), /저장된 거래 메모/);
  const nullPrototypeDraft = Object.assign(Object.create(null), { note: '메모', tags: '태그' });
  assert.deepEqual(parseNoteDraft(nullPrototypeDraft), { note: '메모', tags: ['태그'] });
});

test('invalid save timestamps are rejected before creating a changed partner', () => {
  const partner = { note: '보관할 메모', tags: ['기존'] };
  for (const value of [null, 0, '', 'invalid-date']) {
    assert.throws(() => applyNoteDraft(partner, { note: '새 메모', tags: '' }, value), /저장 시각/);
  }
  assert.deepEqual(partner, { note: '보관할 메모', tags: ['기존'] });
});
