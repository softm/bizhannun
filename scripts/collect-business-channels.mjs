import { createHash } from 'node:crypto';
import { isValidBusinessNumber, normalizeBusinessNumber } from '../src/domain.mjs';
import { safeEnrichmentUrl } from '../src/enrichment.mjs';

// Official contracts: data.go.kr/data/15043184/openapi.do,
// opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019002,
// developers.naver.com/docs/serviceapi/search/, developers.kakao.com/docs/latest/ko/local/dev-guide.
export const CHANNEL_SOURCES = Object.freeze({
  fsc: 'https://www.data.go.kr/data/15043184/openapi.do',
  dart: 'https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019002',
  naver_news: 'https://developers.naver.com/docs/serviceapi/search/news/news.md',
  naver_blog: 'https://developers.naver.com/docs/serviceapi/search/blog/blog.md',
  naver_local: 'https://developers.naver.com/docs/serviceapi/search/local/local.md',
  kakao_local: 'https://developers.kakao.com/docs/latest/ko/local/dev-guide',
});
const MAX_BYTES = 1_000_000, MAX_RESULTS = 50, TIMEOUT_MS = 8000;
const clean = (value, limit = 1000) => (typeof value === 'string' || typeof value === 'number')
  ? String(value).replace(/<[^>]*>/g, ' ').replace(/&(?:amp|lt|gt|quot|apos);/g, value => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"}[value]))
    .replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const key = value => typeof value === 'string' && value.trim().length <= 2048 ? value.trim() : '';
const decodeKey = value => { try { return decodeURIComponent(key(value)); } catch { return ''; } };
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
const asArray = value => Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
const safeDate = value => {
  const raw = clean(value, 100);
  if (!raw) return null;
  const iso = /^\d{8}$/.test(raw) ? `${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}` : raw;
  const date = new Date(iso);
  if (!Number.isFinite(+date)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && date.toISOString().slice(0,10) !== iso) return null;
  return date.toISOString();
};
class CollectionError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, message) => { throw new CollectionError(code, message); };

/** Fixed provider URLs only. Never return request URLs, credentials or raw error bodies. */
async function requestJson(url, headers, fetchImpl) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => {
    controller.abort(); reject(new CollectionError('timeout', '외부 채널 응답 시간이 초과됐습니다.'));
  }, TIMEOUT_MS); });
  const operation = (async () => {
    const response = await fetchImpl(url, {method:'GET', headers:{Accept:'application/json', ...headers}, credentials:'omit', redirect:'error', signal:controller.signal});
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if ([401,403].includes(response.status)) fail('not_authorized', '해당 채널의 인증키·API 활용승인을 확인해야 합니다.');
      if (response.status === 429) fail('rate_limited', '해당 채널의 요청 한도에 도달했습니다.');
      fail('http_error', '외부 채널에서 정상 응답을 받지 못했습니다.');
    }
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      void response.body?.cancel().catch(() => {}); fail('response_too_large', '외부 응답이 허용 크기를 초과했습니다.');
    }
    const reader = response.body?.getReader();
    if (!reader) fail('invalid_response', '외부 응답 형식을 확인하지 못했습니다.');
    let bytes = 0, text = ''; const decoder = new TextDecoder('utf-8', {fatal:true});
    try {
      for (;;) {
        const {value, done} = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) { void reader.cancel().catch(() => {}); fail('response_too_large', '외부 응답이 허용 크기를 초과했습니다.'); }
        text += decoder.decode(value, {stream:true});
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    try { const result = JSON.parse(text); if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error(); return result; }
    catch { fail('invalid_response', '외부 응답 형식을 확인하지 못했습니다.'); }
  })();
  try { return await Promise.race([operation, deadline]); }
  catch (error) { if (error instanceof CollectionError) throw error; fail('network_error', '외부 채널 연결 또는 응답을 확인하지 못했습니다.'); }
  finally { clearTimeout(timer); }
}

/** Optional enrichment. Search results always remain candidates; only returned BNOs confirm identity. */
export async function collectBusinessChannels(seed, {env=process.env, fetchImpl=globalThis.fetch, now=()=>new Date().toISOString()}={}) {
  const businessNumber = normalizeBusinessNumber(seed?.businessNumber);
  if (!isValidBusinessNumber(businessNumber)) throw new Error('올바른 사업자등록번호가 필요합니다.');
  const observed = typeof now === 'function' ? now() : now, collectedAt = safeDate(observed instanceof Date ? observed.toISOString() : observed);
  if (!collectedAt) throw new Error('수집 시각이 올바르지 않습니다.');
  const sources = [], fields = [], sourceStatuses = [];
  const name = clean(seed.name, 200), corporateNumber = clean(seed.corporateNumber, 30).replace(/[\s-]/g, '');
  let corpCode = clean(seed.corpCode || seed.dartCorpCode, 20), entityType;
  const allSecrets = [env.FSC_SERVICE_KEY,env.BUSINESS_PUBLIC_SERVICE_KEY,env.DART_API_KEY,env.NAVER_SEARCH_CLIENT_SECRET,env.NAVER_SEARCH_CLIENT_ID,env.KAKAO_REST_API_KEY].flatMap(value=>[key(value),decodeKey(value)]).filter(value=>value.length>5);
  const redact = value => allSecrets.reduce((result, secret)=>result.split(secret).join('[비공개]'), clean(value,2000));
  const addSource = (provider, url, title, channel, match='candidate', publishedAt=null) => {
    const safe = safeEnrichmentUrl(url); if (!safe || allSecrets.some(secret=>safe.includes(secret))) return null;
    const source = {id:`${provider}:${hash(safe + businessNumber)}`, url:safe, title:redact(title), channel, match, collectedAt,
      publishedAt:safeDate(publishedAt), scope:'public_business', ...(match==='exact_bno'?{businessNumber}:{})};
    if (sources.some(item=>item.id===source.id)) return null;
    sources.push(source); return source;
  };
  const addFields = (source, values) => {
    if (!source) return;
    for (const [field, raw] of Object.entries(values)) {
      const value = redact(raw); if (!value) continue;
      if (field==='website' && !safeEnrichmentUrl(value)) continue;
      fields.push({field,value,sourceId:source.id,match:source.match,scope:'public_business'});
    }
  };
  const run = async (provider,label,configured,reason,operation) => {
    const status={provider,label,sourceUrl:CHANNEL_SOURCES[provider],status:configured?'success':'not_configured',checkedAt:collectedAt,pages:0,returnedCount:0,matchedCount:0,totalCount:null,truncated:false};
    if (!configured) status.message=reason;
    else try { await operation(status); }
    catch (error) {status.status='error';status.errorCode=error instanceof CollectionError?error.code:'collection_error';status.message=error instanceof CollectionError?error.message:'외부 정보 수집을 완료하지 못했습니다.';}
    sourceStatuses.push(status);
  };
  const fscKey=decodeKey(env.FSC_SERVICE_KEY||env.BUSINESS_PUBLIC_SERVICE_KEY);
  await run('fsc','금융위 기업개황',Boolean(fscKey && (name || /^\d{13}$/.test(corporateNumber))),
    fscKey?'기업명 또는 법인등록번호가 있어야 조회할 수 있습니다.':'금융위 기업기본정보 API 인증키와 별도 활용신청이 필요합니다.',async status=>{
      const url=new URL('https://apis.data.go.kr/1160100/service/GetCorpBasicInfoService_V2/getCorpOutline_V2');
      Object.entries({serviceKey:fscKey,resultType:'json',numOfRows:String(MAX_RESULTS),pageNo:'1',...(/^\d{13}$/.test(corporateNumber)?{crno:corporateNumber}:{corpNm:name})}).forEach(([k,v])=>url.searchParams.set(k,v));
      const data=await requestJson(url,{},fetchImpl), response=data.response||data;
      if (!response.header || !['00','0000'].includes(String(response.header.resultCode))) fail('provider_error','금융위 API 활용승인 또는 응답 상태를 확인해야 합니다.');
      const body=response.body;
      if (!body || (!body.items && Number(body.totalCount)!==0)) fail('invalid_response','금융위 API 응답 형식을 확인하지 못했습니다.');
      const items=asArray(body.items?.item).slice(0,MAX_RESULTS);
      status.pages=1;status.returnedCount=items.length;status.totalCount=Number.isSafeInteger(Number(body.totalCount))?Number(body.totalCount):null;
      status.truncated=status.totalCount>items.length;
      const matched=items.filter(item=>normalizeBusinessNumber(item.bzno)===businessNumber).sort((a,b)=>clean(b.basDt).localeCompare(clean(a.basDt)));
      status.matchedCount=matched.length;
      if (!matched.length) {status.status=items.length?'identity_mismatch':'not_found';status.message=items.length?'응답 사업자번호가 일치하지 않아 채택하지 않았습니다.':'공개 기업개황 조회 결과가 없습니다. 전체 사업자 미등록을 뜻하지 않습니다.';return;}
      const item=matched[0];entityType='corporation';
      if (!/^\d{8}$/.test(corpCode) && /^\d{8}$/.test(clean(item.fssCorpUnqNo))) corpCode=clean(item.fssCorpUnqNo);
      const source=addSource('fsc',CHANNEL_SOURCES.fsc,'금융위 기업개황 · '+clean(item.corpNm),'public_data','exact_bno',safeDate(item.basDt));
      addFields(source,{name:item.corpNm,representative:item.enpRprFnm,address:[item.enpBsadr,item.enpDtadr].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' '),website:item.enpHmpgUrl,phone:item.enpTlno,
        industry:item.sicNm,products:item.enpMainBizNm,corporateNumber:item.crno,foundedAt:safeDate(item.enpEstbDt)?.slice(0,10),
        employees:/^\d{1,9}$/.test(clean(item.enpEmpeCnt))?`${Number(item.enpEmpeCnt)}명${safeDate(item.basDt)?` (${safeDate(item.basDt).slice(0,10)} 기준)`:''}`:''});
      if(status.truncated)status.status='partial';
    });
  const dartKey=key(env.DART_API_KEY);
  await run('dart','DART 기업개황',Boolean(dartKey && /^\d{8}$/.test(corpCode)),
    dartKey?'DART 고유번호 8자리가 필요합니다. 기업개황에서 확인되거나 수집 설정에 등록해야 합니다.':'DART API 인증키가 필요합니다.',async status=>{
      const url=new URL('https://opendart.fss.or.kr/api/company.json');url.searchParams.set('crtfc_key',dartKey);url.searchParams.set('corp_code',corpCode);
      const item=await requestJson(url,{},fetchImpl);status.pages=1;
      if(item.status==='013'){status.status='not_found';status.message='공시대상 기업개황 조회 결과가 없습니다.';return;}
      if(item.status!=='000')fail('provider_error','DART 인증키·요청 한도 또는 응답 상태를 확인해야 합니다.');
      status.returnedCount=1;status.totalCount=1;
      if(normalizeBusinessNumber(item.bizr_no)!==businessNumber){status.status='identity_mismatch';status.message='DART 응답의 사업자번호가 일치하지 않아 채택하지 않았습니다.';return;}
      status.matchedCount=1;entityType='corporation';
      const source=addSource('dart',CHANNEL_SOURCES.dart,'DART 기업개황 · '+clean(item.corp_name),'public_data','exact_bno');
      addFields(source,{name:item.corp_name,representative:item.ceo_nm,address:item.adres,website:item.hm_url,phone:item.phn_no,corporateNumber:item.jurir_no,industry:clean(item.induty_code)?'산업분류코드 '+clean(item.induty_code,50):'',foundedAt:safeDate(item.est_dt)?.slice(0,10)});
    });
  const naverId=key(env.NAVER_SEARCH_CLIENT_ID),naverSecret=key(env.NAVER_SEARCH_CLIENT_SECRET);
  for(const [type,label,channel] of [['news','네이버 뉴스','news'],['blog','네이버 블로그','social'],['local','네이버 지역','directory']]){
    await run('naver_'+type,label,Boolean(naverId&&naverSecret&&name),name?'네이버 검색 API Client ID·Secret이 필요합니다.':'상호가 있어야 검색 후보를 수집할 수 있습니다.',async status=>{
      const url=new URL(`https://openapi.naver.com/v1/search/${type}.json`);url.searchParams.set('query',name);url.searchParams.set('display',type==='local'?'5':'10');url.searchParams.set('start','1');
      const data=await requestJson(url,{'X-Naver-Client-Id':naverId,'X-Naver-Client-Secret':naverSecret},fetchImpl);
      if(!Array.isArray(data.items))fail('invalid_response','네이버 검색 응답 형식을 확인하지 못했습니다.');
      const items=data.items.slice(0,type==='local'?5:10);status.pages=1;status.returnedCount=items.length;status.totalCount=Number.isSafeInteger(Number(data.total))?Number(data.total):null;status.truncated=status.totalCount>items.length;
      status.status=items.length?(status.truncated?'partial':'success'):'not_found';status.message='검색 결과는 동일 사업자 확인 전 후보입니다.';
      for(const item of items){const source=addSource('naver_'+type,item.originallink||item.link,item.title,channel,'candidate',item.pubDate||item.postdate);
        addFields(source,type==='local'?{name:item.title,address:item.roadAddress||item.address,industry:item.category,description:item.description}:{description:item.description});}
    });
  }
  const kakaoKey=key(env.KAKAO_REST_API_KEY);
  await run('kakao_local','카카오 장소',Boolean(kakaoKey&&name),name?'카카오 REST API 키가 필요합니다.':'상호가 있어야 장소 후보를 수집할 수 있습니다.',async status=>{
    const url=new URL('https://dapi.kakao.com/v2/local/search/keyword.json');url.searchParams.set('query',name);url.searchParams.set('size','10');url.searchParams.set('page','1');
    const data=await requestJson(url,{Authorization:`KakaoAK ${kakaoKey}`},fetchImpl);
    if(!Array.isArray(data.documents))fail('invalid_response','카카오 장소 응답 형식을 확인하지 못했습니다.');
    const items=data.documents.slice(0,10);status.pages=1;status.returnedCount=items.length;status.totalCount=Number.isSafeInteger(Number(data.meta?.total_count))?Number(data.meta.total_count):null;status.truncated=data.meta?.is_end===false;
    status.status=items.length?(status.truncated?'partial':'success'):'not_found';status.message='장소 검색 결과는 동일 사업자 확인 전 후보입니다.';
    for(const item of items){const source=addSource('kakao_local',item.place_url,item.place_name,'directory');
      addFields(source,{name:item.place_name,address:item.road_address_name||item.address_name,phone:item.phone,industry:item.category_name});}
  });
  const attempted=sourceStatuses.filter(item=>item.status!=='not_configured'),failed=attempted.some(item=>['error','identity_mismatch','partial'].includes(item.status));
  return {businessNumber,sources,fields,...(entityType?{entityType}:{}),collection:{status:!attempted.length?'not_configured':failed?'partial':'success',lastAttemptAt:collectedAt,
    lastSuccessAt:sources.some(source=>source.match==='exact_bno')?collectedAt:null,sourceStatuses}};
}
