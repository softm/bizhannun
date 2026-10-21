import { readFile, writeFile } from 'node:fs/promises';
import { runCollector } from './collect-business-web.mjs';
import { collectPublicBusiness } from './collect-business-public.mjs';
import { queryCommerce, PROVIDER_SOURCES } from '../src/providers.mjs';
import { normalizeEnrichment } from '../src/enrichment.mjs';
const configPath='config/business-sources.json',outputPath='data/enrichment/index.json';
const old=JSON.parse(await readFile(outputPath,'utf8'));
await runCollector({configPath,outputPath});
const index=JSON.parse(await readFile(outputPath,'utf8'));
const config=JSON.parse(await readFile(configPath,'utf8'));
for(const seed of config.businesses){
  const record=index.businesses.find(x=>x.businessNumber===seed.businessNumber);
  if(!record)continue;
  const official=await collectPublicBusiness(seed.businessNumber);
  const refreshedIds=new Set(official.sources.map(s=>s.id));
  record.sources=record.sources.filter(s=>!refreshedIds.has(s.id));
  record.sources.push(...official.sources);
  record.fields.push(...official.fields);
  const sourceStatuses=[...official.collection.sourceStatuses];
  const ftc=await queryCommerce(seed.businessNumber,{FTC_SERVICE_KEY:process.env.FTC_SERVICE_KEY||''});
  sourceStatuses.push({provider:'ftc',label:'공정위 통신판매업',sourceUrl:PROVIDER_SOURCES.ftc.url,status:({ok:'success',error:'error'})[ftc.outcome]||ftc.outcome,checkedAt:ftc.checkedAt,message:ftc.message||'',errorCode:ftc.errorCode||'',returnedCount:ftc.records.length,matchedCount:ftc.records.length});
  for(const [i,item] of ftc.records.entries()){
    const id='ftc-'+seed.businessNumber+'-'+(item.recordId||i),source={id,url:PROVIDER_SOURCES.ftc.url,title:'공정위 통신판매사업자 등록자료',channel:'public_data',match:'exact_bno',businessNumber:seed.businessNumber,collectedAt:ftc.checkedAt,publishedAt:null};
    record.sources=record.sources.filter(s=>s.id!==id);record.fields=record.fields.filter(f=>f.sourceId!==id);record.sources.push(source);
    for(const [field,value]of Object.entries({name:item.name,address:item.address,registration:item.registrationNumber,products:item.products,corporateNumber:item.corporateNumber}))if(value)record.fields.push({field,value,sourceId:id,match:'exact_bno'});
  }
  const previous=old.businesses.find(x=>x.businessNumber===seed.businessNumber);
  record.collection={...record.collection,sourceStatuses};
  const normalized=normalizeEnrichment(record);
  if(!normalized)throw new Error('Invalid collected business record');
  // Empty or failed new sources cannot erase previous successful evidence.
  if(!normalized.sources.length&&previous?.sources?.length)Object.assign(record,previous,{collection:record.collection});
  else Object.assign(record,normalized);
}
index.meta={...index.meta,generatedAt:new Date().toISOString(),collectionVersion:1,method:process.env.GITHUB_ACTIONS?'github_actions_public_collection':'public_source_collection'};
await writeFile(outputPath,JSON.stringify(index,null,2)+'\n');
console.log(JSON.stringify({businesses:index.businesses.length,sources:index.businesses.reduce((n,r)=>n+r.sources.length,0),fields:index.businesses.reduce((n,r)=>n+r.fields.length,0)}));
