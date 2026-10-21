import assert from 'node:assert/strict';
import test from 'node:test';
import { collectPublicBusiness, BUSINESS_PUBLIC_SOURCE } from '../scripts/collect-business-public.mjs';
import { normalizeEnrichment, summarizeEnrichment } from '../src/enrichment.mjs';
const BNO = '2208162517', OTHER = '1048137225', NOW = '2026-10-21T13:30:00Z', KEY = 'fixture+secret/key==';
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const xml = (items = [], { total = items.length, code = '00' } = {}) => `<?xml version="1.0" encoding="UTF-8"?><response><header><resultCode>${code}</resultCode><resultMsg>NORMAL SERVICE</resultMsg></header><body><items>${items.map(item => '<item>' + Object.entries(item).map(([k,v]) => `<${k}>${escape(v)}</${k}>`).join('') + '</item>').join('')}</items>${total === null ? '' : `<totalCount>${total}</totalCount>`}</body></response>`;
const row = (overrides = {}) => ({ saeopjangNm: '테스트(주) 본사', addr: '서울시 테스트길 1', post: '01234', sangsiInwonCnt: '271', seongripDt: '19950701', saeopjaDrno: BNO,
  gyEopjongNm: '고용 적용 업종', gyEopjongCd: '28519', sjEopjongNm: '산재 적용 업종', sjEopjongCd: '12345', ...overrides });
const response = value => new Response(value, { headers: { 'Content-Type': 'application/xml' } });
const options = fetchImpl => ({ key: KEY, fetchImpl, now: () => NOW });

test('missing key is not configured, not zero employees or no registration, and does not fetch', async () => {
  const result = await collectPublicBusiness(BNO, { key: '', fetchImpl: () => { throw new Error('No request expected'); }, now: NOW });
  assert.deepEqual(result.sources, []);
  assert.deepEqual(result.fields, []);
  assert.equal(result.collection.status, 'not_configured');
  assert.deepEqual(result.collection.sourceStatuses.map(item => item.status), ['not_configured','not_configured']);
});

test('official query uses exact requested BRN, encodes key once, and names insurance fields distinctly', async () => {
  const calls = [];
  const result = await collectPublicBusiness('220-81-62517', { ...options(async (url, init) => {
    calls.push(new URL(url));
    assert.equal(url.origin, 'https://apis.data.go.kr');
    assert.equal(url.pathname, '/B490001/gySjbPstateInfoService/getGySjBoheomBsshItem');
    assert.equal(url.searchParams.get('serviceKey'), KEY);
    assert.equal(url.searchParams.get('v_saeopjaDrno'), BNO);
    assert.equal(url.searchParams.get('numOfRows'), '100');
    assert.equal(init.redirect, 'error');
    return response(xml([row({ opaBoheomFg: url.searchParams.get('opaBoheomFg') })]));
  }), key: encodeURIComponent(KEY) });
  assert.deepEqual(calls.map(url => url.searchParams.get('opaBoheomFg')), ['1','2']);
  assert.equal(result.collection.status, 'success');
  assert.equal(result.sources.length, 2);
  assert.ok(result.sources.every(source => source.url === BUSINESS_PUBLIC_SOURCE && source.businessNumber === BNO));
  assert.equal(result.fields.some(item => ['employees','foundedAt','phone','representative'].includes(item.field)), false);
  assert.ok(result.fields.some(item => item.field === 'insuranceEmployeeCount' && item.value === '산재보험 기준 271명'));
  assert.ok(result.fields.some(item => item.field === 'insuranceEstablishedAt' && item.value.includes('1995-07-01')));
  assert.equal(JSON.stringify(result).includes(KEY), false);
  const summary = summarizeEnrichment({ ...result, collectedAt:NOW });
  assert.equal(summary.profile.name, '테스트(주) 본사');
  assert.ok(summary.profile.insuranceEmployeeCount);
});

test('different BRNs and different returned insurance classifications cannot produce accepted facts', async () => {
  const result = await collectPublicBusiness(BNO, options(async () => response(xml([row({ saeopjaDrno: OTHER }), row({ opaBoheomFg: '3' })]))));
  assert.equal(result.sources.length, 0);
  assert.equal(result.fields.length, 0);
  assert.equal(result.collection.status, 'failed');
  assert.ok(result.collection.sourceStatuses.every(status => status.status === 'identity_mismatch'));
});

test('normal empty response means no insurance rows, never an API authorization failure', async () => {
  const result = await collectPublicBusiness(BNO, options(async () => response(xml([]))));
  assert.equal(result.collection.status, 'success');
  assert.ok(result.collection.sourceStatuses.every(status => status.status === 'not_found'));
  assert.equal(result.fields.length, 0);
});

test('authorization, rate limit, provider, HTTP and network errors stay errors and never disclose response or key', async () => {
  for (const [fetcher, expected] of [
    [async () => response(xml([], { code:'30' })), 'not_authorized'],
    [async () => response(xml([], { code:'20' })), 'not_authorized'],
    [async () => response(xml([], { code:'22' })), 'rate_limited'],
    [async () => response(xml([], { code:'05' })), 'provider_error'],
    [async () => new Response(KEY, {status:403}), 'not_authorized'],
    [async () => new Response(KEY, {status:500}), 'http_error'],
    [async () => {throw new Error('Request failed '+KEY);}, 'network_error'],
  ]) {
    const result = await collectPublicBusiness(BNO, options(fetcher));
    assert.equal(result.collection.status,'failed');
    assert.equal(result.sources.length,0);
    assert.ok(result.collection.sourceStatuses.every(status => status.status==='error' && status.errorCode===expected));
    assert.equal(JSON.stringify(result).includes(KEY),false);
  }
});

test('multiple workplaces retain separate proven sources, and zero insured employees remains explicit', async () => {
  const result = await collectPublicBusiness(BNO, options(async url => response(xml([
    row({ opaBoheomFg:url.searchParams.get('opaBoheomFg'), saeopjangNm:'본사', addr:'서울시 테스트길 1',sangsiInwonCnt:'0' }),
    row({ opaBoheomFg:url.searchParams.get('opaBoheomFg'), saeopjangNm:'공장', addr:'서산시 테스트길 2',sangsiInwonCnt:'32' }),
  ]))));
  assert.equal(result.sources.length,4);
  assert.equal(new Set(result.sources.map(item=>item.id)).size,4);
  const summary=summarizeEnrichment({...result,collectedAt:NOW});
  const addresses=summary.fields.find(item=>item.field==='address');
  assert.equal(addresses.conflict,true);
  assert.equal(addresses.alternatives.length,3);
  assert.ok(result.fields.some(item=>item.field==='insuranceEmployeeCount'&&item.value.includes('0명')));
});

test('pagination reads all reported pages and a five-page cap is marked partial', async () => {
  const fullPage = (type, page) => Array.from({length:100},(_,i)=>row({opaBoheomFg:type,saeopjangNm:`지점 ${page}-${i}`,addr:`주소 ${page}-${i}`}));
  const calls=[];
  const result=await collectPublicBusiness(BNO,options(async url=>{
    const type=url.searchParams.get('opaBoheomFg'),page=Number(url.searchParams.get('pageNo'));calls.push([type,page]);
    return response(xml(type==='1'&&page===1?fullPage(type,page):[row({opaBoheomFg:type,saeopjangNm:`추가 ${page}`})],{total:type==='1'?101:1}));
  }));
  assert.deepEqual(calls,[['1',1],['1',2],['2',1]]);
  assert.equal(result.collection.status,'success');
  const capped=await collectPublicBusiness(BNO,options(async url=>response(xml(fullPage(url.searchParams.get('opaBoheomFg'),url.searchParams.get('pageNo')),{total:999}))));
  assert.equal(capped.collection.status,'partial');
  assert.ok(capped.collection.sourceStatuses.every(status=>status.pages===5&&status.truncated));
  assert.equal(capped.sources.length,1000);
  assert.equal(normalizeEnrichment({...capped,collectedAt:NOW}).sources.length,1000);
});

test('a later-page failure preserves earlier verified rows and reports incomplete coverage', async () => {
  const result=await collectPublicBusiness(BNO,options(async url=>{
    if(url.searchParams.get('opaBoheomFg')==='2')return response(xml([]));
    if(url.searchParams.get('pageNo')==='2')return response(xml([],{code:'20'}));
    return response(xml(Array.from({length:100},(_,i)=>row({saeopjangNm:`지점 ${i}`})),{total:101}));
  }));
  assert.equal(result.collection.status,'partial');
  assert.equal(result.sources.length,100);
  assert.equal(result.collection.sourceStatuses[0].status,'partial');
  assert.equal(result.collection.sourceStatuses[0].errorCode,'not_authorized');
});

test('malformed XML, DTD/ENTITY and oversized bodies never become success', async () => {
  for(const value of ['<response><header></response>', '<!DOCTYPE data [<!ENTITY x SYSTEM "file:///etc/passwd">]><response/>',
    '<response><header><resultCode>00</resultCode></header></response>', 'x'.repeat(1_000_001)]){
    const result=await collectPublicBusiness(BNO,options(async()=>response(value)));
    assert.equal(result.collection.status,'failed');
    assert.equal(result.fields.length,0);
  }
  const contentLength=await collectPublicBusiness(BNO,options(async()=>new Response('<response/>',{headers:{'content-length':'1000001'}})));
  assert.equal(contentLength.collection.sourceStatuses[0].errorCode,'response_too_large');
});

test('CDATA, escaped XML text and impossible insurance dates are handled without inventing foundedAt', async () => {
  const doc=xml([row({saeopjangNm:'테스트 & 연구',seongripDt:'20260231'})]).replace('테스트 &amp; 연구','<![CDATA[테스트 & 연구]]>');
  const result=await collectPublicBusiness(BNO,options(async()=>response(doc)));
  assert.equal(result.fields.find(item=>item.field==='name').value,'테스트 & 연구');
  assert.equal(result.fields.some(item=>item.field==='insuranceEstablishedAt'||item.field==='foundedAt'),false);
  const normalized=normalizeEnrichment({...result,collectedAt:NOW});
  assert.equal(normalized.collection.sourceStatuses.length,2);
});
