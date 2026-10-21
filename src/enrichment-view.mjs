import { ENRICHMENT_FIELDS, safeEnrichmentUrl } from './enrichment.mjs';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when = value => { const date=value?new Date(value):null; return date&&Number.isFinite(+date)?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short',hour12:false}).format(date):'기준일 미제공'; };
const channelNames = { official_website:'공식 웹사이트',website:'웹사이트',public_data:'공공데이터',registry:'공개 등록자료',directory:'민간 기업정보',news:'뉴스·보도',jobs:'채용',social:'SNS',commerce:'커머스',user_document:'제공 자료' };
const link = (url,label,cls='') => {const safe=safeEnrichmentUrl(url);return safe?`<a class="${cls}" href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`:esc(label);};
export function discoveryLinks(bno, name='') {
  const number=String(bno).replace(/\D/g,'');
  const phrase = name ? `${name} ${number}` : number;
  return [
    {name:'웹 전체',url:'https://search.naver.com/search.naver?query='+encodeURIComponent(phrase)},
    {name:'뉴스',url:'https://search.naver.com/search.naver?where=news&query='+encodeURIComponent(name||number)},
    {name:'블로그',url:'https://search.naver.com/search.naver?where=blog&query='+encodeURIComponent(name||number)},
    {name:'지도·장소',url:'https://map.naver.com/p/search/'+encodeURIComponent(name||number)},
    {name:'채용',url:'https://www.google.com/search?q='+encodeURIComponent((name||number)+' 채용')},
    {name:'SNS',url:'https://www.google.com/search?q='+encodeURIComponent((name||number)+' 인스타그램 유튜브')},
  ];
}
export function renderEnrichment({businessNumber,summary,record,loading=false,error='',name=''}) {
  const company=name||summary?.profile?.name;
  const fields=summary?.fields||[], sources=summary?.sources||[], candidates=summary?.candidates||[];
  const confirmed=sources.filter(s=>s.match!=='candidate');
  return `<section class="card enrichment-panel" data-business-number="${esc(businessNumber)}" aria-label="사업자 통합 정보" aria-live="polite">
    <div class="card-header"><div><div class="eyebrow">BUSINESS INTELLIGENCE</div><h2>${esc(company||'사업자')} 통합 정보</h2><p class="fine-print">사업자번호로 연결한 공개자료와 웹 채널을 한곳에서 확인합니다.</p></div><button class="button small" data-action="reload-enrichment" data-bno="${esc(businessNumber)}">자료 새로고침</button></div>
    <div class="enrichment-body">
      <div class="enrichment-metrics"><span><strong>${fields.length}</strong>개 확인 항목</span><span><strong>${confirmed.length}</strong>개 연결 출처</span><span><strong>${candidates.length}</strong>개 확인할 후보</span><span class="collection-highlight">마지막 성공 수집 · <strong>${esc(when(summary?.collection?.lastSuccessAt||summary?.collectedAt||record?.collectedAt))}</strong></span></div>
      ${loading?'<p class="inline-loading"><span class="spinner"></span> 공개 사업자 정보를 불러오고 있습니다.</p>':''}
      ${error?`<p class="callout warning">${esc(error)}</p>`:''}
      ${fields.length?`<dl class="enrichment-facts">${fields.map(f=>{const source=sources.find(s=>s.id===f.sourceId);return `<div class="enrichment-fact"><dt>${esc(f.label||ENRICHMENT_FIELDS[f.field]||f.field)}${f.conflict?'<span class="badge warning">출처별 차이</span>':''}</dt><dd>${f.field==='website'?link(f.value,f.value):esc(f.value)}<small>${source?esc(channelNames[source.channel]||'웹 자료')+' · '+link(source.url,source.title||'출처'):''} · ${esc(when(source?.collectedAt))}</small>${f.conflict?`<details><summary>다른 출처 값 확인</summary>${f.alternatives.map(a=>`<p>${esc(a.value)} · ${link(sources.find(s=>s.id===a.sourceId)?.url,'출처')}</p>`).join('')}</details>`:''}</dd></div>`;}).join('')}</dl>`:`<div class="enrichment-empty"><h3>이 사업자의 확인된 추가 정보가 아직 없습니다.</h3><p>상호와 공개 웹사이트를 알려주시면 사업자번호가 일치하는 자료부터 연결합니다.</p></div>`}
      <div class="button-row enrichment-actions"><button class="button primary small" data-action="enrichment-request" data-bno="${esc(businessNumber)}">웹 정보 수집 요청</button>${fields.length?`<button class="button small" data-action="save-enrichment-note" data-bno="${esc(businessNumber)}">출처와 함께 거래처에 보관</button>`:''}<button class="button small" data-action="enrichment-export" data-bno="${esc(businessNumber)}" ${!record?'disabled':''}>수집 자료 JSON</button></div>
      <div class="divider"></div><h3>채널별 더 찾아보기</h3><p class="fine-print">아래는 외부 검색 링크입니다. 검색결과가 수집되거나 동일 사업자로 확인된 것은 아닙니다.</p><div class="enrichment-channels">${discoveryLinks(businessNumber,summary?.profile?.name||'').map(x=>link(x.url,x.name,'enrichment-channel')).join('')}</div>
      ${sources.length?`<details class="enrichment-sources"><summary>연결 출처와 후보 ${sources.length}개</summary><div class="enrichment-source-list">${sources.map(s=>`<article><span class="badge ${s.match==='candidate'?'neutral':'positive'}">${s.match==='exact_bno'?'사업자번호 일치':s.match==='confirmed_domain'?'공식 도메인 연결':'확인할 후보'}</span><strong>${link(s.url,s.title||s.url)}</strong><p>${esc(channelNames[s.channel]||'웹 자료')} · 수집 ${esc(when(s.collectedAt))}${s.publishedAt?' · 게시 '+esc(when(s.publishedAt)):''}</p>${s.match==='candidate'?'<small>동일 사업자인지 추가 확인이 필요합니다. 개요에 자동 합치지 않습니다.</small>':''}</article>`).join('')}</div></details>`:''}
      <details class="enrichment-coverage"><summary>자료 범위와 수집 상태</summary>${['failed','partial'].includes(summary?.collection?.status)?`<p class="callout warning">최근 웹 수집 ${summary.collection.status==='failed'?'실패':'일부 실패'} · ${esc(when(summary.collection.lastAttemptAt))}. ${fields.length?'이전에 확보한 자료를 함께 표시합니다.':'접근 가능한 자료를 다시 확인해야 합니다.'}</p>`:''}${(summary?.collection?.sourceStatuses||[]).map(s=>`<p><strong>${esc(s.label)}</strong> · ${esc(({success:'수집 완료',partial:'일부 수집',not_found:'해당 원천에 자료 없음',not_configured:'인증키 설정 대기',identity_mismatch:'번호 불일치',error:'활용승인·연결 확인 필요'})[s.status]||'확인 필요')}${s.message?' — '+esc(s.message):''}</p>`).join('')}<p>수집 주기: <strong>매일 06:17 (한국시간)</strong> · 등록된 수집 대상과 승인된 수집 요청에 한해 갱신합니다.</p><p>국세청 상태, 공개 등록자료, 공식 웹사이트, 뉴스·채용·SNS를 출처별로 연결합니다. 개인사업자 대표자의 사생활이나 비공개 계정, 유료 문서 본문은 수집하지 않습니다.</p><p>${esc(summary?.collection?.message||record?.collection?.message||'웹 자료는 정기 수집본입니다. 실시간 국세청 상태와 기준일이 다를 수 있습니다.')}</p><p>공공 API는 각 서비스의 활용승인 범위에 따라 추가됩니다. 조회 결과가 없다는 이유로 미등록·폐업으로 판단하지 않습니다.</p></details>
    </div></section>`;
}
export function enrichmentNote(summary) {
  if(!summary?.fields?.length)return '';
  return '[공개 사업자 정보 · 출처 확인]\n'+summary.fields.map(f=>{
    const s=summary.sources.find(x=>x.id===f.sourceId);
    return `${f.label||ENRICHMENT_FIELDS[f.field]}: ${f.value}\n출처: ${s?.url||'미제공'} · 수집: ${s?.collectedAt||'미제공'}${f.conflict?' (출처별 값이 다름)':''}`;
  }).join('\n\n');
}
