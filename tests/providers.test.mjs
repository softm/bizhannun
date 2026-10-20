import assert from 'node:assert/strict';
import test from 'node:test';
import { handleApi } from '../api/index.mjs';
import { parseJsonLossless, queryNtsStatuses, validateNtsBusinesses, queryCommerce } from '../server/providers.mjs';

const BRN = '2208162517';
const OTHER_BRN = '1048137225';
const SECRET = 'test-secret+do-not-print/==';
const neverFetch = async () => { throw new Error('Unexpected network call'); };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const business = { b_no: BRN, start_dt: '20000101', p_nm: '테스트대표' };
const statusRow = (overrides = {}) => ({
  b_no: BRN, b_stt: '계속사업자', b_stt_cd: '01', tax_type: '부가가치세 일반과세자',
  tax_type_cd: '01', end_dt: '', utcc_yn: 'N', tax_type_change_dt: '',
  invoice_apply_dt: '', rbf_tax_type: '해당없음', rbf_tax_type_cd: '99', ...overrides,
});
const request = (path, value, headers = {}) => new Request(`https://api.example.com${path}`, {
  method: value === undefined ? 'GET' : 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  ...(value === undefined ? {} : { body: JSON.stringify(value) }),
});

test('health reports key configuration without claiming provider authentication', async () => {
  const response = await handleApi(request('/api/health'), { NTS_SERVICE_KEY: SECRET }, neverFetch);
  const payload = await response.json();
  assert.equal(payload.providers.nts.configured, true);
  assert.equal(payload.providers.nts.authentication, 'not_checked');
  assert.equal(payload.providers.ftc.configured, false);
  assert.equal(payload.rateLimit.distributed, false);
  assert.equal(JSON.stringify(payload).includes(SECRET), false);
});

test('key absence is not configured, never no records, and makes no request', async () => {
  const nts = await queryNtsStatuses([BRN], {}, neverFetch);
  const ftc = await queryCommerce(BRN, { DATA_GO_KR_SERVICE_KEY: SECRET }, neverFetch);
  const validation = await validateNtsBusinesses([business], {}, neverFetch);
  assert.equal(nts[0].outcome, 'not_configured');
  assert.equal(ftc.outcome, 'not_configured');
  assert.equal(validation[0].valid, null);
});

test('status sends normalized official input, encodes key once, and matches returned numbers', async () => {
  let calls = 0;
  const response = await handleApi(request('/api/status', { businessNumbers: ['220-81-62517', OTHER_BRN] }), {
    DATA_GO_KR_SERVICE_KEY: encodeURIComponent(SECRET),
  }, async (url, init) => {
    calls += 1;
    assert.equal(url.origin, 'https://api.odcloud.kr');
    assert.equal(url.pathname, '/api/nts-businessman/v1/status');
    assert.equal(url.searchParams.get('serviceKey'), SECRET);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(JSON.parse(init.body), { b_no: [BRN, OTHER_BRN] });
    return json({ status_code: 'OK', request_cnt: 2, data: [
      statusRow({ b_no: OTHER_BRN, b_stt_cd: '03', end_dt: '20260131', utcc_yn: 'Y' }),
      statusRow(),
    ] });
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(payload.results.map((row) => row.businessStatus), ['active', 'closed']);
  assert.equal(payload.results[1].closedAt, '2026-01-31');
  assert.equal(payload.results[1].unitTaxConversion, true);
  assert.equal(JSON.stringify(payload).includes(SECRET), false);
});

test('NTS explicit no-registration message is separate from missing or unknown responses', async () => {
  const notFound = await queryNtsStatuses([BRN], { NTS_SERVICE_KEY: SECRET }, async () => json({
    status_code: 'OK', data: [statusRow({ b_stt_cd: '', tax_type: '국세청에 등록되지 않은 사업자등록번호입니다.' })],
  }));
  const empty = await queryNtsStatuses([BRN], { NTS_SERVICE_KEY: SECRET }, async () => json({ status_code: 'OK', data: [] }));
  const unknown = await queryNtsStatuses([BRN], { NTS_SERVICE_KEY: SECRET }, async () => json({ status_code: 'OK', data: [statusRow({ b_stt_cd: '99' })] }));
  const inheritedName = await queryNtsStatuses([BRN], { NTS_SERVICE_KEY: SECRET }, async () => json({ status_code: 'OK', data: [statusRow({ b_stt_cd: '__proto__' })] }));
  assert.equal(notFound[0].outcome, 'not_found');
  assert.equal(empty[0].outcome, 'error');
  assert.equal(unknown[0].errorCode, 'invalid_upstream_response');
  assert.equal(inheritedName[0].errorCode, 'invalid_upstream_response');
});

test('authentication, rate limits, network errors, and XML errors are not no records', async () => {
  for (const [response, expected] of [
    [json({ message: SECRET }, 403), 'provider_unauthorized'],
    [json({ resultCode: '22' }), 'provider_rate_limited'],
    [new Response('<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode><errMsg>secret</errMsg></cmmMsgHeader></OpenAPI_ServiceResponse>'), 'provider_unauthorized'],
    [json({ unexpected: SECRET }), 'invalid_upstream_response'],
  ]) {
    const result = await queryNtsStatuses([BRN], { NTS_SERVICE_KEY: SECRET }, async () => response);
    assert.equal(result[0].outcome, 'error');
    assert.equal(result[0].errorCode, expected);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
  }
  const result = await queryNtsStatuses([BRN], { NTS_SERVICE_KEY: SECRET }, async (url) => { throw new Error(`fetch failed ${url}`); });
  assert.equal(result[0].errorCode, 'provider_network_error');
  assert.equal(JSON.stringify(result).includes(encodeURIComponent(SECRET)), false);
});

test('upstream timeout is aborted and reported separately', async () => {
  const result = await queryNtsStatuses([BRN], { NTS_SERVICE_KEY: SECRET, PROVIDER_TIMEOUT_MS: '100' }, async (_url, init) => {
    return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }));
  });
  assert.equal(result[0].errorCode, 'provider_timeout');
  assert.equal(result[0].outcome, 'error');
});

test('invalid business numbers, oversized batches, and impossible dates fail before fetch', async () => {
  for (const [path, value] of [
    ['/api/status', { businessNumbers: ['1234567890'] }],
    ['/api/status', { businessNumbers: Array(101).fill(BRN) }],
    ['/api/commerce', { businessNumber: 'https://evil.test/' }],
    ['/api/validate', { businesses: [{ ...business, start_dt: '20260230' }] }],
  ]) {
    const response = await handleApi(request(path, value), { NTS_SERVICE_KEY: SECRET }, neverFetch);
    assert.equal(response.status, 400);
  }
});

test('valid 02 is a completed but unconfirmed check, and optional inputs stay omitted', async () => {
  const response = await handleApi(request('/api/validate', { businesses: [business] }), { NTS_SERVICE_KEY: SECRET }, async (url, init) => {
    assert.equal(url.pathname, '/api/nts-businessman/v1/validate');
    assert.deepEqual(JSON.parse(init.body), { businesses: [business] });
    return json({ status_code: 'OK', data: [{ b_no: BRN, valid: '02', valid_msg: '확인할 수 없습니다', request_param: business }] });
  });
  const payload = await response.json();
  assert.equal(payload.results[0].outcome, 'ok');
  assert.equal(payload.results[0].valid, false);
  assert.equal(payload.results[0].verification, 'unconfirmed');
  assert.equal(payload.results[0].businessStatus, 'unknown');
  assert.equal(JSON.stringify(payload).includes('테스트대표'), false);
});

test('valid 01 requires matching echoed request and matching status identity', async () => {
  const matched = await validateNtsBusinesses([business], { NTS_SERVICE_KEY: SECRET }, async () => json({
    status_code: 'OK', data: [{ b_no: BRN, valid: '01', request_param: business, status: statusRow() }],
  }));
  assert.equal(matched[0].valid, true);
  const swapped = await validateNtsBusinesses([business], { NTS_SERVICE_KEY: SECRET }, async () => json({
    status_code: 'OK', data: [{ b_no: BRN, valid: '01', request_param: { ...business, p_nm: '다른대표' }, status: statusRow() }],
  }));
  assert.equal(swapped[0].errorCode, 'identity_mismatch');
  assert.equal(swapped[0].valid, null);
});

test('lossless JSON preserves large identifiers and leaves quoted numeric text untouched', () => {
  const parsed = parseJsonLossless('{"opnSn":878675976369799584,"small":2,"text":"12345678901234567 and \\\"42\\\"","negative":-878675976369799584,"decimal":1.25}');
  assert.equal(parsed.opnSn, '878675976369799584');
  assert.equal(parsed.negative, '-878675976369799584');
  assert.equal(parsed.small, 2);
  assert.equal(parsed.decimal, 1.25);
  assert.equal(parsed.text, '12345678901234567 and "42"');
});

test('FTC current endpoint maps exact BRN records and preserves large opnSn', async () => {
  const response = await queryCommerce(BRN, { FTC_SERVICE_KEY: SECRET }, async (url) => {
    assert.equal(url.pathname, '/1130000/MllBsDtl_3Service/getMllBsInfoDetail_3');
    assert.equal(url.searchParams.get('brno'), BRN);
    assert.equal(url.searchParams.get('resultType'), 'json');
    return new Response(`{"resultCode":"00","totalCount":"1","items":{"item":{"opnSn":878675976369799584,"brno":"220-81-62517","bzmnNm":"예시상호","lctnRnAddr":"서울 예시로","rprsvNm":"예시대표","prmmiMnno":"2026-서울-1234","operSttusCdNm":"정상영업","domnCn":"example.com"}}}`);
  });
  assert.equal(response.outcome, 'ok');
  assert.equal(response.records[0].name, '예시상호');
  assert.equal(response.records[0].recordId, '878675976369799584');
  assert.equal(response.records[0].businessNumber, BRN);
  assert.equal(new URL(response.records[0].sourceUrl).searchParams.get('searchKrwd'), BRN);
  assert.equal(JSON.stringify(response).includes(SECRET), false);
});

test('FTC supports documented item containers and does not match names', async () => {
  const unrelated = await queryCommerce(BRN, { FTC_SERVICE_KEY: SECRET }, async () => json({
    response: { header: { resultCode: '00' }, body: { totalCount: 1, items: { item: [{ brno: OTHER_BRN, bzmnNm: '같은상호' }] } } },
  }));
  assert.equal(unrelated.outcome, 'error');
  assert.equal(unrelated.errorCode, 'identity_mismatch');
  assert.deepEqual(unrelated.records, []);
  const empty = await queryCommerce(BRN, { FTC_SERVICE_KEY: SECRET }, async () => json({ resultCode: '00', totalCount: '0', items: '' }));
  assert.equal(empty.outcome, 'not_found');
  const unknown = await queryCommerce(BRN, { FTC_SERVICE_KEY: SECRET }, async () => json({ resultCode: 'unexpected', totalCount: '0', items: [] }));
  assert.equal(unknown.outcome, 'error');
  const missing = await queryCommerce(BRN, { FTC_SERVICE_KEY: SECRET }, async () => json({ resultCode: '00' }));
  assert.equal(missing.outcome, 'error');
});

test('CORS admits own host, Pages, and explicit origins, but no wildcard or lookalikes', async () => {
  const env = { ALLOWED_ORIGINS: 'https://approved.example.com,*' };
  for (const origin of ['https://api.example.com', 'https://softm.github.io', 'http://localhost:3000', 'https://approved.example.com']) {
    const response = await handleApi(request('/api/health', undefined, { Origin: origin }), env, neverFetch);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
  }
  for (const origin of ['https://evil.test', 'https://softm.github.io.evil.test', 'null']) {
    const response = await handleApi(request('/api/health', undefined, { Origin: origin }), env, neverFetch);
    assert.equal(response.status, 403);
    assert.equal(response.headers.has('Access-Control-Allow-Origin'), false);
  }
  const preflight = await handleApi(new Request('https://api.example.com/api/status', { method: 'OPTIONS', headers: { Origin: 'https://softm.github.io' } }), env);
  assert.equal(preflight.status, 204);
});

test('local rate limit is bounded per instance and blocks requests before upstream fetch', async () => {
  const env = { API_RATE_LIMIT_PER_MINUTE: '1' };
  const headers = { 'x-forwarded-for': '192.0.2.99' };
  const first = await handleApi(request('/api/status', { businessNumbers: [BRN] }, headers), env, neverFetch);
  const second = await handleApi(request('/api/status', { businessNumbers: [BRN] }, headers), env, neverFetch);
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.ok(Number(second.headers.get('Retry-After')) > 0);
});

test('explicit Vercel route modules export working handlers without authenticated requests', async () => {
  const health = await import('../api/health.js');
  const healthResponse = await health.GET(request('/api/health'));
  assert.equal(healthResponse.status, 200);
  assert.equal((await healthResponse.json()).providers.nts.authentication, 'not_checked');
  for (const [name, body] of [
    ['status', { businessNumbers: [] }],
    ['validate', { businesses: [] }],
    ['commerce', { businessNumber: 'invalid' }],
  ]) {
    const route = await import(`../api/${name}.js`);
    assert.equal(typeof route.POST, 'function');
    assert.equal(typeof route.OPTIONS, 'function');
    // Deliberately invalid input guarantees that no real provider is called,
    // even if the test runner happens to have production environment keys.
    const response = await route.POST(request(`/api/${name}`, body));
    assert.equal(response.status, 400);
    const preflight = await route.OPTIONS(new Request(`https://api.example.com/api/${name}`, {
      method: 'OPTIONS', headers: { Origin: 'https://softm.github.io' },
    }));
    assert.equal(preflight.status, 204);
  }
});

test('body byte limit cancels oversized streams with absent or misleading Content-Length', async () => {
  for (const length of [null, '2']) {
    let chunks = 0;
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) {
        chunks += 1;
        controller.enqueue(new Uint8Array(80_000).fill(32));
        if (chunks === 20) controller.close();
      },
      cancel() { cancelled = true; },
    });
    const headers = { 'Content-Type': 'application/json' };
    if (length !== null) headers['Content-Length'] = length;
    const response = await handleApi(new Request('https://api.example.com/api/status', {
      method: 'POST', headers, body, duplex: 'half',
    }), { NTS_SERVICE_KEY: SECRET }, neverFetch);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'invalid_input');
    assert.equal(cancelled, true);
    assert.ok(chunks < 20, 'the remaining oversized body must not be consumed');
  }
});

test('streamed UTF-8 JSON remains valid across a split Korean character', async () => {
  const encoded = new TextEncoder().encode(JSON.stringify({ businesses: [business] }));
  const splitAt = encoded.findIndex((byte) => byte >= 128) + 1;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoded.slice(0, splitAt));
      controller.enqueue(encoded.slice(splitAt));
      controller.close();
    },
  });
  const response = await handleApi(new Request('https://api.example.com/api/validate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body, duplex: 'half',
  }), {}, neverFetch);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).results[0].outcome, 'not_configured');
});
