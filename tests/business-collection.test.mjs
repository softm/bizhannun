import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCollectedEvidence, runBusinessCollectors } from '../scripts/collect-businesses.mjs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const businessNumber='2208162517';
const oldSource={id:'company-profile',url:'https://company.example.com/about',title:'공개 회사정보',channel:'public_data',businessNumber,match:'exact_bno',collectedAt:'2026-10-20T01:00:00Z'};
const old={businessNumber,sources:[oldSource],fields:[{field:'name',value:'이전 상호',sourceId:oldSource.id,match:'exact_bno'},{field:'address',value:'이전 주소',sourceId:oldSource.id,match:'exact_bno'}],collection:{status:'success',lastSuccessAt:oldSource.collectedAt,sourceStatuses:[{provider:'web_page',sourceUrl:oldSource.url,status:'success'}]}};

test('refresh replaces all observations from the refreshed source while unrelated sources survive',()=>{
 const other={id:'other',url:'https://other.example.com',match:'candidate'};
 const record={...old,sources:[...old.sources,other],fields:[...old.fields,{field:'description',value:'관련 보도',sourceId:'other',match:'candidate'}]};
 const fresh={sources:[{...oldSource,collectedAt:'2026-10-21T01:00:00Z'}],fields:[{field:'name',value:'새 상호',sourceId:oldSource.id,match:'exact_bno'}],collection:{sourceStatuses:[{provider:'public',sourceUrl:oldSource.url,status:'success'}]}};
 const merged=mergeCollectedEvidence(record,fresh);
 assert.deepEqual(merged.fields.filter(field=>field.sourceId===oldSource.id).map(field=>field.value),['새 상호']);
 assert.ok(merged.sources.includes(other));assert.ok(merged.fields.some(field=>field.value==='관련 보도'));
 assert.equal(merged.collection.sourceStatuses.length,2);
 assert.equal(old.fields.length,2);
});

test('failed source collection leaves successful values with their actual original timestamp',()=>{
 const merged=mergeCollectedEvidence(old,{sources:[],fields:[],collection:{sourceStatuses:[{provider:'web_page',sourceUrl:oldSource.url,status:'error',checkedAt:'2026-10-21T00:00:00Z'}]}});
 assert.deepEqual(merged.sources,old.sources);assert.deepEqual(merged.fields,old.fields);
 assert.equal(merged.sources[0].collectedAt,oldSource.collectedAt);
 assert.equal(merged.collection.sourceStatuses.length,1);assert.equal(merged.collection.sourceStatuses[0].status,'error');
});

test('complete provider refresh removes superseded record IDs without retaining obsolete conflicts',()=>{
 const stale={...oldSource,id:'comwel:1:old'};
 const record={...old,sources:[...old.sources,stale],fields:[...old.fields,{field:'insuranceEmployeeCount',value:'과거 10명',sourceId:stale.id,match:'exact_bno'}]};
 const fresh={sources:[{...oldSource,id:'comwel:1:new'}],fields:[{field:'insuranceEmployeeCount',value:'현재 15명',sourceId:'comwel:1:new',match:'exact_bno'}]};
 const merged=mergeCollectedEvidence(record,fresh,{replacePrefixes:['comwel:1:']});
 assert.ok(!merged.sources.some(source=>source.id===stale.id));assert.ok(!merged.fields.some(field=>field.value==='과거 10명'));
 assert.ok(merged.fields.some(field=>field.value==='현재 15명'));assert.ok(merged.sources.some(source=>source.id===oldSource.id));
});

test('the scheduled pipeline retains web and optional-channel statuses alongside public API outcomes',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'business-collection-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const configPath=join(directory,'config.json'),outputPath=join(directory,'index.json');
 await writeFile(configPath,JSON.stringify({businesses:[{businessNumber,name:'테스트'}]}));
 await writeFile(outputPath,JSON.stringify({businesses:[old],meta:{}}));
 await runBusinessCollectors({configPath,outputPath,webCollector:async()=>{},publicCollector:async()=>({sources:[],fields:[],collection:{sourceStatuses:[{provider:'comwel',insuranceType:'1',sourceUrl:'https://www.data.go.kr/data/15059256/openapi.do',status:'not_configured'}]}}),commerceCollector:async()=>({outcome:'not_configured',records:[],checkedAt:'2026-10-21T00:00:00Z'}),channelCollector:async()=>({sources:[],fields:[],collection:{sourceStatuses:[{provider:'dart',sourceUrl:'https://opendart.fss.or.kr/',status:'not_configured'}]}}),now:()=> '2026-10-21T00:00:00Z'});
 const record=JSON.parse(await readFile(outputPath,'utf8')).businesses[0];
 assert.deepEqual(record.collection.sourceStatuses.map(status=>status.provider),['web_page','comwel','ftc','dart']);
 assert.equal(record.fields.length,2);assert.equal(record.sources[0].collectedAt,'2026-10-20T01:00:00.000Z');
});
