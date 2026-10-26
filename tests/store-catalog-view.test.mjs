import assert from 'node:assert/strict';
import test from 'node:test';
import { renderStoreCatalogSearch, renderStoreCatalogDetail, renderStoreCatalogStatus } from '../src/store-catalog-view.mjs';

const manifest = {
  schemaVersion: 1, version: 'fixture', sourceDate: '2026-06-30', collectedAt: '2026-10-21T22:00:00Z',
  acceptedCount: 123456, sourceCount: 123458, rejectedCount: 1, duplicateCount: 1,
  source: { provider: 'semas', name: '소상공인시장진흥공단 상가정보', url: 'https://www.data.go.kr/data/15083033/fileData.do' },
  regions: [{ code: '11', name: '서울특별시', count: 100000 }, { code: '26', name: '부산광역시', count: 23456 }],
};
const entry = overrides => ({ id: 'semas:STORE0001', sourceRecordId: 'STORE0001', name: '한눈커피', branchName: '시청점',
  roadAddress: '서울특별시 중구 테스트길 1', landAddress: '서울특별시 중구 테스트동 1', regionCode: '11',
  industryCode: 'I21201', industryName: '카페', sourceDate: '2026-06-30', businessNumber: null, ...overrides });
const search = overrides => renderStoreCatalogSearch({ query:'커피', manifest,
  result: { results: [], total:0, foundCount:0, complete:true, progress: {completedShards:3,totalShards:3,failedShards:0}, failures:[] }, ...overrides });
const result = (entries, overrides) => ({ results: entries, total: entries.length, foundCount: entries.length,
  complete:true, progress: {completedShards:3,totalShards:3,failedShards:0}, failures:[], ...overrides });

test('catalog results identify their scope, source date, and numberless selection action', () => {
  const html = search({ result: result([entry()]) });
  assert.match(html, /사업자번호 미확인/);
  assert.match(html, /data-action="select-store-result" data-id="semas:STORE0001"/);
  assert.match(html, /시청점/);
  assert.match(html, /서울특별시 중구 테스트길 1/);
  assert.match(html, /원천 기준일 <strong>2026-06-30/);
  assert.match(html, /실제 자료 수집 <strong>2026\. 10\. 22\./);
  assert.match(html, /검색 대상 123,456곳/);
  assert.match(html, /국내 모든 사업자등록 상호가 포함된 자료는 아니며/);
  assert.doesNotMatch(html, /data-number=|select-name-result|선택 후 조회/);
  assert.equal((html.match(/href="https:\/\/www.data.go.kr/g)||[]).length, 1);
});

test('loading never declares zero or no matches, and supports indeterminate startup', () => {
  const initial = search({ loading:true, result:null });
  assert.match(initial, /aria-busy="true"/);
  assert.match(initial, /상가 명부에서 검색 중/);
  assert.match(initial, /<progress max="100"  aria-label=/);
  assert.doesNotMatch(initial, /0곳|찾지 못했습니다|검색을 완료하지 못했습니다|role="alert"/);
  const running = search({ loading:true, result: result([entry()], {total:null,foundCount:7,complete:false,
    progress:{completedShards:1,totalShards:4,failedShards:0}}) });
  assert.match(running, /검색 중 · 현재 7곳 확인/);
  assert.match(running, /value="25"/);
  assert.match(running, /검색 범위 25% 확인/);
  assert.doesNotMatch(running, /전체 7곳|검색 미완료/);
});

test('partial failures show retained matches without certifying their final count', () => {
  const html = search({ result: result([entry()], {total:null,foundCount:8,complete:false,failures:[{id:'a'}]}), error:'검색 자료 연결 실패' });
  assert.match(html, /현재 확인한 결과 8곳 · 검색 미완료/);
  assert.match(html, /전체 건수는 확정되지 않았습니다/);
  assert.match(html, /data-action="retry-store-search"/);
  assert.match(html, /role="alert"/);
  assert.match(html, /data-id="semas:STORE0001"/);
  assert.doesNotMatch(html, /일치하는 상가를 찾지 못했습니다|전체 8곳/);
  const failed = search({ result: result([], {total:null,complete:false,failures:[{id:'a'}]}) });
  assert.match(failed, /검색 결과가 없다고 판단할 수 없습니다/);
  assert.doesNotMatch(failed, /0곳|일치하는 상가를 찾지 못했습니다/);
});

test('only a complete search can show a zero-match state', () => {
  const html = search({ regionCode:'26' });
  assert.match(html, /<strong>0곳<\/strong>/);
  assert.match(html, /일치하는 상가를 찾지 못했습니다/);
  assert.match(html, /부산광역시 상가 명부/);
  assert.match(html, /업체의 폐업 여부를 의미하지 않습니다/);
  assert.match(html, /data-action="search-by-number"/);
  assert.doesNotMatch(html, /role="alert"/);
  const malformed = search({ result:result([], {total:null}) });
  assert.match(malformed, /검색을 완료하지 못했습니다/);
  assert.doesNotMatch(malformed, /<strong>0곳<\/strong>/);
});

test('result pagination uses available rows instead of producing pages beyond a capped result set', () => {
  const entries = Array.from({length:200}, (_, i) => entry({id:`semas:${i}`, name:`업체 ${i}`}));
  const html = search({ result:result(entries, {total:8731,capped:true,shownCount:200}), page:999 });
  assert.equal((html.match(/data-action="select-store-result"/g)||[]).length, 10);
  assert.match(html, /20 \/ 20 페이지/);
  assert.match(html, /전체 8,731곳 중 상위 200곳/);
  assert.match(html, /data-action="store-search-next" disabled/);
  assert.doesNotMatch(html, /874 페이지|data-action="store-search-prev" disabled/);
  const first = search({ result:result(entries), page:0 });
  assert.match(first, /1 \/ 20 페이지/);
  assert.match(first, /data-action="store-search-prev" disabled/);
  assert.doesNotMatch(first, /data-action="store-search-next" disabled/);
});

test('region choices are labelled, preserve the selection, and report real manifest counts', () => {
  const html = search({regionCode:'26'});
  assert.match(html, /<label for="store-region-filter">지역<\/label>/);
  assert.match(html, /id="store-region-filter" name="storeRegion" aria-label="전국 상가 검색 지역"/);
  assert.match(html, /value="26" selected>부산광역시 \(23,456\)/);
  assert.match(html, /value="11" >서울특별시 \(100,000\)/);
});

test('same-name branches remain distinct selectable source records', () => {
  const html = search({ result:result([entry(), entry({id:'semas:STORE0002',sourceRecordId:'STORE0002',branchName:'강남점'})]), selectedId:'semas:STORE0002' });
  assert.equal((html.match(/data-action="select-store-result"/g)||[]).length, 2);
  assert.equal((html.match(/class="store-catalog-row is-selected"/g)||[]).length, 1);
  assert.match(html, /data-id="semas:STORE0002"[^>]*aria-current="true"/);
  assert.match(html, /시청점/);
  assert.match(html, /강남점/);
  assert.match(html, /id="store-results-title" tabindex="-1"/);
});

test('all catalog text and selector attributes are escaped', () => {
  const attack = '<img src=x onerror="alert(1)">';
  const html = search({query:attack,error:attack,regionCode:attack,
    manifest:{...manifest,source:{name:attack,url:'javascript:alert(1)'},regions:[{code:attack,name:attack,count:1}]},
    result:result([entry({id:attack,name:attack,branchName:attack+'支',roadAddress:attack,industry:{label:attack}})])});
  assert.doesNotMatch(html, /<img\b|href="javascript:|data-id="<|value="<|aria-label="</);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /data-id="&lt;img/);
});

test('source links reject credentials and script URLs', () => {
  for (const url of ['javascript:alert(1)','https://user:password@example.com/','https://example.com/?token=secret']) {
    const html=search({manifest:{...manifest,source:{...manifest.source,url}}});
    assert.doesNotMatch(html, /href="javascript:|password@example|token=secret/);
  }
  const safe=search({manifest:{...manifest,source:{...manifest.source,url:'https://example.com/?x=1&y=2'}}});
  assert.match(safe, /href="https:\/\/example.com\/\?x=1&amp;y=2" target="_blank" rel="noopener noreferrer"/);
});

test('numberless details separate source IDs, industry taxonomy and NTS state lookup', () => {
  const html=renderStoreCatalogDetail({entry:entry(),manifest});
  assert.match(html, /원천 상가업소번호<\/dt><dd>STORE0001/);
  assert.match(html, /사업자등록번호<\/dt><dd>원천에서 제공하지 않음/);
  assert.match(html, /상가업소번호는 사업자등록번호와 다른 식별자/);
  assert.match(html, /소상공인 상권업종분류/);
  assert.match(html, /입력한 번호와 이 상가의 관계는 자동으로 확정하지 않습니다/);
  assert.match(html, /data-action="return-store-results"/);
  assert.match(html, /id="store-detail-title" tabindex="-1"/);
  assert.match(html, /data-action="search-by-number"/);
  assert.doesNotMatch(html, /data-number=|사업자번호로 조회[^<]*STORE|저장|영업 중|계속사업자/);
  assert.equal(renderStoreCatalogDetail(), '');
});

test('details escape every source field and reject invalid calendar dates', () => {
  const attack='<script>alert("x")</script>';
  const html=renderStoreCatalogDetail({entry:entry({name:attack,branchName:attack+'지점',sourceRecordId:attack,roadAddress:attack,
    landAddress:attack+'1',industry:{label:attack},sourceDate:'2026-02-30'}),manifest});
  assert.doesNotMatch(html, /<script>|2026-02-30/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /기준일 미제공/);
});

test('status distinguishes source date, last successful acquisition, and later failed attempt', () => {
  const html=renderStoreCatalogStatus({manifest,status:{status:'failed',lastAttemptAt:'2026-10-22T03:00:00Z',lastSuccessAt:'2026-10-21T22:00:00Z',
    lastError:'원천 연결 실패',schedule:{label:'매일 06:17 (한국시간)'}}});
  assert.match(html, /최근 갱신 실패/);
  assert.match(html, /자동 갱신 확인<\/dt><dd>매일 06:17/);
  assert.match(html, /마지막 실제 자료 수집<\/dt><dd>2026\. 10\. 22\. 오전 7:00/);
  assert.match(html, /마지막 원천 확인 시도<\/dt><dd>2026\. 10\. 22\. 오후 12:00/);
  assert.match(html, /원천 기준일 <strong>2026-06-30/);
  assert.match(html, /원천 연결 실패 이전에 수집한 정상 자료를 유지/);
  assert.match(html, /검색 대상 <strong>123,456곳/);
  assert.match(html, /수록 지역 <strong>2개/);
  assert.match(html, /사업자번호 확인 업체 수에는 합산하지 않습니다/);
  assert.match(html, /<th scope="row">서울특별시<\/th><td>100,000곳/);
});

test('status never fabricates a dataset, success timestamp or collection schedule', () => {
  const html=renderStoreCatalogStatus();
  assert.match(html, /아직 수집 전/);
  assert.match(html, /자동 확인 일정 미설정/);
  assert.match(html, /마지막 실제 자료 수집<\/dt><dd>기록 없음/);
  assert.match(html, /기준일 미제공/);
  assert.match(html, /검색 대상 <strong>0곳/);
  assert.doesNotMatch(html, /정상 자료를 유지|17개|2026-06-30/);
});
