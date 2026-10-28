import assert from 'node:assert/strict';
import test from 'node:test';
import { renderBusinessSearch } from '../src/business-search-view.mjs';

const company = overrides => ({
  businessNumber: '2208162517', name: '같은상호', address: '서울시 테스트길 1', industry: '소프트웨어',
  sourceLabels: ['공개 수집 자료'], sourceUrl: 'https://company.example.com/about',
  collectedAt: '2026-10-21T13:00:00Z', fromPublic: true, ...overrides,
});
const render = overrides => renderBusinessSearch({
  query: '같은상호', result: { results: [], total: 0, offset: 0, limit: 10 },
  index: { publicCount: 2, savedCount: 3, totalCount: 4 },
  meta: { status: 'available', generatedAt: '2026-10-21T13:00:00Z' }, ...overrides,
});

test('name results show public and private coverage without implying a nationwide registry', () => {
  const html = render();
  assert.match(html, /id="name-results-title" tabindex="-1">등록 상태를 확인할 수 있는 업체/);
  assert.match(html, /사업자번호 있음/);
  assert.match(html, /업체명·주소·사업자번호를 비교한 뒤 선택/);
  assert.match(html, /해당 번호로 국세청 등록 상태를 확인/);
  assert.match(html, /공개자료 2곳/);
  assert.match(html, /내 저장정보 3곳/);
  assert.match(html, /검색 대상은 4곳/);
  assert.match(html, /전국 모든 사업자의 상호가 수집된 것은 아닙니다/);
  assert.match(html, /매일 06:17 \(한국시간\)/);
  assert.match(html, /공개 목록 생성/);
  assert.doesNotMatch(html, /시각 미제공/);
  assert.match(render({ meta: { status: 'not_collected' } }), /공개자료 수집 전/);
});

test('no matches and failed public loading have distinct actionable explanations', () => {
  const empty = render();
  assert.match(empty, /수집·저장된 자료에서 찾지 못했습니다/);
  assert.match(empty, /현재 불러온 검색 대상 4곳에서 일치하는 이름이 없습니다/);
  assert.match(empty, /전국 상호 전체를 조회한 결과는 아닙니다/);
  assert.match(empty, /업체가 없거나 폐업했다는 뜻은 아닙니다/);
  assert.match(empty, /data-action="search-by-number"/);
  assert.match(empty, /data-action="add-partner-from-search"/);
  assert.doesNotMatch(empty, /role="alert"/);

  const failed = render({ error: '공개자료 연결에 실패했습니다.' });
  assert.match(failed, /공개자료 연결 확인 필요/);
  assert.match(failed, /role="alert"/);
  assert.match(failed, /현재 확인할 수 있는 저장정보에서 찾지 못했습니다/);
  assert.match(failed, /내 저장정보는 계속 검색할 수 있습니다/);
  assert.match(failed, /업체가 없거나 폐업했다는 뜻은 아닙니다/);

  const partial = render({ error: '공개자료 연결에 실패했습니다.', result: {
    results: [company({ fromPublic: false, sourceLabels: ['내 거래처'], sourceUrl: '' })], total: 1, offset: 0, limit: 10,
  } });
  assert.match(partial, /data-action="select-name-result"/);
  assert.doesNotMatch(partial, /찾지 못했습니다/);
});

test('loading is announced and does not prematurely present no-match or external-search actions', () => {
  const html = render({ loading: true });
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /data-action="retry-name-search" disabled/);
  assert.match(html, /현재 확인한 자료 기준/);
  assert.match(html, /공개자료 불러오는 중/);
  assert.doesNotMatch(html, /찾지 못했습니다/);
  assert.doesNotMatch(html, /name-external-search/);
});

test('same-name businesses retain distinct number-based selection and selected state', () => {
  const html = render({
    result: { results: [company(), company({ businessNumber: '6901100416', address: '충남 서산시 테스트길 2' })], total: 2, offset: 0, limit: 10 },
    selectedNumber: '6901100416',
  });
  assert.equal((html.match(/data-action="select-name-result"/g) || []).length, 2);
  assert.match(html, /data-number="2208162517"/);
  assert.match(html, /data-number="6901100416"/);
  assert.match(html, /같은상호 220-81-62517 등록 상태 확인/);
  assert.match(html, /같은상호 690-11-00416 상세 다시 보기/);
  assert.equal((html.match(/class="business-candidate is-selected"/g) || []).length, 1);
  assert.match(html, /서울시 테스트길 1/);
  assert.match(html, /충남 서산시 테스트길 2/);
  assert.match(html, /선택한 업체/);
});

test('query, company fields and source labels are escaped in text and attributes', () => {
  const attack = '<img src=x onerror="alert(1)">';
  const html = render({ query: attack, error: attack, result: {
    results: [company({ name: attack, address: attack, industry: attack, matchedName: attack + '별칭', sourceLabels: [attack] })],
    total: 1, offset: 0, limit: 10,
  } });
  assert.doesNotMatch(html, /<img\b/);
  assert.doesNotMatch(html, /aria-label="<|<h3></);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /검색된 이름/);
  assert.match(html, /aria-label="&lt;img/);
});

test('only safe public source URLs render as links and external queries stay URL-encoded', () => {
  for (const url of ['javascript:alert(1)', 'https://user:password@example.com/', 'https://example.com/?token=secret']) {
    const html = render({ result: { results: [company({ sourceUrl: url })], total: 1, offset: 0, limit: 10 } });
    assert.doesNotMatch(html, /상호 출처/);
    assert.doesNotMatch(html, /href="javascript:|password@example|token=secret/);
  }
  const safe = render({ result: { results: [company({ sourceUrl: 'https://company.example.com/?x=1&y=2' })], total: 1, offset: 0, limit: 10 } });
  assert.match(safe, /href="https:\/\/company\.example\.com\/\?x=1&amp;y=2"/);
  assert.match(safe, /target="_blank" rel="noopener noreferrer"/);

  const query = '회사" onfocus="alert(1)<script>&';
  const html = render({ query });
  const externalHref = html.match(/href="(https:\/\/search\.naver\.com\/search\.naver\?query=[^"]+)"/)?.[1];
  assert.ok(externalHref);
  assert.equal(new URL(externalHref).searchParams.get('query'), query + ' 사업자등록번호');
  assert.doesNotMatch(html, /<script>|" onfocus="/);
  assert.match(html, /외부 검색 결과는 자동으로 연결되지 않습니다/);
});

test('pagination exposes total pages and disables only the relevant boundary control', () => {
  const first = render({ result: { results: [company()], total: 25, offset: 0, limit: 10 } });
  assert.match(first, /1 \/ 3 페이지 · 25곳/);
  assert.match(first, /data-action="name-search-prev" disabled/);
  assert.doesNotMatch(first, /data-action="name-search-next" disabled/);

  const last = render({ result: { results: [company()], total: 25, offset: 20, limit: 10 } });
  assert.match(last, /3 \/ 3 페이지 · 25곳/);
  assert.doesNotMatch(last, /data-action="name-search-prev" disabled/);
  assert.match(last, /data-action="name-search-next" disabled/);
  assert.doesNotMatch(render({ result: { results: [company()], total: 1, offset: 0, limit: 10 } }), /name-search-pagination/);
});

test('saved evidence keeps its source timestamp without inflating public coverage', () => {
  const html = render({ result: { results: [company({ fromPublic: false, fromSavedEvidence: true,
    sourceLabels: ['내 거래처', '저장한 공개자료'] })], total: 1, offset: 0, limit: 10 },
    index: { publicCount: 0, savedCount: 1, totalCount: 1 } });
  assert.match(html, /공개자료 0곳/);
  assert.match(html, /내 저장정보 1곳/);
  assert.match(html, /저장한 공개자료/);
  assert.match(html, /자료 수집 2026/);
  assert.match(html, /상호 출처/);
});

test('external fallback turns search wildcards into words and retains URL escaping', () => {
  const html = render({ query: '%서해*전문점%' });
  const href = html.match(/href="(https:\/\/search\.naver\.com\/search\.naver\?query=[^"]+)"/)?.[1];
  assert.equal(new URL(href).searchParams.get('query'), '서해 전문점 사업자등록번호');
});
