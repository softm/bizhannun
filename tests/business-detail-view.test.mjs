import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBusinessInsights } from '../src/business-insights.mjs';
import { resolveBusinessProfile } from '../src/business-profile.mjs';
import { summarizeEnrichment } from '../src/enrichment.mjs';
import { buildBusinessDetailReport, renderBusinessDetail } from '../src/business-detail-view.mjs';

const BNO = '6901100416';
const OTHER = '2208162517';
const NOW = '2026-10-22T06:00:00Z';
const STAMP = '2026-10-21T13:00:00Z';
const source = { id: 'directory', url: 'https://www.bizno.net/article/' + BNO, title: '공개 사업자정보',
  channel: 'directory', businessNumber: BNO, match: 'exact_bno', collectedAt: STAMP, scope: 'public_business' };
const record = () => ({ businessNumber: BNO, collectedAt: STAMP, entityType: 'business', sources: [{ ...source }],
  fields: [['name', '서해박속낙지전문점'], ['address', '경기도 광명시 오리로 1034-1'], ['phone', '02-2682-7211'],
    ['businessType', '숙박 및 음식점업'], ['businessCategory', '일반한식']].map(([field, value]) => ({ field, value, sourceId: source.id })) });
const check = overrides => ({ businessNumber: BNO, outcome: 'ok', businessStatus: 'active', taxType: '부가가치세 일반과세자',
  checkedAt: STAMP, source: { name: '국세청 사업자등록정보', url: 'https://www.data.go.kr/data/15081808/openapi.do' }, ...overrides });
function fixture({ partner: edits = {}, evidence = record(), currentCheck } = {}) {
  const latest = currentCheck || check();
  const partner = { id: 'partner-local-1', businessNumber: BNO, name: '', tags: ['정기 거래'], note: '매월 25일 내부 정산',
    createdAt: '2026-10-19T03:00:00Z', updatedAt: STAMP, lastCheck: latest, lastSuccess: check(), history: [latest], ...edits };
  return { partner, linked: resolveBusinessProfile({ businessNumber: BNO, partner, record: evidence }),
    insights: buildBusinessInsights({ businessNumber: BNO, partner, check: latest, summary: evidence ? summarizeEnrichment(evidence) : null, now: NOW }), generatedAt: NOW, historyNow: NOW };
}
const all = view => [view.header, view.tabs, view.body, view.footer].join('');
const historyPanel = view => view.body.match(/<section class="detail-tab-panel" id="detail-panel-history"[\s\S]*?(?=<section class="detail-tab-panel" id="detail-panel-sources")/)?.[0] || '';

test('real linked profile renders with provenance, honest gaps and exact business number', () => {
  const args = fixture();
  const view = renderBusinessDetail(args);
  assert.match(view.header, /서해박속낙지전문점/);
  assert.match(view.header, /690-11-00416/);
  assert.match(view.body, /경기도 광명시 오리로 1034-1/);
  assert.match(view.body, /https:\/\/www.bizno.net\/article\/6901100416/);
  assert.match(view.body, /아직 확인되지 않았어요/);
  assert.match(view.body, /마지막 성공 조회/);
  assert.doesNotMatch(all(view), /무사고|>공제 가능<|즉시 발행 유효|자동 일일 감지|실시간 알림 구독|팀원 전체 공유|진위확인증/);
});

test('failed newest lookup preserves successful status with both distinct timestamps', () => {
  const success = check({ checkedAt: '2026-10-10T10:00:00Z' });
  const failed = check({ outcome: 'error', businessStatus: 'unknown', checkedAt: NOW });
  const args = fixture({ partner: { lastSuccess: success, lastCheck: failed, history: [failed, success] }, currentCheck: failed });
  const view = renderBusinessDetail(args);
  assert.match(view.header, /계속사업자/);
  assert.match(view.header, /직전 성공 기록/);
  assert.match(view.body, /최근 조회를 완료하지 못해 직전 성공 기록을 표시합니다/);
  assert.match(view.body, /2026\. 10\. 10\./);
  assert.match(view.body, /2026\. 10\. 22\./);
  const report = buildBusinessDetailReport(args);
  assert.match(report, /직전 성공 기록/);
  assert.doesNotMatch(report, /정상 지속|>공제 가능<|즉시 발행 유효/);
});

test('empty profile provides missing states rather than inventing company facts or monitoring', () => {
  const args = fixture({ evidence: null, currentCheck: check({ outcome: 'not_found', businessStatus: 'unknown' }),
    partner: { name: '', note: '', tags: [], lastSuccess: null, history: [] } });
  const html = all(renderBusinessDetail(args));
  assert.match(html, /미확인/);
  assert.match(html, /조회 결과 없음/);
  assert.match(html, /연결한 공개자료가 아직 없습니다/);
  assert.doesNotMatch(html, /서해박속낙지전문점|02-2682-7211|3개년|자동 알림|암호화/);
});

test('tab states provide one focusable selected tab and explicitly hidden alternative panels', () => {
  const view = renderBusinessDetail({ ...fixture(), activeTab: 'history' });
  assert.equal((view.tabs.match(/aria-selected="true"/g) || []).length, 1);
  assert.equal((view.tabs.match(/tabindex="0"/g) || []).length, 1);
  assert.match(view.tabs, /id="detail-tab-history" role="tab" aria-selected="true" aria-controls="detail-panel-history" tabindex="0"/);
  assert.match(view.body, /id="detail-panel-history" role="tabpanel" aria-labelledby="detail-tab-history" tabindex="0">/);
  assert.match(view.body, /id="detail-panel-notes" role="tabpanel" aria-labelledby="detail-tab-notes" tabindex="0" hidden>/);
  assert.equal((view.body.match(/role="tabpanel"/g) || []).length, 5);
  const invalid = renderBusinessDetail({ ...fixture(), activeTab: '"><script>alert(1)</script>' });
  assert.match(invalid.tabs, /id="detail-tab-overview" role="tab" aria-selected="true"/);
  assert.doesNotMatch(all(invalid), /<script>/);
});

test('all private input and displayed identity text is escaped, and dangerous links stay inert', () => {
  const attack = '<img src=x onerror=alert(1)>"&';
  const args = fixture({ partner: { name: attack, note: '</textarea><script>alert(2)</script>', tags: ['<img onerror=alert(3)>'] } });
  args.linked.nameSourceUrl = 'javascript:alert(4)';
  const html = all(renderBusinessDetail(args));
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;\/textarea&gt;&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<img|<script|href="javascript:/);
  assert.doesNotMatch(buildBusinessDetailReport({ ...args, includePrivate: true }), /<img|<script|href="javascript:/);
});

test('draft survives render separately from persisted note and receives honest save feedback', () => {
  const args = fixture();
  const html = renderBusinessDetail({ ...args, draft: { note: '아직 저장하지 않은 메모', tags: '납품, 다음 확인' },
    storageLabel: '내 로그인 계정', error: '저장을 완료하지 못했습니다.' }).body;
  assert.match(html, /아직 저장하지 않은 메모<\/textarea>/);
  assert.match(html, /value="납품, 다음 확인"/);
  assert.match(html, /내 로그인 계정에 보관/);
  assert.match(html, /id="detail-note-error"[^>]*role="alert"[^>]*>저장을 완료하지 못했습니다/);
  assert.equal(args.partner.note, '매월 25일 내부 정산');
});

test('textarea markup protects leading blank lines from HTML parsing across refreshes', () => {
  const args = fixture();
  const original = '\n\n첫 문단\n둘째 줄';
  let note = original;
  for (let refresh = 0; refresh < 3; refresh++) {
    const body = renderBusinessDetail({ ...args, draft: { note, tags: '' } }).body;
    const content = body.match(/<textarea id="detail-note"[^>]*>([\s\S]*?)<\/textarea>/)?.[1];
    // HTML's textarea parser ignores exactly one LF immediately after the start tag.
    assert.ok(content?.startsWith('\n'), 'renderer must provide a disposable leading LF');
    note = content.slice(1);
    assert.equal(note, original, 'each refresh must preserve both user-supplied leading blank lines');
  }
});

test('report excludes private memo, tags and private alias by default, with explicit opt-in', () => {
  const args = fixture({ partner: { name: '비공개 관리별칭', note: '내부결제조건비밀', tags: ['사내전용태그'] } });
  const publicReport = buildBusinessDetailReport(args);
  assert.match(publicReport, /서해박속낙지전문점/);
  assert.match(publicReport, /국세청이 발급한 공식 증명서/);
  assert.doesNotMatch(publicReport, /내부결제조건비밀|사내전용태그|비공개 관리별칭|<script|<link /);
  const privateReport = buildBusinessDetailReport({ ...args, includePrivate: true });
  assert.match(privateReport, /내부결제조건비밀/);
  assert.match(privateReport, /사내전용태그/);
  assert.match(privateReport, /비공개 관리별칭/);
});

test('mismatched models and linked identities cannot replace current partner data', () => {
  const args = fixture({ evidence: null });
  const other = fixture();
  other.linked = { ...other.linked, businessNumber: OTHER, displayName: '다른 업체 기밀', nameSourceLabel: '다른 출처' };
  other.insights = { ...other.insights, businessNumber: OTHER, publicName: '다른 업체 기밀', displayName: '다른 업체 기밀' };
  const combined = { ...args, linked: other.linked, insights: other.insights };
  assert.doesNotMatch(all(renderBusinessDetail(combined)), /다른 업체 기밀|다른 출처|경기도 광명시 오리로/);
  assert.doesNotMatch(buildBusinessDetailReport(combined), /다른 업체 기밀/);
});

test('history rejects foreign-business entries and presents saved history beyond insight summary cap', () => {
  const history = Array.from({ length: 14 }, (_, index) => check({ checkedAt: new Date(Date.parse(STAMP) - index * 86400000).toISOString() }));
  history.unshift(check({ businessNumber: OTHER, checkedAt: NOW, source: { name: '다른 업체 비공개 출처' } }));
  const args = fixture({ partner: { history } });
  const view = renderBusinessDetail(args);
  assert.match(view.body, /보관된 최근 14건/);
  assert.doesNotMatch(view.body, /다른 업체 비공개 출처/);
  assert.equal((view.body.match(/class="detail-history-content"/g) || []).length, 14);
});

test('history controls expose selected filters, period counts and actual before-and-after responses', () => {
  const previous = check({ checkedAt: '2026-10-10T13:00:00Z' });
  const changed = check({ businessStatus: 'suspended', taxType: '부가가치세 간이과세자' });
  const failed = check({ outcome: 'error', businessStatus: 'unknown', checkedAt: NOW });
  const history = [failed, changed, previous, check({ checkedAt: '2026-09-01T13:00:00Z' })];
  const args = fixture({ currentCheck: failed, partner: { lastSuccess: changed, history } });
  const view = renderBusinessDetail({ ...args, activeTab: 'history', historyFilter: 'status', historyPeriod: '30', historySort: 'oldest' });
  const panel = historyPanel(view);
  assert.match(view.tabs, /<span>변동 이력<\/span><span class="detail-tab-count">4<\/span>/);
  assert.equal((panel.match(/class="history-summary-card/g) || []).length, 4);
  assert.match(panel, /전체 보관 이력 기준 요약/);
  assert.match(panel, /id="detail-history-filter-status"[^>]*aria-pressed="true"/);
  assert.match(panel, /id="detail-history-filter-all"[^>]*aria-pressed="false"/);
  assert.equal((panel.match(/aria-pressed="true"/g) || []).length, 1);
  assert.match(panel, /<label for="detail-history-period">기간<\/label><select id="detail-history-period"/);
  assert.match(panel, /<option value="30" selected>최근 30일<\/option>/);
  assert.match(panel, /<label for="detail-history-sort">정렬<\/label>/);
  assert.match(panel, /<option value="oldest" selected>오래된순<\/option>/);
  assert.match(panel, /role="status"[^>]*>선택 기간 <strong>3건<\/strong> 중 <strong>1건<\/strong> 표시/);
  assert.equal((panel.match(/class="detail-history-content"/g) || []).length, 1);
  assert.match(panel, /등록 상태 비교/);
  assert.match(panel, /과세유형 비교/);
  assert.match(panel, /이전 조회<\/span><strong>계속사업자/);
  assert.match(panel, /이번 조회<\/span><strong>휴업자/);
  assert.match(panel, /이전 조회<\/span><strong>부가가치세 일반과세자/);
  assert.match(panel, /이번 조회<\/span><strong>부가가치세 간이과세자/);
  assert.match(panel, /비교 기준 2026\. 10\. 10\./);
  assert.match(panel, /id="detail-history-reset-button"[^>]*data-action="detail-history-reset"/);
  assert.match(panel, /현재 필터 결과 1건 · 메모·태그 제외/);
  assert.doesNotMatch(panel, /data-action="detail-history-export" disabled/);
});

test('empty histories and empty filter results are distinct and cannot export invented rows', () => {
  const empty = fixture({ partner: { lastCheck: null, lastSuccess: null, history: [] } });
  const noRecords = historyPanel(renderBusinessDetail(empty));
  assert.match(noRecords, /아직 조회 이력이 없습니다/);
  assert.match(noRecords, /data-action="detail-history-export" disabled/);
  assert.doesNotMatch(noRecords, /data-action="detail-history-reset"|class="history-event"/);
  const noMatches = historyPanel(renderBusinessDetail({ ...fixture(), historyFilter: 'tax' }));
  assert.match(noMatches, /선택한 조건에 맞는 이력이 없습니다/);
  assert.match(noMatches, /data-action="detail-history-reset"/);
  assert.match(noMatches, /data-action="detail-history-export" disabled/);
  assert.match(noMatches, /선택 기간 <strong>1건<\/strong> 중 <strong>0건<\/strong> 표시/);
  const outsidePeriod = historyPanel(renderBusinessDetail({ ...fixture(), historyPeriod: '30', historyNow: '2027-01-01T00:00:00Z' }));
  assert.match(outsidePeriod, /보관된 최근 1건/);
  assert.match(outsidePeriod, /선택 기간 <strong>0건<\/strong> 중 <strong>0건<\/strong> 표시/);
});

test('history groups calendar days in Korea and preserves the requested oldest-first order', () => {
  const earlier = check({ checkedAt: '2026-10-21T14:59:00Z' });
  const later = check({ checkedAt: '2026-10-21T15:01:00Z' });
  const args = fixture({ currentCheck: later, partner: { lastSuccess: later, history: [later, earlier] } });
  const panel = historyPanel(renderBusinessDetail({ ...args, historySort: 'oldest' }));
  assert.match(panel, /2026년 10월 21일/);
  assert.match(panel, /2026년 10월 22일/);
  assert.ok(panel.indexOf('2026년 10월 21일') < panel.indexOf('2026년 10월 22일'));
  assert.ok(panel.indexOf('datetime="2026-10-21T14:59:00.000Z"') < panel.indexOf('datetime="2026-10-21T15:01:00.000Z"'));
  assert.match(panel, /id="detail-history-reset-button"/);
});

test('history comparison values, source labels and report change labels remain escaped', () => {
  const hostileLabelSource = { name: '<svg onload=alert(3)>', url: 'https://www.data.go.kr/data/15081808/openapi.do' };
  const previous = check({ checkedAt: '2026-10-20T13:00:00Z', taxType: '<img src=x onerror=alert(1)>', source: hostileLabelSource });
  const latest = check({ taxType: '</strong><script>alert(2)</script>', source: hostileLabelSource });
  const args = fixture({ currentCheck: latest, partner: { lastSuccess: latest, history: [latest, previous] } });
  const panel = historyPanel(renderBusinessDetail({ ...args, historyFilter: 'tax' }));
  assert.match(panel, /과세유형 비교/);
  assert.match(panel, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(panel, /&lt;\/strong&gt;&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.match(panel, /&lt;svg onload=alert\(3\)&gt;/);
  assert.doesNotMatch(panel, /<img|<script|<svg onload|href="javascript:/);
  const report = buildBusinessDetailReport(args);
  assert.match(report, /과세유형 변화:/);
  assert.match(report, /&lt;img src=x onerror=alert\(1\)&gt; → &lt;\/strong&gt;/);
  assert.doesNotMatch(report, /<img|<script|<svg onload|href="javascript:/);
  const unsafeSource = { ...hostileLabelSource, url: 'javascript:alert(4)' };
  const unsafeHistory = [latest, previous].map(row => ({ ...row, source: unsafeSource }));
  const unsafeArgs = fixture({ currentCheck: unsafeHistory[0], partner: { lastSuccess: unsafeHistory[0], history: unsafeHistory } });
  const unsafePanel = historyPanel(renderBusinessDetail({ ...unsafeArgs, historyFilter: 'all' }));
  assert.equal((unsafePanel.match(/class="detail-history-content"/g) || []).length, 2);
  assert.match(unsafePanel, /&lt;svg onload=alert\(3\)&gt;/);
  assert.doesNotMatch(unsafePanel, /class="history-change-card"|<img|<script|<svg onload|href="javascript:/);
  assert.doesNotMatch(buildBusinessDetailReport(unsafeArgs), /과세유형 변화:|<img|<script|<svg onload|href="javascript:/);
});

test('report keeps the complete retained history and older status and tax changes despite UI filters', () => {
  const history = Array.from({ length: 14 }, (_, index) => check({
    checkedAt: new Date(Date.parse(STAMP) - index * 86400000).toISOString(),
    businessStatus: index === 10 ? 'closed' : 'active',
    taxType: index === 10 ? '부가가치세 면세사업자' : '부가가치세 일반과세자',
  }));
  const args = { ...fixture({ partner: { lastCheck: history[0], lastSuccess: history[0], history } }), historyFilter: 'issues', historyPeriod: '30' };
  assert.match(historyPanel(renderBusinessDetail(args)), /선택한 조건에 맞는 이력이 없습니다/);
  const report = buildBusinessDetailReport(args);
  assert.match(report, /전체 보관 이력 14건/);
  assert.equal((report.match(/class="detail-history-content"/g) || []).length, 14);
  assert.equal((report.match(/등록 상태 변화:<\/strong>/g) || []).length, 2);
  assert.equal((report.match(/과세유형 변화:<\/strong>/g) || []).length, 2);
  assert.match(report, /계속사업자 → 폐업자/);
  assert.match(report, /부가가치세 일반과세자 → 부가가치세 면세사업자/);
  assert.match(report, /비교 기준 조회 2026\. 10\. 10\./);
  assert.doesNotMatch(report, /매월 25일 내부 정산|정기 거래/);
});

test('successful but uninterpretable responses are identified as needing review rather than failed lookups', () => {
  const unknown = check({ businessStatus: 'unrecognized_value' });
  const args = fixture({ currentCheck: unknown, partner: { lastSuccess: null, history: [unknown] } });
  const panel = historyPanel(renderBusinessDetail({ ...args, historyFilter: 'issues' }));
  assert.match(panel, /조회 응답 확인 필요/);
  assert.match(panel, /응답의 사업자 상태를 해석할 수 없습니다/);
  assert.match(panel, /class="history-event-badge is-issue">확인 필요<\/span>/);
  assert.doesNotMatch(panel, /class="history-event-badge is-issue">조회 미완료<\/span>|사업자 상태 조회 완료/);
});

test('refresh is visibly busy and disabled without substituting a successful response', () => {
  const view = renderBusinessDetail({ ...fixture(), busy: true });
  assert.match(view.footer, /data-action="detail-refresh" aria-busy="true" disabled/);
  assert.match(view.footer, /조회 중…/);
  assert.match(view.body, /type="submit" class="button primary" disabled/);
  assert.match(view.header, /계속사업자/);
});

test('memo saving reports the actual activity while allowing subsequent text edits', () => {
  const view = renderBusinessDetail({ ...fixture(), busy: true, activity: 'saving' });
  assert.match(view.footer, /메모 저장 완료를 확인하고 있습니다…/);
  assert.match(view.footer, /data-action="detail-refresh" aria-busy="false" disabled/);
  assert.match(view.footer, /국세청 상태 다시 조회/);
  assert.doesNotMatch(view.footer, /조회 중…|상태를 확인하고 있습니다/);
  assert.match(view.body, /data-action="detail-reset-note" disabled/);
  assert.match(view.body, /type="submit" class="button primary" disabled aria-busy="true"/);
  assert.match(view.body, /저장 중…/);
  const noteControl = view.body.match(/<textarea id="detail-note"[^>]*>/)?.[0];
  const tagControl = view.body.match(/<input id="detail-tags"[^>]*>/)?.[0];
  assert.ok(noteControl && tagControl);
  assert.doesNotMatch(noteControl + tagControl, /disabled|readonly/);
});

test('account connection does not claim a status lookup or memo save is running', () => {
  const view = renderBusinessDetail({ ...fixture(), busy: true, activity: 'connecting' });
  assert.match(view.footer, /계정 연결 상태를 확인하고 있습니다…/);
  assert.match(view.footer, /data-action="detail-refresh" aria-busy="false" disabled/);
  assert.doesNotMatch(view.footer, /조회 중…|메모 저장 완료/);
  assert.match(view.body, /data-action="detail-reset-note" disabled/);
});
