import { formatBusinessNumber } from './domain.mjs';
import { safeEnrichmentUrl } from './enrichment.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const date = value => {
  const d = value ? new Date(value) : null;
  return d && Number.isFinite(+d) ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(d) : '시각 미확인';
};
const link = (url, label) => {
  const safe = safeEnrichmentUrl(url);
  return safe ? '<a href="' + esc(safe) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + ' ↗</a>' : esc(label);
};
const actionNames = new Set(['insight-refresh-status', 'validate-registration', 'insight-view-sources', 'enrichment-request']);
function button(action, number) {
  return actionNames.has(action.action)
    ? '<button type="button" class="button small" data-action="' + esc(action.action) + '" data-insight-id="' + esc(action.id) + '" data-bno="' + esc(number) + '">' + esc(action.label) + '</button>' : '';
}
function actionRow(action, index, number) {
  return '<li class="insight-action ' + (action.tone === 'warning' ? 'is-attention' : '') + '"><span class="insight-step" aria-hidden="true">' + String(index + 1).padStart(2, '0') + '</span><div class="insight-action-copy"><h3>' + esc(action.title) + '</h3><p>' + esc(action.description) + '</p></div>' + button(action, number) + '</li>';
}
const freshnessLabel = info => ({
  fresh: '조회 후 ' + (info?.ageDays === 0 ? '1일 미만' : String(info?.ageDays ?? '') + '일'),
  stale: '재확인 권장 · 조회 후 ' + String(info?.ageDays ?? '') + '일',
  future: '조회 시각 확인 필요',
  unknown: '조회 시각 미확인',
})[info?.state] || '확인 전';

/** Render only evidence and action prompts; model values are escaped at every HTML boundary. */
export function renderBusinessInsights(model, { compact = false } = {}) {
  if (!model) return '';
  const status = model.status, profile = model.profile, evidence = model.evidence;
  const actionLimit = compact ? 2 : 3;
  const visibleActions = model.actions.slice(0, actionLimit);
  const otherActions = model.actions.slice(actionLimit);
  const attention = status.usingPrevious || status.freshness.state !== 'fresh' || ['suspended', 'closed'].includes(status.businessStatus);
  const parts = [
    '<section class="card insight-panel' + (compact ? ' insight-compact' : '') + '" aria-label="사업자 인사이트" data-business-number="' + esc(model.businessNumber) + '">',
    '<div class="card-header"><div><div class="eyebrow">사업자 인사이트</div><h2>' + esc(model.headline) + '</h2><p class="fine-print">' + esc(model.displayName) + ' · ' + esc(formatBusinessNumber(model.businessNumber)) + '</p></div></div>',
    '<div class="insight-body">',
    '<div class="insight-summary">',
    '<div class="insight-metric' + (attention ? ' is-attention' : '') + '"><span>등록 상태</span><strong>' + (status.usingPrevious ? '<small>직전 성공 기록</small>' : '') + esc(status.label) + '</strong><p>' + esc(status.taxType || '과세유형 미확인') + '</p><small>' + esc(freshnessLabel(status.freshness)) + '</small></div>',
    '<div class="insight-metric"><span>기본정보 확인</span><strong>' + profile.confirmedCount + '<small> / ' + profile.totalCount + '개</small></strong><p>출처가 연결된 기본 항목</p><small>정보 확인 범위 · 신용점수 아님</small></div>',
    '<div class="insight-metric"><span>연결된 출처</span><strong>' + evidence.domainCount + '<small>개 사이트</small></strong><p>' + evidence.sourceCount + '개 자료 · 확인 전 후보 ' + evidence.candidateCount + '개</p><small>주소가 다르면 별도 사이트로 집계</small></div>',
    '</div>',
    '<p class="insight-status-source">' + (status.usingPrevious ? '직전 정상 조회 · ' : '정상 조회 · ') + esc(date(status.checkedAt)) + (status.sourceName ? ' · ' + link(status.sourceUrl, status.sourceName) : '') + '</p>',
  ];
  if (status.usingPrevious) parts.push('<p class="insight-notice is-attention">최근 조회(' + esc(date(status.latestCheckedAt)) + ')는 완료되지 않았습니다. 표시된 상태는 직전 성공 시점의 기록입니다.</p>');
  if (model.nameDifference) parts.push('<p class="insight-notice"><strong>저장한 별칭: ' + esc(model.userName) + '</strong><br>연결된 공개 상호: ' + esc(model.publicName) + '. 직접 저장한 이름은 별칭으로 유지합니다.</p>');
  if (visibleActions.length) parts.push('<div class="insight-section-heading"><h3>지금 확인할 사항</h3><span>확인 필요 순서</span></div><ol class="insight-actions">' + visibleActions.map((action, index) => actionRow(action, index, model.businessNumber)).join('') + '</ol>');
  if (otherActions.length) parts.push('<details class="insight-more"><summary>추가 확인 사항 ' + otherActions.length + '개</summary><ol class="insight-actions" start="' + (actionLimit + 1) + '">' + otherActions.map((action, index) => actionRow(action, actionLimit + index, model.businessNumber)).join('') + '</ol></details>');
  parts.push('<details class="insight-evidence"' + (compact ? '' : ' open') + '><summary>기본정보·연결 근거 확인</summary><dl class="insight-checklist">' + profile.basic.map(item => '<div class="' + (item.confirmed ? 'is-confirmed' : 'is-missing') + '"><dt>' + esc(item.label) + '<span>' + (item.confirmed ? '출처 연결' : '자료 미확보') + '</span></dt><dd>' + (item.confirmed ? (item.field === 'website' ? link(item.value, item.value) : esc(item.value)) + '<small>' + link(item.source.url, item.source.title) + ' · ' + esc(date(item.source.collectedAt)) + (item.conflict ? ' · 출처별 값 차이' : '') + '</small>' : '연결할 공개자료가 아직 없습니다.') + '</dd></div>').join('') + '</dl><p class="fine-print">상호·주소·전화·업태·종목·웹사이트 6개 항목의 확인 범위입니다. 자료가 없다는 이유로 업체를 낮게 평가하지 않습니다. 여러 사이트가 같은 원천을 인용할 수 있으므로 출처 수는 독립 검증 횟수가 아닙니다.</p></details>');
  if (model.conflicts.length) parts.push('<details class="insight-conflicts"><summary>출처별 값 차이 ' + model.conflicts.length + '개</summary>' + model.conflicts.map(item => '<article><h3>' + esc(item.label) + '</h3><ul>' + item.values.map(value => '<li><strong>' + esc(value.value) + '</strong><small>' + link(value.source.url, value.source.title) + ' · ' + esc(date(value.source.collectedAt)) + '</small></li>').join('') + '</ul></article>').join('') + '</details>');
  if (model.timeline.length) parts.push('<details class="insight-timeline"><summary>상태 확인 흐름 · 최근 ' + model.timeline.length + '건</summary><ol>' + model.timeline.map(item => '<li><time>' + esc(date(item.checkedAt)) + '</time><div><strong>' + esc(item.change?.label || item.label) + '</strong>' + (item.taxType ? '<span>' + esc(item.taxType) + '</span>' : '') + '<small>' + link(item.sourceUrl, item.sourceName) + (item.change ? ' · 같은 출처의 정상 조회 비교' : '') + '</small></div></li>').join('') + '</ol></details>');
  parts.push('<p class="insight-policy">상태 조회 7일·공개자료 30일은 이 앱의 재확인 안내 기준입니다. 정보 제공기관의 갱신 주기와 다릅니다. 사업자등록 상태와 공개자료는 거래 이행 능력·지급능력 평가가 아닙니다.</p></div></section>');
  return parts.join('');
}
