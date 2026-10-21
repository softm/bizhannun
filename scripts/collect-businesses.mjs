import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCollector } from './collect-business-web.mjs';
import { collectPublicBusiness } from './collect-business-public.mjs';
import { collectBusinessChannels } from './collect-business-channels.mjs';
import { queryCommerce, PROVIDER_SOURCES } from '../src/providers.mjs';
import { normalizeEnrichment } from '../src/enrichment.mjs';

/** Replace a source and its own observations together; never redate stale fields. */
export function mergeCollectedEvidence(record, incoming, { replacePrefixes = [] } = {}) {
  const sources=Array.isArray(incoming.sources)?incoming.sources:[];
  const sourceIds=new Set(sources.map(source=>source.id));
  const replacedIds=new Set((record.sources||[]).filter(source=>sourceIds.has(source.id)||replacePrefixes.some(prefix=>source.id.startsWith(prefix))).map(source=>source.id));
  const statuses=new Map((record.collection?.sourceStatuses||[]).map(status=>[statusKey(status),status]));
  for(const status of incoming.collection?.sourceStatuses||[])statuses.set(statusKey(status),status);
  return {...record,
    sources:[...(record.sources||[]).filter(source=>!replacedIds.has(source.id)),...sources],
    fields:[...(record.fields||[]).filter(field=>!replacedIds.has(field.sourceId)),...(incoming.fields||[]).filter(field=>sourceIds.has(field.sourceId))],
    ...(incoming.entityType==='corporation'?{entityType:'corporation'}:{}),
    collection:{...(record.collection||{}),sourceStatuses:[...statuses.values()]},
  };
}
function statusKey(status) { return [status.provider,status.insuranceType||'',status.sourceUrl||''].join('\u0000'); }
function commerceEvidence(businessNumber,ftc) {
  const sources=[],fields=[];
  for(const [index,item] of ftc.records.entries()) {
    const id='ftc-'+businessNumber+'-'+(item.recordId||index);
    sources.push({id,url:PROVIDER_SOURCES.ftc.url,title:'공정위 통신판매사업자 등록자료',channel:'public_data',match:'exact_bno',businessNumber,collectedAt:ftc.checkedAt,publishedAt:null});
    for(const [field,value] of Object.entries({name:item.name,address:item.address,registration:item.registrationNumber,products:item.products,corporateNumber:item.corporateNumber}))if(value)fields.push({field,value,sourceId:id,match:'exact_bno'});
  }
  return {sources,fields,collection:{sourceStatuses:[{provider:'ftc',label:'공정위 통신판매업',sourceUrl:PROVIDER_SOURCES.ftc.url,status:({ok:'success',error:'error'})[ftc.outcome]||ftc.outcome,checkedAt:ftc.checkedAt,message:ftc.message||'',errorCode:ftc.errorCode||'',returnedCount:ftc.records.length,matchedCount:ftc.records.length}]}};
}

/** One scheduled collection run. All provider results preserve their source state. */
export async function runBusinessCollectors({configPath='config/business-sources.json',outputPath='data/enrichment/index.json',
  webCollector=runCollector,publicCollector=collectPublicBusiness,commerceCollector=queryCommerce,channelCollector=collectBusinessChannels,now=()=>new Date().toISOString()}={}) {
  let old={businesses:[]};
  try{old=JSON.parse(await readFile(outputPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  await webCollector({configPath,outputPath});
  const index=JSON.parse(await readFile(outputPath,'utf8'));
  const config=JSON.parse(await readFile(configPath,'utf8'));
  for(const seed of config.businesses) {
    const position=index.businesses.findIndex(record=>record.businessNumber===seed.businessNumber);
    if(position<0)continue;
    let record=index.businesses[position];
    const official=await publicCollector(seed.businessNumber);
    // Complete insurance responses replace that provider's previous record set;
    // failures/partial responses keep the last successful observations visible.
    const replacePrefixes=(official.collection?.sourceStatuses||[]).filter(status=>status.provider==='comwel'&&status.status==='success'&&!status.truncated).map(status=>'comwel:'+status.insuranceType+':');
    record=mergeCollectedEvidence(record,official,{replacePrefixes});
    const ftc=await commerceCollector(seed.businessNumber,{FTC_SERVICE_KEY:process.env.FTC_SERVICE_KEY||''});
    record=mergeCollectedEvidence(record,commerceEvidence(seed.businessNumber,ftc),{replacePrefixes:ftc.outcome==='ok'?['ftc-'+seed.businessNumber+'-']:[]});
    if(channelCollector)record=mergeCollectedEvidence(record,await channelCollector(seed));
    const normalized=normalizeEnrichment(record);
    if(!normalized)throw new Error('Invalid collected business record');
    const previous=old.businesses.find(item=>item.businessNumber===seed.businessNumber);
    // A provider outage cannot silently erase the previous successful evidence.
    if(!normalized.sources.length&&previous?.sources?.length)index.businesses[position]={...previous,collection:normalized.collection};
    else index.businesses[position]={...record,...normalized};
    const current=index.businesses[position],statuses=current.collection?.sourceStatuses||[];
    const hasPartial=statuses.some(status=>['error','partial','identity_mismatch'].includes(status.status));
    const successfulTimes=current.sources.filter(source=>source.match!=='candidate'&&current.fields.some(field=>field.sourceId===source.id&&field.match!=='candidate')).map(source=>source.collectedAt).filter(Boolean).sort();
    const lastSuccessAt=successfulTimes.at(-1)||current.collection?.lastSuccessAt||null;
    current.collection={...current.collection,lastSuccessAt,status:hasPartial?(lastSuccessAt?'partial':'failed'):lastSuccessAt?'success':current.collection?.status||'not_collected'};
    if(lastSuccessAt)current.collectedAt=lastSuccessAt;
  }
  const sources=index.businesses.flatMap(record=>record.sources||[]),times=index.businesses.map(record=>record.collection?.lastSuccessAt).filter(Boolean).sort();
  index.meta={...index.meta,generatedAt:now(),lastSuccessAt:times.at(-1)||null,collectionVersion:2,
    status:index.businesses.some(record=>record.collection?.status!=='success')?'partial':'success',
    sourceCount:sources.length,confirmedSourceCount:sources.filter(source=>source.match!=='candidate').length,candidateSourceCount:sources.filter(source=>source.match==='candidate').length,
    fieldCount:index.businesses.reduce((count,record)=>count+(record.fields||[]).filter(field=>field.match!=='candidate').length,0),
    method:process.env.GITHUB_ACTIONS?'github_actions_public_collection':'public_source_collection'};
  await writeFile(outputPath,JSON.stringify(index,null,2)+'\n');
  return {businesses:index.businesses.length,sources:sources.length,fields:index.businesses.reduce((count,record)=>count+record.fields.length,0)};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await runBusinessCollectors()));
}
