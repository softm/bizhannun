import { normalizeBusinessName } from './business-search.mjs';
import { isValidBusinessNumber, formatBusinessNumber } from './domain.mjs';
const esc = v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count = v=>new Intl.NumberFormat('ko-KR').format(v||0);
const MAX_SHARDS=60, MAX_BYTES=5_000_000, MAX_ROUTING_BYTES=32_000_000;
const pathOK=p=>typeof p==='string' && /^(?:shards\/\d{5}|routing)\.json\.gz$/.test(p);
const termOf=q=>normalizeBusinessName(String(q||'').replace(/[%*]/g,'').trim());
async function readBytes(url,fetchImpl,signal,max=MAX_BYTES){
  const r=await fetchImpl(url,{cache:'no-cache',credentials:'same-origin',signal,redirect:'error'});
  if(!r.ok)throw new Error('공개 사업자번호 자료를 불러오지 못했습니다. (HTTP '+r.status+')');
  if(Number(r.headers?.get('content-length')||0)>max)throw new Error('검색자료 크기 제한을 초과했습니다.');
  const bytes=new Uint8Array(await r.arrayBuffer());
  if(bytes.length>max)throw new Error('검색자료 크기 제한을 초과했습니다.');
  return bytes;
}
async function gzipJSON(base,d,fetchImpl,signal){
  if(!d||!pathOK(d.path)||!Number.isSafeInteger(d.bytes)||d.bytes<1||d.bytes>(d.path==='routing.json.gz'?MAX_ROUTING_BYTES:MAX_BYTES)||!/^[a-f0-9]{64}$/.test(d.sha256||''))throw new Error('검색자료 파일 정보가 올바르지 않습니다.');
  const bytes=await readBytes(new URL(d.path,base),fetchImpl,signal,d.path==='routing.json.gz'?MAX_ROUTING_BYTES:MAX_BYTES);
  if(bytes.length!==d.bytes)throw new Error('검색자료 파일 크기 불일치');
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
  const hash=[...digest].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(hash!==d.sha256)throw new Error('검색자료 무결성 검증 실패');
  if(typeof DecompressionStream!=='function')throw new Error('이 브라우저는 압축된 검색자료를 지원하지 않습니다.');
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader=stream.getReader(),chunks=[];let total=0;
  try {
    while(true){
      const {done,value}=await reader.read();if(done)break;
      total+=value.length;if(total>(d.path==='routing.json.gz'?96_000_000:20_000_000))throw new Error('압축 해제 크기 제한 초과');
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const decoded=new Uint8Array(total);let p=0;
  for(const part of chunks){decoded.set(part,p);p+=part.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decoded));
}
export function validateRegistrationManifest(m){
  if(m?.schemaVersion!==1||!Number.isSafeInteger(m.recordCount)||m.recordCount<1||m.recordCount>3_000_000||
     !Array.isArray(m.shards)||m.shards.length<1||m.shards.length>6000||
     !m.shards.every(s=>pathOK(s.path)&&Number.isSafeInteger(s.rows)&&s.rows>0)||
     !pathOK(m.routing?.path)||!m.source?.url?.startsWith('https://www.data.go.kr/'))
     throw new Error('사업자번호 공개자료 목록 형식이 올바르지 않습니다.');
  return m;
}
export function createRegistrationCatalog({baseUrl=new URL('../data/business-numbers/',import.meta.url).href,fetchImpl=globalThis.fetch?.bind(globalThis)}={}){
  const base=new URL(baseUrl);let manifest=null,routing=null;
  async function load({signal,force=false}={}){
    if(force){manifest=null;routing=null;}
    if(manifest&&routing)return manifest;
    let bytes;
    try{bytes=await readBytes(new URL('manifest.json',base),fetchImpl,signal,2_000_000);}
    catch(e){if(/HTTP 404/.test(e.message))return null;throw e;}
    const m=validateRegistrationManifest(JSON.parse(new TextDecoder().decode(bytes)));
    const route=await gzipJSON(base,m.routing,fetchImpl,signal);
    if(!route||typeof route!=='object'||Array.isArray(route))throw new Error('사업자번호 검색색인 형식 오류');
    manifest=m;routing=route;return m;
  }
  async function search(query,{signal,limit=30}={}){
    const m=await load({signal});
    if(!m)return {status:'not_collected',items:[],total:0,complete:false,manifest:null};
    const term=termOf(query);
    if(!term)return {status:'invalid',items:[],total:0,complete:true,manifest:m};
    const indexes=routing[term.length>1?term.slice(0,2):term];
    if(!indexes)return {status:'ready',items:[],total:0,complete:true,manifest:m,coverageComplete:Boolean(m.complete)};
    if(!Array.isArray(indexes)||indexes.some(i=>!Number.isSafeInteger(i)||i<0||i>=m.shards.length))
      throw new Error('사업자번호 검색 인덱스 오류');
    const found=new Map();let checked=0;
    for(const i of indexes.slice(0,MAX_SHARDS)){
      if(signal?.aborted)throw Object.assign(new Error('취소'),{name:'AbortError'});
      const rows=await gzipJSON(base,m.shards[i],fetchImpl,signal);
      if(!Array.isArray(rows)||rows.length!==m.shards[i].rows)throw new Error('검색자료 행 수 불일치');
      checked++;
      for(const row of rows){
        if(!Array.isArray(row)||!isValidBusinessNumber(row[0])||typeof row[1]!=='string'||!normalizeBusinessName(row[1]).includes(term))continue;
        const item={businessNumber:row[0],name:row[1],address:String(row[2]||''),state:String(row[3]||'')};
        found.set([item.businessNumber,item.name,item.address].join('|'),item);
      }
    }
    const all=[...found.values()].sort((a,b)=>Number(normalizeBusinessName(b.name)===term)-Number(normalizeBusinessName(a.name)===term)||a.name.localeCompare(b.name,'ko'));
    return {status:'ready',items:all.slice(0,limit),total:all.length,complete:checked===indexes.length,coverageComplete:Boolean(m.complete),manifest:m};
  }
  return {load,search};
}
export function renderRegistrationCatalog({query='',state={}}={}){
  if(!query)return '';
  const result=state.result,rows=result?.items||[];
  if(!state.loading&&!state.error&&result?.status==='not_collected')return '<section class="card business-search-results" aria-labelledby="registration-results-title"><h2 id="registration-results-title">사업자등록번호 공개자료</h2><p>공식 자료의 등록번호 검색 인덱스가 아직 게시되지 않았습니다. <a href="./data-status.html">데이터 수집 상태 확인</a></p></section>';
  const partial=result?.status==='ready'&&(!result.complete||result.coverageComplete===false);
  const label=state.loading?'공개 등록번호 검색 중':state.error||'검색된 공개 등록번호 '+count(result?.total)+'건'+(partial?' · 원천 일부 수집':'');
  return '<section class="card business-search-results" aria-labelledby="registration-results-title" aria-busy="'+Boolean(state.loading)+'">'+
    '<div class="card-header"><h2 id="registration-results-title" tabindex="-1">사업자등록번호가 공개된 업체</h2><span class="badge neutral">공정위</span></div>'+
    '<p class="name-results-summary">'+esc(label)+'</p>'+
    '<p class="fine-print">통신판매업 공식 공개자료의 번호입니다. 기존 상가 명부와 상호만으로 동일 사업자라고 단정하지 않습니다.</p>'+
    (partial?'<p class="callout warning">검색자료가 많아 일부만 확인했습니다. 더 긴 검색어로 좁혀 주세요.</p>':'')+
    (rows.length?'<ul class="business-candidates">'+rows.map(r=>'<li class="business-candidate"><div class="candidate-content"><h3>'+esc(r.name)+'</h3><p class="candidate-number">'+esc(formatBusinessNumber(r.businessNumber))+'</p><p class="candidate-address">'+esc(r.address||'주소 미제공')+'</p></div><button class="button primary small" data-action="select-registration-result" data-number="'+esc(r.businessNumber)+'">등록 상태 확인</button></li>').join('')+'</ul>':'')+
    '<p class="fine-print"><a href="https://www.data.go.kr/data/15126311/openapi.do" target="_blank" rel="noopener noreferrer">공정위 공식 원천</a> · 휴·폐업 상태는 국세청에서 별도 확인</p></section>';
}
