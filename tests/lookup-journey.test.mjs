import assert from 'node:assert/strict';
import test from 'node:test';
import { createLookupOrigin, restoreLookupOrigin } from '../src/lookup-journey.mjs';

const entry = (overrides = {}) => ({
  kind: 'store', id: 'semas:2208162517', sourceRecordId: '2208162517',
  name: '한눈커피', branchName: '서산점', address: '충남 서산시 테스트길 1',
  industry: { label: '카페' }, source: { name: '공개 상가 명부' },
  businessNumber: null, ...overrides,
});
const search = (overrides = {}) => ({
  query: '  한눈 커피  ', regionCode: '44', page: 3, loading: false, error: '',
  selected: entry(), result: {
    query: '한눈 커피', regionCode: '44', catalogVersion: 'source-20260630',
    results: [entry()], total: 31, foundCount: 31, complete: true, finished: true,
    status: 'complete', progress: { completedShards: 4, totalShards: 4 }, failures: [],
  }, ...overrides,
});

test('store detail to number lookup and back preserves the original name search and selection', () => {
  const original = search();
  const origin = createLookupOrigin({ query: original.query, namePage: 2, storeSearch: original });
  const restored = restoreLookupOrigin(origin);
  assert.equal(restored.lookupQuery, '  한눈 커피  ');
  assert.equal(restored.nameQuery, original.query);
  assert.equal(restored.lookupType, 'name');
  assert.equal(restored.nameSearchPage, 2);
  assert.deepEqual(restored.storeSearch, original);
  assert.deepEqual(origin.selectedStore, original.selected);
});

test('later searches and edits cannot mutate the saved origin or a separately restored journey', () => {
  const original = search();
  const origin = createLookupOrigin({ query: original.query, storeSearch: original });
  original.result.results[0].source.name = '후속 검색 자료';
  original.result.progress.completedShards = 99;
  original.selected.industry.label = '다른 업종';
  original.result.results.push(entry({ id: 'semas:OTHER' }));
  const restored = restoreLookupOrigin(origin);
  assert.equal(restored.storeSearch.result.results.length, 1);
  assert.equal(restored.storeSearch.result.results[0].source.name, '공개 상가 명부');
  assert.equal(restored.storeSearch.result.progress.completedShards, 4);
  assert.equal(restored.storeSearch.selected.industry.label, '카페');
  restored.storeSearch.selected.address = '사용 중 변경';
  restored.storeSearch.result.results[0].name = '화면 중 변경';
  const again = restoreLookupOrigin(origin);
  assert.equal(again.storeSearch.selected.address, '충남 서산시 테스트길 1');
  assert.equal(again.storeSearch.result.results[0].name, '한눈커피');
});

test('a numeric store ID and an accidentally attached number never become a business identity', () => {
  const contaminated = entry({ businessNumber: '6901100416', lastCheck: { businessStatus: 'active' } });
  const original = search({ selected: contaminated,
    businessNumber: '6901100416', lookup: { businessNumber: '6901100416' } });
  original.result.results = [contaminated];
  const origin = createLookupOrigin({ query: '한눈커피', storeSearch: original,
    businessNumber: '6901100416' });
  const restored = restoreLookupOrigin(origin);
  for (const row of [origin.selectedStore, origin.storeSearch.selected,
    restored.storeSearch.selected, restored.storeSearch.result.results[0]]) {
    assert.equal(row.id, 'semas:2208162517');
    assert.equal(row.sourceRecordId, '2208162517');
    assert.equal(row.businessNumber, null);
    assert.equal(Object.hasOwn(row, 'lastCheck'), false);
  }
  assert.equal(Object.hasOwn(origin, 'businessNumber'), false);
  assert.equal(Object.hasOwn(restored.storeSearch, 'businessNumber'), false);
  assert.equal(Object.hasOwn(restored.storeSearch, 'lookup'), false);
  assert.doesNotMatch(JSON.stringify(origin), /6901100416|active/);
});

test('a complete empty search can be restored without selecting an invented store', () => {
  const original = search({ selected: null });
  original.result = { results: [], total: 0, foundCount: 0, complete: true, finished: true };
  const origin = createLookupOrigin({ query: '검색되지 않은 상호', storeSearch: original });
  assert.equal(origin.selectedStore, null);
  const restored = restoreLookupOrigin(origin);
  assert.equal(restored.nameQuery, '검색되지 않은 상호');
  assert.equal(restored.storeSearch.result.total, 0);
  assert.equal(restored.storeSearch.result.complete, true);
  assert.equal(restored.storeSearch.selected, null);
});

test('partial and failed searches retain uncertainty and their retry context after cancellation', () => {
  const original = search({ loading: true, selected: null, error: '일부 검색 자료 연결 실패' });
  original.result = { results: [entry()], total: null, foundCount: 1, complete: false,
    finished: false, status: 'searching', progress: { completedShards: 1, totalShards: 4 },
    failures: [{ regionCode: '44', message: '연결 실패' }] };
  const origin = createLookupOrigin({ query: original.query, storeSearch: original });
  const restored = restoreLookupOrigin(origin);
  assert.equal(origin.storeSearch.loading, false);
  assert.equal(restored.storeSearch.loading, false);
  assert.equal(restored.storeSearch.error, '일부 검색 자료 연결 실패');
  assert.equal(restored.storeSearch.regionCode, '44');
  assert.equal(restored.storeSearch.result.complete, false);
  assert.equal(restored.storeSearch.result.total, null);
  assert.equal(restored.storeSearch.result.foundCount, 1);
  assert.deepEqual(restored.storeSearch.result.failures, original.result.failures);
});

test('a name-only origin restores defaults and page numbers are positive safe integers', () => {
  const restored = restoreLookupOrigin(createLookupOrigin({ query: '다음 검색' }));
  assert.equal(restored.nameSearchPage, 1);
  assert.deepEqual(restored.storeSearch, {
    query: '다음 검색', result: null, loading: false, error: '', regionCode: '', selected: null, page: 1,
  });
  for (const value of [-2, 0, NaN, Infinity, '3', null]) {
    const origin = createLookupOrigin({ query: '상호', namePage: value, storeSearch: search({ page: value }) });
    assert.equal(origin.namePage, 1);
    assert.equal(restoreLookupOrigin(origin).storeSearch.page, 1);
  }
  const fractional = createLookupOrigin({ query: '상호', namePage: 2.9, storeSearch: search({ page: 4.8 }) });
  assert.equal(fractional.namePage, 2);
  assert.equal(restoreLookupOrigin(fractional).storeSearch.page, 4);
});

test('empty or invalid origins do not create a return destination', () => {
  assert.equal(createLookupOrigin(), null);
  assert.equal(createLookupOrigin({ query: ' \n ', storeSearch: {} }), null);
  for (const value of [null, undefined, [], '', {}, { query: 123 }, { query: '  ' }]) {
    assert.equal(restoreLookupOrigin(value), null);
  }
  const fallback = createLookupOrigin({ storeSearch: search() });
  assert.equal(fallback.query, '  한눈 커피  ');
});
