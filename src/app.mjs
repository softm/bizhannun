import { normalizeBusinessNumber, formatBusinessNumber, isValidBusinessNumber, parseBusinessImport, exportPartnersCsv, applyCheckResults, buildInsights } from './domain.mjs';
import { emptyWorkspace, loadWorkspace, saveWorkspace, downloadText, validateBackup } from './storage.mjs';
import { callApi, validateApiBase, failureResult } from './api-client.mjs';
import { loadPrograms, rankPrograms } from './programs.mjs';

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
const statusNames = {active:'계속사업자',suspended:'휴업자',closed:'폐업자',unknown:'미확인'};
const titles = {lookup:'사업자 조회',partners:'거래처 관리',programs:'지원사업 찾기',profile:'내 사업',history:'변경 기록',data:'데이터 현황'};
const navItems = [['lookup','search'],['partners','folder'],['programs','spark'],['profile','building'],['history','clock'],['data','database']];
let workspace = emptyWorkspace();
let storageError = '';
let saving = false;
let health = null;
let healthError = '';
let programs = [];
let programMeta = {};
let programError = '';
let programLoading = true;
let collection = {};
let lookupSerial = 0;
let healthSerial = 0;
let previousFocus;
let modal;
let toastTimer;
let restoreSelection = 0;
let importSelection = 0;
const selected = new Set();
const ui = {
  view: document.body.dataset.page === 'data' ? 'data' : (location.hash.slice(1).split('?')[0] || 'lookup'),
  mode: 'partner', lookupNumber: '', lookup: null, commerce: null, lookupBusy: false,
  partnerQuery: '', partnerStatus: 'all', programQuery: '', programCategory: '', openOnly: true,
  page: 1, profileDraft: null, batchBusy: false, batchDone: 0, batchTotal: 0, mobileMenu: false
};
const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');
const currentApiBase = () => workspace.preferences?.apiBase || window.BIZHANNUN_CONFIG?.apiBase || '';
const byId = id => workspace.partners.find(p=>p.id===id);
const byNumber = n => workspace.partners.find(p=>p.businessNumber===n);
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
  if (saving) { toast('저장 중입니다. 잠시 후 다시 시도해 주세요.'); return false; }
  saving=true;
  try {
    workspace=await saveWorkspace(next);
    storageError='';
    return true;
  } catch(error) {
    storageError=error.message || '브라우저 저장에 실패했습니다.';
    toast(storageError,true);
    return false;
  } finally { saving=false; render(); }
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
    <div class="local-card">${icon('shield')}<div><strong>내 브라우저에 보관</strong>거래처와 메모는 이 기기에 저장돼요.<br>백업으로 기록을 보관하세요.</div></div>
    <div class="side-foot"><span>© bizhannun</span><span>v0.1</span></div>
  </aside>
  <div class="main-wrap">
    <header class="topbar">
      <div class="mobile-header-left"><button class="icon-button mobile-nav-toggle" data-action="toggle-menu" aria-label="메뉴 열기" aria-expanded="${ui.mobileMenu}">${icon('menu')}</button><a class="brand mobile-brand" href="./#lookup" data-nav="lookup"><img class="brand-mark" src="./assets/favicon.svg" alt="">사업자한눈</a></div>
      <div class="breadcrumb">내 워크스페이스 ${icon('chevron')} <span>${titles[view]}</span></div>
      <div class="top-tools"><span class="date-label">${new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'long',day:'numeric',weekday:'long'}).format(new Date())}</span><button class="icon-button notice-button" data-action="goto-history" aria-label="변경 기록 보기">${icon('bell')}${workspace.events.some(e=>!e.acknowledgedAt)?'<span class="notification-count">!</span>':''}</button><div class="workspace-label"><span class="avatar">${icon('user')}</span><span>개인 워크스페이스</span></div></div>
    </header>
    <main class="main-content" id="main-content" tabindex="-1">${storageError?`<div class="callout error storage-warning">${icon('info')}<span>${esc(storageError)} 현재 변경사항을 저장하지 못할 수 있습니다.</span></div>`:''}${content}${footer()}</main>
  </div></div>`;
}
function render() {
  const active=document.activeElement;
  const focusId=active?.id;
  const sel=active&&'selectionStart'in active?active.selectionStart:null;
  const views={lookup:lookupView,partners:partnersView,programs:programsView,profile:profileView,history:historyView,data:dataView};
  app.innerHTML=shell((views[ui.view]||lookupView)());
  if(focusId) {
    const next=document.getElementById(focusId);
    if(next) { next.focus({preventScroll:true}); try { if(sel!==null)next.setSelectionRange(sel,sel); } catch {} }
  }
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
  return `<div class="table-wrap ${compact?'dashboard-table':''}"><table><thead><tr>${!compact?'<th><input type="checkbox" id="select-all" aria-label="보이는 거래처 모두 선택"></th>':''}<th>거래처</th><th>사업자 상태</th><th>최근 확인</th>${!compact?'<th>태그</th><th><span class="sr-only">작업</span></th>':''}</tr></thead><tbody>${rows.map(p=>`<tr>${!compact?`<td><input type="checkbox" class="partner-check" data-id="${esc(p.id)}" aria-label="${esc(p.name||formatBusinessNumber(p.businessNumber))} 선택" ${selected.has(p.id)?'checked':''}></td>`:''}<td><div class="company-cell"><span class="company-avatar">${esc((p.name||'사').slice(0,1))}</span><div><button class="partner-name" data-action="detail" data-id="${esc(p.id)}">${esc(p.name||'이름 미입력')}</button><span class="subline number">${formatBusinessNumber(p.businessNumber)}</span></div></div></td><td>${badge(p.lastCheck)}${p.lastCheck?.outcome!=='ok'&&p.lastSuccess?`<span class="subline">직전 성공: ${esc(p.lastSuccess.statusLabel||statusNames[p.lastSuccess.businessStatus])}</span>`:''}</td><td><span class="subline" style="margin:0">${p.lastCheck?esc(fmtTime(p.lastCheck.checkedAt)):'아직 확인 전'}</span></td>${!compact?`<td><div class="chip-list">${(p.tags||[]).map(t=>`<span class="badge neutral">${esc(t)}</span>`).join('')||'<span class="muted">—</span>'}</div></td><td><button class="icon-button" data-action="edit-partner" data-id="${esc(p.id)}" aria-label="${esc(p.name||'거래처')} 수정">${icon('edit')}</button></td>`:''}</tr>`).join('')}</tbody></table></div>`;
}
function lookupView() {
  return pageHeading('사업의 다음을, 한눈에.','사업자 확인부터 거래처 관리, 내 사업의 새로운 기회까지.',`<div class="button-row"><button class="button" data-action="import">${icon('upload')} 거래처 일괄 등록</button></div>`)+`
  <section class="card search-card" aria-label="사업자등록번호 조회">
    <div class="search-inner">
      <div class="mode-switch"><button class="${ui.mode==='partner'?'active':''}" data-action="lookup-mode" data-mode="partner">거래처 확인</button><button class="${ui.mode==='mine'?'active':''}" data-action="lookup-mode" data-mode="mine">내 사업 확인</button></div>
      <div class="search-title">${ui.mode==='mine'?'내 사업의 시작, 정확한 정보부터':'거래하기 전, 사업자부터 확인하세요'}</div>
      <p class="search-desc">사업자등록번호 10자리로 공개된 사업자 상태를 확인해요.</p>
      <form id="lookup-form"><div class="search-field">${icon('search')}<label class="sr-only" for="business-number">사업자등록번호</label><input id="business-number" name="businessNumber" inputmode="numeric" autocomplete="off" placeholder="사업자등록번호 10자리 입력" value="${esc(ui.lookupNumber)}" maxlength="20" required><button class="button primary" type="submit" ${ui.lookupBusy?'disabled':''}>${ui.lookupBusy?'<span class="spinner"></span>':'조회하기 '+icon('arrow')}</button></div><div id="lookup-error" class="field-error" role="alert"></div></form>
      <div class="search-meta"><span>${icon('shield')} 국세청 공개정보 기반</span><span>${icon('file')} 하이픈 없이 입력 가능</span><span>${icon('info')} 상호·주소는 출처별 제공 범위가 달라요</span></div>
    </div>
  </section>
  ${ui.lookup?lookupResultView():''}
  ${statsView()}
  <div class="content-grid">
    <section class="card"><div class="card-header"><h2>내 거래처 <span class="pill-label" style="margin-left:6px">${number(workspace.partners.length)}</span></h2><a class="text-button" href="./#partners" data-nav="partners">전체 보기 ${icon('chevron')}</a></div>
      ${workspace.partners.length?partnerTable(workspace.partners.slice(0,5),true):empty('folder','첫 거래처를 등록해 보세요','사업자번호를 조회하거나 CSV 파일로 등록하면<br>확인한 상태와 변경 기록을 함께 관리할 수 있어요.',`<button class="button light small" data-action="add-partner">${icon('plus')} 거래처 등록</button>`)}
      <div class="card-foot">조회 실패와 실제 사업자 상태 변화는 구분하여 기록해요.</div>
    </section>
    <div class="overview-side">
      <section class="card guide-card"><div class="section-row"><h2 class="section-title">더 확실한 판단을 위한 3단계</h2></div>
        <div class="guide-step"><span class="step-number">01</span><div><h3>사업자 상태 확인</h3><p>계속·휴업·폐업 여부와 과세유형을<br>공식 출처와 조회시각으로 확인해요.</p></div></div>
        <div class="guide-step"><span class="step-number">02</span><div><h3>거래처를 저장하고 비교</h3><p>여러 거래처를 한 번에 확인하고<br>직전 조회에서 달라진 내용을 살펴보세요.</p></div></div>
        <div class="guide-step"><span class="step-number">03</span><div><h3>내 사업의 기회 발견</h3><p>지역과 관심 분야로 관련 지원사업을 찾고<br>원문에서 신청조건을 확인하세요.</p></div></div>
      </section>
      <section class="card hint-card"><h3 style="font-size:12px">${icon('info')} 정보는 출처와 함께</h3><p>계속사업자 상태는 현재의 세무 등록 상태입니다.<br>거래 안전성이나 지급능력을 보증하지 않아요.</p></section>
    </div>
  </div>
  <section class="mini-banner"><span class="mini-visual">${icon('spark')}</span><div class="mini-text"><h3>내 사업에 어울리는 지원사업, 놓치지 마세요.</h3><p>프로필을 입력하면 지역·관심 분야를 바탕으로 관련 공고를 보여드려요.</p></div><a class="button light" href="./#programs" data-nav="programs">지원사업 찾기 ${icon('arrow')}</a></section>`;
}
function lookupResultView() {
  const r=ui.lookup;
  const commerce=ui.commerce;
  const registered=byNumber(r.businessNumber);
  const profile=commerce?.records?.[0];
  const insights=buildInsights(registered||{businessNumber:r.businessNumber,name:profile?.name||'',lastCheck:r,lastSuccess:r.outcome==='ok'?r:null,history:[r]});
  return `<section class="card result-panel" aria-live="polite"><div class="card-header"><div><h2>${esc(profile?.name||registered?.name||'사업자 조회 결과')}</h2><span class="subline">${formatBusinessNumber(r.businessNumber)}</span></div><div class="button-row">${badge(r)}<button class="icon-button" data-action="close-result" aria-label="조회 결과 접기">${icon('x')}</button></div></div><div class="result-body">
    ${r.outcome!=='ok'?`<div class="callout ${r.outcome==='error'?'warning':''}">${icon('info')}<span>${esc(r.message||'이 출처에서 사업자 정보를 확인하지 못했습니다.')}${r.outcome==='not_configured'?' 거래처를 먼저 저장해 두고 연결 후 다시 확인할 수 있어요.':''}</span></div>`:''}
    <dl class="detail-grid"><div class="detail-fact"><dt>사업자 상태</dt><dd>${r.outcome==='ok'?esc(r.statusLabel||statusNames[r.businessStatus]):'미확인'}<small>${esc(getSourceName(r.source))}</small></dd></div><div class="detail-fact"><dt>과세유형</dt><dd>${esc(r.taxType||'미확인')}<small>조회 응답 기준</small></dd></div>${r.closedAt?`<div class="detail-fact"><dt>폐업일</dt><dd>${esc(fmtDate(r.closedAt))}</dd></div>`:''}${profile?`<div class="detail-fact"><dt>통신판매 등록 상호</dt><dd>${esc(profile.name||'미제공')}<small>공정거래위원회 · 번호 일치 자료</small></dd></div><div class="detail-fact"><dt>공개 사업장 주소</dt><dd>${esc(profile.address||'미제공')}<small>등록 자료의 주소</small></dd></div>`:''}</dl>
    ${insights.slice(0,3).map(insight=>`<div class="insight-card ${esc(insight.tone)}">${icon(insight.tone==='warning'?'info':'shield')}<div><h3>${esc(insight.title)}</h3><p>${esc(insight.description)}</p>${insight.action?`<div class="insight-action">${esc(insight.action)}</div>`:''}</div></div>`).join('')}
    <div class="source-info-line">${external(getSourceUrl(r),getSourceName(r.source))} · 조회시각 ${esc(fmtTime(r.checkedAt))}${commerce?` · 통신판매: ${commerce.outcome==='ok'?number(commerce.records?.length||0)+'건 확인':commerce.outcome==='not_found'?'해당 자료 없음':'미확인'}`:''}</div>
    <div class="button-row result-note"><button class="button primary small" data-action="save-lookup">${icon(registered?'edit':'plus')} ${registered?'거래처 정보 수정':'거래처에 저장'}</button>${ui.mode==='mine'?`<button class="button light small" data-action="use-mine">내 사업으로 입력 ${icon('arrow')}</button>`:''}<button class="button small" data-action="validate-open">${icon('check')} 등록정보 진위 대조</button><a class="text-button" href="./#data" data-nav="data">연동 상태 보기 ${icon('chevron')}</a></div>
  </div></section>`;
}
function filteredPartners() {
  return workspace.partners.filter(p=>{
    const q=ui.partnerQuery.toLowerCase().trim();
    if(q&&!(p.name+' '+p.businessNumber+' '+formatBusinessNumber(p.businessNumber)+' '+(p.tags||[]).join(' ')).toLowerCase().includes(q))return false;
    if(ui.partnerStatus==='all')return true;
    if(ui.partnerStatus==='unchecked')return !p.lastSuccess;
    if(ui.partnerStatus==='error')return p.lastCheck&&['error','not_configured','not_found'].includes(p.lastCheck.outcome);
    return p.lastCheck?.outcome==='ok'&&p.lastCheck.businessStatus===ui.partnerStatus;
  });
}
function partnersView() {
  const rows=filteredPartners();
  return pageHeading('함께하는 거래처를 한눈에','확인한 사실은 남기고, 달라진 정보는 다시 살펴보세요.',`<div class="button-row"><button class="button" data-action="import">${icon('upload')} CSV 가져오기</button><button class="button primary" data-action="add-partner">${icon('plus')} 거래처 등록</button></div>`)+`
  <div class="callout">${icon('shield')}<span>거래처·메모·확인 기록은 <strong>이 브라우저에만 저장</strong>됩니다. 다른 기기로 옮길 때는 백업 파일을 이용하세요.</span></div>
  <div class="toolbar"><div class="filter-group"><div class="input-wrap">${icon('search')}<input id="partner-search" placeholder="업체명, 사업자번호, 태그 검색" value="${esc(ui.partnerQuery)}" aria-label="거래처 검색"></div><select id="partner-status" class="filter-select" aria-label="거래처 상태 필터"><option value="all">모든 상태</option>${[['active','계속사업자'],['suspended','휴업자'],['closed','폐업자'],['unchecked','확인 전'],['error','미확인·조회 실패']].map(([v,t])=>`<option value="${v}" ${ui.partnerStatus===v?'selected':''}>${t}</option>`).join('')}</select></div><div class="button-row"><button class="button small" data-action="export-csv" ${!workspace.partners.length?'disabled':''}>${icon('download')} CSV</button><button class="button small" data-action="import">${icon('upload')} 가져오기</button><button class="button light small" data-action="add-partner">${icon('plus')} 등록</button></div></div>
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
  return `<article class="card program-card"><div class="program-top"><span class="program-source">${esc(p.agency||p.source||'지원기관 확인')}</span><span class="badge ${tone}">${label}</span></div><h3>${esc(p.title)}</h3><div class="program-meta"><span>${icon('location')}${esc((p.regions||[]).slice(0,3).join(' · ')||'지역 원문 확인')}</span><span>${icon('tag')}${esc((p.categories||[]).slice(0,2).join(' · ')||'분야 원문 확인')}</span></div><div class="program-reasons">${esc(reasons.join(' · ')||'원문에서 업력·규모·제외조건을 확인해 주세요.')}</div><div class="program-bottom"><span class="deadline">${icon('calendar')} ${p.endDate?esc(fmtDate(p.endDate))+' 마감':'마감일 원문 확인'}</span><button class="text-button" data-action="program-detail" data-id="${esc(p.id)}">조건·원문 보기 ${icon('arrow')}</button></div></article>`;
}
function profileView() {
  const p=ui.profileDraft||workspace.profile;
  return pageHeading('내 사업을 알려주세요','공개정보로 채워지지 않는 항목을 보완하면, 기회를 찾기 쉬워져요.')+`
  <div class="profile-layout"><form id="profile-form" class="card form-card">
  <div class="section-row"><h2 class="section-title">사업 프로필</h2><span class="mode-label">이 브라우저에 저장</span></div>
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
  </form><aside><section class="card guide-card"><h2 class="section-title">프로필로 할 수 있는 일</h2><div class="guide-step"><span class="step-number">01</span><div><h3>지역에 관련된 공고 찾기</h3><p>사업장 소재지와 공고에 기재된 지역을 참고합니다. 지역은 지원 대상이 아닌 수행지역일 수도 있어 원문을 함께 확인해요.</p></div></div><div class="guide-step"><span class="step-number">02</span><div><h3>관심 분야 먼저 보기</h3><p>창업·기술·금융 등 내게 필요한 분야의 관련 공고를 먼저 탐색하세요.</p></div></div><div class="guide-step"><span class="step-number">03</span><div><h3>부족한 조건 확인</h3><p>미입력 값은 0이나 조건 충족으로 바꾸지 않습니다. 공고별로 추가 확인이 필요한 내용을 표시해요.</p></div></div></section><div class="callout" style="margin-top:17px">${icon('shield')}<span>매출·인원 정보는 추천을 살펴보기 위한 입력값입니다. 현재 서버로 자동 전송하지 않습니다.</span></div></aside></div>`;
}
function historyView() {
  return pageHeading('달라진 정보를 놓치지 않도록','성공한 조회끼리 비교한 상태 변화와 일괄 확인 기록을 모았어요.',`<div class="button-row"><button class="button" data-action="acknowledge-all" ${!workspace.events.some(e=>!e.acknowledgedAt)?'disabled':''}>${icon('check')} 모두 확인함</button></div>`)+`
  <div class="content-grid"><section class="card"><div class="card-header"><h2>상태 변화 <span class="pill-label">${number(workspace.events.length)}</span></h2></div>
    ${workspace.events.length?`<div class="timeline">${workspace.events.slice(0,100).map(e=>`<article class="timeline-item"><span class="timeline-icon">${icon('bell')}</span><div class="timeline-content"><h3>${esc(byId(e.partnerId)?.name||formatBusinessNumber(e.businessNumber))} · ${esc(e.title||'사업자 상태 변경')}</h3><p>${esc(e.message||(statusNames[e.from]||e.from)+' → '+(statusNames[e.to]||e.to))}</p><div style="margin-top:7px">${e.acknowledgedAt?'<span class="badge neutral">확인함</span>':`<button class="text-button" data-action="acknowledge" data-id="${esc(e.id)}">${icon('check')} 확인함</button>`}</div></div><span class="timeline-date">${esc(fmtTime(e.occurredAt))}</span></article>`).join('')}</div>`:empty('clock','확인된 상태 변화가 없어요','거래처를 두 번 이상 정상 조회하면<br>이전 성공 결과와 달라진 상태가 이곳에 표시됩니다.')}
    <div class="card-foot">알림 시각은 앱이 변화를 확인한 시각이며, 실제 변경 발생일과 다를 수 있어요.</div>
  </section><section class="card"><div class="card-header"><h2>일괄 확인 기록</h2></div>${workspace.checks.length?`<div class="timeline">${workspace.checks.slice(0,15).map(c=>`<div class="timeline-item"><span class="timeline-icon">${icon('check')}</span><div class="timeline-content"><h3>${number(c.total)}곳 상태 확인</h3><p>응답 확인 ${number(c.ok)} · 미확인/실패 ${number(c.failed)}<br>${esc(fmtTime(c.checkedAt))}</p></div></div>`).join('')}</div>`:empty('file','첫 확인 기록을 기다리고 있어요','거래처 관리에서 전체 또는 선택한 거래처의 상태를 확인해 보세요.',`<a class="button light small" href="./#partners" data-nav="partners">거래처 관리</a>`)}</section></div>`;
}
function dataView() {
  const nts=health?.providers?.nts,ftc=health?.providers?.ftc;
  const rows=[
    {name:'국세청 · 사업자등록정보',description:'계속·휴업·폐업 상태, 과세유형, 입력 등록정보 진위 대조',url:'https://www.data.go.kr/data/15081808/openapi.do',value:nts?.configured?'연결 설정됨':health?'인증키 설정 필요':'서버 연결 확인 필요',tone:nts?.configured?'positive':'neutral'},
    {name:'공정거래위원회 · 통신판매업',description:'사업자번호가 정확히 일치하는 공개 등록정보',url:'https://www.data.go.kr/data/15126315/openapi.do',value:ftc?.configured?'연결 설정됨':health?'인증키 설정 필요':'서버 연결 확인 필요',tone:ftc?.configured?'positive':'neutral'},
    {name:'지원한눈 · 공개 지원사업 목록',description:'기존 공개 공고의 제목·지역·분야·일정·원문 링크 연결',url:'https://softm.github.io/softm.policyfundfinder/',value:programLoading?'불러오는 중':programs.length?number(programs.length)+'건':'수집 결과 없음',tone:programs.length?'positive':'neutral'}
  ];
  return pageHeading('데이터는 투명하게, 판단은 정확하게','실제 연결 상태와 수집 결과, 데이터의 출처·기준일을 확인하세요.',`<div class="button-row"><button class="button" data-action="refresh-health">${icon('refresh')} 상태 새로고침</button></div>`)+`
  <div class="callout">${icon('info')}<span>API 설정 여부와 실제 조회 성공은 다릅니다. 개별 사업자 화면에는 <strong>조회 응답·출처·조회시각</strong>을 함께 표시합니다.</span></div>
  <div class="section-spacer source-list">${rows.map(r=>`<section class="card source-card"><div><h3>${r.name}</h3><p>${r.description}</p></div><div class="source-status"><span class="badge ${r.tone} dot">${r.value}</span>${external(r.url,'출처','button small')}</div></section>`).join('')}</div>
  <div class="content-grid section-spacer"><section class="card"><div class="card-header"><h2>지원사업 수집 결과</h2><span class="pill-label">실제 파일 기준</span></div><table class="status-table"><tbody>
    <tr><td>불러온 공고</td><td>${number(programs.length)}건</td></tr>
    <tr><td>마지막 성공</td><td>${esc(fmtTime(collection.lastSuccessAt||programMeta.collectedAt||programMeta.generatedAt||programMeta.lastSuccessfulAt))}</td></tr>
    <tr><td>원천 목록 갱신</td><td>${esc(fmtTime(collection.upstreamLastSuccessAt||programMeta.upstreamLastSuccessAt))}</td></tr>
    ${collection.upstreamSources?.bizinfo?.lastSuccessAt?`<tr><td>기업마당 원천 기준</td><td>${esc(fmtTime(collection.upstreamSources.bizinfo.lastSuccessAt))}</td></tr>`:''}
    <tr><td>마지막 수집 시도</td><td>${esc(fmtTime(collection.lastAttemptAt||collection.attemptedAt))}</td></tr>
    <tr><td>수집 상태</td><td>${esc(({success:'수집 완료',failed:'최근 수집 실패',not_collected:'미수집'})[collection.status||programMeta.status]||(programs.length?'자료 불러옴':'미수집'))}</td></tr>
    <tr><td>원천 목록 수</td><td>${number(collection.sourceCount||collection.inputCount||programMeta.sourceCount||programs.length)}건</td></tr>
    <tr><td>연결 범위</td><td>${esc(collection.selectionPolicy||programMeta.selectionPolicy||'수집 상태 확인 필요')}${collection.selectionLimit?` · 최대 ${number(collection.selectionLimit)}건`:''}</td></tr>
    <tr><td>제외·누락</td><td>${number(collection.excludedCount||collection.skippedCount||0)}건 · ${esc(collection.message||'수집 상세는 상태 JSON에서 확인')}</td></tr>
  </tbody></table><div class="card-foot"><a class="text-button" href="./data/collection-status.json" target="_blank" rel="noopener">수집 상태 JSON 보기 ${icon('external')}</a></div></section>
  <section class="card guide-card"><h2 class="section-title">조회 서버 연결</h2><p class="fine-print" style="margin-top:10px">현재 연결 주소</p><p class="mono" style="overflow-wrap:anywhere;margin:8px 0 13px">${esc(currentApiBase()||location.origin+' (동일 서버)')}</p>${healthError?`<div class="callout warning" style="margin-bottom:14px">${icon('info')}<span>${esc(healthError)}</span></div>`:''}<div class="button-row"><button class="button small" data-action="connection-settings">${icon('link')} 서버 주소 설정</button><button class="button small" data-action="refresh-health">${icon('refresh')} 상태 확인</button></div><p class="fine-print" style="margin-top:13px">API 인증키는 서버 환경변수에만 보관합니다. 브라우저에는 인증키를 입력하거나 저장하지 않습니다.</p><div class="divider"></div><h3 style="font-size:12px">앞으로 연결할 데이터</h3><p class="fine-print" style="margin-top:8px">법인 공개재무·국민연금·업종별 인허가는 대상 식별과 이용 조건을 검증한 뒤 확장합니다. 현재 조회되는 정보로 표시하지 않습니다.</p></section></div>`;
}


function openModal(title,body,wide=false) {
  previousFocus=document.activeElement;
  modal={title,body,wide};
  modalRoot.innerHTML=`<div class="modal-backdrop" data-action="close-modal-backdrop"><section class="modal ${wide?'wide':''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><h2 id="modal-title">${title}</h2><button class="icon-button" data-action="close-modal" aria-label="창 닫기">${icon('x')}</button></header><div class="modal-body">${body}</div></section></div>`;
  document.body.style.overflow='hidden';
  setTimeout(()=>modalRoot.querySelector('input:not([type=hidden]),textarea,select,button')?.focus(),0);
}
function closeModal() {
  modal=null;
  modalRoot.replaceChildren();
  document.body.style.overflow='';
  previousFocus?.isConnected&&previousFocus.focus({preventScroll:true});
}
function partnerModal(partner,seed={}) {
  const p=partner||seed;
  openModal(partner?'거래처 정보 수정':'새 거래처 등록',`<form id="partner-form" data-id="${esc(partner?.id||'')}"><div class="form-grid">
  <div class="form-field full-span"><label for="partner-number">사업자등록번호 <span class="muted">(필수)</span></label><input id="partner-number" name="businessNumber" inputmode="numeric" maxlength="20" required value="${esc(formatBusinessNumber(p.businessNumber||''))}" ${partner?'readonly':''} placeholder="000-00-00000"><span class="hint">번호 형식 검사는 국세청 상태 조회나 본인 인증과 다릅니다.</span></div>
  <div class="form-field full-span"><label for="partner-name">업체명</label><input id="partner-name" name="name" maxlength="200" value="${esc(p.name||'')}" placeholder="공개자료 또는 서류에서 확인한 이름"><span class="hint">직접 입력한 이름은 사용자 제공 정보로 저장합니다.</span></div>
  <div class="form-field full-span"><label for="partner-tags">태그</label><input id="partner-tags" name="tags" maxlength="500" value="${esc((p.tags||[]).join(', '))}" placeholder="예: 정기 거래, 납품, 확인 필요"></div>
  <div class="form-field full-span"><label for="partner-note">메모</label><textarea id="partner-note" name="note" maxlength="5000" placeholder="다음에 확인할 내용이나 거래처 관련 메모">${esc(p.note||'')}</textarea></div></div><div id="partner-form-error" class="field-error" role="alert"></div><div class="modal-actions">${partner?`<button class="button danger" type="button" data-action="delete-confirm" data-id="${esc(partner.id)}">${icon('trash')} 삭제</button>`:''}<button class="button" type="button" data-action="close-modal">취소</button><button class="button primary" type="submit">${icon('check')} 저장</button></div></form>`);
}
function detailModal(partner) {
  if(!partner)return;
  const last=partner.lastCheck,success=partner.lastSuccess;
  const insights=buildInsights(partner);
  openModal('거래처 확인 기록',`<div class="profile-summary"><span class="company-avatar">${esc((partner.name||'사').slice(0,1))}</span><div><h2 style="font-size:18px">${esc(partner.name||'이름 미입력')}</h2><p class="number">${formatBusinessNumber(partner.businessNumber)}</p></div><div style="margin-left:auto">${badge(last)}</div></div>
  <dl class="detail-grid"><div class="detail-fact"><dt>마지막 성공 조회의 상태</dt><dd>${esc(success?.statusLabel||'미확인')}<small>${esc(fmtTime(success?.checkedAt))}</small></dd></div><div class="detail-fact"><dt>과세유형</dt><dd>${esc(success?.taxType||'미확인')}</dd></div><div class="detail-fact"><dt>이름의 출처</dt><dd>사용자 입력<small>대표자·관리자 인증과 별개입니다.</small></dd></div><div class="detail-fact"><dt>등록일</dt><dd>${esc(fmtDate(partner.createdAt))}</dd></div></dl>
  ${insights.map(i=>`<div class="insight-card ${esc(i.tone)}">${icon('info')}<div><h3>${esc(i.title)}</h3><p>${esc(i.description)}</p><div class="insight-action">${esc(i.action||'')}</div></div></div>`).join('')}
  <div class="divider"></div><div class="section-row"><h3 style="font-size:13px">메모</h3><div class="chip-list">${(partner.tags||[]).map(t=>`<span class="badge neutral">${esc(t)}</span>`).join('')}</div></div><p style="white-space:pre-wrap;font-size:12px;color:#7c8f6d">${esc(partner.note||'등록된 메모가 없습니다.')}</p>
  <div class="divider"></div><h3 style="font-size:13px;margin-bottom:12px">최근 조회 이력</h3>
  ${partner.history?.length?`<div class="table-wrap"><table><thead><tr><th>조회시각</th><th>결과</th><th>출처</th></tr></thead><tbody>${partner.history.slice(0,10).map(h=>`<tr><td>${esc(fmtTime(h.checkedAt))}</td><td>${badge(h)}</td><td>${external(getSourceUrl(h),getSourceName(h.source))}</td></tr>`).join('')}</tbody></table></div>`:'<p class="fine-print">아직 조회 이력이 없습니다.</p>'}
  <div class="modal-actions"><button class="button" data-action="edit-partner" data-id="${esc(partner.id)}">${icon('edit')} 정보 수정</button><button class="button primary" data-action="check-one" data-id="${esc(partner.id)}">${icon('refresh')} 다시 확인</button></div>`,true);
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
  openModal('조회 서버 연결',`<form id="connection-form"><div class="callout">${icon('shield')}<span>서버의 HTTPS 주소만 입력합니다. 국세청·공정위 인증키는 여기에 입력하지 마세요.</span></div><div class="form-field" style="margin-top:17px"><label for="api-base">API 서버 주소</label><input id="api-base" name="apiBase" type="url" value="${esc(currentApiBase())}" placeholder="https://내-프로젝트.vercel.app"><span class="hint">입력한 서버로 조회할 사업자번호가 전달됩니다. 본인이 운영하거나 신뢰하는 서버만 사용하세요.</span></div><div id="connection-error" class="field-error" role="alert"></div><div class="modal-actions"><button class="button" type="button" data-action="close-modal">취소</button><button class="button primary" type="submit">저장하고 연결 확인</button></div></form>`);
}
function validateModal() {
  if(!ui.lookup)return;
  openModal('등록정보 진위 대조',`<form id="validate-form"><p class="fine-print">사업자등록증의 개업일과 대표자명을 국세청 입력값과 대조합니다. 대표자 본인 인증이나 문서 원본 인증 기능은 아닙니다.</p><div class="form-grid" style="margin-top:17px"><div class="form-field full-span"><label>사업자등록번호</label><input readonly name="b_no" value="${formatBusinessNumber(ui.lookup.businessNumber)}"></div><div class="form-field"><label for="validation-date">개업일</label><input id="validation-date" name="start_dt" type="date" required></div><div class="form-field"><label for="validation-name">대표자명</label><input id="validation-name" name="p_nm" maxlength="100" required autocomplete="off"></div></div><p class="fine-print" style="margin-top:12px">확인 버튼을 누르면 입력값을 조회 서버를 통해 국세청으로 전달합니다. 대표자명·개업일은 이 앱의 거래처 기록에 저장하지 않습니다.</p><div id="validation-result" aria-live="polite"></div><div class="modal-actions"><button class="button" type="button" data-action="close-modal">닫기</button><button class="button primary" type="submit">입력정보 확인</button></div></form>`);
}
function privacyModal() {
  openModal('개인정보와 보관 안내',`<div class="source-list"><div><h3>내 브라우저에 보관하는 정보</h3><p class="fine-print">거래처 목록, 메모, 입력 프로필, 확인 이력은 이 기기의 IndexedDB에 저장합니다. 로그인·다른 기기 동기화·팀 공유는 현재 제공하지 않습니다. 브라우저 데이터를 삭제하면 기록이 없어질 수 있으니 백업 파일을 보관하세요.</p></div><div><h3>조회할 때 전달하는 정보</h3><p class="fine-print">상태조회는 사업자번호, 진위 대조는 사용자가 입력한 번호·개업일·대표자명을 설정된 조회 서버와 해당 기관으로 전달합니다. 내 사업 매출·직원 수·거래 메모는 전송하지 않습니다.</p></div><div><h3>백업과 삭제</h3><p class="fine-print">거래처 관리에서 CSV 내보내기 또는 전체 JSON 백업을 할 수 있습니다. 개별 거래처 삭제 시 해당 거래처의 메모·확인 이력·변경 기록도 함께 삭제합니다. 백업에는 내부 메모가 포함되므로 필요한 사람에게만 전달하세요.</p></div><div><h3>공개정보의 해석</h3><p class="fine-print">사업자한눈은 독립적인 민간 서비스입니다. 정보의 기준일·출처를 확인하세요. 사업자 상태와 통신판매 신고는 거래 안전성이나 신용등급을 의미하지 않습니다.</p></div></div><div class="modal-actions"><button class="button primary" data-action="close-modal">확인</button></div>`);
}
function helpModal() {
  openModal('사업자한눈 이용 안내',`<div class="guide-step"><span class="step-number">01</span><div><h3>사업자번호 조회</h3><p>번호 10자리를 입력하면 연결된 국세청 API의 상태를 확인합니다. 제공되지 않은 상호·주소는 미확인으로 표시합니다.</p></div></div><div class="guide-step"><span class="step-number">02</span><div><h3>거래처 등록과 확인</h3><p>거래처를 직접 등록하거나 CSV로 가져오세요. 여러 업체의 상태를 한 번에 확인하고, 실제 성공 응답끼리 비교한 변경 기록을 볼 수 있습니다.</p></div></div><div class="guide-step"><span class="step-number">03</span><div><h3>지원사업 탐색</h3><p>내 사업 프로필을 저장한 뒤 지역·관심 분야가 관련된 공고를 살펴보세요. 자격조건·제외 대상·접수일정은 항상 원문에서 확인합니다.</p></div></div><div class="callout" style="margin-top:15px">${icon('info')}<span>조회가 연결 대기로 보이면 데이터 현황에서 운영 서버와 API 설정 상태를 확인하세요. 조회 없이 거래처 등록·메모·백업을 사용할 수 있습니다.</span></div><div class="modal-actions"><button class="button primary" data-action="close-modal">시작하기</button></div>`);
}
function go(view) {
  if(!titles[view])return;
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
async function lookup(value) {
  const bno=normalizeBusinessNumber(value);
  ui.lookupNumber=value;
  if(!isValidBusinessNumber(value)) {
    const el=document.getElementById('lookup-error');
    if(el)el.textContent='사업자등록번호 10자리와 검증번호를 확인해 주세요.';
    return;
  }
  const serial=++lookupSerial;
  ui.lookupBusy=true;ui.commerce=null;render();
  try {
    const result=await callApi('status',{businessNumbers:[bno]},currentApiBase());
    if(serial!==lookupSerial)return;
    const match=Array.isArray(result.results)?result.results.find(r=>r.businessNumber===bno):null;
    ui.lookup=match||failureResult(bno,new Error('사업자번호와 일치하는 조회 응답을 확인하지 못했습니다.'));
  } catch(error) {
    if(serial!==lookupSerial)return;
    ui.lookup=failureResult(bno,error);
  } finally {if(serial===lookupSerial){ui.lookupBusy=false;render();}}
  if(serial!==lookupSerial)return;
  if(byNumber(bno)) {
    const applied=applyCheckResults(workspace.partners,[ui.lookup]);
    await persist({...workspace,partners:applied.partners,events:dedupeEvents(workspace.events,applied.events)});
  }
  if(health?.providers?.ftc?.configured) {
    try {const result=await callApi('commerce',{businessNumber:bno},currentApiBase());if(serial===lookupSerial){ui.commerce=result;render();}}
    catch(error){if(serial===lookupSerial){ui.commerce={outcome:'error',message:error.message,records:[]};render();}}
  }
}
async function batchCheck(ids) {
  if(ui.batchBusy)return;
  const targets=workspace.partners.filter(p=>ids.includes(p.id));
  if(!targets.length)return;
  ui.batchBusy=true;ui.batchTotal=targets.length;ui.batchDone=0;render();
  const all=[];
  try {
    for(let offset=0;offset<targets.length;offset+=100) {
      const chunk=targets.slice(offset,offset+100);
      let results;
      try {
        const payload=await callApi('status',{businessNumbers:chunk.map(p=>p.businessNumber)},currentApiBase());
        results=chunk.map(p=>(Array.isArray(payload.results)?payload.results:[]).find(r=>r.businessNumber===p.businessNumber)||failureResult(p.businessNumber,new Error('응답에 이 사업자번호가 없어 확인하지 못했습니다.')));
      } catch(error){results=chunk.map(p=>failureResult(p.businessNumber,error));}
      all.push(...results);
      const applied=applyCheckResults(workspace.partners,results);
      const saved=await persist({...workspace,partners:applied.partners,events:dedupeEvents(workspace.events,applied.events)});
      ui.batchDone+=chunk.length;render();
      if(!saved)break;
      if(results.every(r=>r.outcome==='not_configured')) {
        if(offset+100<targets.length)toast('조회 연결을 준비 중이어서 나머지 요청을 중단했습니다.',true);
        break;
      }
    }
    const check={id:crypto.randomUUID(),total:all.length,ok:all.filter(r=>r.outcome==='ok').length,failed:all.filter(r=>r.outcome!=='ok').length,checkedAt:new Date().toISOString()};
    if(all.length)await persist({...workspace,checks:[check,...workspace.checks].slice(0,100)});
    toast(`${check.total}곳 확인 시도 · 응답 확인 ${check.ok}곳, 미확인/실패 ${check.failed}곳`,check.failed>0);
  } finally {ui.batchBusy=false;render();}
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
  let p={...old,id:old?.id||crypto.randomUUID(),businessNumber:bno,name:String(data.get('name')||'').trim().slice(0,200),tags:[...new Set(String(data.get('tags')||'').split(/[,;|]/).map(t=>t.trim()).filter(Boolean))].slice(0,10),note:String(data.get('note')||'').slice(0,5000),createdAt:old?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString(),history:old?.history||[]};
  if(ui.lookup?.businessNumber===bno&&!old) p=applyCheckResults([p],[ui.lookup]).partners[0];
  const partners=old?workspace.partners.map(item=>item.id===old.id?p:item):[p,...workspace.partners];
  if(await persist({...workspace,partners})){closeModal();toast('거래처를 저장했습니다.');}
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
    interests:data.getAll('interests').map(String),providedBy:'user',updatedAt:new Date().toISOString()
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

document.addEventListener('submit',async event=>{
  const form=event.target;
  if(!['lookup-form','partner-form','profile-form','connection-form','validate-form'].includes(form.id))return;
  event.preventDefault();
  if(form.id==='lookup-form')await lookup(String(new FormData(form).get('businessNumber')));
  if(form.id==='partner-form')await savePartner(form);
  if(form.id==='profile-form')await saveProfile(form);
  if(form.id==='validate-form')await validateRegistration(form);
  if(form.id==='connection-form') {
    try {
      const base=validateApiBase(String(new FormData(form).get('apiBase')||''));
      if(await persist({...workspace,preferences:{...workspace.preferences,apiBase:base}})){closeModal();await checkHealth();toast(health?'서버 연결 상태를 확인했습니다.':'서버 연결 상태를 확인해 주세요.',!health);}
    } catch(error){document.getElementById('connection-error').textContent=error.message;}
  }
});
function captureProfileDraft(form) {
  const data=new FormData(form);
  ui.profileDraft={...Object.fromEntries(data),interests:data.getAll('interests').map(String)};
}
document.addEventListener('input',event=>{
  const t=event.target;
  if(t.closest('#profile-form'))captureProfileDraft(t.closest('form'));
  if(t.id==='business-number')ui.lookupNumber=t.value;
  if(t.id==='partner-search'){ui.partnerQuery=t.value;render();}
  if(t.id==='program-search'){ui.programQuery=t.value;ui.page=1;render();}
  if(t.id==='import-text'){importState.parsed=null;document.getElementById('confirm-import').disabled=true;document.getElementById('import-preview').replaceChildren();}
});
document.addEventListener('change',async event=>{
  const t=event.target;
  if(t.closest('#profile-form'))captureProfileDraft(t.closest('form'));
  if(t.id==='partner-status'){ui.partnerStatus=t.value;render();}
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
  if(action==='close-modal-backdrop'){if(event.target===element)closeModal();return;}
  if(action==='close-modal'){closeModal();return;}
  if(action==='toggle-menu'){ui.mobileMenu=!ui.mobileMenu;render();return;}
  if(action==='goto-history'){go('history');return;}
  if(action==='lookup-mode'){ui.mode=element.dataset.mode;render();return;}
  if(action==='close-result'){lookupSerial++;ui.lookup=null;ui.lookupBusy=false;ui.commerce=null;render();return;}
  if(action==='add-partner'){partnerModal();return;}
  if(action==='edit-partner'){partnerModal(byId(id));return;}
  if(action==='detail'){detailModal(byId(id));return;}
  if(action==='save-lookup'){partnerModal(byNumber(ui.lookup.businessNumber),{businessNumber:ui.lookup.businessNumber,name:ui.commerce?.records?.[0]?.name||''});return;}
  if(action==='use-mine'){
    const name=ui.commerce?.records?.[0]?.name||workspace.profile.name||'';
    if(await persist({...workspace,profile:{...workspace.profile,businessNumber:ui.lookup.businessNumber,name,providedBy:'user'}}))go('profile');
    return;
  }
  if(action==='check-one'){closeModal();await batchCheck([id]);detailModal(byId(id));return;}
  if(action==='batch-check'){await batchCheck(element.dataset.scope==='selected'?[...selected]:workspace.partners.map(p=>p.id));return;}
  if(action==='deselect'){selected.clear();render();return;}
  if(action==='delete-confirm'){
    const p=byId(id);if(!p)return;
    openModal('거래처 삭제',`<p style="font-size:13px"><strong>${esc(p.name||formatBusinessNumber(p.businessNumber))}</strong>의 메모, 확인 이력과 변경 기록을 이 브라우저에서 삭제합니다.</p><div class="modal-actions"><button class="button" data-action="close-modal">취소</button><button class="button danger" data-action="delete-partner" data-id="${esc(id)}">삭제</button></div>`);return;
  }
  if(action==='delete-partner'){
    if(await persist({...workspace,partners:workspace.partners.filter(p=>p.id!==id),events:workspace.events.filter(e=>e.partnerId!==id)})){selected.delete(id);closeModal();toast('거래처와 관련 기록을 삭제했습니다.');}return;
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
  if(action==='export-csv'){downloadText('사업자한눈_거래처_'+new Date().toISOString().slice(0,10)+'.csv',exportPartnersCsv(workspace.partners),'text/csv;charset=utf-8');return;}
  if(action==='backup'){downloadText('사업자한눈_전체백업_'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify({...workspace,preferences:{}},null,2),'application/json');toast('전체 백업 파일을 만들었습니다. 내부 메모가 포함되어 있습니다.');return;}
  if(action==='restore-open'){
    openModal('백업 복원',`<p class="fine-print">사업자한눈에서 내보낸 JSON 백업 파일을 선택하세요. 복원 시 현재 거래처·프로필·확인 기록이 파일 내용으로 교체됩니다.</p><div class="form-field" style="margin-top:15px"><label for="restore-file">백업 파일</label><input id="restore-file" type="file" accept=".json,application/json"></div><div id="restore-preview"></div><div class="modal-actions"><button class="button" data-action="backup">먼저 현재 정보 백업</button><button class="button primary" id="confirm-restore" data-action="restore-confirm" disabled>확인한 백업으로 교체</button></div>`);return;
  }
  if(action==='restore-confirm'){
    const restored=modal?.restore;
    if(restored&&await persist({...restored,revision:workspace.revision,preferences:workspace.preferences})){selected.clear();ui.profileDraft=null;closeModal();render();toast('백업을 복원했습니다.');}return;
  }
  if(action==='category'){ui.programCategory=element.dataset.category;ui.page=1;render();return;}
  if(action==='program-detail'){programModal(id);return;}
  if(action==='prev-page'||action==='next-page'){ui.page+=action==='prev-page'?-1:1;render();document.getElementById('main-content').scrollIntoView({behavior:'instant'});return;}
  if(action==='reload-programs'){await refreshPrograms();return;}
  if(action==='acknowledge'||action==='acknowledge-all'){
    const events=workspace.events.map(e=>(action==='acknowledge-all'||e.id===id)&&!e.acknowledgedAt?{...e,acknowledgedAt:new Date().toISOString()}:e);
    if(await persist({...workspace,events}))toast('확인한 기록으로 표시했습니다.');return;
  }
  if(action==='refresh-health'){await checkHealth();return;}
  if(action==='connection-settings'){connectionModal();return;}
  if(action==='validate-open'){validateModal();return;}
  if(action==='privacy'){privacyModal();return;}
  if(action==='help'){helpModal();return;}
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape') {if(modal)closeModal();else if(ui.mobileMenu){ui.mobileMenu=false;render();}}
  if(event.key==='Tab'&&modal) {
    const focusable=[...modalRoot.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select,textarea,[tabindex="0"]')];
    const first=focusable[0],last=focusable.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
});
window.addEventListener('hashchange',()=>{
  const view=location.hash.slice(1).split('?')[0];
  if(titles[view]){ui.view=view;ui.mobileMenu=false;if(modal)closeModal();render();}
});

try {workspace=await loadWorkspace();}
catch(error){storageError='이 브라우저에서 기록을 불러오지 못했습니다. 저장 기능을 사용하려면 브라우저 저장소 설정을 확인해 주세요.';}
if(!titles[ui.view])ui.view='lookup';
render();
Promise.allSettled([checkHealth(),refreshPrograms()]);

