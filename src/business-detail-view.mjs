import { formatBusinessNumber, isValidBusinessNumber, normalizeBusinessNumber } from './domain.mjs';
import { safeEnrichmentUrl } from './enrichment.mjs';
import { buildBusinessInsights } from './business-insights.mjs';
import { resolveBusinessProfile } from './business-profile.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const number = value => new Intl.NumberFormat('ko-KR').format(Number.isFinite(Number(value)) ? Number(value) : 0);
const dateTime = value => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(+date) ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date) : '확인 시각 없음';
};
const dateOnly = value => {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(+date) ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium' }).format(date) : '미확인';
};
const PATHS = {
  building: 'M3 21h18M5 21V7l7-4 7 4v14M9 9v2m6-2v2m-6 3v2m6-2v2m-4 5v-4h2v4',
  check: 'm5 12 4 4L19 6',
  file: 'M14 2H5v20h14V7l-5-5zm0 0v5h5M8 12h8m-8 4h8',
  copy: 'M8 8h12v13H8zM16 8V3H3v13h5',
  print: 'M7 8V3h10v5M7 17H4V8h16v9h-3M7 14h10v7H7zM17 11h.01',
  close: 'm6 6 12 12M6 18 18 6',
  clock: 'M12 8v5l3 2M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0',
  refresh: 'M20 7A9 9 0 1 0 21 15M20 3v5h-5',
  shield: 'M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7l-9-4zM8 12l3 3 5-5',
  note: 'M4 3h16v18H4zM8 7h8m-8 5h8m-8 5h5',
  source: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  info: 'M12 11v6m0-10v.01M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0',
  tax: 'M5 3h14v18l-3-2-4 2-4-2-3 2V3zM9 7h6m-6 4h6m-6 4h3',
  tag: 'M3 3h8l10 10-8 8L3 11V3zm5 4h.01',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[name] || PATHS.info}"/></svg>`;
const link = (url, label, className = '') => {
  const safe = safeEnrichmentUrl(url);
  return safe ? `<a class="${className}" href="${escape(safe)}" target="_blank" rel="noopener noreferrer">${escape(label)} <span aria-hidden="true">↗</span></a>` : escape(label);
};
const STATUS = { active: '계속사업자', suspended: '휴업자', closed: '폐업자', unknown: '미확인' };
const OUTCOME = { error: '조회 실패', not_found: '조회 결과 없음', not_configured: '연결 설정 대기' };
const TABS = [['overview', '기본 정보', 'building'], ['tax', '상태·과세', 'tax'], ['history', '조회 이력', 'clock'], ['sources', '공개정보·출처', 'source'], ['notes', '메모·태그', 'note']];
const tabIds = new Set(TABS.map(([id]) => id));
const actionNames = new Set(['insight-refresh-status', 'validate-registration', 'insight-view-sources', 'enrichment-request']);

function context(args) {
  const suppliedPartner = args.partner || {};
  const businessNumber = normalizeBusinessNumber(suppliedPartner.businessNumber || args.insights?.businessNumber || args.linked?.businessNumber);
  const valid = isValidBusinessNumber(businessNumber);
  const partner = valid && normalizeBusinessNumber(suppliedPartner.businessNumber) === businessNumber ? suppliedPartner : { businessNumber };
  const linked = valid && normalizeBusinessNumber(args.linked?.businessNumber) === businessNumber
    ? args.linked : resolveBusinessProfile({ businessNumber, partner });
  const insights = valid && normalizeBusinessNumber(args.insights?.businessNumber) === businessNumber
    ? args.insights : buildBusinessInsights({ businessNumber, partner, summary: linked.summary });
  return { businessNumber, valid, partner, linked, insights, status: insights.status, fields: new Map(insights.profile.fields.map(field => [field.field, field])) };
}

function provenance(field) {
  if (!field?.source) return '';
  return `<small class="detail-provenance">${link(field.source.url, field.source.title || '출처')} · ${escape(dateTime(field.source.collectedAt))}${field.conflict ? ' · 출처별 차이 있음' : ''}</small>`;
}

function fact(field, label, { wide = false } = {}) {
  return `<div class="detail-record-fact${wide ? ' is-wide' : ''}${field ? '' : ' is-missing'}"><dt>${escape(label || field?.label || '정보')}${field?.conflict ? '<span class="detail-tag is-warning">출처별 차이</span>' : ''}</dt><dd>${field ? (field.field === 'website' ? link(field.value, field.value) : escape(field.value)) : '<span class="detail-missing-value">아직 확인되지 않았어요</span>'}${field ? provenance(field) : '<small class="detail-provenance">동일 사업자로 확인한 공개자료가 없습니다.</small>'}</dd></div>`;
}

function summaryFact(label, value, note = '', extra = '') {
  return `<div class="detail-record-fact${extra}"><dt>${escape(label)}</dt><dd>${escape(value || '미확인')}${note ? `<small class="detail-provenance">${note}</small>` : ''}</dd></div>`;
}

function stateBadge(status) {
  const tone = ['closed', 'suspended'].includes(status.businessStatus) ? 'is-warning' : status.businessStatus === 'active' ? 'is-positive' : 'is-neutral';
  return `<span class="detail-state ${tone}"><i aria-hidden="true"></i>${escape(status.label || '미확인')}${status.usingPrevious ? '<span>직전 성공 기록</span>' : ''}</span>`;
}

function historyRows({ partner, insights, businessNumber }) {
  const historyKey = item => JSON.stringify([item.checkedAt, item.outcome, item.businessStatus, item.taxType, safeEnrichmentUrl(item.sourceUrl) || item.sourceName]);
  const changes = new Map(insights.timeline.map(item => [historyKey(item), item.change]));
  const raw = [partner.lastCheck, partner.lastSuccess, ...(Array.isArray(partner.history) ? partner.history : [])]
    .filter(item => item && normalizeBusinessNumber(item.businessNumber) === businessNumber && ['ok', 'error', 'not_found', 'not_configured'].includes(item.outcome))
    .map(item => {
      const source = typeof item.source === 'object' && item.source ? item.source : {};
      const checkedAt = Number.isFinite(Date.parse(item.checkedAt)) ? new Date(item.checkedAt).toISOString() : null;
      const row = { checkedAt, outcome: item.outcome, businessStatus: item.outcome === 'ok' ? item.businessStatus : 'unknown',
        label: item.outcome === 'ok' ? STATUS[item.businessStatus] || '상태 해석 확인 필요' : OUTCOME[item.outcome],
        taxType: item.outcome === 'ok' ? item.taxType || '' : '',
        sourceName: source.name || (typeof item.source === 'string' ? item.source : '') || '조회 출처 미제공',
        sourceUrl: source.url || item.sourceUrl || '' };
      return { ...row, change: item.outcome === 'ok' ? changes.get(historyKey(row)) : null };
    });
  const rows = raw.length ? raw : insights.timeline;
  return [...new Map(rows.map(item => [JSON.stringify([item.checkedAt, item.outcome, item.businessStatus, item.taxType, item.sourceUrl, item.sourceName]), item])).values()]
    .sort((a, b) => (Date.parse(b.checkedAt) || 0) - (Date.parse(a.checkedAt) || 0)).slice(0, 50);
}

function timeline(rows, limit = 50) {
  if (!rows.length) return `<div class="detail-empty">${icon('clock')}<h4>아직 조회 이력이 없습니다</h4><p>국세청 상태를 조회하면 확인 시각과 결과가 여기에 남습니다.</p></div>`;
  return `<ol class="detail-history">${rows.slice(0, limit).map(item => `<li class="${item.outcome !== 'ok' ? 'is-failed' : item.change ? 'is-changed' : ''}"><div class="detail-history-dot" aria-hidden="true">${icon(item.outcome === 'ok' ? 'check' : 'info')}</div><div class="detail-history-content"><div class="detail-history-top"><strong>${escape(item.change?.label || item.label)}</strong><time${item.checkedAt ? ` datetime="${escape(item.checkedAt)}"` : ''}>${escape(dateTime(item.checkedAt))}</time></div><p>${escape(item.outcome === 'ok' ? item.taxType || '과세유형 응답 없음' : '이 결과만으로 사업자 상태를 판단하지 않습니다.')}</p><small>${link(item.sourceUrl, item.sourceName)}${item.change ? ' · 같은 출처의 성공 응답 비교' : ''}</small></div></li>`).join('')}</ol>`;
}

function actionCards(model) {
  const actions = model.actions.filter(action => actionNames.has(action.action)).slice(0, 2);
  if (!actions.length) return '';
  return `<section class="detail-next"><div class="detail-section-heading"><h3>${icon('shield')}거래 전 확인할 사항</h3></div><div class="detail-action-list">${actions.map((action, index) => `<article class="detail-action ${action.tone === 'warning' ? 'is-attention' : ''}"><span class="detail-step">${String(index + 1).padStart(2, '0')}</span><div><h4>${escape(action.title)}</h4><p>${escape(action.description)}</p></div><button type="button" class="button small" data-action="${escape(action.action)}" data-insight-id="${escape(action.id)}" data-bno="${escape(model.businessNumber)}">${escape(action.label)}${icon('arrow')}</button></article>`).join('')}</div></section>`;
}

function sourceDifferences(model, changes) {
  const conflicts = model.conflicts || [];
  return `${changes.length ? `<div class="detail-notice is-warning"><strong>보관한 자료와 최신 수집본이 ${number(changes.length)}항목 다릅니다.</strong><ul>${changes.map(change => `<li>${escape(change.label)}: ${escape(change.before)} → ${escape(change.after)}</li>`).join('')}</ul><p>수집본의 값 차이입니다. 실제 변경일은 원문에서 확인하세요.</p></div>` : ''}${conflicts.length ? `<details class="insight-conflicts detail-source-conflicts"><summary>출처별 값 차이 ${number(conflicts.length)}개</summary>${conflicts.map(item => `<article><h4>${escape(item.label)}</h4><ul>${item.values.map(value => `<li><strong>${escape(value.value)}</strong><small>${link(value.source.url, value.source.title)} · ${escape(dateTime(value.source.collectedAt))}</small></li>`).join('')}</ul></article>`).join('')}</details>` : ''}`;
}

function statusNotice(status) {
  if (status.usingPrevious) return `<div class="detail-notice is-warning" role="status">${icon('info')}<div><strong>최근 조회를 완료하지 못해 직전 성공 기록을 표시합니다.</strong><p>최근 시도 ${escape(dateTime(status.latestCheckedAt))} · 표시된 상태 기준 ${escape(dateTime(status.checkedAt))}</p></div></div>`;
  if (status.latestOutcome && status.latestOutcome !== 'ok') return `<div class="detail-notice is-warning" role="status">${icon('info')}<div><strong>${escape(OUTCOME[status.latestOutcome] || '현재 상태 미확인')}</strong><p>확인된 사업자 상태가 없습니다. 번호를 대조하고 다시 조회하세요.</p></div></div>`;
  if (['suspended', 'closed'].includes(status.businessStatus)) return `<div class="detail-notice is-warning">${icon('info')}<div><strong>${escape(status.label)}로 조회되었습니다.</strong><p>조회 시점을 확인하고 거래처에 현재 업무 진행 여부와 거래 일정을 확인하세요.</p></div></div>`;
  return '';
}

/** Pure UI projection; all writes and asynchronous actions belong to app.mjs. */
export function renderBusinessDetail(args = {}) {
  const ctx = context(args), { partner, linked, insights, status, fields, businessNumber } = ctx;
  const activeTab = tabIds.has(args.activeTab) ? args.activeTab : 'overview';
  const displayName = linked.displayName || insights.displayName || '이름 미입력';
  const sourceLabel = linked.nameSourceLabel || '상호 출처 미확인';
  const storageLabel = args.storageLabel || '이 기기';
  const busy = Boolean(args.busy);
  const activity = ['saving', 'refreshing', 'connecting'].includes(args.activity) ? args.activity : 'refreshing';
  const refreshing = busy && activity === 'refreshing';
  const saving = busy && activity === 'saving';
  const activityLabel = { saving: '메모 저장 완료를 확인하고 있습니다…', refreshing: '상태를 확인하고 있습니다…', connecting: '계정 연결 상태를 확인하고 있습니다…' }[activity];
  const rows = historyRows(ctx);
  const note = args.draft?.note ?? partner.note ?? '';
  const tags = args.draft?.tags ?? (Array.isArray(partner.tags) ? partner.tags.join(', ') : '');
  const title = `${displayName} · 거래처 상세`;
  const header = `<div class="detail-header-identity"><span class="detail-company-symbol">${icon('building')}</span><div class="detail-header-copy"><div class="detail-eyebrow">BUSINESS PROFILE <span>거래처 상세</span></div><div class="detail-title-row"><h2 id="modal-title" tabindex="-1">${escape(displayName)}</h2>${stateBadge(status)}</div><div class="detail-identity-meta"><span class="detail-business-number">${escape(formatBusinessNumber(businessNumber))}</span><button type="button" class="detail-copy" data-action="detail-copy-number" aria-label="사업자등록번호 복사" title="사업자등록번호 복사">${icon('copy')}</button><span class="detail-meta-divider" aria-hidden="true"></span><span>${link(linked.nameSourceUrl, sourceLabel)}</span></div>${linked.hasCustomName ? `<p class="detail-public-name">공개 상호: ${escape(linked.publicName)}</p>` : ''}</div></div><div class="detail-header-tools"><button type="button" class="button small detail-export-button" data-action="detail-export" title="메모와 태그를 제외한 조회 기록 저장">${icon('file')}<span>조회 기록 저장</span></button><button type="button" class="icon-button" data-action="detail-print" aria-label="조회 기록 인쇄·PDF 저장" title="인쇄·PDF 저장">${icon('print')}</button><button type="button" class="icon-button detail-close" data-action="close-modal" aria-label="거래처 상세 닫기">${icon('close')}</button></div>`;
  const tabs = `<div class="detail-tabs" role="tablist" aria-label="거래처 상세 항목">${TABS.map(([id, label, glyph]) => `<button type="button" id="detail-tab-${id}" role="tab" aria-selected="${activeTab === id}" aria-controls="detail-panel-${id}" tabindex="${activeTab === id ? 0 : -1}" data-action="detail-tab" data-tab="${id}">${icon(glyph)}<span>${label}</span>${id === 'history' && rows.length ? `<span class="detail-tab-count">${rows.length}</span>` : ''}</button>`).join('')}</div>`;
  const panel = (id, html) => `<section class="detail-tab-panel" id="detail-panel-${id}" role="tabpanel" aria-labelledby="detail-tab-${id}" tabindex="0"${activeTab === id ? '' : ' hidden'}>${html}</section>`;
  const stateSubtext = status.usingPrevious ? '직전 성공 시점의 등록 상태' : status.checkedAt ? '국세청 응답의 등록 상태' : '상태 조회가 필요합니다';
  const overview = `${statusNotice(status)}<div class="detail-kpis"><article class="detail-kpi ${['closed', 'suspended'].includes(status.businessStatus) || status.usingPrevious ? 'is-attention' : ''}"><div class="detail-kpi-label"><span>사업자등록 상태</span>${icon('shield')}</div><strong>${escape(status.label || '미확인')}</strong><p>${escape(stateSubtext)}</p></article><article class="detail-kpi"><div class="detail-kpi-label"><span>과세유형</span>${icon('tax')}</div><strong class="detail-tax-value">${escape(status.taxType || '미확인')}</strong><p>실제 응답에 포함된 과세 구분</p></article><article class="detail-kpi"><div class="detail-kpi-label"><span>기본정보 확인</span>${icon('source')}</div><strong>${number(insights.profile.confirmedCount)}<span> / ${number(insights.profile.totalCount)}개</span></strong><p>출처 ${number(insights.evidence.sourceCount)}개 · 확인 전 후보 ${number(insights.evidence.candidateCount)}개</p></article></div><div class="detail-update"><div>${icon('clock')}<span>마지막 성공 조회</span><strong>${escape(status.checkedAt ? dateTime(status.checkedAt) : '아직 확인 전')}</strong></div><span>${status.sourceName ? link(status.sourceUrl, status.sourceName) : '조회 버튼을 누를 때 확인'}</span></div><section class="detail-record-card"><div class="detail-section-heading"><h3>${icon('building')}사업자 기본정보</h3><button type="button" class="detail-inline-button" data-action="detail-tab" data-tab="sources">출처 자세히 ${icon('arrow')}</button></div><dl class="detail-record-grid">${fact(fields.get('name'), '공개 상호·법인명')}${fact(fields.get('representative'), '공개된 대표자')}${fact(fields.get('businessType'), '업태')}${fact(fields.get('businessCategory'), '종목')}${fact(fields.get('address'), '사업장 주소', { wide: true })}${fact(fields.get('phone'), '업무용 전화')}${fact(fields.get('website'), '공식 웹사이트')}</dl></section>${actionCards(insights)}<p class="detail-policy">${icon('info')}등록 상태는 조회 시점의 세무 등록정보입니다. 거래 이행 능력이나 지급능력을 판단하는 지표가 아닙니다.</p>`;
  const lastSuccess = [partner.lastCheck, partner.lastSuccess, ...(Array.isArray(partner.history) ? partner.history : [])]
    .find(item => normalizeBusinessNumber(item?.businessNumber) === businessNumber && item?.outcome === 'ok' && status.checkedAt && Date.parse(item.checkedAt) === Date.parse(status.checkedAt));
  const tax = `${statusNotice(status)}<section class="detail-record-card"><div class="detail-section-heading"><h3>${icon('tax')}국세청 상태 조회 응답</h3><span class="detail-tag">조회 시점 기준</span></div><dl class="detail-record-grid">${summaryFact('사업자등록번호', formatBusinessNumber(businessNumber))}${summaryFact('사업자등록 상태', status.label, status.usingPrevious ? '직전 성공 기록' : '')}${summaryFact('과세유형', status.taxType)}${summaryFact('마지막 성공 조회', status.checkedAt ? dateTime(status.checkedAt) : '아직 확인 전')}${summaryFact('폐업일', status.closedAt ? dateOnly(status.closedAt) : '응답에 없음')}${summaryFact('과세유형 전환일', lastSuccess?.taxTypeChangedAt ? dateOnly(lastSuccess.taxTypeChangedAt) : '응답에 없음')}</dl><p class="detail-record-source">${status.sourceName ? `출처 · ${link(status.sourceUrl, status.sourceName)}` : '국세청 조회가 완료되면 응답 출처를 표시합니다.'}</p></section><div class="detail-notice"><span class="detail-notice-symbol">${icon('file')}</span><div><strong>계산서 발급·매입세액 공제는 별도 확인이 필요합니다.</strong><p>표시된 과세유형은 조회 응답입니다. 개별 거래의 증빙 요건이나 공제 가능 여부를 자동 판정하지 않습니다.</p></div></div><section class="detail-validation"><div><h3>사업자등록증의 정보와 대조하세요</h3><p>등록증에 있는 개업일·대표자 등을 직접 입력해 국세청 등록정보와 대조할 수 있습니다.</p></div><button type="button" class="button" data-action="detail-validate">${icon('shield')}등록정보 대조</button></section><p class="detail-policy">상태 조회와 등록정보 진위 대조는 서로 다른 절차입니다. 상호·주소는 연결된 공개자료에서, 상태·과세유형은 국세청 조회 응답에서 확인합니다.</p>`;
  const history = `<div class="detail-section-heading"><div><h3>${icon('clock')}사업자 상태 조회 이력</h3><p>이 거래처에 보관된 최근 ${number(rows.length)}건 · 최대 50건</p></div><span class="detail-tag">직접 조회 시 기록</span></div><div class="detail-history-card">${timeline(rows)}</div><p class="detail-policy">성공한 조회끼리 같은 출처의 등록 상태를 비교합니다. 조회 실패·연결 대기·결과 없음은 휴업이나 폐업으로 기록하지 않습니다.</p>`;
  const sources = `<div class="detail-section-heading"><div><h3>${icon('source')}공개정보와 연결 근거</h3><p>사업자번호와 출처를 확인한 자료를 모았습니다.</p></div><span class="detail-tag">${number(insights.evidence.sourceCount)}개 출처</span></div>${sourceDifferences(insights, Array.isArray(args.changes) ? args.changes : [])}${args.publicHtml || `<div class="detail-empty">${icon('source')}<h4>연결한 공개자료가 아직 없습니다</h4><p>상호나 공개 웹사이트를 알려주시면 자료 보강을 요청할 수 있습니다.</p><button type="button" class="button" data-action="enrichment-request" data-bno="${escape(businessNumber)}">공개자료 보강 요청</button></div>`}`;
  const notes = `<div class="detail-section-heading"><div><h3>${icon('note')}내 거래 메모와 태그</h3><p>거래 일정과 다음에 확인할 내용을 기록하세요.</p></div><span class="detail-tag">${escape(storageLabel)}</span></div><form id="detail-note-form" class="detail-note-form" data-id="${escape(partner.id || '')}"><div class="detail-form-field"><label for="detail-tags">거래처 태그</label><input id="detail-tags" name="tags" maxlength="500" value="${escape(tags)}" placeholder="정기 거래, 납품, 확인 필요"><p>쉼표로 구분해 입력하세요.</p></div><div class="detail-form-field"><div class="detail-form-label"><label for="detail-note">내부 메모</label><span>최대 5,000자</span></div><textarea id="detail-note" name="note" maxlength="5000" rows="8" placeholder="정산 일정, 담당자와 확인한 내용, 다음 거래 전에 확인할 사항 등을 기록하세요.">
${escape(note)}</textarea></div><div class="detail-note-meta"><span>${icon('clock')}마지막 저장 ${escape(partner.updatedAt ? dateTime(partner.updatedAt) : '아직 없음')}</span><span>${escape(storageLabel)}에 보관</span></div><div id="detail-note-feedback" class="detail-form-feedback" role="status" aria-live="polite">${escape(args.notice || '')}</div><div id="detail-note-error" class="detail-form-error" role="alert">${escape(args.error || '')}</div><div class="detail-note-actions"><button type="button" class="button" data-action="detail-reset-note"${busy ? ' disabled' : ''}>저장된 내용으로 되돌리기</button><button type="submit" class="button primary"${busy ? ' disabled' : ''} aria-busy="${saving}">${icon('check')}${saving ? '저장 중…' : '메모·태그 저장'}</button></div></form><p class="detail-policy">메모와 태그는 내 관리용 정보입니다. 조회 기록 저장·인쇄에는 포함되지 않습니다.</p>`;
  const body = panel('overview', overview) + panel('tax', tax) + panel('history', history) + panel('sources', sources) + panel('notes', notes);
  const footer = `<footer class="detail-footer"><div class="detail-footer-status">${icon('clock')}<span>${busy ? activityLabel : '조회 버튼을 누를 때 상태 확인'}</span></div><div class="detail-footer-actions"><button type="button" class="button detail-footer-close" data-action="close-modal">닫기</button><button type="button" class="button" data-action="detail-tab" data-tab="notes">${icon('tag')}메모·태그 수정</button><button type="button" class="button primary detail-refresh-button" data-action="detail-refresh" aria-busy="${refreshing}"${busy || !ctx.valid ? ' disabled' : ''}>${icon('refresh')}<span>${refreshing ? '조회 중…' : '국세청 상태 다시 조회'}</span></button></div></footer>`;
  return { title, header, tabs, body, footer };
}

/** A local, portable record, never an official certificate. Private notes are opt-in. */
export function buildBusinessDetailReport(args = {}) {
  const ctx = context(args), { businessNumber, partner, insights, status, linked } = ctx;
  const includePrivate = args.includePrivate === true;
  const title = includePrivate ? linked.displayName || insights.displayName : insights.publicName || formatBusinessNumber(businessNumber);
  const rows = historyRows(ctx);
  const generatedAt = args.generatedAt || new Date().toISOString();
  const fields = insights.profile.fields;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>사업자 조회 기록 · ${escape(title)}</title><style>body{font-family:system-ui,-apple-system,'Noto Sans KR',sans-serif;color:#183a31;background:#fff;line-height:1.65;margin:0}main{max-width:900px;margin:auto;padding:40px 28px}h1{font-size:27px;margin:8px 0}h2{font-size:19px;border-bottom:2px solid #164e44;padding-bottom:9px;margin-top:32px}p,td,th{font-size:13px}.eyebrow{font-size:12px;font-weight:700;letter-spacing:.12em}.notice{padding:15px;background:#eef4f0;border:1px solid #d6e2db;border-radius:8px}table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #dfe7e2;padding:12px;overflow-wrap:anywhere}th{width:24%;font-weight:600;background:#f5f8f6}small{display:block;color:#56675e;font-size:11px;margin-top:5px}a{color:#164e44}pre{white-space:pre-wrap;font:inherit;font-size:13px}.detail-history{list-style:none;padding:0}.detail-history li{padding:12px 0;border-bottom:1px solid #dfe7e2}.detail-history-dot{display:none}.detail-history-top{display:flex;justify-content:space-between;gap:15px}.detail-history-top time{font-size:12px}.detail-history p{margin:5px 0}.detail-history small{font-size:11px}.private{border:1px solid #dfc89d;padding:16px;background:#fffbf2}@media print{main{padding:0}a{color:inherit}h2{break-after:avoid}tr,li{break-inside:avoid}.notice{background:#fff}}</style></head><body><main><div class="eyebrow">BIZHANNUN · 사업자한눈</div><h1>사업자 조회 기록</h1><p><strong>${escape(title)}</strong><br>사업자등록번호 ${escape(formatBusinessNumber(businessNumber))}<br>기록 생성 ${escape(dateTime(generatedAt))} · 한국시간</p><p class="notice">사업자한눈에 표시된 조회 결과와 공개자료를 정리한 기록입니다. 국세청이 발급한 공식 증명서나 거래 안전성 보증서가 아닙니다.${includePrivate ? ' 내부 메모·태그를 포함합니다.' : ' 내부 메모·태그는 제외했습니다.'}</p><h2>상태·과세유형</h2>${status.usingPrevious ? `<p class="notice">최근 조회를 완료하지 못했습니다. 아래 상태는 ${escape(dateTime(status.checkedAt))}의 직전 성공 기록입니다. 최근 시도: ${escape(dateTime(status.latestCheckedAt))}.</p>` : ''}<table><tbody><tr><th>등록 상태</th><td>${escape(status.label || '미확인')}</td></tr><tr><th>과세유형</th><td>${escape(status.taxType || '미확인')}</td></tr><tr><th>마지막 성공 조회</th><td>${escape(status.checkedAt ? dateTime(status.checkedAt) : '아직 확인 전')}</td></tr><tr><th>조회 출처</th><td>${link(status.sourceUrl, status.sourceName || '미제공')}</td></tr></tbody></table><h2>공개 사업자 정보</h2>${fields.length ? `<table><tbody>${fields.map(field => `<tr><th>${escape(field.label)}</th><td>${field.field === 'website' ? link(field.value, field.value) : escape(field.value)}<small>${link(field.source.url, field.source.title)} · 수집 ${escape(dateTime(field.source.collectedAt))}${field.conflict ? ' · 출처별 값 차이 있음' : ''}</small>${field.alternatives?.length ? field.alternatives.map(value => `<small>다른 출처: ${escape(value.value)} · ${link(value.source.url, value.source.title)} · ${escape(dateTime(value.source.collectedAt))}</small>`).join('') : ''}</td></tr>`).join('')}</tbody></table>` : '<p>사업자번호가 일치하는 공개자료를 아직 확보하지 못했습니다.</p>'}<h2>조회 이력</h2>${timeline(rows)}${includePrivate ? `<section class="private"><h2>내부 관리 정보</h2><p>관리용 이름: ${escape(linked.userName || partner.name || '')}</p><p>태그: ${escape((partner.tags || []).join(', ') || '없음')}</p><pre>${escape(partner.note || '등록된 메모 없음')}</pre></section>` : ''}<p class="notice">각 항목의 출처와 확인 시점이 다를 수 있습니다. 등록 상태는 거래 이행 능력·지급능력·개별 거래의 세액공제 가능 여부를 판정하지 않습니다.</p></main></body></html>`;
}
