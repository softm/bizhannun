/**
 * Validate the published FTC JSON catalog before a GitHub data-only push.
 * This uses only gzip JSON files and does not operate a database.
 */
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { isValidBusinessNumber } from '../src/domain.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const CATALOG=join(ROOT,'data/business-numbers');
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const digest=buffer=>createHash('sha256').update(buffer).digest('hex');
function validDescriptor(d,kind){
  const pattern=kind==='route'?/^routing\.json\.gz$/:/^shards\/[0-9]{5}\.json\.gz$/;
  assert(d&&typeof d.path==='string'&&pattern.test(d.path),'Unexpected public JSON file path');
  assert(Number.isSafeInteger(d.bytes)&&d.bytes>0&&d.bytes<32*1024*1024,'Invalid compressed bytes');
  assert(typeof d.sha256==='string'&&/^[a-f0-9]{64}$/.test(d.sha256),'Missing file hash');
}
async function readVerified(d){
  const data=await readFile(join(CATALOG,d.path));
  assert(data.byteLength===d.bytes&&digest(data)===d.sha256,'Corrupt public JSON shard: '+d.path);
  return JSON.parse(gunzipSync(data));
}
export async function validatePublicRegistrationCatalog(){
  const manifest=JSON.parse(await readFile(join(CATALOG,'manifest.json'),'utf8'));
  assert(manifest.schemaVersion===1,'Unsupported schema');
  assert(Number.isSafeInteger(manifest.recordCount)&&manifest.recordCount>0&&manifest.recordCount<=4_000_000,'Invalid record count');
  assert(Array.isArray(manifest.shards)&&manifest.shards.length>0&&manifest.shards.length<=6000,'Invalid shard count');
  assert(Number.isSafeInteger(manifest.nextPageNo)&&manifest.nextPageNo>0,'Invalid collection cursor');
  assert(typeof manifest.complete==='boolean','Missing source completion state');
  assert(manifest.source?.url==='https://www.data.go.kr/data/15126311/openapi.do','Unexpected provider');
  const verifiedPaths=new Set(),seen=new Set();
  let total=0;
  for(const shard of manifest.shards){
    validDescriptor(shard,'shard');
    assert(!verifiedPaths.has(shard.path),'Duplicated file descriptor');
    verifiedPaths.add(shard.path);
    assert(Number.isSafeInteger(shard.rows)&&shard.rows>0&&shard.rows<=1000,'Invalid row count');
    const entries=await readVerified(shard);
    assert(Array.isArray(entries)&&entries.length===shard.rows,'Shard row count mismatch');
    for(const entry of entries){
      assert(Array.isArray(entry)&&entry.length===4,'Invalid public record');
      assert(typeof entry[0]==='string'&&isValidBusinessNumber(entry[0]),'Invalid public registration number');
      assert(typeof entry[1]==='string'&&entry[1].trim().length>0,'Missing business name');
      const key=entry.join('\0');
      assert(!seen.has(key),'Duplicate public registration entry');
      seen.add(key);
    }
    total+=entries.length;
  }
  assert(total===manifest.recordCount,'Manifest and JSON shards record counts differ');
  validDescriptor(manifest.routing,'route');
  const routing=await readVerified(manifest.routing);
  assert(routing!==null&&typeof routing==='object'&&!Array.isArray(routing),'Missing routing index');
  for(const indexes of Object.values(routing)){
    assert(Array.isArray(indexes)&&indexes.length>0&&indexes.every(i=>Number.isSafeInteger(i)&&i>=0&&i<manifest.shards.length),
      'Invalid JSON search postings');
    assert(new Set(indexes).size===indexes.length,'Duplicate posting entries');
  }
  return {count:total,shards:manifest.shards.length,complete:manifest.complete,nextPageNo:manifest.nextPageNo};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  console.log(JSON.stringify(await validatePublicRegistrationCatalog()));
}
