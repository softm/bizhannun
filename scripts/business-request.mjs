import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidBusinessNumber, normalizeBusinessNumber } from '../src/domain.mjs';
import { safeEnrichmentUrl } from '../src/enrichment.mjs';
const trusted = new Set(['OWNER','MEMBER','COLLABORATOR']);
const directoryHosts = new Set(['bizno.net','bizno.co.kr','nicebizinfo.com','nicebizmap.co.kr','114.co.kr']);
const field = (body,name) => body.match(new RegExp('(?:^|\\n)### '+name+'\\s*\\n([^\\n]*)'))?.[1]?.trim() || '';
export function parseBusinessRequest(event={},inputs={}) {
  let bno=inputs.businessNumber,name=inputs.name,website=inputs.website;
  if(event.issue) {
    if(!event.issue.title?.startsWith('[사업자 수집]')||!trusted.has(event.issue.author_association))return null;
    const body=event.issue.body||'';
    if(body.length>8000)throw new Error('Request is too long');
    bno=field(body,'사업자등록번호');name=field(body,'상호');website=field(body,'수집할 공개 웹사이트');if(website==='_미입력_')website='';
  }
  if(!bno)return null;
  const businessNumber=normalizeBusinessNumber(bno);
  if(!isValidBusinessNumber(businessNumber))throw new Error('사업자번호를 확인하세요.');
  const provided=typeof website==='string'&&website.trim();
  const url=safeEnrichmentUrl(provided||`https://bizno.net/article/${businessNumber}`);
  if(!url)throw new Error('공개 웹사이트 주소를 확인하세요.');
  if(typeof name!=='string'||name.length>200||/[\r\n\u0000-\u001f]/.test(name))throw new Error('상호를 확인하세요.');
  const host = new URL(url).hostname.replace(/^www\./,'');
  const directory = !provided || [...directoryHosts].some(base=>host===base||host.endsWith('.'+base));
  return {businessNumber,name:name==='_미입력_'?'':name,website:url,verifiedDomain:false,search:true,channel:directory?'directory':'website'};
}
export async function prepareBusinessRequest({eventPath=process.env.GITHUB_EVENT_PATH,configPath='config/business-sources.json',inputs={businessNumber:process.env.BIZ_REQUEST_NUMBER,name:process.env.BIZ_REQUEST_NAME||'',website:process.env.BIZ_REQUEST_WEBSITE}}={}) {
  const event=eventPath?JSON.parse(await readFile(eventPath,'utf8')):{};
  const request=parseBusinessRequest(event,inputs);if(!request)return {requested:false};
  const config=JSON.parse(await readFile(configPath,'utf8'));
  const index=config.businesses.findIndex(x=>x.businessNumber===request.businessNumber);
  if(index<0)config.businesses.push(request);
  else if(config.businesses[index].website!==request.website)config.businesses[index]=request;
  if(config.businesses.length>100)throw new Error('등록 수집 대상은 현재 100곳까지 지원합니다.');
  await writeFile(configPath,JSON.stringify(config,null,2)+'\n');return {requested:true,businessNumber:request.businessNumber};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await prepareBusinessRequest()));
