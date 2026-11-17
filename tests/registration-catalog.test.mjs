import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { createHash, webcrypto } from 'node:crypto';
import { createRegistrationCatalog, renderRegistrationCatalog, validateRegistrationManifest } from '../src/registration-catalog.mjs';

globalThis.crypto ||= webcrypto;
const base='https://example.test/data/business-numbers/';
const descriptor=(path,bytes)=>({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
const pack=obj=>gzipSync(Buffer.from(JSON.stringify(obj)));

test('공개자료만 검색하고 전체 사업자 명부로 오인하지 않는다',async()=>{
  const shard=pack([['2208162517','다온상사','서울','정상'],['6901100416','서해박속낙지전문점','광명','정상']]);
  const routing=pack({'다':[0],'다온':[0],'온상':[0],'상사':[0],'낙지':[0],'서':[0]});
  const manifest={schemaVersion:1,recordCount:2,
    source:{name:'공정위',url:'https://www.data.go.kr/data/15126311/openapi.do'},
    shards:[{...descriptor('shards/00000.json.gz',shard),rows:2}],
    routing:descriptor('routing.json.gz',routing)};
  const files=new Map([[base+'manifest.json',Buffer.from(JSON.stringify(manifest))],
    [base+'routing.json.gz',routing],[base+'shards/00000.json.gz',shard]]);
  const fetchImpl=async url=>{
    const content=files.get(String(url));
    return new Response(content||'',{status:content?200:404});
  };
  const client=createRegistrationCatalog({baseUrl:base,fetchImpl});
  assert.equal((await client.search('다온')).items[0].businessNumber,'2208162517');
  assert.equal((await client.search('다온상사')).total,1);
  assert.equal((await client.search('낙지')).total,1);
  assert.equal((await client.search('기록없음')).total,0);
  const html=renderRegistrationCatalog({query:'다온',state:{result:await client.search('다온')}});
  assert.match(html,/220-81-62517/);
  assert.match(html,/공정위 공식 원천/);
});

test('미게시·손상된 검색자료는 추측한 등록번호를 표시하지 않는다',async()=>{
  const client=createRegistrationCatalog({baseUrl:base,fetchImpl:async()=>new Response('',{status:404})});
  assert.equal((await client.search('다')).status,'not_collected');
  assert.match(renderRegistrationCatalog({query:'다',state:{result:await client.search('다')}}),/아직 게시되지/);
  assert.throws(()=>validateRegistrationManifest({schemaVersion:1,recordCount:1,shards:[],routing:{path:'../secrets'},source:{url:'https://evil.example'}}));
  const html=renderRegistrationCatalog({query:'x',state:{result:{status:'ready',items:[{businessNumber:'2208162517',name:'<img src=x>',address:'<script>'}],total:1,complete:true}}});
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/&lt;script&gt;/);
});

test('상가 상세 재검색은 같은 이름 중 도로명주소 일치 등록번호를 우선한다',async()=>{
  const shard=pack([
    ['2208162517','다온상사','경기도 고양시 덕양구 중앙로 20','정상'],
    ['6901100416','다온상사','서울특별시 중구 세종대로 1','정상']
  ]);
  const routing=pack({'다':[0],'다온':[0],'온상':[0],'상사':[0]});
  const manifest={schemaVersion:1,recordCount:2,
    source:{url:'https://www.data.go.kr/data/15126311/openapi.do'},
    shards:[{...descriptor('shards/00000.json.gz',shard),rows:2}],
    routing:descriptor('routing.json.gz',routing)};
  const files=new Map([[base+'manifest.json',Buffer.from(JSON.stringify(manifest))],
    [base+'routing.json.gz',routing],[base+'shards/00000.json.gz',shard]]);
  const client=createRegistrationCatalog({baseUrl:base,fetchImpl:async url=>{
    const file=files.get(String(url));
    return new Response(file||'',{status:file?200:404});
  }});
  const result=await client.search('다온상사',{preferAddress:'서울특별시 중구 세종대로 1',limit:1});
  assert.equal(result.total,2);
  assert.equal(result.items[0].businessNumber,'6901100416');
});
