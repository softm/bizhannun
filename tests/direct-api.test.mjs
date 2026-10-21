import test from 'node:test';
import assert from 'node:assert/strict';
import { callDirectApi } from '../src/direct-api.mjs';
const bno = '2208162517';
const config = { ntsServiceKey: 'fixture+key/=' };
const neverFetch = () => { throw new Error('Unexpected request'); };
test('direct health is local and does not expose the key or claim successful authentication', async () => {
  const result = await callDirectApi('health', undefined, config, { fetchImpl: neverFetch });
  assert.equal(result.mode, 'direct');
  assert.equal(result.providers.nts.configured, true);
  assert.equal(result.providers.nts.authentication, 'not_checked');
  assert.equal(JSON.stringify(result).includes(config.ntsServiceKey), false);
});
test('direct status calls only the official API without cookies and preserves provider mapping', async () => {
  const result = await callDirectApi('status', { businessNumbers: ['220-81-62517'] }, config, { fetchImpl: async (url, init) => {
    assert.equal(url.origin, 'https://api.odcloud.kr');
    assert.equal(url.pathname, '/api/nts-businessman/v1/status');
    assert.equal(url.searchParams.get('serviceKey'), config.ntsServiceKey);
    assert.equal(init.credentials, 'omit');
    assert.deepEqual(JSON.parse(init.body), { b_no: [bno] });
    return new Response(JSON.stringify({ status_code: 'OK', data: [{ b_no:bno, b_stt_cd:'01', b_stt:'계속사업자', tax_type:'일반과세자', tax_type_cd:'01', end_dt:'' }] }));
  } });
  assert.equal(result.results[0].outcome, 'ok');
  assert.equal(result.results[0].businessStatus, 'active');
});
test('missing key and commerce remain unconfigured without network or proxy fallback', async () => {
  const result = await callDirectApi('status', { businessNumbers: [bno] }, {}, { fetchImpl: neverFetch });
  assert.equal(result.results[0].outcome, 'not_configured');
  const commerce = await callDirectApi('commerce', { businessNumber:bno }, config, { fetchImpl: neverFetch });
  assert.equal(commerce.outcome,'not_configured');
});
test('invalid input and aborted requests fail before a direct network call', async () => {
  await assert.rejects(callDirectApi('status',{businessNumbers:['bad']},config,{fetchImpl:neverFetch}));
  await assert.rejects(callDirectApi('validate',{businesses:[{b_no:bno,start_dt:'20260231',p_nm:'테스트'}]},config,{fetchImpl:neverFetch}));
  const controller = new AbortController();controller.abort();
  await assert.rejects(callDirectApi('health',undefined,config,{signal:controller.signal,fetchImpl:neverFetch}));
});
