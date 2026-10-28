import { formatBusinessNumber, normalizeBusinessNumber } from './domain.mjs';
import { BASIC_BUSINESS_FIELDS, buildBusinessInsights } from './business-insights.mjs';
import { buildBusinessOutcome } from './business-outcome.mjs';
import { resolveBusinessProfile } from './business-profile.mjs';
import { ENRICHMENT_FIELDS, safeEnrichmentUrl } from './enrichment.mjs';
import { discoveryLinks } from './enrichment-view.mjs';

export const LOOKUP_TABS = Object.freeze([
  { id: 'overview', label: '확인 결과' },
  { id: 'facts', label: '업체 정보' },
  { id: 'sources', label: '자료 출처' },
  { id: 'history', label: '확인 기록' },
].map(Object.freeze));

export const normalizeLookupTab = tab => LOOKUP_TABS.some(item => item.id === tab) ? tab : 'overview';
export const lookupTabForInsight = id => id === 'field-conflicts' ? 'facts'
  : ['collection-incomplete', 'candidates'].includes(id) ? 'sources' : 'overview';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const list = value => Array.isArray(value) ? value : [];
const sameNumber = (value, number) => !!number && normalizeBusinessNumber(value?.businessNumber) === number;
const channelNames = {
  official_website: '공식 웹사이트', website: '웹사이트', public_data: '공공데이터', registry: '공개 등록자료',
  directory: '민간 기업정보', news: '뉴스·보도', jobs: '채용', social: 'SNS', commerce: '커머스', user_document: '제공 자료',
};
const actionNames = new Set(['insight-refresh-status', 'validate-registration', 'insight-view-sources', 'edit-lookup-number']);
const additionalActionIds = new Set(['identity-mismatch', 'field-conflicts', 'registration-cross-check']);
const providerLabels = {
  success: '수집 완료', partial: '일부 수집', not_found: '해당 원천에 자료 없음',
  not_configured: '인증키 설정 대기', identity_mismatch: '번호 불일치', error: '활용승인·연결 확인 필요',
};
const sourceLink = (url, label, className = '') => {
  const safe = safeEnrichmentUrl(url);
  return safe ? `<a${className ? ` class="${esc(className)}"` : ''} href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : esc(label);
};
function when(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(+date)
    ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(date)
    : '시각 미확인';
}
function time(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(+date)
    ? `<time datetime="${esc(date.toISOString())}">${esc(when(value))}</time>` : '시각 미확인';
}
function actionButton(action, number, className = 'button small', refreshing = false) {
  return actionNames.has(action?.action)
    ? `<button type="button" class="${className}" data-action="${esc(action.action)}" data-insight-id="${esc(action.id)}" data-bno="${esc(number)}"${refreshing && action.action === 'insight-refresh-status' ? ' disabled' : ''}>${esc(action.label)}</button>` : '';
}
function tabButton(tab, number, label, className = 'text-button') {
  return `<button type="button" class="${className}" data-action="lookup-tab" data-tab="${tab}" data-bno="${esc(number)}">${esc(label)}</button>`;
}
function statusBadge(outcome) {
  return `<span class="badge ${esc(outcome.tone)} dot">${esc(outcome.badge)}</span>`;
}
function statusNotice(result, outcome) {
  if (outcome.currentConfirmed) return '';
  return `<p class="callout${outcome.kind === 'error' ? ' warning' : ''}" role="status">${esc(outcome.fact)}${outcome.previousRecord ? ` 직전 성공 기록은 ${esc(outcome.previousRecord.label)}(${time(outcome.previousRecord.checkedAt)})이며 현재 상태를 대신하지 않습니다.` : ' 확인 결과에서 이유와 다음 행동을 확인하세요.'}</p>`;
}
function renderHeader({ number, linked, model, outcome, registered, refreshing }) {
  const status = model.status || {};
  const displayName = linked.displayName === '이름 미입력' ? '사업자 조회 결과' : linked.displayName;
  const sourceCaption = linked.nameSource === 'user'
    ? `저장한 이름 · 사용자 입력${linked.publicName && linked.userName !== linked.publicName ? ` <span>공개 상호 · ${esc(linked.publicName)}</span>` : ''}`
    : linked.publicName ? `상호 출처 · ${sourceLink(linked.nameSourceUrl, linked.nameSourceLabel)} · 수집 ${time(linked.nameCollectedAt)}`
      : '국세청 상태 조회에는 상호·주소가 포함되지 않습니다. 등록증과 함께 확인하세요.';
  const statusCaption = `${outcome.timeLabel} · ${time(outcome.observedAt)}`;
  const priorTax = !!status.taxType && !outcome.currentConfirmed;
  return `<header class="lookup-detail-header">
    <div class="lookup-detail-identity">
      <div class="lookup-detail-title-row"><h2 id="lookup-result-title" tabindex="-1">${esc(displayName)}</h2>${statusBadge(outcome)}</div>
      <p class="lookup-detail-meta"><span class="number">${esc(formatBusinessNumber(number))}</span><span>${priorTax ? '이전 기록 · ' : ''}${esc(status.taxType || '과세유형 미확인')}</span>${status.closedAt ? `<span>${outcome.currentConfirmed ? '응답의' : '이전 기록의'} 폐업일 · ${esc(status.closedAt)}</span>` : ''}</p>
      <p class="lookup-name-source">${sourceCaption}</p>
      <p class="lookup-status-source">${statusCaption}${status.sourceName && !outcome.previousRecord ? ` · ${sourceLink(status.sourceUrl, status.sourceName)}` : ''}</p>
    </div>
    <div class="lookup-detail-actions">
      <button type="button" class="button primary small" data-action="save-lookup" data-bno="${esc(number)}">${registered ? '거래처 정보 수정' : '거래처에 저장'}</button>
      <details id="lookup-more-menu" class="lookup-more-actions"><summary>추가 작업</summary><div class="button-row">
        <button type="button" class="button small" data-action="validate-registration" data-bno="${esc(number)}">등록정보 진위 대조</button>
        <button type="button" class="button small" data-action="use-mine" data-bno="${esc(number)}">내 사업으로 입력</button>
        <button type="button" class="button small" data-action="insight-refresh-status" data-bno="${esc(number)}"${refreshing ? ' disabled' : ''}>상태 다시 확인</button>
        <a class="text-button" href="./#data" data-nav="data">연동 상태 보기</a>
        <button type="button" class="button small" data-action="close-result" data-bno="${esc(number)}">조회 결과 닫기</button>
      </div></details>
    </div>
  </header>`;
}
function basicFields(model) {
  const byField = new Map(list(model.profile?.basic).map(item => [item.field, item]));
  return BASIC_BUSINESS_FIELDS.map(field => ({ field, label: ENRICHMENT_FIELDS[field], confirmed: false, ...byField.get(field) }));
}
function actionRow(action, index, number, refreshing) {
  return `<li class="lookup-action${action.tone === 'warning' ? ' is-attention' : ''}"><span class="lookup-action-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><div class="lookup-action-copy"><h4>${esc(action.title)}</h4><p>${esc(action.description)}</p></div>${actionButton(action, number, 'button small', refreshing)}</li>`;
}
function renderOverview({ number, result, model, outcome, refreshing, registered }) {
  const basic = basicFields(model);
  const missing = basic.filter(item => !item.confirmed);
  const evidence = model.evidence || {};
  const next = outcome.nextAction;
  const actions = list(model.actions).filter(action => additionalActionIds.has(action.id) &&
    action.id !== next.id && action.action !== 'enrichment-request');
  const previous = outcome.previousRecord;
  const collectionIncomplete = ['partial', 'failed'].includes(evidence.collectionStatus);
  const savedGuidance = registered
    ? '저장한 거래처의 확인 기록에서 이전 조회와 상태 변화를 비교할 수 있습니다.'
    : '확인한 내용을 거래처에 저장하면 메모를 남기고 다음 조회와 비교할 수 있습니다. 위의 ‘거래처에 저장’을 이용하세요.';
  return `<div class="lookup-overview">
    <section class="lookup-outcome is-${esc(outcome.tone)}" aria-labelledby="lookup-outcome-title">
      <p class="lookup-outcome-kicker">${outcome.currentConfirmed ? '확인된 등록 상태' : '이번 확인 결과'}</p>
      <h3 id="lookup-outcome-title">${esc(outcome.fact)}</h3>
      <p class="lookup-outcome-meaning">${esc(outcome.meaning)}</p>
      <p class="lookup-outcome-time">${esc(outcome.timeLabel)} · ${time(outcome.observedAt)}${outcome.sourceName && !previous ? ` · ${sourceLink(outcome.sourceUrl, outcome.sourceName)}` : ''}</p>
      ${previous ? `<aside class="lookup-previous-result" aria-label="직전 성공 기록"><strong>직전 성공 기록 · ${esc(previous.label)}</strong><p>${time(previous.checkedAt)}${previous.taxType ? ` · ${esc(previous.taxType)}` : ''}${outcome.sourceName ? ` · ${sourceLink(outcome.sourceUrl, outcome.sourceName)}` : ''}</p><small>이전 상태와 과세유형입니다. 현재 상태를 확인한 결과가 아닙니다.</small></aside>` : ''}
      ${result.outcome !== 'ok' && result.message ? `<details id="lookup-response-detail" class="lookup-response-detail"><summary>조회 안내 자세히 보기</summary><p>${esc(result.message)}</p></details>` : ''}
    </section>
    <section class="lookup-next-step" aria-labelledby="lookup-next-step-title"><div><p class="lookup-outcome-kicker">다음으로 할 일</p><h3 id="lookup-next-step-title">${esc(next.title)}</h3><p>${esc(next.description)}</p></div>${actionButton(next, number, 'button primary', refreshing)}</section>
    ${actions.length ? `<details id="lookup-more-actions" class="lookup-extra-actions"><summary>추가로 확인할 사항 ${actions.length}개</summary><ol class="lookup-actions-list">${actions.map((action, index) => actionRow(action, index, number, refreshing)).join('')}</ol></details>` : ''}
    <p class="lookup-save-guidance">${esc(savedGuidance)}</p>
    <details id="lookup-supporting-info" class="lookup-supporting-info"><summary>함께 확인할 업체 정보</summary>
      <p class="lookup-data-note">${missing.length === basic.length ? '이 번호와 연결된 업체 기본정보가 아직 없습니다.' : missing.length ? '공개자료에서 확인하지 못한 항목이 있습니다.' : '상호·주소 등 기본정보에 공개자료의 출처가 연결되어 있습니다.'} 자료의 확보 범위이며 업체의 신뢰도를 평가한 결과가 아닙니다.</p>
      <p class="lookup-summary-line"><strong>기본정보 ${basic.length - missing.length} / ${basic.length}개 확보</strong><span class="lookup-summary-missing">${missing.length ? `미확보 · ${missing.map(item => esc(item.label)).join(' · ')}` : '상호·주소·전화·업태·종목·웹사이트 출처 연결'}</span>${tabButton('facts', number, '업체 정보 보기')}</p>
      <p class="lookup-evidence-line">연결 출처 ${esc(evidence.sourceCount || 0)}개 자료 · ${esc(evidence.domainCount || 0)}개 사이트${tabButton('sources', number, `자료 출처·확인 전 후보 ${evidence.candidateCount || 0}개 보기`)}</p>
      ${collectionIncomplete ? '<p class="lookup-data-note">최근 공개자료 수집을 모두 완료하지 못했습니다. 확보된 자료는 해당 출처의 수집일과 함께 보관하며, 수집 문제를 업체 상태 변화로 판단하지 않습니다.</p>' : ''}
      <p class="fine-print lookup-summary-policy">상태 7일·공개자료 30일은 이 앱의 재확인 안내 기준입니다. 정보 제공기관의 갱신 주기와 다릅니다.</p>
    </details>
  </div>`;
}
function fieldSource(source) {
  if (!source) return '연결 출처 미확인';
  return `${esc(channelNames[source.channel] || '웹 자료')} · ${sourceLink(source.url, source.title || '출처')} · 수집 ${time(source.collectedAt)}`;
}
function fieldValue(field, value) {
  return field === 'website' ? sourceLink(value, value) : esc(value);
}
function renderFact(item, conflictFields) {
  const confirmed = item.confirmed !== false && !!item.value;
  const alternatives = list(item.alternatives);
  const badge = confirmed && item.conflict ? conflictFields.has(item.field)
    ? '<span class="badge warning">출처별 차이</span>' : '<span class="badge neutral">다른 출처 기록</span>' : '';
  return `<div class="lookup-fact${confirmed ? '' : ' is-missing'}" data-field="${esc(item.field)}"><dt>${esc(item.label || ENRICHMENT_FIELDS[item.field] || item.field)}${badge}</dt><dd>${confirmed ? `${fieldValue(item.field, item.value)}<small class="lookup-field-source">${fieldSource(item.source)}</small>${alternatives.length ? `<details id="lookup-field-alternatives-${esc(item.field)}" class="lookup-field-alternatives"><summary>다른 출처의 기록 ${alternatives.length}개</summary>${alternatives.map(alternate => `<p>${fieldValue(item.field, alternate.value)}<small class="lookup-field-source">${fieldSource(alternate.source)}</small></p>`).join('')}</details>` : ''}` : '<span class="lookup-missing-value">자료 미확보</span><small class="lookup-field-source">연결할 공개자료가 아직 없습니다.</small>'}</dd></div>`;
}
function renderConflicts(model) {
  const conflicts = list(model.conflicts);
  if (!conflicts.length) return '';
  return `<details id="lookup-conflicts" class="lookup-conflicts insight-conflicts"><summary>출처별 값 차이 ${conflicts.length}개</summary><p class="fine-print">출처의 기준·시점·표현이 다를 수 있습니다. 각 원문과 수집일을 비교하세요.</p>${conflicts.map(item => `<article><h4>${esc(item.label)}</h4><ul>${list(item.values).map(value => `<li><strong>${fieldValue(item.field, value.value)}</strong><small class="lookup-field-source">${fieldSource(value.source)}</small></li>`).join('')}</ul></article>`).join('')}</details>`;
}
function renderCommerce(commerce, number) {
  if (!commerce) return '';
  const records = list(commerce.records).filter(item => sameNumber(item, number));
  const outcomeLabel = { not_found: '이 번호로 연결된 통신판매 자료가 없습니다.', not_configured: '통신판매 자료 연결 설정 대기', error: '통신판매 자료 조회를 완료하지 못했습니다.' }[commerce.outcome];
  if (!records.length) return `<section class="lookup-commerce"><h3 class="lookup-section-title">통신판매 등록자료</h3><p class="fine-print">${esc(outcomeLabel || '이 번호와 일치하는 통신판매 자료가 없습니다.')} 조회 결과만으로 미등록·폐업을 판단하지 않습니다.</p></section>`;
  const fields = [['name', '등록 상호'], ['address', '등록 사업장 주소'], ['registrationNumber', '통신판매업 신고번호'], ['products', '신고 제품·서비스'], ['corporateNumber', '법인등록번호']];
  return `<section class="lookup-commerce"><h3 class="lookup-section-title">통신판매 등록자료 <span class="badge neutral">번호 일치 ${records.length}건</span></h3>${records.map(item => `<article><dl class="lookup-facts-grid">${fields.filter(([field]) => item[field]).map(([field, label]) => `<div class="lookup-fact"><dt>${label}</dt><dd>${esc(item[field])}</dd></div>`).join('')}</dl><p class="lookup-field-source">${sourceLink(item.sourceUrl || commerce.sourceUrl, '공정거래위원회 통신판매 등록자료')} · 조회 ${time(item.checkedAt || commerce.checkedAt)}</p></article>`).join('')}</section>`;
}
function renderFacts({ number, model, commerce }) {
  const fields = list(model.profile?.fields).filter(item => !BASIC_BUSINESS_FIELDS.includes(item.field));
  const conflictFields = new Set(list(model.conflicts).map(item => item.field));
  return `<h3 class="lookup-section-title">기본 사업자 정보</h3><p class="fine-print">사업자번호 또는 확인된 공식 도메인으로 연결한 공개자료입니다. 항목별 출처와 수집시각을 기준으로 확인하세요.</p><dl class="lookup-facts-grid">${basicFields(model).map(item => renderFact(item, conflictFields)).join('')}</dl>
    ${fields.length ? `<h3 class="lookup-section-title">추가 공개정보</h3><dl class="lookup-facts-grid">${fields.map(item => renderFact(item, conflictFields)).join('')}</dl>` : ''}
    ${renderConflicts(model)}${renderCommerce(commerce, number)}`;
}
function renderSource(source, candidate = false) {
  const label = candidate ? '확인 전 후보' : source.match === 'exact_bno' ? '사업자번호 일치' : '공식 도메인 연결';
  return `<article class="lookup-source-card"><span class="badge ${candidate ? 'neutral' : 'positive'}">${label}</span><h4>${sourceLink(source.url, source.title || '출처 원문')}</h4><p>${esc(channelNames[source.channel] || '웹 자료')} · 수집 ${time(source.collectedAt)}${source.publishedAt ? ` · 게시 ${time(source.publishedAt)}` : ''}</p>${candidate ? '<small>동일 사업자인지 확인 전입니다. 기본정보에 자동으로 합치지 않습니다.</small>' : ''}</article>`;
}
function renderSources({ number, summary, record, model, loading }) {
  const collection = summary?.collection || {};
  const sources = list(summary?.sources);
  const confirmed = sources.filter(source => source.match === 'exact_bno' || source.match === 'confirmed_domain');
  const candidates = sources.filter(source => source.match === 'candidate');
  const sourceCount = model.evidence?.sourceCount ?? new Set(confirmed.map(source => source.url)).size;
  const candidateCount = model.evidence?.candidateCount ?? candidates.length;
  const providers = list(collection.sourceStatuses);
  const lastSuccess = collection.lastSuccessAt || summary?.collectedAt || record?.collectedAt;
  const collectionWarning = ['failed', 'partial'].includes(collection.status)
    ? `<p class="callout warning">최근 웹 수집 ${collection.status === 'failed' ? '실패' : '일부 실패'} · ${time(collection.lastAttemptAt)}. ${list(model.profile?.fields).length ? '이전에 확보한 자료를 출처별 수집일과 함께 유지했습니다.' : '연결할 공개자료를 다시 확인해야 합니다.'} 수집 실패는 업체 상태 변화가 아닙니다.</p>` : '';
  return `<div class="lookup-source-toolbar"><h3 class="lookup-section-title">자료 범위와 수집 상태</h3><button type="button" class="button small" data-action="reload-enrichment" data-bno="${esc(number)}"${loading ? ' disabled' : ''}>수집본 다시 불러오기</button></div>
    <dl class="lookup-collection-highlights"><div><dt>마지막 수집 시도</dt><dd>${time(collection.lastAttemptAt)}</dd></div><div><dt>마지막 성공 수집</dt><dd>${time(lastSuccess)}</dd></div><div><dt>정기 수집 일정</dt><dd>매일 06:17 (한국시간)<small>등록된 수집 대상·승인된 요청만 갱신</small></dd></div></dl>
    <details id="lookup-collection" class="enrichment-coverage" open><summary>원천별 수집 상태</summary>${collectionWarning}<div class="lookup-provider-list">${providers.length ? providers.map(provider => `<article><strong>${esc(provider.label || provider.provider || '공개 원천')}</strong><span>${esc(providerLabels[provider.status] || '확인 필요')}</span>${provider.checkedAt ? `<small>확인 ${time(provider.checkedAt)}</small>` : ''}${provider.message ? `<p>${esc(provider.message)}</p>` : ''}</article>`).join('') : '<p class="fine-print">원천별 수집 결과가 아직 없습니다.</p>'}</div><p class="fine-print">공공 API 자료는 각 서비스의 활용승인 범위에 따라 추가됩니다. 자료가 없거나 수집에 실패한 것으로 미등록·폐업을 판단하지 않습니다.</p>${collection.message ? `<p class="fine-print">${esc(collection.message)}</p>` : ''}</details>
    <details id="lookup-source-list" class="enrichment-sources" open><summary>연결자료 ${esc(sourceCount)}개 · 수집기록 ${confirmed.length}건 · 확인 전 후보 ${esc(candidateCount)}개</summary><h3 class="lookup-section-title">동일 사업자로 연결된 출처</h3><div class="lookup-source-list">${confirmed.length ? confirmed.map(source => renderSource(source)).join('') : '<p class="fine-print">동일 사업자로 연결된 공개 출처가 아직 없습니다.</p>'}</div>${candidates.length ? `<div class="lookup-source-candidates"><h3 class="lookup-section-title">연결 전 확인할 후보</h3><div class="lookup-source-list">${candidates.map(source => renderSource(source, true)).join('')}</div></div>` : ''}<p class="fine-print">연결자료 수는 같은 URL을 한 번만 집계합니다. 여러 사이트가 같은 원천을 인용할 수 있어 출처 수는 독립 검증 횟수가 아닙니다. 게시일·수집일·상태 조회일은 서로 다른 기준입니다.</p></details>
    <div class="button-row lookup-source-actions">${list(model.profile?.fields).length ? `<button type="button" class="button small" data-action="save-enrichment-note" data-bno="${esc(number)}">출처와 함께 거래처에 보관</button>` : ''}<button type="button" class="button small" data-action="enrichment-export" data-bno="${esc(number)}"${record ? '' : ' disabled'}>수집 자료 JSON</button><button type="button" class="text-button" data-action="enrichment-request" data-bno="${esc(number)}">공개자료 추가 요청 · GitHub</button></div>
    <p class="fine-print">추가 요청은 GitHub의 공개 요청 작성 화면에서 제출합니다. 이 앱에서 즉시 자료가 수집되지는 않습니다.</p>
    <details id="lookup-discovery" class="lookup-discovery"><summary>외부 채널에서 더 찾아보기</summary><p class="fine-print">외부 검색 링크입니다. 검색결과가 수집되거나 동일 사업자로 확인된 것은 아닙니다.</p><div class="lookup-discovery-links">${discoveryLinks(number, model.publicName || '').map(item => sourceLink(item.url, item.name, 'enrichment-channel')).join('')}</div></details>`;
}
function renderHistory({ model }) {
  const timeline = list(model.timeline);
  return `<h3 class="lookup-section-title">상태 조회 이력</h3><p class="fine-print">이 앱에 남은 최근 조회 기록입니다. 같은 출처의 정상 조회끼리 상태 변화를 비교합니다.</p>${timeline.length ? `<ol class="lookup-history">${timeline.map(item => `<li class="lookup-history-item">${time(item.checkedAt)}<div><strong>${esc(item.change?.label || item.label)}</strong>${item.taxType ? `<p>${esc(item.taxType)}</p>` : ''}<small>${sourceLink(item.sourceUrl, item.sourceName || '조회 출처 미확인')}${item.change ? ' · 같은 출처의 정상 조회 비교' : ''}</small></div></li>`).join('')}</ol>` : '<p class="lookup-empty">남아 있는 상태 조회 이력이 없습니다.</p>'}`;
}

/** One selected company, with content rendered only for the active panel. */
export function renderBusinessWorkbench({ result, linked = null, model = null, record = null, summary = null, loading = false, refreshing = false, error = '', commerce = null, registered = false, tab = 'overview' } = {}) {
  const number = normalizeBusinessNumber(result?.businessNumber);
  if (!result || !number) return '';
  const matchingLinked = sameNumber(linked, number) ? linked : null;
  const matchingRecord = sameNumber(record, number) ? record : null;
  const matchingSummary = sameNumber(summary, number) ? summary : sameNumber(matchingLinked?.summary, number) ? matchingLinked.summary : null;
  const partner = matchingLinked?.userName ? { businessNumber: number, name: matchingLinked.userName } : null;
  const profile = resolveBusinessProfile({ businessNumber: number, partner, record: matchingRecord, summary: matchingSummary });
  const insights = sameNumber(model, number) ? model : buildBusinessInsights({ businessNumber: number, check: result, partner, summary: profile.summary });
  const outcome = buildBusinessOutcome(insights);
  const context = { number, result, linked: profile, model: insights, outcome, record: matchingRecord, summary: profile.summary, loading, refreshing, commerce, registered };
  const active = normalizeLookupTab(tab);
  const views = { overview: renderOverview, facts: renderFacts, sources: renderSources, history: renderHistory };
  const notices = (refreshing ? '<p class="inline-loading" role="status"><span class="spinner" aria-hidden="true"></span> 사업자 상태를 다시 확인하고 있습니다. 이전 조회 결과를 표시합니다.</p>' : '') + (active === 'overview' ? '' : statusNotice(result, outcome)) + (loading ? '<p class="inline-loading" role="status"><span class="spinner" aria-hidden="true"></span> 공개자료를 불러오고 있습니다.</p>' : '') + (error ? `<p class="callout" role="status">${esc(error)}${profile.summary?.fields?.length ? ' 이전에 불러온 공개자료를 해당 수집시각과 함께 표시합니다.' : ''} 공개자료 연결 문제는 업체의 등록 상태와 관계없습니다.</p>` : '');
  return `<section id="lookup-result" class="lookup-detail" data-business-number="${esc(number)}" aria-labelledby="lookup-result-title">
    ${renderHeader(context)}${notices ? `<div class="lookup-detail-notices">${notices}</div>` : ''}
    <div class="lookup-tabs" role="tablist" aria-label="선택한 사업자 상세정보">${LOOKUP_TABS.map(item => `<button type="button" id="lookup-tab-${item.id}" class="lookup-tab${active === item.id ? ' is-active' : ''}" role="tab" data-action="lookup-tab" data-tab="${item.id}" data-bno="${esc(number)}" aria-controls="lookup-panel-${item.id}" aria-selected="${active === item.id}" tabindex="${active === item.id ? '0' : '-1'}">${item.label}</button>`).join('')}</div>
    <div class="lookup-tabpanels">${LOOKUP_TABS.map(item => `<div id="lookup-panel-${item.id}" class="lookup-tabpanel" role="tabpanel" aria-labelledby="lookup-tab-${item.id}" tabindex="0"${active === item.id ? '' : ' hidden'}>${active === item.id ? views[item.id](context) : ''}</div>`).join('')}</div>
  </section>`;
}
