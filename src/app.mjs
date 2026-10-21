import { normalizeBusinessNumber, formatBusinessNumber, isValidBusinessNumber, parseBusinessImport, exportPartnersCsv, applyCheckResults } from './domain.mjs';
import { emptyWorkspace, loadWorkspace, saveWorkspace, downloadText, validateBackup } from './storage.mjs';
import { callApi, validateApiBase, failureResult } from './api-client.mjs';
import { loadPrograms, rankPrograms } from './programs.mjs';
import { loadEnrichmentIndex, summarizeEnrichment } from './enrichment.mjs';
import { renderEnrichment } from './enrichment-view.mjs';
import { resolveBusinessProfile, attachPartnerEnrichment, derivePartnerProfile, setPartnerName } from './business-profile.mjs';
import { buildBusinessInsights } from './business-insights.mjs';
import { renderBusinessInsights } from './business-insights-view.mjs';
import { classifyBusinessQuery, buildBusinessSearchIndex, searchBusinesses } from './business-search.mjs';
import { renderBusinessSearch } from './business-search-view.mjs';
import { renderBusinessWorkbench, LOOKUP_TABS, normalizeLookupTab, lookupTabForInsight } from './business-workbench-view.mjs';
import { renderCollectionDashboard, buildBusinessProfileDraft, evidenceChanges } from './business-dashboard.mjs';
import { renderBusinessDetail, buildBusinessDetailReport } from './business-detail-view.mjs';
import { buildBusinessHistory, buildBusinessHistoryCsv } from './business-history.mjs';
import { editorNoteDraft, sameNoteDraft, applyNoteDraft } from './business-detail-state.mjs';
import { createAuthClient } from './auth.mjs';
import { createCloudWorkspace, mergeGuestWorkspace } from './cloud-storage.mjs';

const paths = {
 search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
 building:'M4 21V7l7-3v17M11 21V2l9 4v15M2 21h20M7 9v1m0 4v1m8-8v1m0 4v1m0 4v1m3-10v1m0 4v1m0 4v1',
 grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
 folder:'M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z',
 spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z',
 bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
 clock:'M12 8v5l3 2M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0',
 database:'M20 6c0 2-4 3-8 3s-8-1-8-3 4-3 8-3 8 1 8 3zM4 6v12c0 2 4 3 8 3s8-1 8-3V6M4 12c0 2 4 3 8 3s8-1 8-3',
 shield:'M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7l-9-4zM8 12l3 3 5-5',
 chevron:'m9 5 7 7-7 7',
 arrow:'M4 12h16m-6-6 6 6-6 6',
 external:'M14 3h7v7m0-7L10 14M11 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6',
 plus:'M12 5v14M5 12h14',
 upload:'M12 16V3m-5 5 5-5 5 5M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5',
 download:'M12 3v13m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4',
 refresh:'M20 7A9 9 0 1 0 21 15M20 3v5h-5',
 check:'m5 12 4 4L19 6',
 info:'M12 11v6m0-10v.01M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0',
 x:'m6 6 12 12M6 18 18 6',
 edit:'m15 4 5 5-11 11-6 1 1-6L15 4zm0 0 3-3 5 5-3 3',
 trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
 tag:'M3 3h8l10 10-8 8L3 11V3zm5 4h.01',
 file:'M14 2H5v20h14V7l-5-5zm0 0v5h5M8 12h8m-8 4h8',
 location:'M19 10c0 6-7 12-7 12S5 16 5 10a7 7 0 0 1 14 0zM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
 calendar:'M8 2v4m8-4v4M3 9h18M3 5h18v16H3V5z',
 menu:'M4 6h16M4 12h16M4 18h16',
 user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',
 link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
 heart:'M20 4a5 5 0 0 0-8 2 5 5 0 0 0-8-2c-7 5 8 17 8 17S27 9 20 4z',
 help:'M9 8a3 3 0 0 1 6 1c0 2-3 2-3 5m0 3v.01M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0'
};
const icon = (name,cls='') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]||paths.info}"/></svg>`;
const esc = v => String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl = value => { try { const u=new URL(value); return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password ? u.href : ''; } catch { return ''; } };
const external = (url,label,cls='source-link') => safeUrl(url) ? `<a class="${cls}" href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(label)} ${icon('external')}</a>` : esc(label);
const fmtTime = value => { if(!value) return '아직 확인 전'; const d=new Date(value); return Number.isNaN(d.getTime())?'날짜 미확인':new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d); };
const fmtDate = value => { if(!value) return '미확인'; const v=String(value); if(/^\d{8}$/.test(v))return v.slice(0,4)+'.'+v.slice(4,6)+'.'+v.slice(6); const d=new Date(value); return Number.isNaN(d.getTime())?v:new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(d); };
const number = value => new Intl.NumberFormat('ko-KR').format(value || 0);
const regions = ['서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주'];
const regionSummary = values => !values?.length ? '지역 원문 확인' : values.includes('전국') || regions.every(region=>values.includes(region)) ? '전국' : values.slice(0,3).join(' · ')+(values.length>3?` 외 ${values.length-3}개 지역`:'');
const statusNames = {active:'계속사업자',suspended:'휴업자',closed:'폐업자',unknown:'미확인'};
const titles = {lookup:'사업자 조회',partners:'거래처 관리',programs:'지원사업 찾기',profile:'내 사업',history:'변경 기록',account:'계정 · 동기화',data:'데이터 현황'};
const navItems = [['lookup','search'],['partners','folder'],['programs','spark'],['profile','building'],['history','clock'],['account','user'],['data','database']];
let workspace = emptyWorkspace();
let guestWorkspace = emptyWorkspace();
let authClient;
let authState = { phase:'initializing', user:null, configured:false, providers:{} };
let activeUid = null;
let accountEpoch = 0;
let accountTransition = false;
let cloudReady = false;
let cloudStore;
let cloudStatus = { phase:'guest', message:'' };
let remoteRevision = 0;
let accountError = '';
let accountNotice = '';
let authMode = 'signin';
let storageError = '';
let saving = false;
let health = null;
let healthError = '';
let programs = [];
let programMeta = {};
let programError = '';
let programLoading = true;
let collection = {};
let publicRecords = new Map();
let publicSummaries = new Map();
let publicMeta = {};
let publicIndexLoaded = false;
let publicIndexLoading = false;
let publicIndexError = '';
let publicIndexPromise = null;
let lookupSerial = 0;
let interactionEpoch = 0;
let businessIndexCache = null;
let lookupComposing = false;
let renderAfterComposition = false;
let healthSerial = 0;
let previousFocus;
let previousFocusDescriptor;
let previousBodyOverflow = '';
let backgroundWasInert = false;
let modal;
const detailDrafts = new Map();
let toastTimer;
let restoreSelection = 0;
let importSelection = 0;
const selected = new Set();
const ui = {
  view: document.body.dataset.page === 'data' ? 'data' : (location.hash.slice(1).split('?')[0] || 'lookup'),
  enrichment:null, enrichmentBusy:false, enrichmentError:'', mode: 'partner', lookupQuery: '', lookupType:'auto', lookupError:'', lookup: null, commerce: null, lookupBusy: false,
  nameQuery:'', nameSearchBusy:false, nameSearchError:'', nameSearchPage:1, lookupSelection:null,
  lookupTab:'overview', lookupPendingNumber:'', nameResultsExpanded:false,
  partnerQuery: '', partnerStatus: 'all', partnerInsight:'all', programQuery: '', programCategory: '', openOnly: true,
  page: 1, profileDraft: null, batchBusy: false, batchDone: 0, batchTotal: 0, mobileMenu: false
};
const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const currentApiBase = () => window.BIZHANNUN_CONFIG?.mode === 'direct' ? '' : workspace.preferences?.apiBase || window.BIZHANNUN_CONFIG?.apiBase || '';
const byId = id => workspace.partners.find(p=>p.id===id);
const byNumber = n => workspace.partners.find(p=>p.businessNumber===n);
const businessView = (partner) => {
  const ownRecord=[ui.profileDraft?.enrichment,workspace.profile?.enrichment].find(record=>record?.businessNumber===partner.businessNumber);
  return derivePartnerProfile({...partner,...(!partner.enrichment&&ownRecord?{enrichment:ownRecord}:{})}, publicRecords.get(partner.businessNumber) || null);
};
const businessRecord = value => {
  const bno=normalizeBusinessNumber(value);
  return businessView(byNumber(bno) || {businessNumber:bno,name:''}).record;
};
function linkedPartners(partners) {
  return partners.map(partner => {
    const record = publicRecords.get(partner.businessNumber);
    return record ? attachPartnerEnrichment(partner, record) : partner;
  });
}
const linkedBusiness = (businessNumber, partner=byNumber(normalizeBusinessNumber(businessNumber))) => resolveBusinessProfile({
  businessNumber, partner, record:businessRecord(businessNumber),
  summary:publicSummaries.get(normalizeBusinessNumber(businessNumber))
});
const publicBusiness = bno => { const record=businessRecord(bno); return {record,summary:record?summarizeEnrichment(record):null,meta:publicMeta}; };
const insightModel = (bno, check=null) => buildBusinessInsights({businessNumber:bno,partner:byNumber(bno)||null,check,summary:linkedBusiness(bno).summary});
const publicNameLine = profile => profile.publicName && profile.userName && profile.publicName!==profile.userName ? `<span class="subline public-name">공개 상호 · ${esc(profile.publicName)}</span>` : '';
const getSourceName = source => typeof source === 'string' ? source : source?.name || '국세청';
const getSourceUrl = result => safeUrl(result?.sourceUrl || (typeof result?.source==='object' ? result.source.url : '')) || 'https://www.data.go.kr/data/15081808/openapi.do';

function badge(result) {
  if (!result) return '<span class="badge neutral dot">확인 전</span>';
  if (result.outcome === 'not_configured') return '<span class="badge neutral dot">연결 대기</span>';
  if (result.outcome === 'error') return '<span class="badge warning dot">조회 실패</span>';
  if (result.outcome === 'not_found') return '<span class="badge neutral dot">등록정보 미확인</span>';
  const tone={active:'positive',suspended:'warning',closed:'danger',unknown:'neutral'}[result.businessStatus]||'neutral';
  return `<span class="badge ${tone} dot">${esc(result.statusLabel||statusNames[result.businessStatus]||'미확인')}</span>`;
}
function toast(message, error=false) {
  clearTimeout(toastTimer);
  document.getElementById('toast-root').innerHTML=`<div class="toast ${error?'error':''}">${esc(message)}</div>`;
  toastTimer=setTimeout(()=>document.getElementById('toast-root').replaceChildren(),error?6500:3500);
}
async function persist(next) {
  if (saving || accountTransition || authBusy() || (authState.user?.uid || null) !== activeUid) { toast('계정 연결 또는 저장 중입니다. 잠시 후 다시 시도해 주세요.'); return false; }
  if (activeUid && !cloudReady) { toast('계정 기록을 먼저 불러와 주세요.',true); return false; }
  const epoch=accountEpoch, uid=activeUid, store=cloudStore;
  saving=true;
  try {
    const saved = uid ? await store.save(uid,next) : await saveWorkspace(next);
    if(epoch!==accountEpoch || uid!==activeUid)return false;
    workspace={...saved,preferences:uid?guestWorkspace.preferences:saved.preferences};
    if(!uid)guestWorkspace=structuredClone(workspace);
    storageError='';
    remoteRevision=0;
    return true;
  } catch(error) {
    if(epoch!==accountEpoch)return false;
    storageError=error.message || '정보를 저장하지 못했습니다.';
    toast(storageError,true);
    return false;
  } finally { if(epoch===accountEpoch){saving=false;render();} }
}
function authBusy(){return ['initializing','authenticating','signing-out'].includes(authState.phase)||accountTransition;}
function userLabel(){return authState.user?.displayName||authState.user?.email?.split('@')[0]||'내 계정';}
function accountStorageStatus(){
  if(!authState.user)return {label:authState.phase==='initializing'?'연결 확인 중':authState.configured?'로그인 필요':'로그인 설정 확인 필요',tone:'neutral',message:authState.error||'현재 자료는 이 기기에 보관합니다. 로그인하면 계정에 저장한 기록을 불러옵니다.'};
  if(accountTransition||cloudStatus.phase==='loading')return {label:'불러오는 중',tone:'neutral',message:'계정의 기록을 서버에서 확인하고 있습니다.'};
  if(saving||cloudStatus.phase==='saving')return {label:'저장 중',tone:'neutral',message:'서버의 저장 완료 응답을 기다리고 있습니다.'};
  if(cloudStatus.phase==='error'||storageError||accountError)return {label:'동기화 확인 필요',tone:'warning',message:storageError||accountError||cloudStatus.message};
  if(remoteRevision||cloudStatus.phase==='conflict')return {label:'최신 기록 확인 필요',tone:'warning',message:'다른 기기에서 기록이 변경되었습니다. 작성 중인 내용을 보관한 뒤 최신 기록을 불러와 주세요.'};
  if(!cloudReady)return {label:'계정 연결 확인 필요',tone:'warning',message:'아직 계정의 기록을 불러오지 못했습니다.'};
  return {label:workspace.revision?'서버 확인 완료':'계정 저장소 연결됨',tone:'positive',message:workspace.revision?'계정에 저장된 기록을 서버에서 확인했습니다.':'계정 저장소에 연결되었습니다. 아직 저장한 기록은 없습니다.'};
}
async function receiveAuthState(state){
  authState=state;
  const nextUid=state.user?.uid||null;
  if(['ready','unconfigured','error'].includes(state.phase)&&nextUid!==activeUid)await switchAccount(nextUid);
  render();
}
async function switchAccount(uid){
  const epoch=++accountEpoch;
  lookupComposing=false;renderAfterComposition=false;
  cloudStore?.dispose();cloudStore=null;
  activeUid=uid;cloudReady=false;accountTransition=true;saving=false;
  accountError='';accountNotice='';storageError='';remoteRevision=0;
  lookupSerial++;interactionEpoch++;restoreSelection++;importSelection++;
  ui.lookup=null;ui.lookupBusy=false;ui.commerce=null;ui.profileDraft=null;
  ui.lookupQuery='';ui.lookupError='';ui.lookupSelection=null;ui.nameQuery='';ui.nameSearchBusy=false;ui.nameSearchError='';ui.nameSearchPage=1;
  ui.lookupTab='overview';ui.lookupPendingNumber='';ui.nameResultsExpanded=false;
  ui.enrichment=null;ui.enrichmentBusy=false;ui.enrichmentError='';businessIndexCache=null;
  ui.batchBusy=false;selected.clear();if(modal)closeModal({discardDraft:true,quiet:true});detailDrafts.clear();
  workspace={...emptyWorkspace(),preferences:guestWorkspace.preferences};render();
  try{
    if(!uid){workspace=structuredClone(guestWorkspace);cloudStatus={phase:'guest',message:'이 기기에 저장'};}
    else{
      const context=authClient.getContext();
      cloudStore=createCloudWorkspace({...context,onStatus:status=>{if(epoch===accountEpoch){cloudStatus=status;render();}},onRemoteChange:change=>{
        if(epoch===accountEpoch&&change.uid===activeUid&&change.revision>workspace.revision){remoteRevision=change.revision;render();}
      }});
      const loaded=await cloudStore.load(uid);
      if(epoch!==accountEpoch)return;
      workspace={...loaded,preferences:guestWorkspace.preferences};cloudReady=true;cloudStore.watch(uid);
    }
  }catch(error){if(epoch===accountEpoch){accountError=error.message;cloudStatus={phase:'error',message:accountError};}}
  finally{if(epoch===accountEpoch){accountTransition=false;render();}}
}
async function reloadCloud(){
  if(!activeUid||!cloudStore||saving)return;
  const epoch=accountEpoch;accountTransition=true;accountError='';render();
  try{
    const loaded=await cloudStore.load(activeUid);
    if(epoch!==accountEpoch)return;
    workspace={...loaded,preferences:guestWorkspace.preferences};cloudReady=true;
    ui.profileDraft=null;storageError='';remoteRevision=0;accountNotice='';
    cloudStore.watch(activeUid);toast('계정의 최신 기록을 불러왔습니다.');
  }catch(error){if(epoch===accountEpoch)accountError=error.message;}
  finally{if(epoch===accountEpoch){accountTransition=false;render();}}
}
async function runAuth(task){
  if(authBusy()||saving||ui.batchBusy)return;
  accountError='';accountNotice='';
  try{await task();}
  catch(error){accountError=error.message||'로그인을 완료하지 못했습니다.';}
  render();
}
function accountConfirm(action,title,message){
  openModal(title,`<p class="fine-print">${esc(message)}</p><div class="modal-actions"><button class="button" data-action="close-modal">취소</button><button class="button primary" data-action="${action}">계속하기</button></div>`);
  modal.accountEpoch=accountEpoch;
}
function blockLoginForProfileDraft(){
  if(!ui.profileDraft)return false;
  openModal('작성 중인 사업 프로필을 먼저 저장해 주세요',`<p class="fine-print">로그인하면 계정의 자료를 불러옵니다. 입력 중인 사업 프로필을 잃지 않도록 내 사업 화면에서 먼저 저장해 주세요. 저장한 뒤 다시 로그인할 수 있습니다. 기기 자료를 계정으로 가져올지는 로그인 후 선택할 수 있습니다.</p><div class="modal-actions"><button class="button" data-action="close-modal">닫기</button><button class="button primary" data-action="auth-return-profile">내 사업으로 돌아가 저장하기</button></div>`);
  return true;
}
function workspaceNotice(){
  if(accountTransition)return '<div class="callout storage-warning" role="status"><span class="spinner"></span><span>계정의 기록을 불러오고 있습니다.</span></div>';
  if(remoteRevision)return '<div class="callout warning storage-warning"><span>다른 기기에서 기록이 변경되었습니다. <button class="text-button" data-action="cloud-reload-confirm">최신 기록 확인</button></span></div>';
  if(activeUid&&!cloudReady)return `<div class="callout warning storage-warning"><span>${esc(accountError||'계정 저장소 연결을 확인해 주세요.')} <button class="text-button" data-nav="account">계정 상태 확인</button></span></div>`;
  return '';
}
function accountView(){
  const user=authState.user,busy=authBusy()||saving,sync=accountStorageStatus();
  if(user){
    const guestCount=guestWorkspace.partners.length,hasGuest=guestCount||guestWorkspace.events.length||guestWorkspace.checks.length||Object.keys(guestWorkspace.profile||{}).length;
    return pageHeading('내 계정, 이어지는 기록','거래처와 사업 정보를 같은 계정으로 다른 기기에서도 확인하세요.')+`
    <div class="account-layout"><section class="card account-card">
      <div class="account-identity"><span class="account-avatar">${icon('user')}</span><div><h2>${esc(userLabel())}</h2><p class="fine-print">${esc(user.email||'SNS로 로그인한 계정')}</p></div><span class="badge positive dot">로그인됨</span></div>
      <div class="divider"></div><h3>계정에 보관하는 정보</h3><p class="fine-print">거래처, 메모·태그, 사업 프로필, 조회 이력과 변경 기록을 Firestore에 저장합니다. 로그인한 본인 계정에서만 읽고 수정할 수 있습니다.</p>
      <dl class="detail-grid section-spacer"><div class="detail-fact"><dt>저장 상태</dt><dd><span class="badge ${sync.tone} dot">${esc(sync.label)}</span></dd></div><div class="detail-fact"><dt>마지막 저장</dt><dd>${esc(fmtTime(workspace.updatedAt))}</dd></div><div class="detail-fact"><dt>거래처</dt><dd>${number(workspace.partners.length)}곳</dd></div><div class="detail-fact"><dt>저장 버전</dt><dd>${number(workspace.revision)}</dd></div></dl>
      <div class="callout ${sync.tone==='warning'?'warning':''} section-spacer" role="status"><span>${esc(sync.message)}</span></div>
      <div class="button-row section-spacer"><button class="button primary" data-action="cloud-reload-confirm" ${busy?'disabled':''}>${icon('refresh')} 계정 기록 다시 불러오기</button><button class="button" data-action="backup">${icon('download')} 전체 백업</button></div>
      ${user.providerIds?.includes('password')&&!user.emailVerified?`<div class="callout warning section-spacer"><span>이메일 확인이 필요합니다. 받은 메일의 링크를 열어 주세요. <button class="text-button" data-action="auth-verify" ${busy?'disabled':''}>인증 메일 다시 보내기</button></span></div>`:''}
      <div class="divider"></div><button class="button" data-action="auth-signout" ${busy||ui.batchBusy?'disabled':''}>로그아웃</button><p class="fine-print" style="margin-top:12px">로그아웃하면 이 기기에만 저장한 자료로 돌아갑니다. 계정 자료는 Firestore에 보관됩니다.</p>
    </section><section class="card account-card"><h2>이 기기의 기존 자료</h2><p class="fine-print">로그인 전에 저장한 자료는 계정 자료와 따로 보관돼 있습니다. 가져오기를 선택하면 현재 계정에 추가합니다.</p><div class="migration-count">${number(guestCount)}<span>곳의 거래처</span></div><p class="fine-print">같은 사업자번호가 있으면 계정에 저장된 거래처를 유지합니다. 가져온 뒤에도 이 기기의 원본은 남습니다.</p><button class="button primary section-spacer" data-action="guest-import-preview" ${!hasGuest||!cloudReady||busy?'disabled':''}>${icon('upload')} 기존 자료 가져오기</button><div class="divider"></div><h3>다른 기기에서 이어서 쓰기</h3><p class="fine-print">같은 로그인 방식과 같은 계정을 선택하세요. 카카오·네이버·구글·이메일 계정은 이메일 주소가 같아도 자동으로 합쳐지지 않습니다.</p></section></div>
    ${accountNotice?`<div class="callout section-spacer" role="status"><span>${esc(accountNotice)}</span></div>`:''}`;
  }
  const providers=[['kakao','카카오로 시작하기','K'],['naver','네이버로 시작하기','N'],['google','Google로 시작하기','G']];
  return pageHeading('어디서든, 내 사업의 기록','로그인하면 거래처·메모·프로필·조회 이력이 계정에 저장됩니다.')+`
  <div class="account-layout"><section class="card account-card signin-card"><h2>간편하게 로그인</h2><p class="fine-print">같은 계정으로 로그인해 다른 기기에서도 이어서 사용하세요.</p>
    <div class="social-buttons">${providers.map(([key,label,mark])=>`<button class="social-button ${key}" data-action="auth-provider" data-provider="${key}" ${busy||!authState.providers?.[key]?.configured?'disabled':''}><span class="social-mark">${mark}</span><span>${label}</span>${!authState.providers?.[key]?.configured?'<small>준비 중</small>':''}</button>`).join('')}</div>
    ${authState.phase==='initializing'?'<div class="inline-loading"><span class="spinner"></span>로그인 연결 확인 중</div>':''}
    ${authState.error?`<div class="callout warning"><span>${esc(authState.error)}</span></div>`:''}
    ${['error','unconfigured'].includes(authState.phase)?'<button class="text-button section-spacer" data-action="auth-retry">연결 다시 확인</button>':''}
    ${authState.providers?.email?.configured?`<div class="auth-divider"><span>또는 이메일로</span></div><div class="auth-tabs"><button class="${authMode==='signin'?'active':''}" data-action="auth-mode" data-mode="signin">로그인</button><button class="${authMode==='signup'?'active':''}" data-action="auth-mode" data-mode="signup">회원가입</button></div><form id="auth-email-form"><div class="form-field"><label for="auth-email">이메일</label><input id="auth-email" name="email" type="email" required autocomplete="email" maxlength="254"></div>${authMode!=='reset'?`<div class="form-field"><label for="auth-password">비밀번호</label><input id="auth-password" name="password" type="password" required minlength="${authMode==='signup'?8:1}" maxlength="4096" autocomplete="${authMode==='signup'?'new-password':'current-password'}"></div>`:''}<button class="button primary auth-submit" type="submit" ${busy?'disabled':''}>${authMode==='signup'?'이메일로 가입하기':authMode==='reset'?'재설정 메일 받기':'이메일로 로그인'}</button></form><button class="text-button" style="margin-top:14px" data-action="auth-mode" data-mode="${authMode==='reset'?'signin':'reset'}">${authMode==='reset'?'로그인으로 돌아가기':'비밀번호를 잊으셨나요?'}</button>`:''}
    ${accountError?`<p class="field-error" role="alert">${esc(accountError)}</p>`:''}${accountNotice?`<p class="fine-print" role="status">${esc(accountNotice)}</p>`:''}
  </section><section class="card account-card account-benefits"><div class="account-hero-icon">${icon('shield')}</div><h2>정보도 함께 저장합니다</h2><div class="guide-step"><span class="step-number">01</span><div><h3>거래처와 메모</h3><p>거래처, 분류 태그와 업무 메모를 계정에 보관합니다.</p></div></div><div class="guide-step"><span class="step-number">02</span><div><h3>조회 이력과 내 사업</h3><p>사업자 상태 조회와 변경 기록, 지원사업 탐색용 프로필을 함께 저장합니다.</p></div></div><div class="guide-step"><span class="step-number">03</span><div><h3>기존 자료 이어 쓰기</h3><p>이 브라우저의 자료는 로그인 후 가져오기로 옮길 수 있습니다.</p></div></div><div class="divider"></div><p class="fine-print">로그인 없이도 이 기기에 저장하며 사용할 수 있습니다. 로그아웃 상태의 자료는 다른 기기와 동기화되지 않습니다.</p><button class="button section-spacer" data-nav="partners">이 기기에서 계속하기 ${icon('arrow')}</button></section></div>`;
}
async function handleAccountAction(action,element){
  if(action==='auth-return-profile'){closeModal();go('profile');return true;}
  if(action==='auth-provider'){if(blockLoginForProfileDraft())return true;await runAuth(()=>authClient.signIn(element.dataset.provider));return true;}
  if(action==='auth-retry'){await authClient.init();return true;}
  if(action==='auth-mode'){authMode=['signin','signup','reset'].includes(element.dataset.mode)?element.dataset.mode:'signin';accountError='';accountNotice='';render();return true;}
  if(action==='auth-verify'){await runAuth(async()=>{await authClient.sendVerification();accountNotice='인증 메일을 보냈습니다.';});return true;}
  if(action==='auth-signout'){
    if(ui.profileDraft){accountConfirm('auth-signout-confirm','로그아웃할까요?','저장하지 않은 사업 프로필 입력은 사라집니다. 먼저 저장하거나 백업한 뒤 계속해 주세요.');}
    else await runAuth(()=>authClient.signOut());
    return true;
  }
  if(action==='auth-signout-confirm'){
    if(modal?.accountEpoch!==accountEpoch)return true;closeModal();await runAuth(()=>authClient.signOut());return true;
  }
  if(action==='cloud-reload-confirm'){
    if(ui.profileDraft){accountConfirm('cloud-reload','계정 기록 다시 불러오기','작성 중인 사업 프로필을 서버에 저장된 기록으로 바꿉니다. 필요한 입력을 보관한 뒤 계속해 주세요.');}
    else await reloadCloud();return true;
  }
  if(action==='cloud-reload'){if(modal?.accountEpoch!==accountEpoch)return true;closeModal();await reloadCloud();return true;}
  if(action==='guest-import-preview'){
    if(!activeUid||!cloudReady||saving)return true;
    try{
      const merged=mergeGuestWorkspace(workspace,guestWorkspace);
      openModal('기존 자료를 계정으로 가져오기',`<p class="fine-print">새 거래처 <strong>${number(merged.addedPartners)}곳</strong>을 추가합니다. 같은 사업자번호 <strong>${number(merged.duplicatePartners)}곳</strong>은 계정 기록을 유지합니다. 계정 프로필이 비어 있으면 기기의 프로필을 가져옵니다. 기기의 원본은 남습니다.</p><div class="modal-actions"><button class="button" data-action="close-modal">취소</button><button class="button primary" data-action="guest-import-confirm">현재 계정에 가져오기</button></div>`);
      modal.accountEpoch=accountEpoch;modal.merge=merged.workspace;
    }catch(error){toast(error.message,true);}return true;
  }
  if(action==='guest-import-confirm'){
    if(modal?.accountEpoch!==accountEpoch||!modal.merge)return true;
    if(await persist(modal.merge)){closeModal();toast('기존 자료를 계정에 가져왔습니다. 이 기기의 원본도 보관됩니다.');}return true;
  }
  return false;
}
async function submitAuth(form){
  if(!form.reportValidity())return;
  if(authMode!=='reset'&&blockLoginForProfileDraft())return;
  const data=new FormData(form),email=String(data.get('email')||''),password=String(data.get('password')||'');
  await runAuth(async()=>{
    if(authMode==='reset'){await authClient.resetPassword(email);accountNotice='입력한 주소로 재설정 안내를 요청했습니다. 받은 메일을 확인해 주세요.';}
    else if(authMode==='signup'){const result=await authClient.signUpEmail(email,password);accountNotice=result?.warning||'계정을 만들었습니다. 이메일 인증 안내를 확인해 주세요.';}
    else await authClient.signInEmail(email,password);
  });
}
function pageHeading(title,description,action='') {
  return `<div class="page-heading"><div><div class="eyebrow">BIZHANNUN WORKSPACE</div><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}
function empty(iconName,title,description,button='') {
  return `<div class="empty-state"><div class="empty-icon">${icon(iconName)}</div><h3>${title}</h3><p>${description}</p>${button}</div>`;
}
function footer() {
  return `<footer class="footer"><span>사업자한눈 · 공개정보에 근거한 사업의 다음 단계</span><div class="footer-links"><a href="./data-status.html">데이터 출처</a><button class="footer-button" data-action="privacy">개인정보 안내</button><button class="footer-button" data-action="help">이용 안내</button></div></footer>`;
}
function shell(content) {
  const view=titles[ui.view]?ui.view:'lookup';
  const nav=navItems.map(([key,symbol],i)=>`${i===4?'<div class="nav-label">WORKSPACE</div>':''}<a class="nav-link ${key===view?'active':''}" href="./#${key}" data-nav="${key}" ${key===view?'aria-current="page"':''}>${icon(symbol)}<span>${titles[key]}</span>${key==='partners'&&workspace.partners.length?`<span class="nav-count">${workspace.partners.length}</span>`:''}</a>`).join('');
  return `<div class="shell">
  <div class="mobile-backdrop ${ui.mobileMenu?'is-open':''}" data-action="toggle-menu"></div>
  <aside class="sidebar ${ui.mobileMenu?'is-open':''}" aria-label="주 메뉴">
    <a class="brand" href="./#lookup" data-nav="lookup"><img class="brand-mark" src="./assets/favicon.svg" alt="">사업자한눈</a>
    <div class="brand-sub">BUSINESS AT A GLANCE</div>
    <nav>${nav}</nav>
    <div class="side-spacer"></div>
    <div class="local-card">${icon('shield')}<div><strong>${authState.user?'내 계정에 보관':'이 기기에 보관'}</strong>${authState.user?esc(accountStorageStatus().label):'로그인하면 다른 기기에서도<br>내 기록을 이어서 볼 수 있어요.'}</div></div>
    <div class="side-foot"><span>© bizhannun</span><span>v0.5</span></div>
  </aside>
  <div class="main-wrap">
    <header class="topbar">
      <div class="mobile-header-left"><button class="icon-button mobile-nav-toggle" data-action="toggle-menu" aria-label="메뉴 열기" aria-expanded="${ui.mobileMenu}">${icon('menu')}</button><a class="brand mobile-brand" href="./#lookup" data-nav="lookup"><img class="brand-mark" src="./assets/favicon.svg" alt="">사업자한눈</a></div>
      <div class="breadcrumb">내 워크스페이스 ${icon('chevron')} <span>${titles[view]}</span></div>
      <div class="top-tools"><span class="date-label">${new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'long'}).format(new Date())}</span><button class="icon-button notice-button" data-action="goto-history" aria-label="변경 기록 보기">${icon('bell')}${workspace.events.some(e=>!e.acknowledgedAt)?'<span class="notification-count">!</span>':''}</button><button class="account-trigger" data-nav="account"><span class="avatar">${icon('user')}</span><span>${authState.user?esc(userLabel()):'로그인'}</span></button></div>
    </header>
    <main class="main-content" id="main-content" tabindex="-1">${workspaceNotice()}${storageError?`<div class="callout error storage-warning">${icon('info')}<span>${esc(storageError)} 현재 변경사항을 저장하지 못할 수 있습니다.</span></div>`:''}${content}${footer()}</main>
  </div></div>`;
}
function render() {
  if(lookupComposing){renderAfterComposition=true;return;}
  renderAfterComposition=false;
  const active=document.activeElement;
  const focusId=app.contains(active)?active?.id:null;
  const sel=active&&'selectionStart'in active?active.selectionStart:null;
  const previousNumber=app.querySelector('#lookup-result')?.dataset.businessNumber;
  const disclosureState=[...app.querySelectorAll('.lookup-page details[id]')].map(el=>({id:el.id,open:el.open}));
  const selectionEnd=active&&'selectionEnd'in active?active.selectionEnd:sel;
  const views={lookup:lookupView,partners:partnersView,programs:programsView,profile:profileView,history:historyView,account:accountView,data:dataView};
  app.innerHTML=shell((views[ui.view]||lookupView)());
  const nextNumber=app.querySelector('#lookup-result')?.dataset.businessNumber;
  for(const disclosure of disclosureState){
    if(disclosure.id!=='lookup-scope-info'&&previousNumber!==nextNumber)continue;
    const next=document.getElementById(disclosure.id);
    if(next instanceof HTMLDetailsElement)next.open=disclosure.open;
  }
  if(focusId) {
    const next=document.getElementById(focusId);
    if(next) { next.focus({preventScroll:true}); try { if(sel!==null)next.setSelectionRange(sel,selectionEnd); } catch {} }
  }
  if(modal?.detailId&&byId(modal.detailId))detailModal(byId(modal.detailId),{refresh:true});
}
function statsView() {
  const changes=workspace.events.filter(e=>!e.acknowledgedAt).length;
  const missing=workspace.partners.filter(p=>!p.lastSuccess).length;
  const values=[
    ['folder','관리 중인 거래처',workspace.partners.length,'곳','함께 일하는 사업자 목록',''],
    ['shield','상태 확인 완료',workspace.partners.filter(p=>p.lastCheck?.outcome==='ok').length,'곳','마지막 조회에 응답한 사업자',''],
    ['bell','확인할 상태 변화',changes,'건','이전 성공 조회와 비교한 기록','warning'],
    ['clock','아직 확인 전',missing,'곳','성공한 상태 조회가 없는 거래처','']
  ];
  return `<div class="stats-grid">${values.map(([ic,label,v,unit,desc,tone])=>`<div class="card stat-card ${tone}"><div class="stat-top">${label}<div class="stat-icon">${icon(ic)}</div></div><div class="stat-value">${number(v)}<small>${unit}</small></div><div class="stat-caption">${desc}</div></div>`).join('')}</div>`;
}
function partnerTable(rows, compact=false) {
  return `<div class="table-wrap ${compact?'dashboard-table':''}"><table><thead><tr>${!compact?'<th><input type="checkbox" id="select-all" aria-label="보이는 거래처 모두 선택"></th>':''}<th>거래처</th>${!compact?'<th>공개 사업 정보</th>':''}<th>사업자 상태</th><th>최근 확인</th>${!compact?'<th>태그</th><th><span class="sr-only">작업</span></th>':''}</tr></thead><tbody>${rows.map(p=>{
    const linked=linkedBusiness(p.businessNumber,p),facts=linked.summary?.profile||{};
    return `<tr>${!compact?`<td><input type="checkbox" class="partner-check" data-id="${esc(p.id)}" aria-label="${esc(linked.displayName)} 선택" ${selected.has(p.id)?'checked':''}></td>`:''}<td><div class="company-cell"><span class="company-avatar">${esc(linked.displayName.slice(0,1))}</span><div><button class="partner-name" data-action="detail" data-id="${esc(p.id)}">${esc(linked.displayName)}</button><span class="subline number">${formatBusinessNumber(p.businessNumber)}</span>${publicNameLine(linked)}<span class="subline source-caption">${esc(linked.nameSourceLabel)}</span></div></div></td>${!compact?`<td class="partner-business-info"><span>${esc(facts.businessCategory||facts.industry||'업종 미확인')}</span><span class="subline">${esc(facts.address||'주소 미확인')}</span>${linked.nameHasConflict?'<span class="badge warning">상호 출처별 차이</span>':''}</td>`:''}<td>${badge(p.lastCheck)}${p.lastCheck?.outcome!=='ok'&&p.lastSuccess?`<span class="subline">직전 성공: ${esc(p.lastSuccess.statusLabel||statusNames[p.lastSuccess.businessStatus])}</span>`:''}</td><td><span class="subline" style="margin:0">${p.lastCheck?esc(fmtTime(p.lastCheck.checkedAt)):'아직 확인 전'}</span></td>${!compact?`<td><div class="chip-list">${(p.tags||[]).map(t=>`<span class="badge neutral">${esc(t)}</span>`).join('')||'<span class="muted">—</span>'}</div></td><td><button class="icon-button" data-action="edit-partner" data-id="${esc(p.id)}" aria-label="${esc(linked.displayName)} 수정">${icon('edit')}</button></td>`:''}</tr>`;
  }).join('')}</tbody></table></div>`;
}
function businessInformation(bno) {
  const linked=linkedBusiness(bno), data=publicBusiness(bno);
  return renderEnrichment({businessNumber:bno,...data,summary:linked.summary,loading:publicIndexLoading,error:publicIndexError,name:linked.displayName==='이름 미입력'?'':linked.displayName});
}
function businessInsightView(bno,check=null,compact=false) {
  return renderBusinessInsights(insightModel(bno,check),{compact});
}
function portfolioView() {
  if(!workspace.partners.length)return '';
  const models=workspace.partners.map(p=>insightModel(p.businessNumber,p.lastCheck));
  const options=[
    ['refresh','상태 재확인',models.filter(m=>m.status.needsRefresh).length,'7일 경과·미확인·조회 실패','clock'],
    ['linked','공개정보 연결',models.filter(m=>m.profile.fields.length).length,'동일 번호의 출처가 연결된 거래처','link'],
    ['conflict','출처별 차이',models.filter(m=>m.conflicts.length).length,'같은 항목의 값이 다른 거래처','info'],
    ['missing','기본정보 보강',models.filter(m=>m.profile.missing.length).length,'6개 기본 항목 중 미확보 자료 있음','file']
  ];
  return `<section class="card portfolio-panel" aria-label="거래처 점검"><div class="card-header"><div><h2>거래처 점검</h2><p class="fine-print">${number(workspace.partners.length)}곳의 확인 기록과 공개자료를 함께 살펴봅니다.</p></div><button class="text-button" data-action="insight-filter" data-filter="all">전체 거래처 ${icon('chevron')}</button></div><div class="portfolio-grid">${options.map(([key,label,count,desc,symbol])=>`<button class="portfolio-metric ${ui.partnerInsight===key&&ui.view==='partners'?'is-selected':''}" data-action="insight-filter" data-filter="${key}" aria-label="${label} ${count}곳 보기"><span>${icon(symbol)}${label}</span><strong>${count}<small>곳</small></strong><p>${desc}</p></button>`).join('')}</div><p class="portfolio-note">확인할 정보의 범위입니다. 업체의 신용등급이나 거래 안전성을 평가한 수치가 아닙니다.</p>${publicIndexError?`<p class="insight-notice is-attention">${esc(publicIndexError)}</p>`:''}</section>`;
}
function lookupView() {
  const hasActivity=!!(ui.nameQuery||ui.lookup||ui.lookupBusy);
  const selectedContext=!!ui.nameQuery&&!!(ui.lookup||ui.lookupBusy);
  const showResults=!selectedContext||ui.nameResultsExpanded;
  const search=ui.nameQuery?currentNameSearch():null;
  const index=businessSearchIndex();
  const searchScope=!publicIndexLoaded&&!publicIndexError?'공개목록 불러오는 중':publicIndexError?'공개목록 연결 확인 필요':`수집·저장 ${number(index.totalCount)}곳 대상`;
  return `<div class="lookup-page">
    <header class="lookup-heading"><h1>사업자 조회</h1><p>이름이나 등록번호로 찾고, 같은 번호의 정보를 확인하세요.</p></header>
    <section class="card lookup-search" aria-label="사업자 이름 또는 등록번호 조회">
      <form id="lookup-form" role="search" aria-label="사업자 검색">
        <div class="lookup-input-row">
          <label class="sr-only" for="lookup-type">검색 기준</label>
          <select id="lookup-type" name="lookupType"><option value="auto" ${ui.lookupType==='auto'?'selected':''}>자동 구분</option><option value="name" ${ui.lookupType==='name'?'selected':''}>상호·업체명</option><option value="number" ${ui.lookupType==='number'?'selected':''}>사업자번호</option></select>
          <label class="sr-only" for="business-query">사업자등록번호 또는 상호·업체명</label>
          <input id="business-query" name="businessQuery" type="search" inputmode="${ui.lookupType==='number'?'numeric':'search'}" autocomplete="off" enterkeyhint="search" spellcheck="false" placeholder="${ui.lookupType==='number'?'사업자등록번호 10자리':'상호 일부 또는 사업자등록번호 10자리'}" value="${esc(ui.lookupQuery)}" maxlength="200" aria-describedby="lookup-error lookup-hint" ${ui.lookupError?'aria-invalid="true"':''} required>
          <button class="button primary" type="submit" ${ui.lookupBusy||ui.nameSearchBusy?'aria-busy="true"':''}>${ui.lookupBusy||ui.nameSearchBusy?'<span class="spinner"></span> 검색 중':icon('search')+' 검색하기'}</button>
        </div>
        <div id="lookup-error" class="field-error" role="alert">${esc(ui.lookupError)}</div>
      </form>
      <div class="lookup-search-note"><p id="lookup-hint">이름 일부 포함 검색 · <strong>${esc(searchScope)}</strong></p><details class="lookup-scope" id="lookup-scope-info"><summary>검색 범위·갱신</summary><div><p>공개자료 ${number(index.publicCount)}곳 · 내 저장정보 ${number(index.savedCount)}곳. 같은 사업자번호를 합친 검색 대상은 ${number(index.totalCount)}곳입니다.</p><p>전국 모든 사업자의 상호가 수집된 것은 아닙니다. 이름의 앞·중간·끝 어디에 검색어가 포함되어도 찾습니다. 저장된 별칭과 동일 사업자번호로 확인된 공개 상호도 검색합니다.</p><p>예: <strong>이버</strong> → 네이버, <strong>박속</strong> → 서해박속낙지전문점. <strong>%네이버%</strong>·<strong>*네이버*</strong>도 지원하며, <strong>서해%전문점</strong>처럼 중간 글자를 생략할 수 있습니다.</p><p>상호 일부와 지역을 함께 입력할 수 있고, 번호는 하이픈 없이 입력해도 됩니다. 숫자만으로 된 상호는 검색 기준을 상호·업체명으로 바꿔 주세요. 초성·오타 보정은 지원하지 않습니다.</p><div class="search-data-highlights"><span>공개자료 수집 일정<strong>매일 06:17 (한국시간)</strong></span><span>공개 목록 생성<strong>${esc(fmtTime(publicMeta.generatedAt||publicMeta.collectedAt))}</strong></span></div><a class="text-button" href="./#data" data-nav="data">전체 데이터 현황 ${icon('chevron')}</a></div></details></div>
    </section>
    ${selectedContext?`<div id="lookup-search-context" class="lookup-results-context"><span><strong>“${esc(ui.nameQuery)}”</strong> 검색 결과 ${number(search.result.total)}곳</span><button id="toggle-name-results" class="text-button" data-action="toggle-name-results" aria-controls="lookup-name-results-area" aria-expanded="${showResults}">${showResults?'결과 목록 접기':'결과 다시 보기'} ${icon('chevron')}</button></div>`:''}
    ${ui.nameQuery?`<div id="lookup-name-results-area" class="lookup-results ${showResults?'is-expanded':''}" ${showResults?'':'hidden'}>${showResults?nameSearchView():''}</div>`:''}
    ${ui.lookupBusy&&!ui.lookup?`<div class="lookup-progress" role="status"><span class="spinner"></span><div><strong>${esc(formatBusinessNumber(ui.lookupPendingNumber))}</strong><p>선택한 번호의 등록 상태와 공개정보를 확인하고 있습니다.</p></div></div>`:''}
    ${ui.lookup?lookupResultView():''}
    ${!hasActivity?lookupStartView():''}
  </div>`;
}
function lookupStartView() {
  const saved=workspace.partners.slice(0,3);
  return `<section class="lookup-start" aria-label="검색 안내"><div class="lookup-start-icon">${icon('building')}</div><h2>확인할 사업자를 검색하세요</h2><p>상호로 업체를 선택하거나, 사업자번호로 바로 조회할 수 있습니다.</p><span>등록 상태 · 사업자 정보 · 출처와 확인 기록</span></section>
    ${saved.length?`<section class="lookup-saved" aria-labelledby="lookup-saved-title"><div class="section-row"><h2 id="lookup-saved-title">저장한 거래처</h2><a class="text-button" href="./#partners" data-nav="partners">전체 ${number(workspace.partners.length)}곳 보기 ${icon('chevron')}</a></div><ul class="lookup-saved-list">${saved.map(p=>{const linked=linkedBusiness(p.businessNumber,p);return `<li><button type="button" data-action="lookup-saved" data-bno="${esc(p.businessNumber)}"><span class="company-avatar" aria-hidden="true">${esc(linked.displayName.slice(0,1))}</span><span class="lookup-saved-name"><strong>${esc(linked.displayName)}</strong><small class="number">${formatBusinessNumber(p.businessNumber)}</small></span><span class="lookup-saved-status">${badge(p.lastCheck)}<small>${p.lastCheck?'확인 '+esc(fmtTime(p.lastCheck.checkedAt)):'아직 조회 전'}</small></span>${icon('chevron')}</button></li>`;}).join('')}</ul></section>`:''}`;
}
function businessSearchIndex() {
  const records=publicRecords;
  if(!businessIndexCache||businessIndexCache.records!==records||businessIndexCache.workspace!==workspace){
    businessIndexCache={records,workspace,value:buildBusinessSearchIndex({records:[...records.values()],partners:workspace.partners,profile:workspace.profile})};
  }
  return businessIndexCache.value;
}
function currentNameSearch() {
  const index=businessSearchIndex();
  let result=searchBusinesses(index,ui.nameQuery,{limit:10,offset:(ui.nameSearchPage-1)*10});
  const pages=Math.max(1,Math.ceil(result.total/10));
  if(ui.nameSearchPage>pages){ui.nameSearchPage=pages;result=searchBusinesses(index,ui.nameQuery,{limit:10,offset:(pages-1)*10});}
  return {index,result};
}
function nameSearchView() {
  if(!ui.nameQuery)return '';
  const {index,result}=currentNameSearch();
  return renderBusinessSearch({query:ui.nameQuery,index,result,loading:ui.nameSearchBusy,error:ui.nameSearchError||publicIndexError,
    meta:publicMeta,selectedNumber:ui.lookupSelection?.businessNumber||''});
}
function lookupResultView() {
  const result=ui.lookup;
  const registered=byNumber(result.businessNumber);
  const ownProfile=normalizeBusinessNumber(workspace.profile.businessNumber)===result.businessNumber?workspace.profile:null;
  const linked=linkedBusiness(result.businessNumber,registered||ownProfile);
  const data=publicBusiness(result.businessNumber);
  const model=buildBusinessInsights({businessNumber:result.businessNumber,partner:registered||ownProfile,check:result,summary:linked.summary});
  return renderBusinessWorkbench({result,linked,model,record:data.record,summary:linked.summary,
    loading:publicIndexLoading,refreshing:ui.lookupBusy,error:publicIndexError,commerce:ui.commerce,registered:!!registered,tab:ui.lookupTab});
}
function activateLookupTab(tab,{focus=false,target=''}={}) {
  if(!ui.lookup)return;
  ui.lookupTab=normalizeLookupTab(tab);interactionEpoch++;
  render();
  const root=document.getElementById('lookup-result');
  const section=target?root?.querySelector(target):null;
  if(section){
    if(section instanceof HTMLDetailsElement)section.open=true;
    const heading=section.querySelector('summary,h3,h4')||section;
    heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});
    section.scrollIntoView({block:'nearest',behavior:'instant'});
  }else if(focus)document.getElementById('lookup-tab-'+ui.lookupTab)?.focus({preventScroll:true});
}
function filteredPartners() {
  return workspace.partners.filter(p=>{
    const q=ui.partnerQuery.toLowerCase().trim();
    const linked=linkedBusiness(p.businessNumber,p),facts=linked.summary?.profile||{};
    if(q&&![linked.displayName,linked.publicName,p.businessNumber,formatBusinessNumber(p.businessNumber),facts.address,facts.industry,facts.businessCategory,...(p.tags||[])].filter(Boolean).join(' ').toLowerCase().includes(q))return false;
    if(ui.partnerInsight!=='all'){
      const model=insightModel(p.businessNumber,p.lastCheck);
      if(ui.partnerInsight==='refresh'&&!model.status.needsRefresh)return false;
      if(ui.partnerInsight==='linked'&&!model.profile.fields.length)return false;
      if(ui.partnerInsight==='conflict'&&!model.conflicts.length)return false;
      if(ui.partnerInsight==='missing'&&!model.profile.missing.length)return false;
    }
    if(ui.partnerStatus==='all')return true;
    if(ui.partnerStatus==='unchecked')return !p.lastSuccess;
    if(ui.partnerStatus==='error')return p.lastCheck&&['error','not_configured','not_found'].includes(p.lastCheck.outcome);
    return p.lastCheck?.outcome==='ok'&&p.lastCheck.businessStatus===ui.partnerStatus;
  });
}
function partnersView() {
  const rows=filteredPartners();
  return pageHeading('함께하는 거래처를 한눈에','확인한 사실은 남기고, 달라진 정보는 다시 살펴보세요.',`<div class="button-row"><button class="button" data-action="import">${icon('upload')} CSV 가져오기</button><button class="button primary" data-action="add-partner">${icon('plus')} 거래처 등록</button></div>`)+`
  <div class="callout">${icon('shield')}<span>${authState.user?'거래처·메모·확인 기록을 <strong>내 계정에 저장</strong>합니다. 같은 계정으로 다른 기기에서도 이어서 확인하세요.':'거래처·메모·확인 기록은 <strong>이 기기에 저장</strong>합니다. 로그인하면 계정으로 가져와 다른 기기에서도 사용할 수 있습니다.'}</span></div>
  ${portfolioView()}
  ${ui.partnerInsight!=='all'?`<div class="active-insight-filter"><strong>${esc(({refresh:'상태 재확인',linked:'공개정보 연결',conflict:'출처별 차이',missing:'기본정보 보강'})[ui.partnerInsight])}</strong> 거래처를 보고 있습니다.<button class="text-button" data-action="insight-filter" data-filter="all">필터 해제 ×</button></div>`:''}
  <div class="toolbar"><div class="filter-group"><div class="input-wrap">${icon('search')}<input id="partner-search" placeholder="상호, 사업자번호, 주소, 업종, 태그 검색" value="${esc(ui.partnerQuery)}" aria-label="거래처 검색"></div><select id="partner-status" class="filter-select" aria-label="거래처 상태 필터"><option value="all">모든 상태</option>${[['active','계속사업자'],['suspended','휴업자'],['closed','폐업자'],['unchecked','확인 전'],['error','미확인·조회 실패']].map(([v,t])=>`<option value="${v}" ${ui.partnerStatus===v?'selected':''}>${t}</option>`).join('')}</select></div><div class="button-row"><button class="button small" data-action="export-csv" ${!workspace.partners.length?'disabled':''}>${icon('download')} CSV</button><button class="button small" data-action="import">${icon('upload')} 가져오기</button><button class="button light small" data-action="add-partner">${icon('plus')} 등록</button></div></div>
  ${selected.size?`<div class="selected-bar"><span>${selected.size}곳 선택</span><div class="button-row"><button class="button primary small" data-action="batch-check" data-scope="selected" ${ui.batchBusy?'disabled':''}>${icon('refresh')} 선택 거래처 확인</button><button class="text-button" data-action="deselect">선택 해제</button></div></div>`:''}
  ${ui.batchBusy?`<div class="callout"><span class="spinner"></span><div style="flex:1">상태 확인 중 · ${ui.batchDone}/${ui.batchTotal}곳<div class="progress-strip"><span style="width:${ui.batchTotal?ui.batchDone/ui.batchTotal*100:0}%"></span></div></div></div>`:''}
  <section class="card"><div class="card-header"><h2>거래처 목록 <span class="pill-label" style="margin-left:6px">${number(rows.length)}</span></h2><button class="text-button" data-action="batch-check" data-scope="all" ${ui.batchBusy||!workspace.partners.length?'disabled':''}>${icon('refresh')} 전체 상태 확인</button></div>${rows.length?partnerTable(rows):empty('folder',workspace.partners.length?'검색 결과가 없어요':'관리할 거래처를 등록하세요',workspace.partners.length?'다른 업체명이나 상태로 검색해 보세요.':'직접 입력하거나 CSV에서 여러 거래처를 한 번에 가져올 수 있어요.',`<button class="button light small" data-action="add-partner">${icon('plus')} 거래처 등록</button>`)}</section>
  <div class="toolbar"><p class="fine-print">전체 ${number(workspace.partners.length)}곳 · 한 번에 최대 100개씩 조회합니다.<br>실패한 조회가 기존 성공 기록이나 사업자 상태를 덮어쓰지 않습니다.</p><div class="button-row"><button class="button small" data-action="backup">${icon('download')} 전체 백업</button><button class="button small" data-action="restore-open">${icon('upload')} 백업 복원</button></div></div>`;
}
function programRows() {
  let result;
  try {result=rankPrograms(programs,workspace.profile,{query:ui.programQuery,category:ui.programCategory,openOnly:ui.openOnly});}
  catch {result=programs.map(p=>({program:p,assessment:'unknown',reasons:[],missing:['원문 신청조건 확인']}));}
  return result;
}
function programsView() {
  const ranked=programRows();
  const pageCount=Math.max(1,Math.ceil(ranked.length/12));
  ui.page=Math.min(ui.page,pageCount);
  const show=ranked.slice((ui.page-1)*12,ui.page*12);
  const categories=['금융','창업','기술','경영','수출','인력','내수'];
  return pageHeading('내 사업의 다음 기회','공개 공고에서 관련 사업을 찾고, 원문으로 신청조건을 확인하세요.',`<div class="button-row"><a class="button" href="./#profile" data-nav="profile">${icon('edit')} 내 사업 프로필</a></div>`)+`
  <div class="callout">${icon('spark')}<div>${workspace.profile.region||workspace.profile.industry?`<strong>${esc([workspace.profile.region,workspace.profile.industry].filter(Boolean).join(' · '))}</strong> 프로필을 바탕으로 관련 공고를 먼저 보여드려요.`:'<strong>내 사업 프로필</strong>을 입력하면 지역·관심 분야를 참고해 공고를 정렬해요.'}<br><span class="fine-print">지역·키워드의 관련성만으로 지원 자격을 확정하지 않습니다. 매출·업력·제외조건은 원문 확인이 필요합니다.</span></div></div>
  <div class="toolbar"><div class="input-wrap" style="max-width:550px">${icon('search')}<input id="program-search" placeholder="공고명, 기관명, 관심 키워드 검색" value="${esc(ui.programQuery)}" aria-label="지원사업 검색"></div><label class="check-control"><input type="checkbox" id="open-only" ${ui.openOnly?'checked':''}> 종료일이 지난 공고 제외</label></div>
  <div class="tab-bar"><button class="tab-chip ${!ui.programCategory?'active':''}" data-action="category" data-category="">전체 분야</button>${categories.map(c=>`<button class="tab-chip ${ui.programCategory===c?'active':''}" data-action="category" data-category="${c}">${c}</button>`).join('')}</div>
  <div class="section-row"><h2 class="section-title">관련 공고 <span class="pill-label">${number(ranked.length)}</span></h2><button class="text-button" data-action="reload-programs">${icon('refresh')} 새로고침</button></div>
  ${programLoading?'<div class="results-grid"><div class="skeleton"></div><div class="skeleton"></div></div>':programError?`<div class="callout warning">${icon('info')}<span>${esc(programError)}</span></div>`:''}
  ${!programLoading&&!show.length?`<div class="card">${empty('spark',programs.length?'조건에 맞는 공고가 없어요':'지원사업 데이터를 준비하고 있어요',programs.length?'검색어·분야를 변경하거나 종료 공고도 함께 확인해 보세요.':'수집된 공고가 없거나 지금 연결하지 못했습니다.<br>지원한눈에서 공개 공고를 먼저 확인할 수 있어요.',external('https://softm.github.io/softm.policyfundfinder/','지원한눈 열기','button light small'))}</div>`:`<div class="results-grid">${show.map(programCard).join('')}</div>`}
  ${pageCount>1?`<div class="pagination"><button class="button small" data-action="prev-page" ${ui.page===1?'disabled':''}>이전</button><span>${ui.page} / ${pageCount}</span><button class="button small" data-action="next-page" ${ui.page===pageCount?'disabled':''}>다음</button></div>`:''}
  <p class="source-info-line">지원한눈 공개 공고 목록 연계 · ${esc(fmtTime(programMeta.collectedAt||programMeta.generatedAt||programMeta.lastSuccessfulAt||collection.lastSuccessAt))}<br>${programMeta.partial?`원천 ${number(programMeta.sourceCount)}건 중 미종료·게시일 기준 최대 ${number(programMeta.selectionLimit)}건을 연결했습니다. `:''}신청 일정과 원문은 제공기관 기준입니다. <a href="./data-status.html">수집 범위·기준일 보기</a></p>`;
}
function programCard(item) {
  const p=item.program;
  const label=item.assessment==='candidate'?'관련 공고':item.assessment==='mismatch'?'조건 재확인':'추가 확인 필요';
  const tone=item.assessment==='candidate'?'positive':'neutral';
  const reasons=Array.isArray(item.reasons)?item.reasons.slice(0,2).map(x=>typeof x==='string'?x:x.message||x.label||'조건 확인'):['원문 신청조건을 확인하세요.'];
  return `<article class="card program-card"><div class="program-top"><span class="program-source">${esc(p.agency||p.source||'지원기관 확인')}</span><span class="badge ${tone}">${label}</span></div><h3>${esc(p.title)}</h3><div class="program-meta"><span>${icon('location')}${esc(regionSummary(p.regions))}</span><span>${icon('tag')}${esc((p.categories||[]).slice(0,2).join(' · ')||'분야 원문 확인')}</span></div><div class="program-reasons">${esc(reasons.join(' · ')||'원문에서 업력·규모·제외조건을 확인해 주세요.')}</div><div class="program-bottom"><span class="deadline">${icon('calendar')} ${p.endDate?esc(fmtDate(p.endDate))+' 마감':'마감일 원문 확인'}</span><button class="text-button" data-action="program-detail" data-id="${esc(p.id)}">조건·원문 보기 ${icon('arrow')}</button></div></article>`;
}
function profileView() {
  const p=ui.profileDraft||workspace.profile;
  return pageHeading('내 사업을 알려주세요','공개정보로 채워지지 않는 항목을 보완하면, 기회를 찾기 쉬워져요.')+`
  ${p.enrichment?`<div class="callout profile-evidence-note">${icon('link')}<span>공개자료에서 확인한 정보를 함께 보관합니다. 아래 값을 검토하고 프로필을 저장하세요. <button class="text-button" data-action="profile-evidence" data-business-number="${esc(p.businessNumber)}">출처 자료 ${p.enrichment.sources.length}개 확인</button></span></div>`:''}
  <div class="profile-layout"><form id="profile-form" class="card form-card">
  <div class="section-row"><h2 class="section-title">사업 프로필</h2><span class="mode-label">${authState.user?'내 계정에 저장':'이 기기에 저장'}</span></div>
  <div class="form-grid">
    <div class="form-field"><label for="profile-name">사업체명</label><input id="profile-name" name="name" maxlength="200" value="${esc(p.name||'')}" placeholder="사업체 이름"></div>
    <div class="form-field"><label for="profile-number">사업자등록번호 <span class="muted">(선택)</span></label><input id="profile-number" name="businessNumber" inputmode="numeric" maxlength="20" value="${esc(formatBusinessNumber(p.businessNumber||''))}" placeholder="000-00-00000"><span class="hint">예비창업자는 비워 두어도 됩니다.</span></div>
    <div class="form-field"><label for="profile-region">사업장 지역</label><select id="profile-region" name="region"><option value="">지역 선택</option>${regions.map(r=>`<option value="${r}" ${p.region===r?'selected':''}>${r}</option>`).join('')}</select></div>
    <div class="form-field"><label for="profile-industry">업종·주요 사업</label><input id="profile-industry" name="industry" maxlength="100" value="${esc(p.industry||'')}" placeholder="예: 소프트웨어 개발, 음식점"></div>
    <div class="form-field"><label for="profile-founded">개업일 <span class="muted">(선택)</span></label><input id="profile-founded" type="date" name="foundedAt" value="${esc(p.foundedAt||'')}" max="${new Date().toISOString().slice(0,10)}"><span class="hint">공고의 업력 기준일은 별도로 확인해야 합니다.</span></div>
    <div class="form-field"><label for="profile-kind">사업자 유형</label><select id="profile-kind" name="businessKind"><option value="">선택 안 함</option>${['개인사업자','법인사업자','예비창업자'].map(t=>`<option ${p.businessKind===t?'selected':''}>${t}</option>`).join('')}</select></div>
    <div class="form-field"><label for="profile-employees">상시근로자 수 <span class="muted">(명, 선택)</span></label><input id="profile-employees" name="employees" type="number" min="0" step="1" max="10000000" value="${esc(p.employees??'')}" placeholder="미입력은 미확인으로 처리"></div>
    <div class="form-field"><label for="profile-revenue">연 매출 <span class="muted">(만원, 선택)</span></label><input id="profile-revenue" name="revenue" type="number" min="0" max="9007199254740991" step="1" value="${esc(p.revenue??'')}" placeholder="해당 연도 매출액"></div>
    <div class="form-field"><label for="profile-revenue-year">매출 기준연도</label><input id="profile-revenue-year" name="revenueYear" type="number" min="1900" max="2100" value="${esc(p.revenueYear??'')}" placeholder="예: 2025"></div>
    <div class="form-field full-span"><label>관심 지원 분야</label><div class="chip-list">${['금융','창업','기술','경영','수출','인력','내수'].map(c=>`<label class="check-control" style="padding:6px 10px;border:1px solid var(--line);border-radius:7px"><input name="interests" type="checkbox" value="${c}" ${(p.interests||[]).includes(c)?'checked':''}>${c}</label>`).join('')}</div></div>
  </div><div class="divider"></div><p class="fine-print">입력값은 사용자 제공 정보로 보관합니다. 번호를 입력해도 해당 사업자의 대표자 인증이 되지는 않습니다.</p><div class="modal-actions"><button class="button primary" type="submit">${icon('check')} 프로필 저장</button></div>
  </form><aside><section class="card guide-card"><h2 class="section-title">프로필로 할 수 있는 일</h2><div class="guide-step"><span class="step-number">01</span><div><h3>지역에 관련된 공고 찾기</h3><p>사업장 소재지와 공고에 기재된 지역을 참고합니다. 지역은 지원 대상이 아닌 수행지역일 수도 있어 원문을 함께 확인해요.</p></div></div><div class="guide-step"><span class="step-number">02</span><div><h3>관심 분야 먼저 보기</h3><p>창업·기술·금융 등 내게 필요한 분야의 관련 공고를 먼저 탐색하세요.</p></div></div><div class="guide-step"><span class="step-number">03</span><div><h3>부족한 조건 확인</h3><p>미입력 값은 0이나 조건 충족으로 바꾸지 않습니다. 공고별로 추가 확인이 필요한 내용을 표시해요.</p></div></div></section><div class="callout" style="margin-top:17px">${icon('shield')}<span>매출·인원 정보는 지원사업 탐색에 사용합니다. 로그인 후 저장하면 내 계정에 보관하며, 조회 기관에는 전송하지 않습니다.</span></div></aside></div>`;
}
function historyView() {
  return pageHeading('달라진 정보를 놓치지 않도록','성공한 조회끼리 비교한 상태 변화와 일괄 확인 기록을 모았어요.',`<div class="button-row"><button class="button" data-action="acknowledge-all" ${!workspace.events.some(e=>!e.acknowledgedAt)?'disabled':''}>${icon('check')} 모두 확인함</button></div>`)+`
  <div class="content-grid"><section class="card"><div class="card-header"><h2>상태 변화 <span class="pill-label">${number(workspace.events.length)}</span></h2></div>
    ${workspace.events.length?`<div class="timeline">${workspace.events.slice(0,100).map(e=>`<article class="timeline-item"><span class="timeline-icon">${icon('bell')}</span><div class="timeline-content"><h3>${esc(linkedBusiness(e.businessNumber,byId(e.partnerId)).displayName)} · ${esc(e.title||'사업자 상태 변경')}</h3><p>${esc(e.message||(statusNames[e.from]||e.from)+' → '+(statusNames[e.to]||e.to))}</p><div style="margin-top:7px">${e.acknowledgedAt?'<span class="badge neutral">확인함</span>':`<button class="text-button" data-action="acknowledge" data-id="${esc(e.id)}">${icon('check')} 확인함</button>`}</div></div><span class="timeline-date">${esc(fmtTime(e.occurredAt))}</span></article>`).join('')}</div>`:empty('clock','확인된 상태 변화가 없어요','거래처를 두 번 이상 정상 조회하면<br>이전 성공 결과와 달라진 상태가 이곳에 표시됩니다.')}
    <div class="card-foot">알림 시각은 앱이 변화를 확인한 시각이며, 실제 변경 발생일과 다를 수 있어요.</div>
  </section><section class="card"><div class="card-header"><h2>일괄 확인 기록</h2></div>${workspace.checks.length?`<div class="timeline">${workspace.checks.slice(0,15).map(c=>`<div class="timeline-item"><span class="timeline-icon">${icon('check')}</span><div class="timeline-content"><h3>${number(c.total)}곳 상태 확인</h3><p>응답 확인 ${number(c.ok)} · 미확인/실패 ${number(c.failed)}<br>${esc(fmtTime(c.checkedAt))}</p></div></div>`).join('')}</div>`:empty('file','첫 확인 기록을 기다리고 있어요','거래처 관리에서 전체 또는 선택한 거래처의 상태를 확인해 보세요.',`<a class="button light small" href="./#partners" data-nav="partners">거래처 관리</a>`)}</section></div>`;
}
function publicCollectionView() {
  return renderCollectionDashboard([...publicRecords.values()],publicMeta,{loading:publicIndexLoading,error:publicIndexError});
}

function dataView() {
  const nts=health?.providers?.nts;
  const sync=accountStorageStatus();
  const collectedStatuses=[...publicRecords.values()].flatMap(record=>record.collection?.sourceStatuses||[]);
  const providerState=(names)=>{
    const results=collectedStatuses.filter(result=>names.includes(result.provider));
    if(results.some(result=>result.status==='success'))return {value:'수집 결과 있음',tone:'positive'};
    if(results.some(result=>result.status==='not_found'))return {value:'조회 완료 · 일치 결과 없음',tone:'neutral'};
    if(results.some(result=>['error','partial','identity_mismatch'].includes(result.status)))return {value:'최근 수집 기록 확인',tone:'warning'};
    return {value:results.length?'연동 설정 필요':publicIndexLoading?'수집 기록 확인 중':'수집 기록 없음',tone:'neutral'};
  };
  const rows=[
    {name:'국세청 · 사업자등록정보',description:'계속·휴업·폐업 상태, 과세유형, 입력 등록정보 진위 대조',url:'https://www.data.go.kr/data/15081808/openapi.do',value:nts?.configured?'연결 설정됨':health?'인증키 설정 필요':'서버 연결 확인 필요',tone:nts?.configured?'positive':'neutral'},
    {name:'공정거래위원회 · 통신판매업',description:'사업자번호가 정확히 일치하는 공개 등록정보 · 정기 수집',url:'https://www.data.go.kr/data/15126315/openapi.do',...providerState(['ftc'])},
    {name:'근로복지공단 · 고용·산재보험',description:'사업장명·주소·보험 기준 인원과 성립일 · 정기 수집',url:'https://www.data.go.kr/data/15059256/openapi.do',...providerState(['comwel'])},
    {name:'OpenDART · 기업개황',description:'공시 대상 기업의 회사 정보 · 응답 사업자번호 대조',url:'https://opendart.fss.or.kr/guide/detail.do?apiGrpCd=DS001&apiId=2019002',...providerState(['dart'])},
    {name:'금융위원회 · 기업기본정보',description:'법인 기본정보 · 상호 검색 후 사업자번호 대조',url:'https://www.data.go.kr/data/15043184/openapi.do',...providerState(['fsc'])},
    {name:'네이버 검색 · 뉴스·블로그·지역',description:'상호 기반 공개 검색 결과 · 확인 후보로 보관',url:'https://developers.naver.com/docs/serviceapi/search/local/local.md',...providerState(['naver_news','naver_blog','naver_local'])},
    {name:'카카오 로컬 · 장소 검색',description:'상호·주소·업무 전화 등 장소 후보 · 사업자 동일성 추가 확인',url:'https://developers.kakao.com/docs/latest/ko/local/dev-guide',...providerState(['kakao_local'])},
    {name:'지원한눈 · 공개 지원사업 목록',description:'기존 공개 공고의 제목·지역·분야·일정·원문 링크 연결',url:'https://softm.github.io/softm.policyfundfinder/',value:programLoading?'불러오는 중':programs.length?number(programs.length)+'건':'수집 결과 없음',tone:programs.length?'positive':'neutral'}
  ];
  return pageHeading('데이터는 투명하게, 판단은 정확하게','실제 연결 상태와 수집 결과, 데이터의 출처·기준일을 확인하세요.',`<div class="button-row"><button class="button" data-action="refresh-health">${icon('refresh')} 상태 새로고침</button></div>`)+`
  <div class="callout">${icon('info')}<span>API 설정 여부와 실제 조회 성공은 다릅니다. 개별 사업자 화면에는 <strong>조회 응답·출처·조회시각</strong>을 함께 표시합니다.</span></div>
  <div class="callout collection-highlight">${icon('clock')}<span><strong>국세청 조회: 조회 버튼을 누를 때 확인</strong><br>원천 정보 갱신은 30분 주기이며 신규 개업자는 1~2일이 걸릴 수 있습니다. 앱의 최근 조회시각과 구분해 확인하세요.</span></div>
  ${publicCollectionView()}
  <div class="section-spacer source-list">${rows.map(r=>`<section class="card source-card"><div><h3>${r.name}</h3><p>${r.description}</p></div><div class="source-status"><span class="badge ${r.tone} dot">${r.value}</span>${external(r.url,'출처','button small')}</div></section>`).join('')}</div>
  <section class="card source-card section-spacer"><div><h3>Firebase · 계정 보관</h3><p>${esc(sync.message)}</p>${authState.user&&cloudReady&&workspace.updatedAt?`<p>마지막 서버 확인 · ${esc(fmtTime(workspace.updatedAt))}</p>`:''}</div><div class="source-status"><span class="badge ${sync.tone} dot">${esc(sync.label)}</span><a class="button small" href="./#account" data-nav="account">계정 확인</a></div></section>
  <div class="content-grid section-spacer"><section class="card"><div class="card-header"><h2>지원사업 수집 결과</h2><span class="pill-label">실제 파일 기준</span></div><table class="status-table"><tbody>
    <tr><td>불러온 공고</td><td>${number(programs.length)}건</td></tr>
    <tr class="collection-highlight"><td>자동 수집 주기</td><td><strong>매일 06:17 · 한국시간</strong></td></tr>
    <tr class="collection-highlight"><td>마지막 성공 수집</td><td><strong>${esc(fmtTime(collection.lastSuccessAt||programMeta.collectedAt||programMeta.generatedAt||programMeta.lastSuccessfulAt))}</strong></td></tr>
    <tr><td>원천 목록 갱신</td><td>${esc(fmtTime(collection.upstreamLastSuccessAt||programMeta.upstreamLastSuccessAt))}</td></tr>
    ${collection.upstreamSources?.bizinfo?.lastSuccessAt?`<tr><td>기업마당 원천 기준</td><td>${esc(fmtTime(collection.upstreamSources.bizinfo.lastSuccessAt))}</td></tr>`:''}
    <tr><td>마지막 수집 시도</td><td>${esc(fmtTime(collection.lastAttemptAt||collection.attemptedAt))}</td></tr>
    <tr><td>수집 상태</td><td>${esc(({success:'수집 완료',failed:'최근 수집 실패',not_collected:'미수집'})[collection.status||programMeta.status]||(programs.length?'자료 불러옴':'미수집'))}</td></tr>
    <tr><td>원천 목록 수</td><td>${number(collection.sourceCount||collection.inputCount||programMeta.sourceCount||programs.length)}건</td></tr>
    <tr><td>연결 범위</td><td>${esc(collection.selectionPolicy||programMeta.selectionPolicy||'수집 상태 확인 필요')}${collection.selectionLimit?` · 최대 ${number(collection.selectionLimit)}건`:''}</td></tr>
    <tr><td>제외·누락</td><td>${number(collection.excludedCount||collection.skippedCount||0)}건 · ${esc(collection.message||'수집 상세는 상태 JSON에서 확인')}</td></tr>
  </tbody></table><div class="card-foot"><a class="text-button" href="./data/collection-status.json" target="_blank" rel="noopener">수집 상태 JSON 보기 ${icon('external')}</a></div></section>
  <section class="card guide-card"><h2 class="section-title">조회 연결</h2><p class="fine-print" style="margin-top:10px">현재 연결 주소</p><p class="mono" style="overflow-wrap:anywhere;margin:8px 0 13px">${esc(window.BIZHANNUN_CONFIG?.mode==='direct'?'브라우저 → 제공기관 직접 호출':currentApiBase()||location.origin+' (동일 서버)')}</p>${healthError?`<div class="callout warning" style="margin-bottom:14px">${icon('info')}<span>${esc(healthError)}</span></div>`:''}<div class="button-row">${window.BIZHANNUN_CONFIG?.mode==='direct'?'':'<button class="button small" data-action="connection-settings">서버 주소 설정</button>'}<button class="button small" data-action="refresh-health">${icon('refresh')} 상태 확인</button></div><p class="fine-print" style="margin-top:13px">${window.BIZHANNUN_CONFIG?.mode==='direct'?'국세청은 브라우저에서 직접 조회합니다. 인증키는 GitHub Secret에서 배포 시 주입하며, 배포된 앱과 요청에서는 확인할 수 있습니다.':'API 인증키는 서버 환경변수에 보관합니다.'}</p><div class="divider"></div><h3 style="font-size:12px">앞으로 연결할 데이터</h3><p class="fine-print" style="margin-top:8px">기업개황·뉴스·블로그·장소 검색은 출처별 실행 결과를 위 표에 표시합니다. 국민연금·공개 재무제표·업종별 인허가는 후속 연계 대상입니다.</p></section></div>`;
}


function describeFocus(element) {
  if(!element||element===document.body)return null;
  return {id:element.id,action:element.dataset?.action,itemId:element.dataset?.id,
    tab:element.dataset?.tab,bno:element.dataset?.bno,nav:element.dataset?.nav,
    start:'selectionStart' in element?element.selectionStart:null,
    end:'selectionEnd' in element?element.selectionEnd:null,
    direction:'selectionDirection' in element?element.selectionDirection:null};
}
function resolveFocus(root,descriptor) {
  if(!descriptor)return null;
  if(descriptor.id){const found=root.querySelector('#'+CSS.escape(descriptor.id));if(found)return found;}
  if(descriptor.action)return [...root.querySelectorAll('[data-action]')].find(element=>
    element.dataset.action===descriptor.action&&element.dataset.id===descriptor.itemId&&
    element.dataset.tab===descriptor.tab&&element.dataset.bno===descriptor.bno)||null;
  if(descriptor.nav)return [...root.querySelectorAll('[data-nav]')].find(element=>element.dataset.nav===descriptor.nav)||null;
  return null;
}
function captureDetailDraft() {
  const state=modal?.detailState;
  if(!state)return null;
  const note=modalRoot.querySelector('#detail-note'),tags=modalRoot.querySelector('#detail-tags');
  if(note&&tags)state.draft={note:note.value,tags:tags.value};
  state.dirty=!sameNoteDraft(state.draft,state.baseline);
  if(state.dirty)detailDrafts.set(modal.detailId,{draft:{...state.draft},baseline:{...state.baseline}});
  else detailDrafts.delete(modal.detailId);
  return state;
}
function beginModal() {
  captureDetailDraft();
  if(!modal){
    previousFocus=document.activeElement;previousFocusDescriptor=describeFocus(previousFocus);
    previousBodyOverflow=document.body.style.overflow;backgroundWasInert=app.inert;
  }
  app.inert=true;document.body.style.overflow='hidden';
}
function openModal(title,body,wide=false) {
  interactionEpoch++;beginModal();
  modal={title,body,wide};
  modalRoot.innerHTML=`<div class="modal-backdrop" data-action="close-modal-backdrop"><section class="modal ${wide?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><h2 id="modal-title" tabindex="-1">${esc(title)}</h2><button class="icon-button" data-action="close-modal" aria-label="창 닫기">${icon('x')}</button></header><div class="modal-body">${body}</div></section></div>`;
  const activeModal=modal;
  setTimeout(()=>{if(modal===activeModal)(modalRoot.querySelector('input:not([type=hidden]),textarea,select')||modalRoot.querySelector('#modal-title'))?.focus({preventScroll:true});},0);
}
function closeModal({discardDraft=false,quiet=false}={}) {
  if(!modal)return;
  const state=discardDraft?null:captureDetailDraft();
  if(discardDraft&&modal?.detailId)detailDrafts.delete(modal.detailId);
  interactionEpoch++;modal=null;modalRoot.replaceChildren();
  document.body.style.overflow=previousBodyOverflow;app.inert=backgroundWasInert;
  const target=previousFocus?.isConnected?previousFocus:resolveFocus(app,previousFocusDescriptor)||document.getElementById('main-content');
  target?.focus({preventScroll:true});
  if(state?.dirty&&!quiet)toast('작성 중인 메모를 임시 보관했습니다. 거래처를 다시 열어 저장해 주세요.');
}

function partnerModal(partner,seed={}) {
  const base=partner||{...seed,name:seed.name||''};
  const record=base.businessNumber&&isValidBusinessNumber(base.businessNumber)?businessRecord(base.businessNumber):null;
  const p=record?attachPartnerEnrichment(base,record):base;
  openModal(partner?'거래처 정보 수정':'새 거래처 등록',`<form id="partner-form" data-id="${esc(partner?.id||'')}">${p.enrichment?`<div class="callout partner-evidence-note">상호·주소 등 공개정보 ${summarizeEnrichment(p.enrichment).fieldCount}항목을 출처와 함께 저장합니다. 메모는 별도로 유지합니다.</div>`:''}<div class="form-grid">
  <div class="form-field full-span"><label for="partner-number">사업자등록번호 <span class="muted">(필수)</span></label><input id="partner-number" name="businessNumber" inputmode="numeric" maxlength="20" required value="${esc(formatBusinessNumber(p.businessNumber||''))}" ${partner?'readonly':''} placeholder="000-00-00000"><span class="hint">번호 형식 검사는 국세청 상태 조회나 본인 인증과 다릅니다.</span></div>
  <div class="form-field full-span"><label for="partner-name">업체명</label><input id="partner-name" name="name" maxlength="200" value="${esc(p.name||'')}" placeholder="공개자료 또는 서류에서 확인한 이름"><span class="hint">${p.nameOrigin?.kind==='public'?'사업자번호에 연결된 공개 상호입니다. 수정하면 사용자 입력 이름으로 보관합니다.':'직접 입력한 이름은 사용자 제공 정보로 저장합니다.'}</span></div>
  <div class="form-field full-span"><label for="partner-tags">태그</label><input id="partner-tags" name="tags" maxlength="500" value="${esc((p.tags||[]).join(', '))}" placeholder="예: 정기 거래, 납품, 확인 필요"></div>
  <div class="form-field full-span"><label for="partner-note">메모</label><textarea id="partner-note" name="note" maxlength="5000" placeholder="다음에 확인할 내용이나 거래처 관련 메모">${esc(p.note||'')}</textarea></div></div><div id="partner-form-error" class="field-error" role="alert"></div><div class="modal-actions">${partner?`<button class="button danger" type="button" data-action="delete-confirm" data-id="${esc(partner.id)}">${icon('trash')} 삭제</button>`:''}<button class="button" type="button" data-action="close-modal">취소</button><button class="button primary" type="submit">${icon('check')} 저장</button></div></form>`);
  modal.prefilledName={value:p.name||'',automatic:p.nameOrigin?.kind==='public'};
}

function openProfileEvidence(value) {
  const bno=normalizeBusinessNumber(value);
  if(!isValidBusinessNumber(bno))return;
  const record=businessRecord(bno),p=ui.profileDraft||workspace.profile;
  if(!record)return;
  const connected=derivePartnerProfile({businessNumber:bno,name:p.name||'',enrichment:record});
  const body=renderEnrichment({businessNumber:bno,record:connected.record,summary:connected.summary,name:connected.name,compact:true});
  if(modal?.profileEvidence&&modal.businessNumber===bno){
    const target=modalRoot.querySelector('.modal-body');
    if(target){const scroll=target.scrollTop;target.innerHTML=body;target.scrollTop=scroll;modal.body=body;}
  }else openModal('내 사업 공개자료 출처',body,true);
  modal.profileEvidence=true;modal.businessNumber=bno;
}
function detailArguments(partner) {
  const state=modal?.detailState;
  return {partner,linked:linkedBusiness(partner.businessNumber,partner),
    insights:insightModel(partner.businessNumber,partner.lastCheck),
    publicHtml:businessInformation(partner.businessNumber),
    changes:evidenceChanges(partner.enrichment,publicRecords.get(partner.businessNumber)),
    storageLabel:authState.user?'내 계정 · '+userLabel():'이 브라우저',
    activeTab:state?.tab||'overview',draft:state?.draft||editorNoteDraft(partner),
    historyFilter:state?.historyFilter||'all',historyPeriod:state?.historyPeriod||'all',
    historySort:state?.historySort||'newest',historyNow:state?.historyNow,
    busy:!!(state?.saving||state?.refreshing||saving||ui.batchBusy||authBusy()),
    activity:state?.saving||saving?'saving':state?.refreshing||ui.batchBusy?'refreshing':authBusy()?'connecting':null,
    notice:state?.notice||(state?.dirty?'저장하지 않은 변경사항이 있습니다.':''),error:state?.error||''};
}
function detailModal(partner,{refresh=false}={}) {
  if(!partner)return;
  const same=refresh&&modal?.detailId===partner.id;
  if(same){
    captureDetailDraft();
    if(modal.detailState.composing){modal.detailState.renderPending=true;return;}
  }else{
    interactionEpoch++;beginModal();
    const cached=detailDrafts.get(partner.id),baseline=editorNoteDraft(partner);
    const draft=cached?.draft||baseline;
    modal={detailId:partner.id,wide:true,detailState:{tab:'overview',draft:{...draft},baseline,
      dirty:!sameNoteDraft(draft,baseline),saving:false,refreshing:false,composing:false,renderPending:false,
      historyFilter:'all',historyPeriod:'all',historySort:'newest',historyNow:new Date().toISOString(),
      tabScroll:{},notice:cached?'이전에 작성하던 메모 초안을 불러왔습니다. 저장하면 반영됩니다.':'',error:''}};
  }
  const state=modal.detailState;
  state.historyNow=new Date().toISOString();
  const focus=modalRoot.contains(document.activeElement)?describeFocus(document.activeElement):null;
  const scroll=modalRoot.querySelector('.modal-body')?.scrollTop||0;
  const tabBarScroll=modalRoot.querySelector('.detail-tabs')?.scrollLeft||0;
  const expanded=[...modalRoot.querySelectorAll('details[open]')].map(item=>item.querySelector('summary')?.textContent);
  const view=renderBusinessDetail(detailArguments(partner));
  modal.title=view.title;modal.body=view.body;state.renderPending=false;
  modalRoot.innerHTML=`<div class="modal-backdrop" data-action="close-modal-backdrop"><section class="modal wide partner-detail-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-business-number="${esc(partner.businessNumber)}"><header class="modal-header">${view.header}</header>${view.tabs}<div class="modal-body">${view.body}</div>${view.footer}</section></div>`;
  for(const item of modalRoot.querySelectorAll('details'))if(expanded.includes(item.querySelector('summary')?.textContent))item.open=true;
  if(same){
    modalRoot.querySelector('.detail-tabs').scrollLeft=tabBarScroll;
    const target=resolveFocus(modalRoot,focus);
    if(target&&!target.disabled&&!target.closest('[hidden]')){
      target.focus({preventScroll:true});
      if(focus.start!==null)try{target.setSelectionRange(focus.start,focus.end,focus.direction||'none');}catch{}
    }else if(focus)modalRoot.querySelector('#modal-title')?.focus({preventScroll:true});
    modalRoot.querySelector('.modal-body').scrollTop=scroll;
  }else modalRoot.querySelector('#modal-title')?.focus({preventScroll:true});
}
function switchDetailTab(tab,{focus=false,editor=false}={}) {
  if(!modal?.detailState||!['overview','tax','history','sources','notes'].includes(tab))return;
  const state=captureDetailDraft(),body=modalRoot.querySelector('.modal-body');
  state.tabScroll[state.tab]=body.scrollTop;state.tab=tab;
  for(const button of modalRoot.querySelectorAll('[role=tab]')){
    const selected=button.dataset.tab===tab;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;
  }
  for(const panel of modalRoot.querySelectorAll('[role=tabpanel]'))panel.hidden=panel.id!=='detail-panel-'+tab;
  body.scrollTop=state.tabScroll[tab]||0;
  if(editor)modalRoot.querySelector('#detail-note')?.focus({preventScroll:true});
  else if(focus||document.activeElement?.closest('[role=tabpanel][hidden]'))modalRoot.querySelector('#detail-tab-'+tab)?.focus({preventScroll:true});
  modalRoot.querySelector('#detail-tab-'+tab)?.scrollIntoView({block:'nearest',inline:'nearest'});
}
function updateDetailHistory({filter,period,sort},{reset=false}={}) {
  const partner=byId(modal?.detailId),state=modal?.detailState;
  if(!partner||!state)return;
  if(filter!==undefined&&!['all','status','tax','issues'].includes(filter))return;
  if(period!==undefined&&!['all','30','90','365'].includes(period))return;
  if(sort!==undefined&&!['newest','oldest'].includes(sort))return;
  if(filter!==undefined)state.historyFilter=filter;
  if(period!==undefined)state.historyPeriod=period;
  if(sort!==undefined)state.historySort=sort;
  detailModal(partner,{refresh:true});
  if(reset)modalRoot.querySelector('#detail-history-filter-all')?.focus({preventScroll:true});
}
async function saveDetailNotes(form) {
  const activeModal=modal,epoch=accountEpoch;
  if(!activeModal?.detailState)return;
  const state=captureDetailDraft(),partner=byId(activeModal.detailId);
  if(!partner||state.saving||state.refreshing||saving||ui.batchBusy||authBusy())return;
  let next;
  const submitted={...state.draft};
  try{next=applyNoteDraft(partner,submitted,new Date().toISOString());}
  catch(error){state.error=error.message;state.notice='';detailModal(partner,{refresh:true});return;}
  state.saving=true;state.error='';state.notice='저장 완료 응답을 기다리고 있습니다.';
  detailModal(partner,{refresh:true});
  const ok=await persist({...workspace,partners:workspace.partners.map(item=>item.id===partner.id?next:item)});
  if(epoch!==accountEpoch)return;
  if(ok&&sameNoteDraft(detailDrafts.get(partner.id)?.draft,submitted))detailDrafts.delete(partner.id);
  if(modal!==activeModal){
    if(ok&&modal?.detailId===partner.id){
      const current=captureDetailDraft(),latest=byId(partner.id);
      if(latest){
        current.baseline=editorNoteDraft(latest);
        if(sameNoteDraft(current.draft,submitted)){
          current.draft={...current.baseline};
          modalRoot.querySelector('#detail-note').value=current.draft.note;
          modalRoot.querySelector('#detail-tags').value=current.draft.tags;
          current.notice='메모와 태그를 저장했습니다.';
        }
        detailModal(latest,{refresh:true});
      }
    }
    return;
  }
  state.saving=false;
  const latest=byId(partner.id);if(!latest)return;
  if(ok){
    state.baseline=editorNoteDraft(latest);
    if(sameNoteDraft(state.draft,submitted))state.draft={...state.baseline};
    state.dirty=!sameNoteDraft(state.draft,state.baseline);
    state.notice=state.dirty?'메모를 저장했습니다. 이후 변경사항은 아직 저장 전입니다.':'메모와 태그를 '+(activeUid?'계정에':'이 브라우저에')+' 저장했습니다.';
    state.error='';
    // Preserve the acknowledged text instead of recapturing the old pre-save inputs.
    const note=modalRoot.querySelector('#detail-note'),tags=modalRoot.querySelector('#detail-tags');
    if(note)note.value=state.draft.note;if(tags)tags.value=state.draft.tags;
  }else{state.error=storageError||'저장하지 못했습니다. 작성한 내용은 유지됩니다. 다시 시도해 주세요.';state.notice='';}
  detailModal(latest,{refresh:true});
}
async function refreshDetailStatus() {
  const activeModal=modal,epoch=accountEpoch,state=captureDetailDraft();
  if(!state||state.saving||state.refreshing||saving||ui.batchBusy||authBusy())return;
  const partner=byId(activeModal.detailId);if(!partner)return;
  state.refreshing=true;state.error='';
  detailModal(partner,{refresh:true});
  try{await batchCheck([partner.id]);}
  finally{
    if(modal===activeModal&&epoch===accountEpoch){
      state.refreshing=false;
      const latest=byId(partner.id);
      if(latest)detailModal(latest,{refresh:true});
    }
  }
}
function printDetailReport(partner) {
  document.getElementById('business-detail-print-frame')?.remove();
  const frame=document.createElement('iframe');
  frame.id='business-detail-print-frame';frame.title='사업자 조회 기록 인쇄';
  frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;
  frame.setAttribute('sandbox','allow-same-origin allow-modals');
  frame.style.cssText='position:fixed;left:-10000px;top:0;width:800px;height:1000px;border:0;';
  frame.onload=()=>{
    frame.contentWindow.addEventListener('afterprint',()=>frame.remove(),{once:true});
    frame.contentWindow.print();
  };
  frame.srcdoc=buildBusinessDetailReport({...detailArguments(partner),includePrivate:false});
  document.body.append(frame);
}

let importState={text:'',parsed:null};
function importModal() {
  importState={text:'',parsed:null};
  openModal('거래처 일괄 등록',`<div class="drop-area">${icon('upload')}<h3 style="font-size:13px">CSV 파일 또는 사업자번호 목록</h3><p>최대 1,000개 · UTF-8 또는 한글 CSV · 중복번호는 한 번만 등록합니다.</p><input id="import-file" type="file" accept=".csv,.txt,text/csv,text/plain" aria-label="거래처 CSV 파일 선택"></div><div class="form-field" style="margin-top:16px"><label for="import-text">붙여넣기</label><textarea id="import-text" rows="6" placeholder="사업자번호,업체명,태그,메모&#10;또는 한 줄에 사업자번호 하나씩 입력"></textarea></div><div class="toolbar" style="margin-bottom:0"><button class="text-button" data-action="csv-template">${icon('download')} CSV 양식 다운로드</button><button class="button light small" data-action="preview-import">등록 내용 확인</button></div><div id="import-preview"></div><div class="modal-actions"><button class="button" data-action="close-modal">취소</button><button id="confirm-import" class="button primary" data-action="confirm-import" disabled>가져오기</button></div>`,true);
}
function previewImport() {
  const text=document.getElementById('import-text').value;
  importState={text,parsed:parseBusinessImport(text)};
  const parsed=importState.parsed;
  const existing=new Set(workspace.partners.map(p=>p.businessNumber));
  const fresh=parsed.rows.filter(p=>!existing.has(p.businessNumber));
  const exists=parsed.rows.length-fresh.length;
  const over=workspace.partners.length+fresh.length>1000;
  document.getElementById('import-preview').innerHTML=`<div class="callout ${parsed.errors.length||over?'warning':''}" style="margin-top:15px">${icon('info')}<span>새 거래처 <strong>${fresh.length}곳</strong> · 기존 거래처 ${exists}곳 · 파일 내 중복 ${parsed.duplicates}곳 · 오류 ${parsed.errors.length}행${over?'<br>저장할 거래처가 1,000개를 초과합니다. 파일을 나누어 관리해 주세요.':''}</span></div>${parsed.errors.length?`<ul class="error-list">${parsed.errors.map(e=>`<li>${e.row}행: ${esc(e.message)}</li>`).join('')}</ul><p class="fine-print">아래 정상 행만 등록합니다. 오류 행은 수정한 뒤 다시 가져오세요.</p>`:''}${fresh.length?`<div class="import-preview"><table><thead><tr><th>사업자번호</th><th>업체명</th><th>태그</th></tr></thead><tbody>${fresh.slice(0,20).map(p=>`<tr><td>${formatBusinessNumber(p.businessNumber)}</td><td>${esc(p.name||'미입력')}</td><td>${esc(p.tags.join(', '))}</td></tr>`).join('')}</tbody></table></div>${fresh.length>20?'<p class="fine-print">미리보기는 처음 20개입니다. 등록은 확인된 전체 정상 행에 적용됩니다.</p>':''}`:''}`;
  const confirm=document.getElementById('confirm-import');
  confirm.disabled=!fresh.length||over;
  confirm.textContent=`정상 ${fresh.length}곳 가져오기`;
}
function programModal(id) {
  const item=programRows().find(r=>r.program.id===id)||{program:programs.find(p=>p.id===id),reasons:[],missing:[]};
  const p=item.program;
  if(!p)return;
  const missing=item.missing?.length?item.missing:['공고 원문의 상세 신청자격','제외 대상 및 중복 수혜 제한','업력·매출·근로자 수의 기준일'];
  openModal('지원사업 조건 확인',`<div class="program-source">${esc(p.agency||p.source||'')}</div><h2 style="font-size:19px;margin:8px 0 15px">${esc(p.title)}</h2><div class="callout">${icon('info')}<span>공개 목록과 입력 프로필을 바탕으로 찾은 관련 공고입니다. <strong>지원 자격 충족이나 선정 가능성을 확정한 결과가 아닙니다.</strong></span></div><dl class="detail-grid"><div class="detail-fact"><dt>지역</dt><dd>${esc((p.regions||[]).join(', ')||'원문 확인')}<small>대상지역인지 수행지역인지 원문 확인</small></dd></div><div class="detail-fact"><dt>신청기간</dt><dd>${esc(p.startDate?fmtDate(p.startDate):'원문 확인')} ~ ${esc(p.endDate?fmtDate(p.endDate):'원문 확인')}</dd></div></dl><h3 style="font-size:13px;margin-top:17px">관련 정보</h3>${(item.reasons||[]).map(r=>`<div class="insight-card">${icon('check')}<p style="font-size:12px">${esc(typeof r==='string'?r:r.message||r.label)}</p></div>`).join('')||'<p class="fine-print" style="margin-top:8px">현재 프로필로 확인할 수 있는 공통 조건이 부족합니다.</p>'}<h3 style="font-size:13px;margin-top:20px">추가로 확인할 조건</h3><ul class="fine-print">${missing.map(m=>`<li>${esc(typeof m==='string'?m:m.message||m.label)}</li>`).join('')}</ul><p class="fine-print">본문을 임의로 합치거나 요약하지 않습니다. 아래 링크에서 해당 공고의 원문·첨부·최신 접수기간을 확인해 주세요.</p><div class="modal-actions">${external(p.sourceUrl||p.applyUrl,'공식 원문 확인','button primary')}<a class="button" href="./#profile" data-nav="profile">내 프로필 보완</a></div>`);
}
function connectionModal() {
  if(window.BIZHANNUN_CONFIG?.mode==='direct'){toast('브라우저에서 국세청으로 직접 조회합니다.');return;}
  openModal('조회 서버 연결',`<form id="connection-form"><div class="callout">${icon('shield')}<span>서버의 HTTPS 주소만 입력합니다. 국세청·공정위 인증키는 여기에 입력하지 마세요.</span></div><div class="form-field" style="margin-top:17px"><label for="api-base">API 서버 주소</label><input id="api-base" name="apiBase" type="url" value="${esc(currentApiBase())}" placeholder="https://api.example.com"><span class="hint">입력한 서버로 조회할 사업자번호가 전달됩니다. 본인이 운영하거나 신뢰하는 서버만 사용하세요.</span></div><div id="connection-error" class="field-error" role="alert"></div><div class="modal-actions"><button class="button" type="button" data-action="close-modal">취소</button><button class="button primary" type="submit">저장하고 연결 확인</button></div></form>`);
}
function enrichmentRequestModal(bno=ui.lookup?.businessNumber){
  if(!isValidBusinessNumber(bno))return;
  const name=linkedBusiness(bno).publicName||'';
  openModal('웹 정보 수집 요청',`<form id="enrichment-request-form"><p class="fine-print">사업자번호와 아래 입력은 공개 수집 요청으로 기록됩니다. 내부 메모·비공개 연락처는 입력하지 마세요. 운영자 계정의 요청은 자동 수집하며, 일반 요청은 운영자 확인 후 수집합니다.</p><div class="form-grid section-spacer"><div class="form-field full-span"><label for="enrich-bno">사업자등록번호</label><input id="enrich-bno" name="businessNumber" readonly value="${esc(bno)}"></div><div class="form-field full-span"><label for="enrich-name">상호</label><input id="enrich-name" name="name" maxlength="200" value="${esc(name)}"></div><div class="form-field full-span"><label for="enrich-url">수집할 공개 웹사이트 (선택)</label><input id="enrich-url" name="website" type="url" maxlength="2048" placeholder="https://회사홈페이지 또는 사업자정보 페이지"></div></div><p class="fine-print">회사소개·연락처·제품·채용·SNS 링크를 수집합니다. 접근이 제한된 페이지는 건너뛰며, 결과는 수집·배포 후 이 화면에 반영됩니다.</p><div class="modal-actions"><button class="button" type="button" data-action="close-modal">취소</button><button class="button primary" type="submit">공개 요청 작성 화면 열기 ↗</button></div></form>`);
}
function validateModal(bno=ui.lookup?.businessNumber) {
  if(!isValidBusinessNumber(bno))return;
  openModal('등록정보 진위 대조',`<form id="validate-form"><p class="fine-print">사업자등록증의 개업일과 대표자명을 국세청 입력값과 대조합니다. 대표자 본인 인증이나 문서 원본 인증 기능은 아닙니다.</p><div class="form-grid" style="margin-top:17px"><div class="form-field full-span"><label>사업자등록번호</label><input readonly name="b_no" value="${formatBusinessNumber(bno)}"></div><div class="form-field"><label for="validation-date">개업일</label><input id="validation-date" name="start_dt" type="date" required></div><div class="form-field"><label for="validation-name">대표자명</label><input id="validation-name" name="p_nm" maxlength="100" required autocomplete="off"></div></div><p class="fine-print" style="margin-top:12px">확인 버튼을 누르면 입력값을 국세청 조회 서비스로 전달합니다. 대표자명·개업일은 이 앱의 거래처 기록에 저장하지 않습니다.</p><div id="validation-result" aria-live="polite"></div><div class="modal-actions"><button class="button" type="button" data-action="close-modal">닫기</button><button class="button primary" type="submit">입력정보 확인</button></div></form>`);
}
function privacyModal() {
  openModal('개인정보와 보관 안내',`<div class="source-list"><div><h3>내 브라우저에 보관하는 정보</h3><p class="fine-print">거래처 목록, 메모, 입력 프로필, 확인 이력은 이 기기의 IndexedDB에 저장합니다. 로그인하면 Firebase UID별 Firestore 공간에 거래처·메모·프로필·조회 이력을 저장합니다. 비로그인 자료는 기기에 보관하고 명시적으로 가져올 때만 계정에 추가합니다. 팀 공동 작업은 제공하지 않습니다. 브라우저 데이터를 삭제하면 기록이 없어질 수 있으니 백업 파일을 보관하세요.</p></div><div><h3>조회할 때 전달하는 정보</h3><p class="fine-print">상태조회는 사업자번호, 진위 대조는 사용자가 입력한 번호·개업일·대표자명을 설정된 조회 서버와 해당 기관으로 전달합니다. 내 사업 매출·직원 수·거래 메모는 조회 기관에 전송하지 않습니다. 로그인 후 저장하는 업무 정보는 내 계정의 Firestore 공간으로 전달합니다.</p></div><div><h3>백업과 삭제</h3><p class="fine-print">거래처 관리에서 CSV 내보내기 또는 전체 JSON 백업을 할 수 있습니다. 개별 거래처 삭제 시 해당 거래처의 메모·확인 이력·변경 기록도 함께 삭제합니다. 백업에는 내부 메모가 포함되므로 필요한 사람에게만 전달하세요.</p></div><div><h3>공개정보의 해석</h3><p class="fine-print">사업자한눈은 독립적인 민간 서비스입니다. 정보의 기준일·출처를 확인하세요. 사업자 상태와 통신판매 신고는 거래 안전성이나 신용등급을 의미하지 않습니다.</p></div></div><div class="modal-actions"><button class="button primary" data-action="close-modal">확인</button></div>`);
}
function helpModal() {
  openModal('사업자한눈 이용 안내',`<div class="guide-step"><span class="step-number">01</span><div><h3>이름 또는 사업자번호 조회</h3><p>상호·업체명의 일부를 입력하면 공개 수집자료와 내 거래처·내 사업 정보에서 찾습니다. 주소와 번호를 확인한 뒤 업체를 선택하세요. 사업자번호 10자리는 바로 국세청 상태를 조회합니다. 숫자로만 된 이름은 검색 기준을 상호·업체명으로 바꾸세요.</p></div></div><div class="guide-step"><span class="step-number">02</span><div><h3>거래처 등록과 확인</h3><p>거래처를 직접 등록하거나 CSV로 가져오세요. 여러 업체의 상태를 한 번에 확인하고, 실제 성공 응답끼리 비교한 변경 기록을 볼 수 있습니다.</p></div></div><div class="guide-step"><span class="step-number">03</span><div><h3>지원사업 탐색</h3><p>내 사업 프로필을 저장한 뒤 지역·관심 분야가 관련된 공고를 살펴보세요. 자격조건·제외 대상·접수일정은 항상 원문에서 확인합니다.</p></div></div><div class="callout" style="margin-top:15px">${icon('info')}<span>조회가 연결 대기로 보이면 데이터 현황에서 운영 서버와 API 설정 상태를 확인하세요. 조회 없이 거래처 등록·메모·백업을 사용할 수 있습니다.</span></div><div class="modal-actions"><button class="button primary" data-action="close-modal">시작하기</button></div>`);
}
function go(view) {
  if(!titles[view])return;
  interactionEpoch++;
  if(modal)closeModal();
  ui.mobileMenu=false;
  ui.view=view;
  if(document.body.dataset.page==='data'&&view!=='data') history.replaceState(null,'','./#'+view);
  else history.replaceState(null,'','#'+view);
  render();
  window.scrollTo({top:0,behavior:'instant'});
}
async function checkHealth() {
  const serial = ++healthSerial;
  const apiBase = currentApiBase();
  try {
    const result = await callApi('health',undefined,apiBase);
    if(serial!==healthSerial||apiBase!==currentApiBase())return;
    health=result;healthError='';
  } catch(error) {
    if(serial!==healthSerial||apiBase!==currentApiBase())return;
    health=null;healthError=error.message;
  }
  render();
}
async function refreshPrograms() {
  programLoading=true;programError='';render();
  try {
    const result=await loadPrograms();
    programs=Array.isArray(result.programs)?result.programs:[];
    programMeta=result.meta||{};
    if(!programs.length&&programMeta.message)programError=programMeta.message;
  } catch(error){programError='지원사업 목록을 불러오지 못했습니다. 잠시 후 다시 시도하거나 지원한눈에서 확인해 주세요.';}
  try {const res=await fetch('./data/collection-status.json',{cache:'no-cache'});if(res.ok)collection=await res.json();} catch {}
  programLoading=false;render();
}
function dedupeEvents(existing,events) {
  const seen=new Set(existing.map(e=>e.id));
  return [...events.filter(e=>!seen.has(e.id)),...existing].slice(0,1000);
}
async function refreshPublicIndex({force=false}={}) {
  if(publicIndexPromise)return publicIndexPromise;
  if(publicIndexLoaded&&!force)return true;
  publicIndexLoading=true;render();
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),15_000);
  publicIndexPromise=(async()=>{
    try{
      const result=await loadEnrichmentIndex({signal:controller.signal});
      if(publicIndexLoaded&&result.meta.status==='not_collected')throw new Error('공개 수집본을 찾을 수 없습니다.');
      // Build complete maps before replacing the last successful snapshot.
      const records=new Map(),summaries=new Map();
      for(const record of result.records){records.set(record.businessNumber,record);summaries.set(record.businessNumber,summarizeEnrichment(record));}
      publicRecords=records;publicSummaries=summaries;publicMeta=result.meta;
      publicIndexLoaded=true;publicIndexError='';ui.nameSearchError='';businessIndexCache=null;
      if(ui.lookup)ui.enrichment=publicBusiness(ui.lookup.businessNumber);
      return true;
    }catch{
      publicIndexError=publicIndexLoaded?'공개자료 갱신에 실패했습니다. 이전에 불러온 정보와 수집 시각을 유지합니다.':'공개 사업자 정보를 불러오지 못했습니다. 자료 새로고침으로 다시 시도해 주세요.';
      return false;
    }finally{
      clearTimeout(timeout);publicIndexLoading=false;publicIndexPromise=null;render();
    }
  })();
  return publicIndexPromise;
}
async function refreshEnrichment(bno,serial=lookupSerial,{force=false}={}){
  ui.enrichmentBusy=true;
  await refreshPublicIndex({force});
  if(serial!==lookupSerial)return;
  if(!ui.lookup||ui.lookup.businessNumber===bno)ui.enrichment=publicBusiness(bno);
  ui.enrichmentError=publicIndexError;ui.enrichmentBusy=false;render();
}
function clearLookupResult(){
  ui.lookup=null;ui.lookupBusy=false;ui.commerce=null;ui.lookupSelection=null;
  ui.enrichment=null;ui.enrichmentBusy=false;ui.enrichmentError='';
  ui.lookupTab='overview';ui.lookupPendingNumber='';ui.nameResultsExpanded=false;
}
async function submitLookup(value,{refresh=false,type=ui.lookupType}={}){
  if(lookupComposing)return;
  const parsed=classifyBusinessQuery(value,{type});
  if(ui.nameSearchBusy&&parsed.kind==='name'&&ui.nameQuery===parsed.query)return;
  if(ui.lookupBusy&&parsed.kind==='number'&&ui.lookupPendingNumber===parsed.businessNumber)return;
  if(parsed.kind==='number'&&ui.lookup?.businessNumber===parsed.businessNumber){
    ui.lookupQuery=String(value??'');ui.lookupError='';ui.nameQuery='';ui.nameSearchError='';ui.nameResultsExpanded=false;
    await lookup(parsed.businessNumber,{preserveContext:true});return;
  }
  const serial=++lookupSerial;
  interactionEpoch++;
  const interaction=interactionEpoch;
  ui.lookupQuery=String(value??'');ui.lookupError='';ui.nameQuery='';ui.nameSearchBusy=false;ui.nameSearchError='';ui.nameSearchPage=1;
  clearLookupResult();
  if(parsed.kind==='invalid'){
    ui.lookupError=parsed.error||'상호·업체명 또는 올바른 사업자등록번호를 입력해 주세요.';
    render();document.getElementById('business-query')?.focus({preventScroll:true});return;
  }
  if(parsed.kind==='number'){await lookup(parsed.businessNumber);return;}
  ui.nameQuery=parsed.query;ui.nameSearchBusy=true;render();
  try{if(!await refreshPublicIndex({force:refresh}))throw new Error(publicIndexError);}
  catch{
    if(serial!==lookupSerial)return;
    ui.nameSearchError=publicIndexError||'공개 검색자료를 새로 불러오지 못했습니다. 자료 새로고침으로 다시 시도해 주세요.';
  }finally{
    if(serial===lookupSerial){
      ui.nameSearchBusy=false;render();
      if(interaction===interactionEpoch&&!lookupComposing&&!modal&&ui.view==='lookup'&&ui.lookupQuery===String(value??''))document.getElementById('name-results-title')?.focus({preventScroll:true});
    }
  }
}
async function lookup(value,{candidate=null,preserveContext=false}={}) {
  const bno=normalizeBusinessNumber(value);
  if(ui.lookupBusy&&ui.lookupPendingNumber===bno)return;
  const previousNumber=ui.lookup?.businessNumber||ui.lookupPendingNumber;
  const activeTab=previousNumber===bno?normalizeLookupTab(ui.lookupTab):'overview';
  const keepResult=preserveContext&&previousNumber===bno&&!!ui.lookup;
  if(!candidate&&!preserveContext){ui.lookupQuery=value;if(ui.lookupType==='name')ui.lookupType='number';ui.nameQuery='';ui.nameSearchError='';}
  if(!isValidBusinessNumber(value)) {
    ui.lookupError='사업자등록번호 10자리와 검증번호를 확인해 주세요.';render();
    return;
  }
  const serial=++lookupSerial;
  interactionEpoch++;
  const interaction=interactionEpoch;
  ui.lookupError='';ui.nameSearchBusy=false;ui.lookupSelection=candidate;
  ui.lookupTab=activeTab;ui.lookupPendingNumber=bno;
  if(candidate)ui.nameResultsExpanded=false;
  ui.lookupBusy=true;
  if(!keepResult){ui.lookup=null;ui.commerce=null;ui.enrichment=null;}
  ui.enrichmentError='';ui.enrichmentBusy=true;render();
  const evidenceTask=refreshEnrichment(bno,serial);
  try {
    const result=await callApi('status',{businessNumbers:[bno]},currentApiBase());
    if(serial!==lookupSerial)return;
    const match=Array.isArray(result.results)?result.results.find(r=>r.businessNumber===bno):null;
    ui.lookup=match||failureResult(bno,new Error('사업자번호와 일치하는 조회 응답을 확인하지 못했습니다.'));
  } catch(error) {
    if(serial!==lookupSerial)return;
    ui.lookup=failureResult(bno,error);
  } finally {if(serial===lookupSerial){ui.lookupBusy=false;ui.lookupPendingNumber='';render();if(!preserveContext&&interaction===interactionEpoch&&!lookupComposing&&!modal&&ui.view==='lookup'){document.getElementById('lookup-result-title')?.focus({preventScroll:true});document.getElementById('lookup-result')?.scrollIntoView({block:'nearest',behavior:'instant'});}}}
  await evidenceTask;
  if(serial!==lookupSerial)return;
  if(byNumber(bno)) {
    const applied=applyCheckResults(workspace.partners,[ui.lookup]);
    await persist({...workspace,partners:linkedPartners(applied.partners),events:dedupeEvents(workspace.events,applied.events)});
  }
  if(serial!==lookupSerial)return;
  if(health?.providers?.ftc?.configured) {
    try {const result=await callApi('commerce',{businessNumber:bno},currentApiBase());if(serial===lookupSerial){ui.commerce=result;render();}}
    catch(error){if(serial===lookupSerial){ui.commerce={outcome:'error',message:error.message,records:[]};render();}}
  }
}
async function batchCheck(ids) {
  if(ui.batchBusy||authBusy()||accountTransition)return;
  const epoch=accountEpoch;
  const targets=workspace.partners.filter(p=>ids.includes(p.id));
  if(!targets.length)return;
  ui.batchBusy=true;ui.batchTotal=targets.length;ui.batchDone=0;render();
  const all=[];
  try {
    await refreshPublicIndex();
    if(epoch!==accountEpoch)return;
    for(let offset=0;offset<targets.length;offset+=100) {
      const chunk=targets.slice(offset,offset+100);
      let results;
      try {
        const payload=await callApi('status',{businessNumbers:chunk.map(p=>p.businessNumber)},currentApiBase());
        results=chunk.map(p=>(Array.isArray(payload.results)?payload.results:[]).find(r=>r.businessNumber===p.businessNumber)||failureResult(p.businessNumber,new Error('응답에 이 사업자번호가 없어 확인하지 못했습니다.')));
      } catch(error){results=chunk.map(p=>failureResult(p.businessNumber,error));}
      if(epoch!==accountEpoch)return;
      all.push(...results);
      const applied=applyCheckResults(workspace.partners,results);
      const saved=await persist({...workspace,partners:linkedPartners(applied.partners),events:dedupeEvents(workspace.events,applied.events)});
      if(epoch!==accountEpoch)return;
      ui.batchDone+=chunk.length;render();
      if(!saved)break;
      if(results.every(r=>r.outcome==='not_configured')) {
        if(offset+100<targets.length)toast('조회 연결을 준비 중이어서 나머지 요청을 중단했습니다.',true);
        break;
      }
    }
    const check={id:crypto.randomUUID(),total:all.length,ok:all.filter(r=>r.outcome==='ok').length,failed:all.filter(r=>r.outcome!=='ok').length,checkedAt:new Date().toISOString()};
    if(epoch!==accountEpoch)return;
    if(all.length)await persist({...workspace,checks:[check,...workspace.checks].slice(0,100)});
    toast(`${check.total}곳 확인 시도 · 응답 확인 ${check.ok}곳, 미확인/실패 ${check.failed}곳`,check.failed>0);
  } finally {if(epoch===accountEpoch){ui.batchBusy=false;render();}}
}
async function savePartner(form) {
  const data=new FormData(form);
  const old=byId(form.dataset.id);
  const raw=String(data.get('businessNumber'));
  const bno=normalizeBusinessNumber(raw);
  const error=document.getElementById('partner-form-error');
  if(!isValidBusinessNumber(raw)){error.textContent='사업자등록번호의 자리수와 검증번호를 확인해 주세요.';return;}
  const duplicate=byNumber(bno);
  if(duplicate&&duplicate.id!==old?.id){error.textContent='이미 등록한 사업자번호입니다. 기존 거래처 정보를 수정해 주세요.';return;}
  if(!old&&workspace.partners.length>=1000){error.textContent='거래처는 최대 1,000개까지 저장할 수 있습니다.';return;}
  let p={...old,id:old?.id||crypto.randomUUID(),businessNumber:bno,name:old?.name||'',tags:[...new Set(String(data.get('tags')||'').split(/[,;|]/).map(t=>t.trim()).filter(Boolean))].slice(0,10),note:String(data.get('note')||'').slice(0,5000),createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),history:old?.history||[]};
  const evidence=businessRecord(bno);
  if(evidence)p=attachPartnerEnrichment(p,evidence);
  const enteredName=String(data.get('name')||'').trim();
  if(!modal?.prefilledName?.automatic||enteredName!==modal.prefilledName.value)p=setPartnerName(p,enteredName);
  if(ui.lookup?.businessNumber===bno&&!old) p=applyCheckResults([p],[ui.lookup]).partners[0];
  const partners=old?workspace.partners.map(item=>item.id===old.id?p:item):[p,...workspace.partners];
  if(await persist({...workspace,partners})){if(old)detailDrafts.delete(old.id);closeModal();toast('거래처를 저장했습니다.');}
}
async function saveProfile(form) {
  const data=new FormData(form);
  const raw=String(data.get('businessNumber')||'').trim();
  if(raw&&!isValidBusinessNumber(raw)){toast('사업자등록번호를 확인해 주세요.',true);document.getElementById('profile-number').focus();return;}
  const optionalNumber=name=>String(data.get(name)||'').trim()===''?null:Number(data.get(name));
  const revenue=optionalNumber('revenue');
  const revenueYear=optionalNumber('revenueYear');
  const employees=optionalNumber('employees');
  if([revenue,revenueYear,employees].some(value=>value!==null&&(!Number.isSafeInteger(value)||value<0))){toast('매출액·인원·기준연도는 유효한 정수로 입력해 주세요.',true);return;}
  if(revenue!==null&&revenueYear===null){toast('매출액의 기준연도를 함께 입력해 주세요.',true);document.getElementById('profile-revenue-year').focus();return;}
  const profile={
    name:String(data.get('name')||'').trim(),businessNumber:normalizeBusinessNumber(raw),
    region:String(data.get('region')||''),industry:String(data.get('industry')||'').trim(),
    foundedAt:String(data.get('foundedAt')||''),businessKind:String(data.get('businessKind')||''),
    employees,revenue,revenueUnit:'만원',revenueYear,
    interests:data.getAll('interests').map(String),providedBy:'user',updatedAt:new Date().toISOString(),
    ...((ui.profileDraft||workspace.profile).enrichment?.businessNumber===normalizeBusinessNumber(raw)?{enrichment:(ui.profileDraft||workspace.profile).enrichment}:{})
  };
  if(await persist({...workspace,profile})){ui.profileDraft=null;render();toast('내 사업 프로필을 저장했습니다.');}
}
async function validateRegistration(form) {
  const button=form.querySelector('button[type=submit]');
  button.disabled=true;
  const data=new FormData(form);
  const target=document.getElementById('validation-result');
  target.innerHTML='<div class="inline-loading"><span class="spinner"></span>입력 정보를 대조하고 있어요.</div>';
  try {
    const result=await callApi('validate',{businesses:[{b_no:normalizeBusinessNumber(String(data.get('b_no'))),start_dt:String(data.get('start_dt')).replaceAll('-',''),p_nm:String(data.get('p_nm')).trim()}]},currentApiBase());
    const r=result.results?.[0];
    const matched=r?.outcome==='ok'&&r.valid===true;
    const message=matched?'입력한 등록정보가 국세청 정보와 일치합니다.':r?.message||'입력정보의 일치를 확인하지 못했습니다. 대표자명·개업일을 확인해 주세요.';
    target.innerHTML=`<div class="callout ${matched?'':'warning'}" style="margin-top:15px">${icon(matched?'check':'info')}<span>${esc(message)}<br><span class="fine-print">일치 여부는 대표자 본인 인증·문서 원본 인증·거래 안전성 보증과 다릅니다.</span></span></div>`;
  } catch(error){target.innerHTML=`<div class="callout warning" style="margin-top:15px">${icon('info')}<span>${esc(error.message)}</span></div>`;}
  finally {button.disabled=false;}
}

document.addEventListener('submit',event=>{
  if(event.target.id!=='enrichment-request-form')return;
  event.preventDefault();event.stopImmediatePropagation();
  const form=event.target;if(!form.reportValidity())return;
  const data=new FormData(form),bno=String(data.get('businessNumber')),name=String(data.get('name')||'').trim(),website=String(data.get('website')||'').trim();
  let url;try{url=website?new URL(website):null;if(url&&(!['https:','http:'].includes(url.protocol)||url.username||url.password))throw Error();}catch{toast('공개 웹사이트의 HTTPS 주소를 입력해 주세요.',true);return;}
  const body=`### 사업자등록번호\n${bno}\n\n### 상호\n${name||'_미입력_'}\n\n### 수집할 공개 웹사이트\n${url?.href||'_미입력_'}\n\n공개 사업자 정보 수집을 요청합니다. 개인정보와 내부 메모는 포함하지 않습니다.`;
  const target=new URL('https://github.com/softm/bizhannun/issues/new');target.searchParams.set('title','[사업자 수집] '+bno);target.searchParams.set('body',body);
  window.open(target.href,'_blank','noopener,noreferrer');
},true);
document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!['lookup-form','partner-form','profile-form','connection-form','validate-form','auth-email-form','detail-note-form'].includes(form.id))return;
  event.preventDefault();
  if(form.id==='detail-note-form'){await saveDetailNotes(form);return;}
  if(form.id==='auth-email-form'){await submitAuth(form);return;}
  if(form.id==='lookup-form')await submitLookup(String(new FormData(form).get('businessQuery')||''));
  if(form.id==='partner-form')await savePartner(form);
  if(form.id==='profile-form')await saveProfile(form);
  if(form.id==='validate-form')await validateRegistration(form);
  if(form.id==='connection-form') {
    try {
      const base=validateApiBase(String(new FormData(form).get('apiBase')||''));
      guestWorkspace=await saveWorkspace({...guestWorkspace,preferences:{...guestWorkspace.preferences,apiBase:base}});workspace={...workspace,preferences:guestWorkspace.preferences};closeModal();await checkHealth();toast(health?'서버 연결 상태를 확인했습니다.':'서버 연결 상태를 확인해 주세요.',!health);
    } catch(error){document.getElementById('connection-error').textContent=error.message;}
  }
});
function captureProfileDraft(form) {
  const data=new FormData(form);
  const previous=ui.profileDraft||workspace.profile;
  const bno=normalizeBusinessNumber(String(data.get('businessNumber')||''));
  ui.profileDraft={...Object.fromEntries(data),businessNumber:bno,interests:data.getAll('interests').map(String),...(previous.enrichment?.businessNumber===bno?{enrichment:previous.enrichment}:{})};
}
document.addEventListener('input',event=>{
  const t=event.target;
  if(t.closest('#detail-note-form')&&modal?.detailState){
    const state=captureDetailDraft();state.notice=state.dirty?'저장하지 않은 변경사항이 있습니다.':'';state.error='';
    const feedback=modalRoot.querySelector('#detail-note-feedback'),error=modalRoot.querySelector('#detail-note-error');
    if(feedback)feedback.textContent=state.notice;if(error)error.textContent='';
  }
  if(t.closest('#profile-form'))captureProfileDraft(t.closest('form'));
  if(t.id==='business-query'){
    interactionEpoch++;ui.lookupQuery=t.value;ui.lookupError='';t.removeAttribute('aria-invalid');
    const error=document.getElementById('lookup-error');if(error)error.textContent='';
  }
  if(t.id==='partner-search'){interactionEpoch++;ui.partnerQuery=t.value;render();}
  if(t.id==='program-search'){ui.programQuery=t.value;ui.page=1;render();}
  if(t.id==='import-text'){importState.parsed=null;document.getElementById('confirm-import').disabled=true;document.getElementById('import-preview').replaceChildren();}
});
document.addEventListener('compositionstart',event=>{
  if(event.target.id==='business-query'){interactionEpoch++;lookupComposing=true;}
  if(event.target.closest('#detail-note-form')&&modal?.detailState)modal.detailState.composing=true;
});
document.addEventListener('compositionend',event=>{
  if(event.target.closest('#detail-note-form')&&modal?.detailState){
    const state=captureDetailDraft();state.composing=false;
    if(state.renderPending)detailModal(byId(modal.detailId),{refresh:true});
    return;
  }
  if(event.target.id!=='business-query')return;
  lookupComposing=false;ui.lookupQuery=event.target.value;
  if(renderAfterComposition)render();
});
document.addEventListener('change',async event=>{
  const t=event.target;
  if(t.id==='detail-history-period'){updateDetailHistory({period:t.value});return;}
  if(t.id==='detail-history-sort'){updateDetailHistory({sort:t.value});return;}
  if(t.id==='lookup-type'){
    lookupSerial++;interactionEpoch++;ui.lookupType=t.value;ui.lookupError='';ui.nameQuery='';ui.nameSearchBusy=false;ui.nameSearchError='';clearLookupResult();
    render();document.getElementById('business-query')?.focus({preventScroll:true});return;
  }
  if(t.closest('#profile-form'))captureProfileDraft(t.closest('form'));
  if(t.id==='partner-status'){interactionEpoch++;ui.partnerStatus=t.value;render();}
  if(t.id==='open-only'){ui.openOnly=t.checked;ui.page=1;render();}
  if(t.classList.contains('partner-check')){t.checked?selected.add(t.dataset.id):selected.delete(t.dataset.id);render();}
  if(t.id==='select-all'){for(const p of filteredPartners()){t.checked?selected.add(p.id):selected.delete(p.id);}render();}
  if(t.id==='import-file'&&t.files?.[0]) {
    const activeModal=modal;
    const selection=++importSelection;
    const file=t.files[0];
    if(file.size>5*1024*1024){toast('CSV 파일은 5MB 이하로 준비해 주세요.',true);return;}
    let contents=new TextDecoder('utf-8').decode(await file.arrayBuffer());
    if(contents.includes('\uFFFD')) {contents=new TextDecoder('euc-kr').decode(await file.arrayBuffer());toast('한글 CSV 인코딩으로 읽었습니다. 미리보기를 확인해 주세요.');}
    if(modal!==activeModal||selection!==importSelection||!document.getElementById('import-text'))return;
    document.getElementById('import-text').value=contents;
    previewImport();
  }
  if(t.id==='restore-file'&&t.files?.[0]) {
    const activeModal=modal;
    const selection=++restoreSelection;
    if(!activeModal)return;
    activeModal.restore=null;
    document.getElementById('confirm-restore').disabled=true;
    document.getElementById('restore-preview').replaceChildren();
    try {
      if(t.files[0].size>25*1024*1024)throw new Error('백업 파일은 25MB 이하만 지원합니다.');
      const restored=validateBackup(JSON.parse(await t.files[0].text()));
      if(!restored.partners.every(p=>isValidBusinessNumber(p.businessNumber)))throw new Error('백업에 유효하지 않은 사업자번호가 있습니다.');
      if(modal!==activeModal||selection!==restoreSelection)return;
      modal.restore=restored;
      document.getElementById('restore-preview').innerHTML=`<div class="callout warning" style="margin-top:16px">${icon('info')}<span><strong>${restored.partners.length}곳</strong>의 거래처와 확인 기록으로 현재 정보를 교체합니다. 현재 기록을 먼저 백업해 두세요.</span></div>`;
      document.getElementById('confirm-restore').disabled=false;
    } catch(error){if(modal===activeModal&&selection===restoreSelection)toast(error.message,true);}
  }
});
document.addEventListener('click',async event=>{
  const nav=event.target.closest('[data-nav]');
  if(nav){event.preventDefault();go(nav.dataset.nav);return;}
  const element=event.target.closest('[data-action]');
  if(!element||element.disabled)return;
  const action=element.dataset.action;
  const id=element.dataset.id;
  if(/^(auth-|cloud-|guest-import-)/.test(action)){await handleAccountAction(action,element);return;}
  if(action==='close-modal-backdrop'){if(event.target===element)closeModal();return;}
  if(action==='close-modal'){closeModal();return;}
  if(action==='detail-tab'){switchDetailTab(element.dataset.tab,{editor:element.getAttribute('role')!=='tab'&&element.dataset.tab==='notes'});return;}
  if(action==='detail-history-filter'){updateDetailHistory({filter:element.dataset.filter});return;}
  if(action==='detail-history-reset'){updateDetailHistory({filter:'all',period:'all',sort:'newest'},{reset:true});return;}
  if(action==='detail-history-export'){
    const partner=byId(modal?.detailId),state=modal?.detailState;if(!partner||!state)return;
    try{
      const history=buildBusinessHistory({partner,businessNumber:partner.businessNumber,filter:state.historyFilter,
        period:state.historyPeriod,sort:state.historySort,now:state.historyNow});
      if(!history.rows.length){toast('선택한 조건에 내보낼 조회 기록이 없습니다.');return;}
      downloadText('사업자한눈_변동이력_'+partner.businessNumber+'_'+history.filter+'_'+history.period+'.csv',
        buildBusinessHistoryCsv({businessNumber:partner.businessNumber,rows:history.rows}),'text/csv;charset=utf-8');
      toast('현재 조건의 조회 기록 '+number(history.rows.length)+'건을 CSV로 내려받았습니다.');
    }catch(error){toast(error.message||'조회 기록을 내보내지 못했습니다.',true);}
    return;
  }
  if(action==='detail-refresh'){await refreshDetailStatus();return;}
  if(action==='detail-copy-number'){
    const partner=byId(modal?.detailId);if(!partner)return;
    try{await navigator.clipboard.writeText(formatBusinessNumber(partner.businessNumber));toast('사업자등록번호를 복사했습니다.');}
    catch{toast('복사할 사업자등록번호: '+formatBusinessNumber(partner.businessNumber),true);}
    return;
  }
  if(action==='detail-export'||action==='detail-print'){
    const partner=byId(modal?.detailId);if(!partner)return;
    if(action==='detail-export'){
      downloadText('사업자한눈_조회기록_'+partner.businessNumber+'.html',buildBusinessDetailReport({...detailArguments(partner),includePrivate:false}),'text/html;charset=utf-8');
      toast('출처와 확인 시각이 담긴 조회 기록을 내려받았습니다. 메모·태그는 제외됩니다.');
    }else printDetailReport(partner);
    return;
  }
  if(action==='detail-validate'){
    const partner=byId(modal?.detailId);if(partner)validateModal(partner.businessNumber);return;
  }
  if(action==='detail-edit-partner'){
    const partner=byId(modal?.detailId),state=captureDetailDraft();if(!partner)return;
    try{partnerModal(state?applyNoteDraft(partner,state.draft,partner.updatedAt):partner);}
    catch(error){state.error=error.message;detailModal(partner,{refresh:true});}
    return;
  }
  if(action==='detail-reset-note'){
    const partner=byId(modal?.detailId),state=modal?.detailState;if(!partner||!state||state.saving||state.refreshing||saving||ui.batchBusy||authBusy())return;
    state.draft=editorNoteDraft(partner);state.baseline={...state.draft};state.dirty=false;state.error='';state.notice='저장된 메모와 태그를 불러왔습니다.';
    modalRoot.querySelector('#detail-note').value=state.draft.note;modalRoot.querySelector('#detail-tags').value=state.draft.tags;
    detailModal(partner,{refresh:true});return;
  }
  if(action==='toggle-menu'){ui.mobileMenu=!ui.mobileMenu;render();return;}
  if(action==='goto-history'){go('history');return;}
  if(action==='insight-filter'){
    const filter=element.dataset.filter;
    if(!['all','refresh','linked','conflict','missing'].includes(filter))return;
    interactionEpoch++;ui.partnerInsight=filter;ui.partnerStatus='all';ui.partnerQuery='';selected.clear();
    if(ui.view!=='partners')go('partners');else render();return;
  }
  if(action==='lookup-mode'){interactionEpoch++;ui.mode=element.dataset.mode;render();return;}
  if(action==='lookup-tab'){
    if(element.dataset.bno&&element.dataset.bno!==ui.lookup?.businessNumber)return;
    activateLookupTab(element.dataset.tab,{focus:true,target:element.dataset.target||''});return;
  }
  if(action==='toggle-name-results'){
    interactionEpoch++;ui.nameResultsExpanded=!ui.nameResultsExpanded;render();
    const target=document.getElementById(ui.nameResultsExpanded?'name-results-title':'toggle-name-results');
    target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest',behavior:'instant'});
    return;
  }
  if(action==='lookup-saved'){
    const partner=byNumber(normalizeBusinessNumber(element.dataset.bno));
    if(partner)await lookup(partner.businessNumber);return;
  }
  if(action==='close-result'){
    lookupSerial++;interactionEpoch++;clearLookupResult();render();
    const target=document.getElementById('name-results-title')||document.getElementById('business-query');
    target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest',behavior:'instant'});return;
  }
  if(action==='select-name-result'){
    const candidate=currentNameSearch().result.results.find(entry=>entry.businessNumber===element.dataset.number);
    if(candidate&&ui.lookup?.businessNumber===candidate.businessNumber){
      interactionEpoch++;ui.nameResultsExpanded=false;render();const target=document.getElementById('lookup-result-title');target?.focus({preventScroll:true});target?.scrollIntoView({block:'nearest',behavior:'instant'});
    }else if(candidate)await lookup(candidate.businessNumber,{candidate});
    return;
  }
  if(action==='retry-name-search'){if(ui.nameQuery)await submitLookup(ui.nameQuery,{refresh:true,type:'name'});return;}
  if(action==='name-search-prev'||action==='name-search-next'){
    interactionEpoch++;ui.nameSearchPage=Math.max(1,ui.nameSearchPage+(action==='name-search-next'?1:-1));render();document.getElementById('name-results-title')?.focus({preventScroll:true});return;
  }
  if(action==='search-by-number'){
    lookupSerial++;interactionEpoch++;clearLookupResult();ui.lookupType='number';ui.lookupQuery='';ui.nameQuery='';ui.nameSearchBusy=false;ui.nameSearchError='';ui.lookupError='';
    render();document.getElementById('business-query')?.focus({preventScroll:true});return;
  }
  if(action==='add-partner-from-search'){partnerModal(null,{name:ui.nameQuery});return;}
  if(action==='add-partner'){partnerModal();return;}
  if(action==='edit-partner'){partnerModal(byId(id));return;}
  if(action==='detail'){detailModal(byId(id));return;}
  const contextBno=normalizeBusinessNumber(element.dataset.businessNumber||element.dataset.bno||byId(modal?.detailId)?.businessNumber||ui.lookup?.businessNumber||'');
  if(action==='reload-catalog'){await refreshPublicIndex({force:true});return;}
  if(action==='reload-enrichment'){
    const activeModal=modal, profileEvidence=modal?.profileEvidence;
    if(isValidBusinessNumber(contextBno))await refreshEnrichment(contextBno,lookupSerial,{force:true});
    else await refreshPublicIndex({force:true});
    if(profileEvidence&&modal===activeModal)openProfileEvidence(contextBno);
    toast(publicIndexError||'배포된 최신 수집본을 확인했습니다. 웹 재수집은 수집 요청에서 실행합니다.',!!publicIndexError);return;
  }
  if(action==='enrichment-export'){
    const record=businessRecord(contextBno);
    if(record)downloadText('사업자한눈_공개정보_'+contextBno+'.json',JSON.stringify(record,null,2),'application/json');return;
  }
  if(action==='save-enrichment-note'){
    const record=businessRecord(contextBno);if(!record)return;
    const old=byNumber(contextBno);
    if(old){
      const activeModal=modal;
      if(await persist({...workspace,partners:workspace.partners.map(p=>p.id===old.id?attachPartnerEnrichment(p,record):p)})){
        if(modal===activeModal&&modal?.detailId===old.id)detailModal(byId(old.id),{refresh:true});
        toast('공개정보와 출처를 거래처에 보관했습니다.');
      }
    }else partnerModal(null,{businessNumber:contextBno});
    return;
  }
  if(action==='enrichment-request'){enrichmentRequestModal(contextBno);return;}
  if(action==='save-lookup'){
    if(ui.lookup)partnerModal(byNumber(ui.lookup.businessNumber),{businessNumber:ui.lookup.businessNumber});return;
  }
  if(action==='profile-evidence'){openProfileEvidence(contextBno);return;}
  if(action==='insight-refresh-status'){
    if(!isValidBusinessNumber(contextBno))return;
    const partner=byNumber(contextBno);
    if(modal?.detailId&&partner){await refreshDetailStatus();}
    else{if(modal)closeModal();if(ui.view!=='lookup')go('lookup');await lookup(contextBno,{candidate:ui.lookupSelection?.businessNumber===contextBno?ui.lookupSelection:null,preserveContext:ui.lookup?.businessNumber===contextBno});}
    return;
  }
  if(action==='validate-registration'){validateModal(contextBno);return;}
  if(action==='insight-view-sources'){
    if(modal?.detailId)switchDetailTab('sources');
    const target=({'field-conflicts':'.insight-conflicts','collection-incomplete':'.enrichment-coverage'})[element.dataset.insightId]||'.enrichment-sources';
    if(!modal?.detailId&&ui.lookup?.businessNumber===contextBno){activateLookupTab(lookupTabForInsight(element.dataset.insightId),{target,focus:true});return;}
    const root=modal?.detailId?modalRoot:app;
    const sources=root.querySelector(target);
    if(sources){sources.open=true;sources.querySelector('summary')?.focus({preventScroll:true});sources.scrollIntoView({behavior:'smooth',block:'start'});}
    else toast('연결된 출처가 아직 없습니다. 웹 정보 수집 요청으로 자료를 보강해 주세요.');
    return;
  }
  if(action==='use-mine'){
    if(!ui.lookup)return;
    const bno=ui.lookup.businessNumber;
    ui.profileDraft=buildBusinessProfileDraft(ui.profileDraft||workspace.profile,bno,businessRecord(bno));
    go('profile');toast('공개정보로 프로필을 채웠습니다. 내용을 확인하고 저장하세요.');return;
  }
  if(action==='check-one'){if(modal?.detailId===id){await refreshDetailStatus();return;}const epoch=accountEpoch;closeModal();const interaction=interactionEpoch;await batchCheck([id]);if(epoch===accountEpoch&&interaction===interactionEpoch&&!modal&&byId(id))detailModal(byId(id));return;}
  if(action==='batch-check'){await batchCheck(element.dataset.scope==='selected'?[...selected]:workspace.partners.map(p=>p.id));return;}
  if(action==='deselect'){selected.clear();render();return;}
  if(action==='delete-confirm'){
    const p=byId(id);if(!p)return;
    openModal('거래처 삭제',`<p style="font-size:13px"><strong>${esc(linkedBusiness(p.businessNumber,p).displayName)}</strong>의 메모, 확인 이력과 변경 기록을 현재 ${authState.user?'계정':'기기'} 자료에서 삭제합니다.</p><div class="modal-actions"><button class="button" data-action="close-modal">취소</button><button class="button danger" data-action="delete-partner" data-id="${esc(id)}">삭제</button></div>`);return;
  }
  if(action==='delete-partner'){
    if(await persist({...workspace,partners:workspace.partners.filter(p=>p.id!==id),events:workspace.events.filter(e=>e.partnerId!==id)})){selected.delete(id);detailDrafts.delete(id);closeModal({discardDraft:true});toast('거래처와 관련 기록을 삭제했습니다.');}return;
  }
  if(action==='import'){importModal();return;}
  if(action==='preview-import'){previewImport();return;}
  if(action==='confirm-import'){
    if(!importState.parsed)return;
    const existing=new Set(workspace.partners.map(p=>p.businessNumber));
    const fresh=importState.parsed.rows.filter(p=>!existing.has(p.businessNumber)).map(p=>({...p,id:crypto.randomUUID(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),history:[]}));
    if(workspace.partners.length+fresh.length>1000){toast('거래처는 최대 1,000개까지 저장할 수 있습니다.',true);return;}
    if(await persist({...workspace,partners:[...fresh,...workspace.partners]})){closeModal();toast(`새 거래처 ${fresh.length}곳을 등록했습니다.`);}return;
  }
  if(action==='csv-template'){downloadText('사업자한눈_거래처_양식.csv','\uFEFF사업자등록번호,업체명,태그,메모\r\n','text/csv;charset=utf-8');return;}
  if(action==='export-csv'){downloadText('사업자한눈_거래처_'+new Date().toISOString().slice(0,10)+'.csv',exportPartnersCsv(workspace.partners.map(p=>{const linked=linkedBusiness(p.businessNumber,p);return {...p,displayName:linked.displayName==='이름 미입력'?'':linked.displayName,publicName:linked.publicName,publicNameSourceUrl:linked.publicNameSourceUrl,publicNameCollectedAt:linked.publicNameCollectedAt};}),{includeLinkedInfo:true}),'text/csv;charset=utf-8');return;}
  if(action==='backup'){downloadText('사업자한눈_전체백업_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({...workspace,preferences:{}},null,2),'application/json');toast('전체 백업 파일을 만들었습니다. 내부 메모가 포함되어 있습니다.');return;}
  if(action==='restore-open'){
    openModal('백업 복원',`<p class="fine-print">사업자한눈에서 내보낸 JSON 백업 파일을 선택하세요. 복원 시 현재 거래처·프로필·확인 기록이 파일 내용으로 교체됩니다.</p><div class="form-field" style="margin-top:15px"><label for="restore-file">백업 파일</label><input id="restore-file" type="file" accept=".json,application/json"></div><div id="restore-preview"></div><div class="modal-actions"><button class="button" data-action="backup">먼저 현재 정보 백업</button><button class="button primary" id="confirm-restore" data-action="restore-confirm" disabled>확인한 백업으로 교체</button></div>`);return;
  }
  if(action==='restore-confirm'){
    const restored=modal?.restore;
    if(restored&&await persist({...restored,revision:workspace.revision,preferences:workspace.preferences})){selected.clear();detailDrafts.clear();ui.profileDraft=null;closeModal({discardDraft:true});render();toast('백업을 복원했습니다.');}return;
  }
  if(action==='category'){ui.programCategory=element.dataset.category;ui.page=1;render();return;}
  if(action==='program-detail'){programModal(id);return;}
  if(action==='prev-page'||action==='next-page'){ui.page+=action==='prev-page'?-1:1;render();document.getElementById('main-content').scrollIntoView({behavior:'instant'});return;}
  if(action==='reload-programs'){await refreshPrograms();return;}
  if(action==='acknowledge'||action==='acknowledge-all'){
    const events=workspace.events.map(e=>(action==='acknowledge-all'||e.id===id)&&!e.acknowledgedAt?{...e,acknowledgedAt:new Date().toISOString()}:e);
    if(await persist({...workspace,events}))toast('확인한 기록으로 표시했습니다.');return;
  }
  if(action==='refresh-health'){await Promise.allSettled([checkHealth(),refreshPublicIndex({force:true})]);return;}
  if(action==='connection-settings'){connectionModal();return;}
  if(action==='validate-open'){validateModal();return;}
  if(action==='privacy'){privacyModal();return;}
  if(action==='help'){helpModal();return;}
});
document.addEventListener('keydown',event=>{
  if(event.isComposing)return;
  const tab=event.target.closest?.('[role="tab"][data-action="lookup-tab"]');
  if(tab&&!modal&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
    event.preventDefault();
    const index=LOOKUP_TABS.findIndex(item=>item.id===tab.dataset.tab);
    const next=event.key==='Home'?0:event.key==='End'?LOOKUP_TABS.length-1:(index+(event.key==='ArrowRight'?1:-1)+LOOKUP_TABS.length)%LOOKUP_TABS.length;
    activateLookupTab(LOOKUP_TABS[next].id,{focus:true});return;
  }
  if(event.key==='Escape') {if(modal){event.preventDefault();closeModal();}else if(ui.mobileMenu){ui.mobileMenu=false;render();}}
  if(modal?.detailState&&event.target.matches('[role=tab]')&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
    event.preventDefault();
    const tabs=['overview','tax','history','sources','notes'],index=tabs.indexOf(modal.detailState.tab);
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    switchDetailTab(tabs[next],{focus:true});return;
  }
  if(event.key==='Tab'&&modal) {
    const focusable=[...modalRoot.querySelectorAll('button,a[href],input,select,textarea,summary,[tabindex]')].filter(element=>
      !element.disabled&&element.tabIndex>=0&&!element.closest('[hidden],[inert]')&&element.getClientRects().length>0&&
      ![...modalRoot.querySelectorAll('details:not([open])')].some(details=>details.contains(element)&&element!==details.querySelector('summary')));
    const first=focusable[0],last=focusable.at(-1);
    if(!focusable.includes(document.activeElement)){event.preventDefault();(event.shiftKey?last:first)?.focus();}
    else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
});
window.addEventListener('beforeunload',event=>{
  captureDetailDraft();
  if(detailDrafts.size){event.preventDefault();event.returnValue='';}
});
window.addEventListener('afterprint',()=>document.body.classList.remove('printing-business-detail'));
window.addEventListener('hashchange',()=>{
  const view=location.hash.slice(1).split('?')[0];
  if(titles[view]){interactionEpoch++;ui.view=view;ui.mobileMenu=false;if(modal)closeModal();render();}
});

try {workspace=await loadWorkspace();guestWorkspace=structuredClone(workspace);}
catch(error){storageError='이 브라우저에서 기록을 불러오지 못했습니다. 저장 기능을 사용하려면 브라우저 저장소 설정을 확인해 주세요.';}
if(!titles[ui.view])ui.view='lookup';
render();
authClient=createAuthClient({publicConfig:window.BIZHANNUN_CONFIG?.auth,apiBase:window.BIZHANNUN_CONFIG?.apiBase||'',onStateChange:receiveAuthState});
Promise.allSettled([checkHealth(),refreshPrograms(),refreshPublicIndex(),authClient.init()]);

