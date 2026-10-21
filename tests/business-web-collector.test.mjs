import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
import { decodePublicBody,decodePageBody,decodeRobotsBody,extractBusinessPage,robotsAllows,runCollector,validatePublicUrl } from '../scripts/collect-business-web.mjs';

const BNO='2208162517',OTHER='1048137225';
const ORIGIN='https://company.testcorp.com';
const seed={businessNumber:BNO,name:'테스트기업',website:ORIGIN};
const lookupImpl=async()=>[{address:'93.184.216.34',family:4}];
const response=(body,status=200,headers={})=>new Response(body,{status,headers:{'content-type':'text/html;charset=utf-8',...headers}});
const now=()=> '2026-10-21T13:00:00.000Z';
const html=`<html><head><title>테스트기업 공식 홈페이지</title><meta property="og:site_name" content="테스트기업"><meta name="description" content="사업용 솔루션 기업"><script type="application/ld+json">{"@type":"Organization","name":"테스트기업","taxID":"220-81-62517","telephone":"02-123-4567","email":"contact@testcorp.com","address":{"@type":"PostalAddress","streetAddress":"공개 사업장 주소"}}</script></head><body>사업자등록번호: 220-81-62517 <a href="/company">회사소개</a><a href="http://127.0.0.1/private">회사소개</a></body></html>`;
async function files(t,contents={}) {
 const dir=await mkdtemp(join(tmpdir(),'biz-web-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const configPath=join(dir,'seeds.json'),outputPath=join(dir,'index.json');
 await writeFile(configPath,JSON.stringify({businesses:[seed]}));
 if(contents.previous)await writeFile(outputPath,JSON.stringify(contents.previous));
 return {configPath,outputPath};
}

test('URL and every DNS answer must be public; local and cloud metadata destinations are refused',async()=>{
 for(const url of ['http://127.0.0.1','http://169.254.169.254','http://[::1]','http://localhost','file:///tmp/a','https://user:pass@example.com','https://example.com:444','https://example.com/?serviceKey=x'])await assert.rejects(validatePublicUrl(url,lookupImpl));
 for(const address of ['10.2.3.4','172.16.0.1','192.168.1.2','100.64.0.1','0.0.0.0','::ffff:127.0.0.1','2001:db8::1'])await assert.rejects(validatePublicUrl('https://example.com',async()=>[{address,family:address.includes(':')?6:4}]));
 await assert.rejects(validatePublicUrl('https://example.com',async()=>[{address:'93.184.216.34',family:4},{address:'10.0.0.1',family:4}]));
 assert.equal((await validatePublicUrl(ORIGIN,lookupImpl)).url.origin,ORIGIN);
});

test('robots respects specific bot rules, longest match, allow tie, wildcard and terminal path',()=>{
 const robots='User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /*.pdf$\n';
 assert.equal(robotsAllows(robots,'/private/a'),false);
 assert.equal(robotsAllows(robots,'/private/public/a'),true);
 assert.equal(robotsAllows(robots,'/file.pdf'),false);
 assert.equal(robotsAllows(robots,'/file.pdf?x=1'),true);
 assert.equal(robotsAllows('User-agent: *\nDisallow: /\nUser-agent: BizHannunBot\nAllow: /', '/anything'),true);
});

test('exact business registration number produces source-backed business fields and safe same-origin links',()=>{
 const page=extractBusinessPage(html,ORIGIN,seed,now());
 assert.equal(page.source.match,'exact_bno');assert.equal(page.source.businessNumber,BNO);
 assert.equal(page.source.channel,'website');
 assert.ok(page.fields.some(f=>f.field==='name'&&f.value==='테스트기업'));
 assert.ok(page.fields.some(f=>f.field==='phone'&&f.scope==='public_business'));
 assert.ok(page.fields.some(f=>f.field==='email'&&f.scope==='public_business'));
 assert.ok(page.fields.every(f=>f.sourceId===page.source.id));
 assert.deepEqual(page.links,[ORIGIN+'/company']);
 assert.ok(!page.fields.some(f=>f.field==='representative'));
});

test('name-only pages remain candidates; exact domain confirmation cannot cross to another host',()=>{
 const page=extractBusinessPage('<title>테스트기업</title><meta property="og:site_name" content="테스트기업"><p>이름이 같은 회사</p>',ORIGIN,seed,now());
 assert.equal(page.source.match,'candidate');assert.equal(page.matched,false);
 const verified=extractBusinessPage('<title>테스트기업</title>',ORIGIN,{...seed,verifiedDomain:true},now());
 assert.equal(verified.source.match,'confirmed_domain');
 const cross=extractBusinessPage('<title>테스트기업</title>','https://other-company.com',{...seed,verifiedDomain:true},now());
 assert.equal(cross.source.match,'candidate');
});

test('successful collection is bounded, publishes provenance, and preserves unrelated entities',async t=>{
 const paths=await files(t,{previous:{businesses:[{businessNumber:OTHER,name:'기존 회사',sources:[],fields:[]}]}});
 await writeFile(paths.configPath,JSON.stringify([{...seed,verifiedDomain:true}]));
 const calls=[];
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>{calls.push(url.href);return url.pathname==='/robots.txt'?response('User-agent: *\nDisallow: /private',200,{'content-type':'text/plain'}):response(html);}});
 const index=JSON.parse(await readFile(paths.outputPath,'utf8'));
 assert.equal(index.businesses.length,2);
 const collected=index.businesses.find(b=>b.businessNumber===BNO);
 assert.equal(collected.collection.status,'success');assert.equal(collected.officialDomain,'company.testcorp.com');
 assert.equal(collected.sources.length,2);assert.ok(collected.fields.some(f=>f.field==='website'));
 assert.ok(calls.length<=5);
 assert.equal(index.businesses.find(b=>b.businessNumber===OTHER).name,'기존 회사');
});

test('robots denial preserves prior evidence and performs no prohibited page fetch',async t=>{
 const old={businessNumber:BNO,name:'이전 기록',sources:[{id:'old',url:ORIGIN,match:'exact_bno'}],fields:[{field:'name',value:'이전 기록',sourceId:'old'}],collection:{lastSuccessAt:'2026-10-20T00:00:00Z'}};
 const paths=await files(t,{previous:{businesses:[old]}});const calls=[];
 const result=await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>{calls.push(url.href);return response('User-agent: *\nDisallow: /',200,{'content-type':'text/plain'});}});
 const index=JSON.parse(await readFile(paths.outputPath,'utf8'));
 assert.equal(result.failedCount,1);assert.deepEqual(calls,[ORIGIN+'/robots.txt']);
 assert.equal(index.businesses[0].fields[0].value,'이전 기록');assert.equal(index.businesses[0].collection.lastSuccessAt,old.collection.lastSuccessAt);
 assert.equal(index.businesses[0].collection.error,'robots_disallowed');
});

test('redirects to private hosts are rejected before any private fetch',async t=>{
 const paths=await files(t);const hosts=[];
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>{
  hosts.push(url.hostname);if(url.pathname==='/robots.txt')return response('User-agent: *\nAllow: /');
  return response('',302,{location:'http://169.254.169.254/latest/meta-data/'});
 }});
 assert.deepEqual([...new Set(hosts)],['company.testcorp.com']);
 const index=JSON.parse(await readFile(paths.outputPath,'utf8'));assert.equal(index.businesses[0].collection.status,'failed');
});

test('oversized streamed pages never publish successful evidence and preserve last success',async t=>{
 const paths=await files(t,{previous:{businesses:[{businessNumber:BNO,sources:[{id:'old'}],fields:[],collection:{lastSuccessAt:'2026-10-20T00:00:00Z'}}]}});
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):response('a'.repeat(1_000_001))});
 const index=JSON.parse(await readFile(paths.outputPath,'utf8'));
 assert.equal(index.businesses[0].collection.status,'failed');assert.equal(index.businesses[0].sources[0].id,'old');
});

test('EUC-KR response metadata is decoded before business extraction',async t=>{
 const paths=await files(t);const body=Buffer.concat([Buffer.from('<title>'),Buffer.from([0xb0,0xa1]),Buffer.from('</title><p>220-81-62517</p>')]);
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):new Response(body,{headers:{'content-type':'text/html;charset=euc-kr'}})});
 const index=JSON.parse(await readFile(paths.outputPath,'utf8'));
 assert.equal(index.businesses[0].sources[0].title,'가');
 assert.equal(index.businesses[0].sources[0].match,'exact_bno');
});

test('directory tables yield the target company fields rather than directory operator or tax-office contacts',()=>{
 const page=extractBusinessPage(`<title>사업자 조회</title><meta property="og:site_name" content="디렉터리 운영사"><script type="application/ld+json">{"@type":"Organization","name":"디렉터리 운영사","telephone":"02-111-1111"}</script><table><tr><th>회사명</th><td>실제 대상기업</td></tr><tr><th>회사주소</th><td>서울시 공개 사업장</td></tr><tr><th>업태</th><td>서비스</td></tr><tr><th>종목</th><td>소프트웨어</td></tr><tr><th>관할세무서 전화번호</th><td>02-999-9999</td></tr></table><p>사업자번호 220-81-62517 관할세무서 전화번호: 02-999-9999</p>`,ORIGIN+'/article/'+BNO,{...seed,channel:'directory'},now());
 assert.equal(page.source.match,'exact_bno');assert.equal(page.source.channel,'directory');assert.ok(page.fields.every(field=>field.match==='exact_bno'));
 assert.deepEqual(page.fields.filter(f=>f.field==='name').map(f=>f.value),['실제 대상기업']);
 assert.ok(page.fields.some(f=>f.field==='address'&&f.value==='서울시 공개 사업장'));
 assert.ok(page.fields.some(f=>f.field==='businessType'&&f.value==='서비스'));
 assert.ok(page.fields.some(f=>f.field==='businessCategory'&&f.value==='소프트웨어'));
 assert.equal(page.fields.some(f=>f.field==='phone'),false);
});

test('a directory start URL never becomes the business official website or domain',async t=>{
 const paths=await files(t);await writeFile(paths.configPath,JSON.stringify([{...seed,channel:'directory'}]));
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):response(html)});
 const index=JSON.parse(await readFile(paths.outputPath,'utf8'));const business=index.businesses[0];
 assert.equal(business.collection.status,'success');assert.equal(business.officialDomain,undefined);assert.equal(business.website,undefined);
 assert.equal(business.fields.some(f=>f.field==='website'),false);
});


test('hidden elements cannot establish business-number identity',()=>{
 const page=extractBusinessPage('<title>후보</title><div hidden>220-81-62517</div><div style="display:none">220-81-62517</div><p>이름만 같은 기업</p>',ORIGIN,seed,now());
 assert.equal(page.source.match,'candidate');
});

test('public website links expose news, hiring and social references as candidates without fetching their content',()=>{
 const page=extractBusinessPage(html+`<a href="https://www.instagram.com/public_company/">인스타그램</a><a href="https://careers.testcorp.com/jobs">채용</a><a href="/news/company">보도자료</a><a href="https://youtube.com/official?serviceKey=private">거부</a><a href="http://127.0.0.1/news">거부</a><a href="https://youtube.com/official">유튜브</a><a href="https://www.instagram.com/public_company/">중복</a>`,ORIGIN,seed,now());
 assert.deepEqual(page.references.map(source=>source.channel),['social','jobs','news','social']);
 assert.ok(page.references.every(source=>source.match==='candidate'&&source.discoveredFrom===ORIGIN));
 assert.equal(page.references.length,4);
 assert.equal(page.references.some(source=>source.url.includes('serviceKey')),false);
 assert.equal(page.references.some(source=>source.url.includes('127.0.0.1')),false);
});

test('directory exact-number pages may use a company h1 or og title, but never an unverified seed name',()=>{
 const page=extractBusinessPage('<h1>공개 회사명</h1><p>사업자번호: 220-81-62517</p>',ORIGIN+'/article/'+BNO,{...seed,channel:'directory'},now());
 assert.ok(page.fields.some(field=>field.field==='name'&&field.value==='공개 회사명'));
 const og=extractBusinessPage('<meta property="og:title" content="공개 회사명 - 사업자등록번호 조회"><p>220-81-62517</p>',ORIGIN+'/article/'+BNO,{...seed,channel:'directory'},now());
 assert.ok(og.fields.some(field=>field.field==='name'&&field.value==='공개 회사명'));
 const candidate=extractBusinessPage('<h1>사업자등록번호 조회</h1><p>다른 기업</p>',ORIGIN,{...seed,channel:'directory'},now());
 assert.equal(candidate.fields.some(field=>field.field==='name'),false);
 assert.equal(candidate.fields.some(field=>field.value===seed.name),false);
});

test('channel references persist with provenance and are never promoted by the official source match',async t=>{
 const paths=await files(t);
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):response(html+'<a href="https://www.youtube.com/@testcorp">유튜브</a>')});
 const index=JSON.parse(await readFile(paths.outputPath,'utf8'));const sources=index.businesses[0].sources;
 const social=sources.filter(source=>source.channel==='social');assert.equal(social.length,1);assert.equal(social[0].match,'candidate');
 assert.ok(social[0].discoveredFrom);assert.equal(index.businesses[0].collection.status,'success');
});

async function baseline(t, verifiedDomain=false) {
 const paths=await files(t);await writeFile(paths.configPath,JSON.stringify([{...seed,verifiedDomain}]));
 await runCollector({...paths,lookupImpl,now:()=> '2026-10-20T13:00:00.000Z',delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):response(html)});
 return {...paths,previous:JSON.parse(await readFile(paths.outputPath,'utf8'))};
}

test('HTTP 200 identity downgrade preserves confirmed source, original fields and successful timestamp',async t=>{
 const paths=await baseline(t);const previous=paths.previous.businesses[0];
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):response('<title>새 후보</title><table><tr><th>회사명</th><td>합치면 안 되는 후보 이름</td></tr></table>')});
 const business=JSON.parse(await readFile(paths.outputPath,'utf8')).businesses[0];
 assert.deepEqual(business.sources,previous.sources);assert.deepEqual(business.fields,previous.fields);
 assert.equal(business.collection.lastSuccessAt,previous.collection.lastSuccessAt);
 assert.equal(business.collection.status,'failed');assert.equal(business.collection.error,'identity_not_confirmed');
 assert.equal(business.fields.some(field=>field.value==='합치면 안 되는 후보 이름'),false);
});

test('HTTP 200 with only the same BRN but no public fields preserves the previous confirmed snapshot',async t=>{
 const paths=await baseline(t);const previous=paths.previous.businesses[0];
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):response('<title>접근 화면</title><p>220-81-62517</p>')});
 const business=JSON.parse(await readFile(paths.outputPath,'utf8')).businesses[0];
 assert.deepEqual(business.fields,previous.fields);assert.deepEqual(business.sources,previous.sources);
 assert.equal(business.collection.error,'no_public_fields');
});

test('exact BRN to confirmed domain downgrade does not replace a stronger existing source',async t=>{
 const paths=await baseline(t,true);const previous=paths.previous.businesses[0];
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):response('<title>다른 자료</title><meta property="og:site_name" content="새 회사명">')});
 const business=JSON.parse(await readFile(paths.outputPath,'utf8')).businesses[0];
 assert.deepEqual(business.sources,previous.sources);assert.deepEqual(business.fields,previous.fields);
 assert.equal(business.collection.error,'identity_not_confirmed');
});

test('normally reverified equal-level evidence can refresh while another downgraded page remains intact',async t=>{
 const paths=await baseline(t);const previous=paths.previous.businesses[0];
 const oldChild=previous.sources.find(source=>source.url.endsWith('/company'));
 const changed=html.replaceAll('테스트기업','갱신된기업');
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):response(url.pathname==='/company'?'<title>후보</title><meta property="og:site_name" content="관계없는후보">':changed)});
 const business=JSON.parse(await readFile(paths.outputPath,'utf8')).businesses[0];
 assert.equal(business.collection.status,'partial');assert.equal(business.collection.error,'identity_not_confirmed');
 assert.ok(business.fields.some(field=>field.field==='name'&&field.value==='갱신된기업'));
 assert.deepEqual(business.sources.find(source=>source.id===oldChild.id),oldChild);
 assert.deepEqual(business.fields.filter(field=>field.sourceId===oldChild.id),previous.fields.filter(field=>field.sourceId===oldChild.id));
 assert.equal(business.fields.some(field=>field.value==='관계없는후보'),false);
});

test('exact BRN on an unverified website cannot create an official domain or website field',async t=>{
 const paths=await baseline(t);const business=paths.previous.businesses[0];
 assert.equal(business.sources[0].match,'exact_bno');
 assert.equal(business.officialDomain,undefined);assert.equal(business.website,undefined);
 assert.equal(business.fields.some(field=>field.field==='website'),false);
});

test('publisher JSON-LD and footer contacts cannot be assigned to a mentioned BRN without entity or domain evidence',()=>{
 const page=extractBusinessPage('<title>기업 소개 기사</title><meta property="og:site_name" content="언론사"><meta name="description" content="언론사 설명"><script type="application/ld+json">{"@type":"Organization","name":"언론사","telephone":"02-111-1111","email":"publisher@example.com"}</script><p>대상 사업자번호: 220-81-62517</p><footer>TEL: 02-111-1111 이메일: publisher@example.com</footer>',ORIGIN,seed,now());
 assert.equal(page.source.match,'exact_bno');
 assert.equal(page.fields.some(field=>['name','phone','email','description'].includes(field.field)),false);
});


test('UTF-8 bytes override obsolete EUC-KR declarations without corrupting Korean text',()=>{
 const page='<meta charset="euc-kr"><h1>서해박속낙지전문점</h1>';
 assert.equal(decodePageBody(Buffer.from(page),'text/html; charset=EUC-KR'),page);
 const cp949=Buffer.concat([Buffer.from('<meta charset="cp949"><h1>'),Buffer.from([0xb0,0xa1]),Buffer.from('</h1>')]);
 assert.ok(decodePageBody(cp949,'text/html; charset=UTF-8').includes('<h1>가</h1>'));
 assert.throws(()=>decodePageBody(Buffer.from([0xff,0xfe,0xfa]),'text/html;charset=utf-8'),/unsupported_encoding/);
});

test('publisher footer BRN cannot confirm an unrelated business table or heading',()=>{
 const markup='<h1>전혀 다른 회사</h1><table><tr><th>회사명</th><td>전혀 다른 회사</td></tr><tr><th>주소</th><td>다른 사업장</td></tr></table><footer>운영사 사업자번호 220-81-62517</footer>';
 const page=extractBusinessPage(markup,ORIGIN+'/article/'+BNO,{...seed,channel:'directory'},now());
 assert.equal(page.source.match,'candidate');assert.ok(page.fields.every(field=>field.match==='candidate'));
 const cssFooter=extractBusinessPage(markup.replace('<footer>','<div class="site-footer"><span>').replace('</footer>','</span></div>'),ORIGIN,seed,now());
 assert.equal(cssFooter.source.match,'candidate');
});

test('multi-company pages keep only the target registration-number table confirmed',()=>{
 const markup=`<table><tr><th>사업자등록번호</th><td>220-81-62517</td></tr><tr><th>회사명</th><td>대상 기업</td></tr><tr><th>주소</th><td>대상 주소</td></tr></table><table><tr><th>사업자등록번호</th><td>104-81-37225</td></tr><tr><th>회사명</th><td>다른 기업</td></tr><tr><th>주소</th><td>다른 주소</td></tr></table>`;
 const page=extractBusinessPage(markup,ORIGIN+'/article/'+BNO,{...seed,channel:'directory'},now());
 assert.equal(page.source.match,'exact_bno');
 assert.deepEqual(page.fields.filter(field=>field.field==='name'&&field.match!=='candidate').map(field=>field.value),['대상 기업']);
 assert.ok(!page.fields.some(field=>field.value==='다른 주소'));
 const unscoped=extractBusinessPage('<p>대상 번호 220-81-62517</p><table><tr><th>회사명</th><td>첫 회사</td></tr></table><table><tr><th>회사명</th><td>둘째 회사</td></tr></table>',ORIGIN+'/article/'+BNO,{...seed,channel:'directory'},now());
 assert.ok(unscoped.fields.every(field=>field.match==='candidate'));
});

test('Organization graphs and affiliate pages do not merge sibling company details into the parent',()=>{
 const organizations={ '@graph':[
  {'@type':'Organization',name:'대상 기업',taxID:'220-81-62517',telephone:'02-111-1111'},
  {'@type':'Organization',name:'다른 기업',taxID:'104-81-37225',telephone:'02-222-2222'},
  {'@type':'Organization',name:'관계사',telephone:'02-333-3333'},
 ]};
 const page=extractBusinessPage('<script type="application/ld+json">'+JSON.stringify(organizations)+'</script>',ORIGIN+'/company/affiliates',{...seed,verifiedDomain:true},now());
 assert.deepEqual(page.fields.filter(field=>field.field==='name').map(field=>field.value),['대상 기업']);
 assert.deepEqual(page.fields.filter(field=>field.field==='phone').map(field=>field.value),['02-111-1111']);
});

test('HTTP 200 waiting rooms preserve the previous source and report an access restriction per page',async t=>{
 const paths=await baseline(t),previous=paths.previous.businesses[0];
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):response('<title>접속대기_no1</title><p>현재 접속인원이 많아 접속이 지연되고 있습니다.</p>')});
 const index=JSON.parse(await readFile(paths.outputPath,'utf8')),business=index.businesses[0];
 assert.deepEqual(business.sources,previous.sources);assert.deepEqual(business.fields,previous.fields);
 assert.equal(business.collection.error,'access_restricted');
 assert.equal(business.collection.sourceStatuses[0].errorCode,'access_restricted');
 assert.equal(business.collection.sourceStatuses[0].status,'error');
 assert.equal(index.meta.lastSuccessAt,previous.collection.lastSuccessAt);assert.ok(index.meta.schedule.label.includes('06:17'));
});

test('additional public source URLs are bounded and keep distinct identity and page statuses',async t=>{
 const paths=await files(t);await writeFile(paths.configPath,JSON.stringify([{...seed,verifiedDomain:true,sourceUrls:['https://publictourism.example.com/detail/company']}])) ;
 const calls=[];
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>{
  calls.push(url.href);if(url.pathname==='/robots.txt')return response('');
  return response(url.hostname==='company.testcorp.com'?html:'<title>공공 여행 안내</title><meta name="description" content="공개된 식당 소개"><p>번호 미제공</p>');
 }});
 const index=JSON.parse(await readFile(paths.outputPath,'utf8')),business=index.businesses[0];
 const tourism=business.sources.find(source=>source.url.includes('publictourism'));
 assert.equal(tourism.match,'candidate');assert.ok(business.fields.some(field=>field.sourceId===tourism.id&&field.match==='candidate'));
 assert.ok(business.collection.sourceStatuses.some(status=>status.sourceUrl.includes('publictourism')&&status.status==='identity_mismatch'));
 assert.ok(calls.filter(url=>!url.endsWith('/robots.txt')).length<=4);
});

test('automatic refresh retains the source ID while replacing changed facts at the same URL',async t=>{
 const reviewed={businessNumber:BNO,collectedAt:'2026-10-20T00:00:00Z',sources:[{id:'reviewed',url:ORIGIN,match:'exact_bno',businessNumber:BNO,collectedAt:'2026-10-20T00:00:00Z'}],fields:[{field:'name',value:'과거 이름',sourceId:'reviewed',match:'exact_bno'},{field:'phone',value:'02-999-8888',sourceId:'reviewed',match:'exact_bno',scope:'public_business'}],collection:{lastSuccessAt:'2026-10-20T00:00:00Z'}};
 const paths=await files(t,{previous:{businesses:[reviewed]}});
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):response(html)});
 const business=JSON.parse(await readFile(paths.outputPath,'utf8')).businesses[0];
 assert.ok(business.sources.some(source=>source.id==='reviewed'));
 assert.ok(!business.fields.some(field=>field.value==='과거 이름'||field.value==='02-999-8888'));
 assert.ok(business.fields.some(field=>field.value==='테스트기업'));
});


test('an explicit different business number revokes the old match without changing its observation date',async t=>{
 const paths=await baseline(t),previous=paths.previous.businesses[0];
 const different=html.replaceAll('220-81-62517','104-81-37225').replaceAll('테스트기업','다른 기업');
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):response(different)});
 const business=JSON.parse(await readFile(paths.outputPath,'utf8')).businesses[0];
 assert.ok(business.collection.sourceStatuses.every(status=>status.status==='identity_mismatch'&&status.errorCode==='entity_scope_mismatch'));
 assert.ok(business.sources.filter(source=>!source.discoveredFrom).every(source=>source.match==='candidate'));
 assert.ok(business.fields.every(field=>field.match==='candidate'));
 assert.equal(business.sources[0].collectedAt,previous.sources[0].collectedAt);
 assert.ok(!business.fields.some(field=>field.value==='다른 기업'));
});

test('hidden and script-embedded tables cannot establish target business facts',()=>{
 const table='<table><tr><th>사업자등록번호</th><td>220-81-62517</td></tr><tr><th>회사명</th><td>숨겨진 업체</td></tr></table>';
 const page=extractBusinessPage('<script>const template='+JSON.stringify(table)+'</script><div hidden>'+table+'</div><p>공개 본문</p>',ORIGIN,seed,now());
 assert.equal(page.source.match,'candidate');assert.equal(page.fields.length,0);
});


test('official structured business metadata includes opening hours, services and public contact points',()=>{
 const details={'@type':'LocalBusiness',taxID:'220-81-62517',name:'공개 업체',openingHoursSpecification:[{'@type':'OpeningHoursSpecification',dayOfWeek:['https://schema.org/Monday','https://schema.org/Tuesday'],opens:'09:00',closes:'18:00'}],contactPoint:[{'@type':'ContactPoint',telephone:'02-555-1234',email:'service@example.com'}],hasOfferCatalog:{itemListElement:[{itemOffered:{name:'공개 서비스'}}]}};
 const page=extractBusinessPage('<meta property="business:contact_data:street_address" content="공개 도로 12"><script type="application/ld+json">'+JSON.stringify(details)+'</script>',ORIGIN,{...seed,verifiedDomain:true},now());
 assert.ok(page.fields.some(field=>field.field==='hours'&&field.value.includes('09:00–18:00')));
 assert.ok(page.fields.some(field=>field.field==='products'&&field.value==='공개 서비스'));
 assert.ok(page.fields.some(field=>field.field==='phone'&&field.value==='02-555-1234'&&field.scope==='public_business'));
 assert.ok(page.fields.some(field=>field.field==='address'&&field.value==='공개 도로 12'));
});


test('legacy Korean bytes in robots comments cannot block valid ASCII rules or change disallow paths',()=>{
 const robots=Buffer.concat([Buffer.from('User-agent: *\n# '),Buffer.from([0xc7,0xd1,0xb1,0xdb]),Buffer.from('\nDisallow: /private\nAllow: /public # '),Buffer.from([0xc7,0xd1,0xb1,0xdb])]);
 const decoded=decodeRobotsBody(robots,'text/plain');
 assert.equal(robotsAllows(decoded,'/private/a'),false);assert.equal(robotsAllows(decoded,'/public'),true);
 assert.throws(()=>decodeRobotsBody(Buffer.from([0x44,0x69,0x73,0x61,0x6c,0x6c,0x6f,0x77,0x3a,0x20,0x2f,0xff]),'text/plain'),/unsupported_encoding/);
});

test('a target number on the page never attributes another business table or recommendation to the target',()=>{
 const target='<table><tr><th>사업자등록번호</th><td>220-81-62517</td></tr><tr><th>상호</th><td>대상기업</td></tr></table>';
 const other='<section><h2>추천업체</h2><table><tr><th>사업자등록번호</th><td>104-81-37225</td></tr><tr><th>상호</th><td>다른기업</td></tr><tr><th>주소</th><td>다른 기업의 주소</td></tr></table></section>';
 const page=extractBusinessPage('<h1>대상기업</h1>'+target+other,ORIGIN,{...seed,channel:'directory'},now());
 assert.equal(page.source.match,'exact_bno');
 assert.deepEqual(page.fields.map(field=>[field.field,field.value]),[['name','대상기업']]);
 const unnumbered=other.replace('<tr><th>사업자등록번호</th><td>104-81-37225</td></tr>','');
 const ambiguous=extractBusinessPage(target+unnumbered,ORIGIN,{...seed,channel:'directory'},now());
 assert.deepEqual(ambiguous.fields.map(field=>field.value),['대상기업']);
});

test('multi-business table rows join on their own business-number column',()=>{
 const table='<table><tr><th>상호</th><th>사업자등록번호</th><th>주소</th></tr><tr><td>다른기업</td><td>104-81-37225</td><td>다른 주소</td></tr><tr><td>대상기업</td><td>220-81-62517</td><td>대상 주소</td></tr></table>';
 const page=extractBusinessPage(table,ORIGIN,{...seed,channel:'directory'},now());
 assert.deepEqual(page.fields.map(field=>[field.field,field.value]),[['name','대상기업'],['address','대상 주소']]);
});

test('an official domain cannot merge multiple unnumbered JSON-LD organizations',()=>{
 const graph=organizations=>`<meta property="og:site_name" content="자동 귀속 금지"><script type="application/ld+json">${JSON.stringify({'@graph':organizations})}</script>`;
 const companies=[{'@type':'Organization',name:'본회사'},{'@type':'Organization',name:'별도 자회사',telephone:'02-999-9999'}];
 const ambiguous=extractBusinessPage(graph(companies),ORIGIN,{...seed,verifiedDomain:true},now());
 assert.equal(ambiguous.source.match,'confirmed_domain');
 assert.equal(ambiguous.fields.length,0);
 companies[0].taxID='220-81-62517';
 const exact=extractBusinessPage(graph(companies),ORIGIN,{...seed,verifiedDomain:true},now());
 assert.deepEqual(exact.fields.map(field=>[field.field,field.value]),[['name','본회사']]);
 const other=extractBusinessPage(graph([{'@type':'Organization',name:'다른기업',taxID:'104-81-37225'}]),ORIGIN,{...seed,verifiedDomain:true},now());
 assert.equal(other.source.match,'candidate');assert.equal(other.source.identityMismatch,true);
 assert.equal(other.fields.length,0);
});

test('declared Korean Windows-949 aliases and HTML metadata decode without guessing invalid UTF-8',()=>{
 const korean=Buffer.from([0xb0,0xa1]);
 for(const charset of ['euc-kr','windows-949','cp949','ms949','x-windows-949','ks_c_5601-1987']) {
  assert.equal(decodePublicBody(korean,{contentType:`text/html; charset=${charset}`}), '가');
 }
 const html=Buffer.concat([Buffer.from('<meta charset="cp949"><h1>'),korean,Buffer.from('</h1>')]);
 assert.match(decodePublicBody(html),/가/);
 // Runtimes with full UHC support may decode it; narrower ICU builds must reject corruption.
 try { assert.equal(decodePublicBody(Buffer.from([0x81,0x41]),{contentType:'text/html; charset=cp949'}),'갂'); }
 catch(error) { assert.match(error.message,/unsupported_encoding/); }
 assert.throws(()=>decodePublicBody(korean,{contentType:'text/html; charset=utf-8'}),/unsupported_encoding/);
 assert.throws(()=>decodePublicBody(korean,{contentType:'text/html; charset=unknown-codepage'}),/unsupported_encoding/);
});

test('native compressed response decoding is explicit and bounded before parsing business facts',()=>{
 const body=Buffer.from('<title>사업자 공개 정보</title>');
 for(const [contentEncoding,compress] of [['gzip',gzipSync],['deflate',deflateSync],['br',brotliCompressSync]]) {
  assert.equal(decodePublicBody(compress(body),{contentType:'text/html; charset=utf-8',contentEncoding}),body.toString());
 }
 assert.throws(()=>decodePublicBody(gzipSync(Buffer.alloc(1_000_001,65)),{contentEncoding:'gzip'}),/response_too_large/);
 assert.throws(()=>decodePublicBody(body,{contentEncoding:'gzip'}),/invalid_compressed_response/);
 assert.throws(()=>decodePublicBody(body,{contentEncoding:'__proto__'}),/unsupported_content_encoding/);
});

test('a partially extracted same-level source preserves all previous fields and timestamps',async t=>{
 const paths=await baseline(t);const previous=paths.previous.businesses[0];
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):response('<script type="application/ld+json">{"@type":"Organization","taxID":"220-81-62517","name":"이름만 읽힌 응답"}</script>')});
 const business=JSON.parse(await readFile(paths.outputPath,'utf8')).businesses[0];
 assert.deepEqual(business.fields,previous.fields);assert.deepEqual(business.sources,previous.sources);
 assert.equal(business.collection.lastSuccessAt,previous.collection.lastSuccessAt);
 assert.equal(business.collection.error,'partial_extraction');
});

test('a successful refreshed URL retains its existing source ID and known entity classification',async t=>{
 const paths=await baseline(t);const old=paths.previous.businesses[0];
 const oldId=old.sources[0].id;old.sources[0].id='reviewed-source';old.entityType='corporation';
 old.fields.forEach(field=>{if(field.sourceId===oldId)field.sourceId='reviewed-source';});
 old.collection.sourceStatuses=[{provider:'ftc',status:'not_configured'}];
 await writeFile(paths.outputPath,JSON.stringify(paths.previous));
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):response(html.replaceAll('테스트기업','갱신된기업'))});
 const business=JSON.parse(await readFile(paths.outputPath,'utf8')).businesses[0];
 assert.equal(business.entityType,'corporation');
 assert.equal(business.sources.filter(source=>source.url===ORIGIN+'/').length,1);
 assert.ok(business.sources.some(source=>source.id==='reviewed-source'));
 assert.ok(business.fields.some(field=>field.sourceId==='reviewed-source'&&field.value==='갱신된기업'));
 assert.ok(business.collection.sourceStatuses.some(status=>status.provider==='ftc'&&status.status==='not_configured'));
 assert.ok(business.collection.sourceStatuses.some(status=>status.provider==='web_page'&&status.status==='success'));
});

async function reviewedBaseline(t) {
 const date='2026-10-20T00:00:00.000Z',id='reviewed-official-home';
 const previous={businesses:[{businessNumber:BNO,name:seed.name,officialDomain:'company.testcorp.com',collectedAt:date,
  sources:[{id,url:ORIGIN+'/',title:'검토한 공식 홈페이지',channel:'official_website',match:'confirmed_domain',collectedAt:date}],
  fields:[['name','검토한 회사명'],['website',ORIGIN+'/'],['description','이전 설명'],['products','검토한 서비스']].map(([field,value])=>({field,value,sourceId:id,match:'confirmed_domain'})),
  collection:{lastSuccessAt:date}}]};
 const paths=await files(t,{previous});
 await writeFile(paths.configPath,JSON.stringify([{...seed,verifiedDomain:true}]));
 return {...paths,previous,date,id};
}

test('missing reviewed fields retain their original observation date while refreshed fields replace their old values',async t=>{
 const paths=await reviewedBaseline(t);
 const fetchImpl=async url=>url.pathname==='/robots.txt'?response(''):response('<meta name="description" content="새 설명">');
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl});
 const business=JSON.parse(await readFile(paths.outputPath,'utf8')).businesses[0];
 const history=business.sources.find(source=>source.id.startsWith('historical-reviewed-'));
 assert.ok(history);assert.equal(history.collectedAt,paths.date);
 assert.deepEqual(business.fields.filter(field=>field.sourceId===history.id).map(field=>[field.field,field.value]),[['name','검토한 회사명'],['products','검토한 서비스']]);
 const current=business.sources.find(source=>source.id===paths.id);
 assert.equal(current.collectedAt,now());
 assert.ok(business.fields.some(field=>field.sourceId===current.id&&field.field==='description'&&field.value==='새 설명'));
 assert.ok(!business.fields.some(field=>field.value==='이전 설명'));
 await runCollector({...paths,lookupImpl,now:()=> '2026-10-22T13:00:00.000Z',delayMs:0,fetchImpl});
 const again=JSON.parse(await readFile(paths.outputPath,'utf8')).businesses[0];
 assert.deepEqual(again.sources.filter(source=>source.id.startsWith('historical-reviewed-')),[history]);
 assert.equal(again.sources.length,business.sources.length);
 assert.equal(again.fields.length,business.fields.length);
});

test('a newly extracted field supersedes the historical reviewed value and removes unused history',async t=>{
 const paths=await reviewedBaseline(t);
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):response('<meta name="description" content="새 설명">')});
 const complete='<meta name="description" content="최신 설명"><script type="application/ld+json">'+JSON.stringify({'@type':'Organization',name:'새 회사명',taxID:'220-81-62517',makesOffer:[{itemOffered:{name:'새 서비스'}}]})+'</script>';
 await runCollector({...paths,lookupImpl,now:()=> '2026-10-22T13:00:00.000Z',delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):response(complete)});
 const business=JSON.parse(await readFile(paths.outputPath,'utf8')).businesses[0];
 assert.equal(business.sources.some(source=>source.id.startsWith('historical-reviewed-')),false);
 assert.ok(business.fields.some(field=>field.field==='name'&&field.value==='새 회사명'));
 assert.ok(business.fields.some(field=>field.field==='products'&&field.value==='새 서비스'));
 assert.equal(business.fields.some(field=>['검토한 회사명','검토한 서비스'].includes(field.value)),false);
});

test('explicit identity mismatch revokes reviewed and historical facts and survives the next fetch failure',async t=>{
 const paths=await reviewedBaseline(t);
 await runCollector({...paths,lookupImpl,now,delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):response('<meta name="description" content="새 설명">')});
 const snapshot=JSON.parse(await readFile(paths.outputPath,'utf8'));
 snapshot.businesses[0].sources.find(source=>source.id===paths.id).channel='official_website';
 await writeFile(paths.outputPath,JSON.stringify(snapshot));
 await runCollector({...paths,lookupImpl,now:()=> '2026-10-22T13:00:00.000Z',delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):response('<p>사업자등록번호 104-81-37225</p>')});
 const business=JSON.parse(await readFile(paths.outputPath,'utf8')).businesses[0];
 assert.equal(business.collection.error,'entity_scope_mismatch');
 assert.ok(business.sources.every(source=>source.match==='candidate'));
 assert.ok(business.fields.every(field=>field.match==='candidate'));
 assert.ok(business.sources.some(source=>source.identityMismatch===true&&source.matchedBusinessNumber===OTHER));
 assert.equal(business.sources.find(source=>source.id===paths.id).collectedAt,now());
 await runCollector({...paths,lookupImpl,now:()=> '2026-10-23T13:00:00.000Z',delayMs:0,fetchImpl:async url=>url.pathname==='/robots.txt'?response(''):response('Unavailable',503)});
 const failed=JSON.parse(await readFile(paths.outputPath,'utf8')).businesses[0];
 assert.deepEqual(failed.sources,business.sources);assert.deepEqual(failed.fields,business.fields);
});
