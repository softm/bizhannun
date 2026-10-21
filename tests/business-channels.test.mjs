import test from 'node:test';
import assert from 'node:assert/strict';
import { collectBusinessChannels } from '../scripts/collect-business-channels.mjs';
import { summarizeEnrichment } from '../src/enrichment.mjs';

const seed={businessNumber:'2208162517',name:'네이버',corpCode:'00266961'};
const now=()=> '2026-10-21T15:00:00.000Z';
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

test('missing optional keys reports six unavailable channels without fetching',async()=>{
  let calls=0;const result=await collectBusinessChannels(seed,{env:{},now,fetchImpl:async()=>{calls++;throw Error();}});
  assert.equal(calls,0);assert.equal(result.collection.sourceStatuses.length,6);
  assert.ok(result.collection.sourceStatuses.every(status=>status.status==='not_configured'));
  assert.equal(result.sources.length,0);assert.equal(result.collection.lastSuccessAt,null);
});
test('DART confirms only the returned business number and rejects another company',async()=>{
  for(const [bizr_no,expected] of [['2208162517','success'],['1248100998','identity_mismatch']]){
    const result=await collectBusinessChannels(seed,{env:{DART_API_KEY:'secret-dart-key'},now,fetchImpl:async(url,options)=>{
      assert.equal(new URL(url).searchParams.get('corp_code'),seed.corpCode);assert.equal(options.redirect,'error');
      return json({status:'000',bizr_no,corp_name:'네이버',ceo_nm:'공개 대표자',adres:'경기도 성남시',hm_url:'https://www.navercorp.com/',est_dt:'19990629'});
    }});
    assert.equal(result.collection.sourceStatuses.find(s=>s.provider==='dart').status,expected);
    assert.equal(result.sources.length,expected==='success'?1:0);
    if(expected==='success')assert.equal(summarizeEnrichment({...result,collectedAt:now()}).profile.name,'네이버');
    assert.ok(!JSON.stringify(result).includes('secret-dart-key'));
  }
});
test('DART missing corp code is explicit and makes no request',async()=>{
  const result=await collectBusinessChannels({...seed,corpCode:''},{env:{DART_API_KEY:'private-key'},now,fetchImpl:async()=>{throw Error('must not fetch');}});
  const status=result.collection.sourceStatuses.find(s=>s.provider==='dart');
  assert.equal(status.status,'not_configured');assert.match(status.message,/고유번호/);
});
test('FSC matches returned BNO, chooses latest date and supplies DART identity code',async()=>{
  const requests=[];
  const result=await collectBusinessChannels({...seed,corpCode:''},{env:{BUSINESS_PUBLIC_SERVICE_KEY:'public-secret',DART_API_KEY:'dart-secret'},now,fetchImpl:async url=>{
    requests.push(new URL(url));
    if(new URL(url).hostname==='opendart.fss.or.kr')return json({status:'000',bizr_no:seed.businessNumber,corp_name:'네이버',est_dt:'19990230'});
    return json({response:{header:{resultCode:'00'},body:{totalCount:3,items:{item:[
      {bzno:seed.businessNumber,corpNm:'옛 상호',basDt:'20250101',enpEmpeCnt:'10',fssCorpUnqNo:'00266961'},
      {bzno:'1248100998',corpNm:'동명 다른 법인',basDt:'20261021'},
      {bzno:seed.businessNumber,corpNm:'네이버',basDt:'20261020',enpEmpeCnt:'123',fssCorpUnqNo:'00266961',enpHmpgUrl:'https://www.navercorp.com/'},
    ]}}}});
  }});
  assert.equal(requests.length,2);assert.equal(requests[1].searchParams.get('corp_code'),'00266961');
  assert.equal(result.sources.length,2);assert.ok(!result.fields.some(f=>f.value==='옛 상호'||f.value==='동명 다른 법인'));
  assert.ok(result.fields.some(f=>f.field==='employees'&&f.value.includes('123명')));
  assert.ok(!result.fields.some(f=>f.field==='foundedAt'));
  assert.ok(!JSON.stringify(result).includes('public-secret'));
});
test('search candidates cannot populate the confirmed company profile',async()=>{
  const result=await collectBusinessChannels(seed,{env:{NAVER_SEARCH_CLIENT_ID:'client-id',NAVER_SEARCH_CLIENT_SECRET:'naver-secret',KAKAO_REST_API_KEY:'kakao-secret'},now,fetchImpl:async(url,options)=>{
    if(new URL(url).hostname==='dapi.kakao.com'){
      assert.equal(options.headers.Authorization,'KakaoAK kakao-secret');
      return json({meta:{total_count:1,is_end:true},documents:[{place_name:'동명 업체',place_url:'https://place.map.kakao.com/1234',road_address_name:'서울',phone:'02-123-4567'}]});
    }
    assert.equal(options.headers['X-Naver-Client-Secret'],'naver-secret');
    return json({total:2,items:[{title:'<b>네이버</b>',link:'https://example.org/public',description:'공개 소개',roadAddress:'서울'},{title:'unsafe',link:'http://127.0.0.1/private',description:'private'}]});
  }});
  assert.equal(result.sources.length,4);assert.ok(result.sources.every(s=>s.match==='candidate'));
  const summary=summarizeEnrichment({...result,collectedAt:now()});
  assert.deepEqual(summary.profile,{});assert.equal(summary.candidates.length,4);
  assert.ok(!JSON.stringify(result).includes('127.0.0.1'));
});
test('provider errors and oversize responses never disclose request secrets',async()=>{
  for(const response of [()=>new Response('https://api.example?serviceKey=sensitive-key',{status:403}),()=>new Response('{}',{headers:{'content-length':'1000001'}}),()=>new Response('not JSON')]){
    const result=await collectBusinessChannels(seed,{env:{DART_API_KEY:'sensitive-key'},now,fetchImpl:async()=>response()});
    const status=result.collection.sourceStatuses.find(s=>s.provider==='dart');
    assert.equal(status.status,'error');assert.ok(!JSON.stringify(result).includes('sensitive-key'));assert.equal(result.sources.length,0);
  }
});
test('search result count is bounded and incomplete result sets are reported',async()=>{
  const result=await collectBusinessChannels(seed,{env:{KAKAO_REST_API_KEY:'key-for-search'},now,fetchImpl:async()=>json({meta:{total_count:1000,is_end:false},documents:Array.from({length:30},(_,i)=>({place_name:'후보 '+i,place_url:'https://place.map.kakao.com/'+i}))})});
  const status=result.collection.sourceStatuses.find(s=>s.provider==='kakao_local');
  assert.equal(result.sources.length,10);assert.equal(status.status,'partial');assert.equal(status.truncated,true);assert.equal(status.matchedCount,0);
});
