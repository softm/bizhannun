import { formatBusinessNumber, normalizeBusinessNumber } from './domain.mjs';
import { ENRICHMENT_FIELDS, safeEnrichmentUrl, summarizeEnrichment } from './enrichment.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const when = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('ko-KR', { timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short' }).format(new Date(value)) : '기록 없음';
const link = (url, title) => { const safe = safeEnrichmentUrl(url); return safe ? `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(title)} ↗</a>` : esc(title); };
export const collectionStatusLabel = status => ({success:'수집 완료',partial:'일부 수집',failed:'수집 실패',not_found:'조회 결과 없음',not_configured:'연동 설정 필요',not_collected:'아직 수집 전',identity_mismatch:'동일 사업자 확인 필요',error:'연결·활용승인 확인'})[status] || '확인 필요';

export function renderBusinessInsights(analysis) {
  if (!analysis) return '';
  const { metrics, insights, summary } = analysis;
  const publicSources = (summary?.sources || []).filter(source => ['public_data','registry'].includes(source.channel) && source.match !== 'candidate');
  return `<section class="business-insights" aria-label="사업자 정보 인사이트">
    <div class="section-row"><div><span class="eyebrow">확인한 정보로 다음 행동까지</span><h3>이 사업자에서 확인할 내용</h3></div><span class="badge neutral">출처 기반 점검</span></div>
    <div class="insight-metrics"><div><span>기본정보 확보</span><strong>${metrics.coverageCount}<small> / ${metrics.coverageTotal}종</small></strong></div><div><span>공공 등록 출처</span><strong>${publicSources.length}<small>개</small></strong></div><div><span>출처별 차이</span><strong>${metrics.conflictCount}<small>항목</small></strong></div><div><span>30일 이상 경과</span><strong>${metrics.staleCount}<small>항목</small></strong></div></div>
    <p class="fine-print">기본정보는 상호·주소·업종·웹사이트·업무 연락처 5종입니다. 확보 범위이며 신용점수나 거래 안전성 점수가 아닙니다.</p>
    ${insights.length ? `<div class="business-insight-list">${insights.slice(0,6).map(item => `<article class="business-insight ${item.tone === 'warning' ? 'warning' : ''}"><h4>${esc(item.title)}</h4><p>${esc(item.description)}</p><span>${esc(item.action || '원문 확인')}</span></article>`).join('')}</div>` : '<p class="callout">기본 공개정보가 연결되어 있습니다. 계약·지급 조건 등은 거래 서류에서 추가로 확인하세요.</p>'}
  </section>`;
}

export function renderCollectionDashboard(records, meta = {}, { loading = false, error = '' } = {}) {
  const rows = records.flatMap(record => (record.collection?.sourceStatuses || []).map(status => ({ ...status, businessNumber:record.businessNumber, company:summarizeEnrichment(record)?.profile?.name || formatBusinessNumber(record.businessNumber) })));
  const dates = records.flatMap(record => record.sources.filter(source => source.match !== 'candidate').map(source => source.collectedAt)).filter(Boolean).sort();
  const latest = dates.at(-1);
  const summaries = records.map(record => summarizeEnrichment(record));
  return `<section class="card collection-dashboard section-spacer" aria-label="사업자 공개정보 수집 현황">
    <div class="card-header"><div><h2>사업자 공개정보 수집 현황</h2><p>웹사이트·등록자료·검색 채널의 실제 실행 결과입니다.</p></div><button class="button small" data-action="reload-catalog" ${loading?'disabled':''}>${loading?'불러오는 중':'수집 결과 새로고침'}</button></div>
    <div class="collection-highlights"><div><span>자동 수집 주기</span><strong>${esc(meta.schedule?.label || '매일 오전 06:17 (한국 시간)')}</strong><small>공개 수집 대상으로 등록한 사업자 · Actions 예약 실행</small></div><div><span>마지막 수집 실행</span><strong>${esc(when(meta.lastAttemptAt || meta.generatedAt))}</strong><small>실행 시각과 출처별 성공 시각은 다를 수 있습니다.</small></div><div><span>마지막 성공 자료</span><strong>${esc(when(latest))}</strong><small>확인된 공개 출처 중 가장 최근 시각</small></div></div>
    ${error?`<p class="callout warning">${esc(error)}</p>`:''}
    <div class="collection-summary"><span><strong>${records.length}</strong>개 사업자</span><span><strong>${summaries.reduce((n,s)=>n+s.fieldCount,0)}</strong>개 확인 항목</span><span><strong>${summaries.reduce((n,s)=>n+s.confirmedCount,0)}</strong>개 연결 출처</span><span><strong>${summaries.reduce((n,s)=>n+s.candidateCount,0)}</strong>개 후보 출처</span></div>
    <p class="fine-print collection-note">등록된 수집 대상의 자료입니다. 전국 사업자 전체를 확보한 수가 아닙니다. 미등록 사업자는 조회 화면의 ‘웹 정보 수집 요청’으로 수집 대상을 추가할 수 있습니다.</p>
    <div class="table-wrap"><table class="collection-table"><thead><tr><th>사업자 / 채널</th><th>결과</th><th>확인 시각</th><th>수집 범위·사유</th></tr></thead><tbody>${rows.length?rows.map(row=>`<tr><td><strong>${esc(row.company)}</strong><span class="subline">${link(row.sourceUrl,row.label||row.provider)}</span></td><td><span class="badge ${row.status==='success'?'positive':['error','identity_mismatch'].includes(row.status)?'warning':'neutral'}">${esc(collectionStatusLabel(row.status))}</span></td><td>${esc(when(row.checkedAt))}</td><td>${row.matchedCount?`${row.matchedCount}건 연결 · `:''}${row.pages?`${row.pages}페이지 · `:''}${esc(row.message || (row.status==='not_found'?'이 출처에서 찾지 못했습니다. 영업 상태와 별개입니다.':'수집 결과 기준'))}</td></tr>`).join(''):'<tr><td colspan="4">출처별 수집 기록을 불러오는 중이거나 아직 생성되지 않았습니다.</td></tr>'}</tbody></table></div>
    <div class="card-foot"><a class="text-button" href="./data/enrichment/index.json" target="_blank" rel="noopener noreferrer">사업자 수집 JSON ↗</a><a class="text-button" href="https://github.com/softm/bizhannun/actions/workflows/pages.yml" target="_blank" rel="noopener noreferrer">자동 수집 실행 기록 ↗</a></div>
  </section>`;
}

const regionNames = {서울특별시:'서울',서울:'서울',부산광역시:'부산',부산:'부산',대구광역시:'대구',대구:'대구',인천광역시:'인천',인천:'인천',광주광역시:'광주',광주:'광주',대전광역시:'대전',대전:'대전',울산광역시:'울산',울산:'울산',세종특별자치시:'세종',세종:'세종',경기도:'경기',경기:'경기',강원특별자치도:'강원',강원도:'강원',강원:'강원',충청북도:'충북',충북:'충북',충청남도:'충남',충남:'충남',전북특별자치도:'전북',전라북도:'전북',전북:'전북',전라남도:'전남',전남:'전남',경상북도:'경북',경북:'경북',경상남도:'경남',경남:'경남',제주특별자치도:'제주',제주도:'제주',제주:'제주'};

/** A reviewable draft: keep known user values for the same business, never copy another firm's finances. */
export function buildBusinessProfileDraft(current = {}, businessNumber, record = null) {
  const bno = normalizeBusinessNumber(businessNumber);
  const currentNumber = normalizeBusinessNumber(current.businessNumber || '');
  const sameBusiness = !currentNumber || currentNumber === bno;
  const base = sameBusiness ? current : { interests: current.interests || [] };
  const sameRecord = record && normalizeBusinessNumber(record.businessNumber || record.bno || '') === bno;
  const summary = sameRecord ? summarizeEnrichment(record) : null;
  const facts = summary?.profile || {};
  const region = regionNames[facts.address?.split(/\s+/)[0]] || '';
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(facts.foundedAt || '') ? new Date(facts.foundedAt + 'T00:00:00Z') : null;
  const date = parsedDate && Number.isFinite(+parsedDate) && parsedDate.toISOString().slice(0, 10) === facts.foundedAt ? facts.foundedAt : '';
  const { enrichment: priorEvidence, ...baseValues } = base;
  const evidence = sameRecord && summary ? record
    : priorEvidence?.businessNumber === bno ? priorEvidence : null;
  return { ...baseValues, businessNumber:bno, name:base.name || facts.name || '',
    region:base.region || region, industry:base.industry || facts.industry || facts.businessCategory || facts.businessType || '',
    foundedAt:base.foundedAt || date, businessKind:base.businessKind || (sameRecord && record.entityType === 'corporation' ? '법인사업자' : ''),
    ...(evidence ? {enrichment:evidence} : {}), providedBy:'user' };
}

/** Evidence differences are comparisons of collected observations, not inferred real-world changes. */
export function evidenceChanges(savedRecord, latestRecord) {
  if (!savedRecord || !latestRecord || savedRecord.businessNumber !== latestRecord.businessNumber) return [];
  const before = summarizeEnrichment(savedRecord), after = summarizeEnrichment(latestRecord);
  if (!before || !after) return [];
  return after.fields.filter(field => before.profile[field.field] && before.profile[field.field] !== field.value).map(field => ({
    field:field.field, label:ENRICHMENT_FIELDS[field.field], before:before.profile[field.field], after:field.value,
    source:after.sources.find(source=>source.id===field.sourceId),
  }));
}
