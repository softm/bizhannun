/**
 * FTC business registration catalog, incremental and database-free.
 * Each scheduled execution collects a bounded number of pages; successful
 * batches are atomically published as gzip JSON shards and a routing index.
 */
import { readFile, writeFile, readdir, mkdir, rename, rm, cp, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isValidBusinessNumber } from '../src/domain.mjs';
import { normalizeBusinessName } from '../src/business-search.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const FOLDER=join(ROOT,'data/business-numbers');
const STATUS=join(ROOT,'data/business-number-status.json');
const SOURCE='https://www.data.go.kr/data/15126311/openapi.do';
const ENDPOINT='https://apis.data.go.kr/1130000/MllBs_2Service/getMllBsInfo_2';
const PAGE_SIZE=1000;
const MAX_RECORDS=4_000_000;
const MAX_PAGES_RUN=Math.max(1,Math.min(30,Number(process.env.FTC_PAGES_PER_RUN)||12));
const text=v=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
const now=()=>new Date().toISOString();
const hash=buf=>createHash('sha256').update(buf).digest('hex');
const number=v=>String(v??'').replace(/[^0-9]/g,'');
const validEntry=r=>{
  const bn=number(r.brno??r['사업자등록번호']??r.businessNumber);
  const name=text(r.bzmnNm??r['상호']??r.companyName);
  if(!isValidBusinessNumber(bn)||!name)return null;
  return [bn,name,text(r.rnAddr??r.lctnAddr??r['사업장소재지(도로명)']??r.address),text(r.operSttusCdNm??r['업소상태']??r.status)];
};
const fileDescriptor=(path,buf)=>({path,bytes:buf.length,sha256:hash(buf)});
const encode=obj=>gzipSync(Buffer.from(JSON.stringify(obj)),{level:8,mtime:0});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function readJSON(path,fallback=null){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function atomicJSON(path,value){await writeFile(path+'.tmp',JSON.stringify(value,null,2)+'\n');await rename(path+'.tmp',path);}
function parseResponse(value){
  const obj=value?.response??value;
  const header=obj?.header??{};
  const code=String(header.resultCode??'00');
  if(!['00','0','SUCCESS','INFO-000'].includes(code))throw Error('기관 API 응답 오류 '+code);
  const body=obj?.body??obj;
  const received=body?.items?.item??body?.items;
  const rows=Array.isArray(received)?received:received&&typeof received==='object'?[received]:[];
  const total=Number(body?.totalCount??body?.total);
  if(!Number.isSafeInteger(total)||total<0||total>MAX_RECORDS)throw Error('기관 API 전체 건수 확인 실패');
  return {rows,total};
}
function failureText(e){
  const str=String(e?.message||e);
  return str.replace(/serviceKey=[^&\s]+/ig,'serviceKey=REDACTED').slice(0,200);
}
async function requestPage(key,page,fetchImpl=fetch){
  const url=new URL(ENDPOINT);
  url.search=new URLSearchParams({serviceKey:key,pageNo:String(page),numOfRows:String(PAGE_SIZE),resultType:'json'}).toString();
  let last;
  for(let attempt=0;attempt<4;attempt++){
    try{
      const response=await fetchImpl(url,{signal:AbortSignal.timeout(22000),headers:{accept:'application/json'}});
      if(!response.ok){
        const snippet=(await response.text()).slice(0,1500);
        const code=(snippet.match(/(SERVICE_KEY_IS_NOT_REGISTERED_ERROR|SERVICE_ACCESS_DENIED_ERROR|LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR|SERVICE_KEY_IS_NULL)/)||[])[1]||'';
        if([401,403].includes(response.status))throw Object.assign(new Error('등록현황 API HTTP '+response.status+' '+code),{retryable:false});
        throw Object.assign(new Error('등록현황 API HTTP '+response.status),{retryable:response.status>=500||response.status===429});
      }
      const buf=Buffer.from(await response.arrayBuffer());
      if(buf.length>8_000_000)throw Object.assign(new Error('원천 API 응답 크기 초과'),{retryable:false});
      return parseResponse(JSON.parse(buf.toString('utf8')));
    }catch(e){last=e;if(e.retryable===false)break;if(attempt<3)await sleep(500*(attempt+1));}
  }
  throw new Error(failureText(last));
}
async function buildBatch({root=FOLDER,fetchImpl=fetch,key,pageLimit=MAX_PAGES_RUN}){
  const previous=await readJSON(join(root,'manifest.json'));
  let previousRouting={},previousShards=[],page=1,existingCount=0;
  if(previous){
    const routingDescriptor=previous.routing;
    const zipped=await readFile(join(root,routingDescriptor.path));
    if(hash(zipped)!==routingDescriptor.sha256)throw Error('기존 검색 색인 검증 실패');
    previousRouting=JSON.parse(gunzipSync(zipped));
    previousShards=previous.shards;
    page=previous.nextPageNo || 1;
    existingCount=previous.recordCount || 0;
  }
  if(previous?.complete && Date.now()-Date.parse(previous.generatedAt)<6*86400000)
    return {unchanged:true,manifest:previous};
  const stage=root+'.staging';
  await rm(stage,{recursive:true,force:true});
  await mkdir(join(stage,'shards'),{recursive:true});
  const shards=previousShards.map(s=>({...s}));
  const routing={...previousRouting};
  let total=previous?.sourceTotal??null;
  let attempted=0,invalidRows=0,duplicates=0,lastError='';
  const seen=new Set();
  // Previous snapshots are immutable; deduplicate any overlap on rerun
  // without holding historical name/address records in memory.
  for(const shard of shards){
    const blob=await readFile(join(root,shard.path));
    if(hash(blob)!==shard.sha256)throw Error('이전 공개 검색 조각 손상');
    for(const entry of JSON.parse(gunzipSync(blob)))seen.add(entry.join('\0'));
  }
  for(let n=0;n<pageLimit;n++){
    let result;
    try{result=await requestPage(key,page,fetchImpl);}catch(e){lastError=failureText(e);break;}
    if(total===null)total=result.total;
    // Page offsets can shift when new registrations arrive. Explicitly record
    // snapshot scope; never claim the source is fully exhausted when it drifts.
    if(total!==result.total){lastError='수집 도중 원천 전체 건수가 변경됨';break;}
    if(!result.rows.length && (page-1)*PAGE_SIZE<total){lastError='비어 있는 원천 페이지';break;}
    const accepted=[];
    for(const item of result.rows){
      const entry=validEntry(item);
      if(!entry){invalidRows++;continue;}
      const identity=entry.join('\0');
      if(seen.has(identity)){duplicates++;continue;}
      seen.add(identity);accepted.push(entry);
    }
    if(accepted.length){
      const id=shards.length,rel='shards/'+String(id).padStart(5,'0')+'.json.gz';
      const packed=encode(accepted);
      await writeFile(join(stage,rel),packed);
      shards.push({...fileDescriptor(rel,packed),rows:accepted.length});
      const grams=new Set();
      for(const row of accepted){
        const name=normalizeBusinessName(row[1]);
        for(const c of name)grams.add(c);
        for(let i=0;i<name.length-1;i++)grams.add(name.slice(i,i+2));
      }
      for(const gram of grams){if(!routing[gram])routing[gram]=[];routing[gram].push(id);}
    }
    page++;
    attempted++;
    if((page-1)*PAGE_SIZE>=total)break;
  }
  if(!attempted){
    await rm(stage,{recursive:true,force:true});
    throw Error(lastError||'새로 수집된 원천 페이지 없음');
  }
  const complete=(page-1)*PAGE_SIZE>=total;
  const generatedAt=now();
  const routeZip=encode(routing);
  await writeFile(join(stage,'routing.json.gz'),routeZip);
  const manifest={schemaVersion:1,generatedAt,recordCount:existingCount+shards.slice(previousShards.length).reduce((n,s)=>n+s.rows,0),
    sourceTotal:total,complete,nextPageNo:complete?1:page,pagesFetched:page-1,
    invalidRows:(previous?.invalidRows||0)+invalidRows,duplicates:(previous?.duplicates||0)+duplicates,
    shards,routing:fileDescriptor('routing.json.gz',routeZip),
    source:{name:'공정거래위원회 통신판매사업자 등록현황',url:SOURCE},
    coverage:complete?'공정위 통신판매업 원천 전체 페이지를 읽은 스냅샷. 전국 모든 사업자 아님.':'공정위 통신판매업 원천 중 수집 완료 페이지까지의 일부 공개자료',
    lastError};
  await atomicJSON(join(stage,'manifest.json'),manifest);
  // Keep all old files, but only write new/updated files atomically.
  await mkdir(join(root,'shards'),{recursive:true});
  for(let i=previousShards.length;i<shards.length;i++)
    await rename(join(stage,shards[i].path),join(root,shards[i].path));
  await rename(join(stage,'routing.json.gz'),join(root,'routing.json.gz'));
  await rename(join(stage,'manifest.json'),join(root,'manifest.json'));
  await rm(stage,{recursive:true,force:true});
  return {manifest,attempted,lastError};
}
export async function collectRegistration({key=process.env.FTC_SERVICE_KEY||'',root=FOLDER,statusPath=STATUS,fetchImpl=fetch,pageLimit=MAX_PAGES_RUN}={}){
  const previous=await readJSON(statusPath,{});
  const status={provider:'ftc',lastAttemptAt:now(),lastSuccessAt:previous.lastSuccessAt||null,
    status:'checking',source:SOURCE,message:''};
  const supplied=key.includes('%')?decodeURIComponent(key):key;
  if(!supplied){status.status='not_configured';status.message='FTC_SERVICE_KEY 미설정';await atomicJSON(statusPath,status);return status;}
  try{
    const result=await buildBatch({root,key:supplied,fetchImpl,pageLimit});
    status.status=result.unchanged?'unchanged':result.manifest.complete?'success':'partial';
    status.lastSuccessAt=result.unchanged?previous.lastSuccessAt:result.manifest.generatedAt;
    status.recordCount=result.manifest.recordCount;status.sourceTotal=result.manifest.sourceTotal;
    status.nextPageNo=result.manifest.nextPageNo;status.complete=result.manifest.complete;
    status.message=result.lastError||'';
  }catch(e){status.status='failed';status.message=failureText(e);}
  await atomicJSON(statusPath,status);
  return status;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=await collectRegistration();
  console.log(JSON.stringify({...result,message:result.message},null,2));
}
