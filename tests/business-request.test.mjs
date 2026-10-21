import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBusinessRequest } from '../scripts/business-request.mjs';
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
