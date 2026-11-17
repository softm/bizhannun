import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { collectRegistration } from '../scripts/collect-business-number-pages.mjs';

test('incremental public JSON snapshots survive between runs and resume next page',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'biz-number-test-'));
  try{
    const base=join(folder,'public');
    const status=join(folder,'status.json');
    const pageReads=[];
    const fetchImpl=async url=>{
      const page=Number(new URL(url).searchParams.get('pageNo'));
      pageReads.push(page);
      const item=page===1?{brno:'2208162517',bzmnNm:'다온상사',rnAddr:'서울'}:
        {brno:'6901100416',bzmnNm:'서해박속낙지전문점',rnAddr:'광명'};
      return new Response(JSON.stringify({response:{header:{resultCode:'00'},body:{items:[item],totalCount:1001}}}),{status:200});
    };
    const first=await collectRegistration({root:base,statusPath:status,key:'FAKE_PRIVATE',pageLimit:1,fetchImpl});
    assert.equal(first.status,'partial');
    assert.equal(first.recordCount,1);
    const m1=JSON.parse(await readFile(join(base,'manifest.json')));
    assert.equal(m1.complete,false);assert.equal(m1.nextPageNo,2);
    const second=await collectRegistration({root:base,statusPath:status,key:'FAKE_PRIVATE',pageLimit:1,fetchImpl});
    assert.equal(second.status,'success');
    assert.equal(second.recordCount,2);
    assert.deepEqual(pageReads,[1,2]);
    const m2=JSON.parse(await readFile(join(base,'manifest.json')));
    assert.equal(m2.complete,true);
    const routing=JSON.parse(gunzipSync(await readFile(join(base,'routing.json.gz'))));
    assert.equal(routing['다'][0],0);
    assert.equal(routing['서'][0],1);
    const row0=JSON.parse(gunzipSync(await readFile(join(base,m2.shards[0].path))));
    assert.equal(row0[0][0],'2208162517');
    assert.equal(second.sourceTotal,1001);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test('FTC errors do not publish empty JSON or reveal service keys',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'biz-number-test-'));
  try{
    const stat=join(folder,'status.json');
    const result=await collectRegistration({root:join(folder,'data'),statusPath:stat,key:'SECRET_TOKEN',
      fetchImpl:async()=>new Response('SERVICE_KEY_IS_NOT_REGISTERED_ERROR',{status:403})});
    assert.equal(result.status,'failed');
    assert.ok(!JSON.stringify(result).includes('SECRET_TOKEN'));
    assert.match(result.message,/403/);
  }finally{await rm(folder,{recursive:true,force:true});}
});
