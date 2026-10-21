import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareBusinessRequest, parseBusinessRequest } from '../scripts/business-request.mjs';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const request={businessNumber:'2208162517',name:'네이버',website:'https://www.navercorp.com/'};
test('dispatch request validates public input without trusting the domain',()=>{
 const r=parseBusinessRequest({},request);assert.equal(r.verifiedDomain,false);assert.equal(r.businessNumber,request.businessNumber);
 for(const website of ['http://127.0.0.1/','https://x.example/?token=secret','file:///etc/passwd'])assert.throws(()=>parseBusinessRequest({},{...request,website}));
 assert.throws(()=>parseBusinessRequest({},{...request,businessNumber:'bad'}));
});
test('public issue body cannot cause automatic collection without repository-author association',()=>{
 const issue={title:'[사업자 수집] 2208162517',author_association:'NONE',body:'### 사업자등록번호\n2208162517\n\n### 상호\n네이버\n\n### 수집할 공개 웹사이트\nhttps://www.navercorp.com/'};
 assert.equal(parseBusinessRequest({issue}),null);issue.author_association='OWNER';
 assert.equal(parseBusinessRequest({issue}).website,request.website);
 issue.title='Other request';assert.equal(parseBusinessRequest({issue}),null);
});

test('number-only collection uses a public directory without promoting its domain',()=>{
 const r=parseBusinessRequest({},{businessNumber:request.businessNumber,name:'',website:''});
 assert.equal(parseBusinessRequest({},{...request,website:'https://bizno.net/article/2208162517'}).channel,'directory');
 assert.equal(r.website,'https://bizno.net/article/2208162517');assert.equal(r.channel,'directory');assert.equal(r.verifiedDomain,false);
 const issue={title:'[사업자 수집] 2208162517',author_association:'OWNER',body:'### 사업자등록번호\n2208162517\n\n### 상호\n_미입력_\n\n### 수집할 공개 웹사이트\n_미입력_'};
 assert.equal(parseBusinessRequest({issue}).channel,'directory');
});


async function configFixture(t,business) {
 const directory=await mkdtemp(join(tmpdir(),'biz-request-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const configPath=join(directory,'config.json');
 const unrelated={businessNumber:'1048137225',name:'다른 회사',website:'https://other.example.com/',verifiedDomain:true,reviewedAt:'2026-10-01T00:00:00Z'};
 await writeFile(configPath,JSON.stringify({version:1,businesses:[business,unrelated]}));
 return {configPath,unrelated,read:async()=>JSON.parse(await readFile(configPath,'utf8'))};
}

test('a repeated request updates a nonempty name while preserving reviewed metadata for the same canonical website',async t=>{
 const previous={...request,businessNumber:'220-81-62517',website:'https://www.navercorp.com',verifiedDomain:true,channel:'website',search:false,corpCode:'00266961',sourceUrls:['https://official.example.com/profile'],review:{reviewedAt:'2026-10-20T00:00:00Z',evidence:'공식 등록자료'}};
 const fixture=await configFixture(t,previous);
 await prepareBusinessRequest({eventPath:null,configPath:fixture.configPath,inputs:{...request,name:'  네이버 주식회사  '}});
 const config=await fixture.read(),business=config.businesses[0];
 assert.equal(config.businesses.length,2);assert.deepEqual(config.businesses[1],fixture.unrelated);
 assert.equal(business.name,'네이버 주식회사');assert.equal(business.businessNumber,request.businessNumber);
 assert.equal(business.verifiedDomain,true);assert.equal(business.search,false);
 assert.equal(business.corpCode,previous.corpCode);assert.deepEqual(business.review,previous.review);
 assert.deepEqual(business.sourceUrls,previous.sourceUrls);
});

test('changing the website preserves other metadata and keeps the old safe website among six distinct additional sources',async t=>{
 const previous={...request,verifiedDomain:true,channel:'website',corpCode:'00266961',reviewedAt:'2026-10-20T00:00:00Z',sourceUrls:[
  'https://bizno.net/article/2208162517','https://evidence.example.com/a','https://evidence.example.com/a#duplicate',
  'https://evidence.example.com/b','https://evidence.example.com/c','https://evidence.example.com/d','https://evidence.example.com/e','https://evidence.example.com/f',
  'http://127.0.0.1/private','https://evidence.example.com/?token=secret',
 ]};
 const fixture=await configFixture(t,previous);
 await prepareBusinessRequest({eventPath:null,configPath:fixture.configPath,inputs:{...request,name:'',website:'https://bizno.net/article/2208162517'}});
 const business=(await fixture.read()).businesses[0];
 assert.equal(business.website,'https://bizno.net/article/2208162517');assert.equal(business.channel,'directory');assert.equal(business.verifiedDomain,false);
 assert.equal(business.name,previous.name);assert.equal(business.corpCode,previous.corpCode);assert.equal(business.reviewedAt,previous.reviewedAt);
 assert.equal(business.sourceUrls[0],previous.website);assert.equal(business.sourceUrls.length,6);
 assert.equal(new Set(business.sourceUrls).size,6);assert.ok(!business.sourceUrls.includes(business.website));
 assert.ok(!business.sourceUrls.some(url=>url.includes('token=')||url.includes('127.0.0.1')));
});

test('number-only and blank-name refreshes preserve an existing reviewed homepage and company name',async t=>{
 const previous={...request,verifiedDomain:true,channel:'website',corpCode:'00266961',sourceUrls:['https://www.navercorp.com/','https://official.example.com/profile']};
 const fixture=await configFixture(t,previous);
 await prepareBusinessRequest({eventPath:null,configPath:fixture.configPath,inputs:{businessNumber:request.businessNumber,name:'   ',website:''}});
 const business=(await fixture.read()).businesses[0];
 assert.equal(business.website,previous.website);assert.equal(business.name,previous.name);assert.equal(business.verifiedDomain,true);assert.equal(business.channel,'website');
 assert.deepEqual(business.sourceUrls,['https://official.example.com/profile']);assert.equal(business.corpCode,previous.corpCode);
});
