import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBusinessInsights } from '../src/business-insights.mjs';
import { resolveBusinessProfile } from '../src/business-profile.mjs';
import { summarizeEnrichment } from '../src/enrichment.mjs';
import { LOOKUP_TABS, lookupTabForInsight, normalizeLookupTab, renderBusinessWorkbench } from '../src/business-workbench-view.mjs';

const BNO = '6901100416';
const OTHER = '2208162517';
const NOW = '2026-10-21T14:00:00Z';
const STAMP = '2026-10-21T13:00:00Z';
const OLD = '2026-10-11T10:00:00Z';
const source = (overrides = {}) => ({
  id: 'directory', url: 'https://bizno.net/article/' + BNO, title: '공개 사업자정보',
  channel: 'directory', businessNumber: BNO, match: 'exact_bno', collectedAt: STAMP, scope: 'public_business', ...overrides,
});
const record = (overrides = {}) => ({
  businessNumber: BNO, collectedAt: STAMP, entityType: 'business', sources: [source()],
  fields: [
    ['name', '서해박속낙지전문점'], ['address', '경기도 광명시 오리로 1034-1'], ['phone', '02-2682-7211'],
    ['businessType', '숙박 및 음식점업'], ['businessCategory', '일반한식'],
  ].map(([field, value]) => ({ field, value, sourceId: 'directory' })), ...overrides,
});
const status = (overrides = {}) => ({
  businessNumber: BNO, outcome: 'ok', businessStatus: 'active', taxType: '부가가치세 일반과세자',
  checkedAt: STAMP, source: { name: '국세청 사업자등록정보', url: 'https://www.data.go.kr/data/15081808/openapi.do' }, ...overrides,
});
function input({ publicRecord = record(), result = status(), partner = null, ...overrides } = {}) {
  const summary = publicRecord ? summarizeEnrichment(publicRecord) : null;
  const linked = resolveBusinessProfile({ businessNumber: BNO, partner, record: publicRecord });
  const model = buildBusinessInsights({ businessNumber: BNO, partner, check: result, summary, now: NOW });
  return { result, linked, model, record: publicRecord, summary, ...overrides };
}
const render = (options = {}) => renderBusinessWorkbench(input(options));

test('tabs use the agreed labels, normalize unknown states and map evidence actions to their section', () => {
  assert.deepEqual(LOOKUP_TABS, [
    { id: 'overview', label: '확인 결과' }, { id: 'facts', label: '업체 정보' },
    { id: 'sources', label: '자료 출처' }, { id: 'history', label: '확인 기록' },
  ]);
  for (const item of LOOKUP_TABS) assert.equal(normalizeLookupTab(item.id), item.id);
  for (const invalid of [undefined, null, '', 'constructor', '<script>']) assert.equal(normalizeLookupTab(invalid), 'overview');
  assert.equal(lookupTabForInsight('field-conflicts'), 'facts');
  assert.equal(lookupTabForInsight('collection-incomplete'), 'sources');
  assert.equal(lookupTabForInsight('candidates'), 'sources');
  assert.equal(lookupTabForInsight('unknown'), 'overview');
  assert.equal(renderBusinessWorkbench(), '');
});

test('one selected company has four ARIA panel shells but renders only the active panel', () => {
  for (const active of LOOKUP_TABS) {
    const html = render({ tab: active.id });
    assert.equal((html.match(/id="lookup-result"/g) || []).length, 1);
    assert.equal((html.match(/<h2\b/g) || []).length, 1);
    assert.match(html, /<h2 id="lookup-result-title" tabindex="-1">서해박속낙지전문점<\/h2>/);
    assert.equal((html.match(/role="tab"/g) || []).length, 4);
    assert.equal((html.match(/role="tabpanel"/g) || []).length, 4);
    for (const tab of LOOKUP_TABS) {
      const button = html.match(new RegExp('<button[^>]+id="lookup-tab-' + tab.id + '"[^>]*>'))?.[0];
      assert.ok(button);
      assert.match(button, new RegExp('aria-controls="lookup-panel-' + tab.id + '"'));
      assert.match(button, new RegExp('aria-selected="' + (active.id === tab.id) + '"'));
      assert.match(button, new RegExp('tabindex="' + (active.id === tab.id ? '0' : '-1') + '"'));
      if (active.id !== tab.id) assert.match(html, new RegExp('id="lookup-panel-' + tab.id + '"[^>]+ hidden></div>'));
    }
    if (active.id !== 'facts') assert.doesNotMatch(html, /data-field="address"/);
    if (active.id !== 'sources') assert.doesNotMatch(html, /lookup-collection-highlights/);
    if (active.id !== 'history') assert.doesNotMatch(html, /class="lookup-history"/);
  }
});

test('overview leads with a dated fact and one next action, and keeps missing profile data folded away', () => {
  const data = input();
  data.model.actions.push({ id: 'candidates', title: '후보 안내 카드', action: 'insight-view-sources', label: '후보' });
  const html = renderBusinessWorkbench(data);
  assert.match(html, /<h3 id="lookup-outcome-title">계속사업자로 확인됐습니다/);
  assert.match(html, /확인한 시각 · <time datetime="2026-10-21T13:00:00.000Z"/);
  const factIndex = html.indexOf('id="lookup-outcome-title"');
  const nextIndex = html.indexOf('class="lookup-next-step"');
  const supportingIndex = html.indexOf('id="lookup-supporting-info"');
  assert.ok(factIndex < nextIndex && nextIndex < supportingIndex);
  const nextStep = html.match(/<section class="lookup-next-step"[\s\S]*?<\/section>/)?.[0] || '';
  assert.equal((nextStep.match(/<button\b/g) || []).length, 1);
  assert.match(nextStep, /data-action="validate-registration"/);
  assert.match(html, /<details id="lookup-supporting-info" class="lookup-supporting-info"><summary>함께 확인할 업체 정보/);
  assert.doesNotMatch(html, /기본정보 1개 항목을 더 확인|후보 안내 카드/);
  assert.match(html, /기본정보 5 \/ 6개 확보/);
  assert.match(html, /미확보 · 공식 웹사이트/);
  assert.match(html, /data-insight-id="registration-cross-check"/);
  assert.doesNotMatch(html, /data-action="enrichment-request"/);
  assert.match(html, /확인한 내용을 거래처에 저장/);
  assert.doesNotMatch(html, /class="insight-metric|class="enrichment-panel|통합 정보<\/h2>/);
  const empty = render({ publicRecord: null });
  assert.match(empty, /이 번호와 연결된 업체 기본정보가 아직 없습니다/);
  assert.match(empty, /업체의 신뢰도를 평가한 결과가 아닙니다/);
  assert.ok(empty.indexOf('기본정보 0 / 6개 확보') > empty.indexOf('<details id="lookup-supporting-info"'));
});

test('facts always expose six basic fields, preserve alternatives and warn only on comparable conflicts', () => {
  const base = record();
  const alternate = source({ id: 'second', url: 'https://registry.example.com/business', title: '다른 등록자료' });
  const publicRecord = {
    ...base, sources: [...base.sources, alternate], fields: [...base.fields,
      { field: 'address', value: '경기도 광명시 새주소 2', sourceId: 'second' },
      { field: 'description', value: '식당 소개', sourceId: 'directory' },
      { field: 'description', value: '식당의 연혁', sourceId: 'second' },
    ],
  };
  const html = render({ publicRecord, tab: 'facts' });
  assert.equal((html.match(/data-field="(?:name|address|phone|businessType|businessCategory|website)"/g) || []).length, 6);
  assert.match(html, /class="lookup-fact is-missing" data-field="website"/);
  assert.match(html, /경기도 광명시 새주소 2/);
  assert.match(html, /id="lookup-conflicts" class="lookup-conflicts insight-conflicts"/);
  assert.match(html, /출처별 값 차이 1개/);
  assert.match(html, /<span class="badge neutral">다른 출처 기록<\/span>/);
  assert.match(html, /id="lookup-field-alternatives-description"/);
  const empty = render({ publicRecord: null, tab: 'facts' });
  assert.equal((empty.match(/class="lookup-fact is-missing"/g) || []).length, 6);
  assert.doesNotMatch(empty, /이 사업자의 확인된 추가 정보/);
});

test('commerce records are joined by business number and failures are not interpreted as closure', () => {
  const commerce = { outcome: 'ok', checkedAt: STAMP, records: [
    { businessNumber: OTHER, name: '다른 업체 누출 금지', address: '다른 주소' },
    { businessNumber: '690-11-00416', name: '번호가 일치한 통신판매 상호', registrationNumber: '2026-광명-123', sourceUrl: 'https://www.ftc.go.kr/' },
  ] };
  const html = render({ commerce, tab: 'facts' });
  assert.match(html, /번호가 일치한 통신판매 상호/);
  assert.match(html, /번호 일치 1건/);
  assert.match(html, /2026-광명-123/);
  assert.doesNotMatch(html, /다른 업체 누출 금지|다른 주소/);
  const empty = render({ tab: 'facts', commerce: { outcome: 'not_found', records: [] } });
  assert.match(empty, /조회 결과만으로 미등록·폐업을 판단하지 않습니다/);
});

test('sources distinguish collection attempts, retained success, provider access and unconfirmed candidates', () => {
  const publicRecord = record({
    sources: [source({ collectedAt: OLD }), source({ id: 'same-url', collectedAt: OLD }),
      source({ id: 'candidate', match: 'candidate', url: 'https://blog.example.com/post', title: '연결 전 블로그', collectedAt: STAMP })],
    collection: { status: 'failed', lastAttemptAt: STAMP, lastSuccessAt: OLD, sourceStatuses: [
      { provider: 'comwel', label: '근로복지공단 산재보험', status: 'error', checkedAt: STAMP, message: '활용승인을 확인해 주세요.' },
      { provider: 'ftc', label: '공정거래위원회', status: 'not_configured', checkedAt: STAMP },
    ] },
  });
  const html = render({ publicRecord, tab: 'sources' });
  assert.match(html, /마지막 수집 시도<\/dt><dd><time datetime="2026-10-21T13:00:00.000Z"/);
  assert.match(html, /마지막 성공 수집<\/dt><dd><time datetime="2026-10-11T10:00:00.000Z"/);
  assert.match(html, /이전에 확보한 자료를 출처별 수집일과 함께 유지/);
  assert.match(html, /근로복지공단 산재보험/);
  assert.match(html, /활용승인·연결 확인 필요/);
  assert.match(html, /인증키 설정 대기/);
  assert.match(html, /매일 06:17 \(한국시간\)/);
  assert.match(html, /등록된 수집 대상·승인된 요청만 갱신/);
  assert.match(html, /연결자료 1개 · 수집기록 2건 · 확인 전 후보 1개/);
  assert.match(html, /class="lookup-source-candidates"/);
  assert.match(html, /기본정보에 자동으로 합치지 않습니다/);
  for (const action of ['reload-enrichment', 'enrichment-request', 'save-enrichment-note', 'enrichment-export']) {
    assert.match(html, new RegExp('data-action="' + action + '" data-bno="' + BNO + '"'));
  }
  assert.match(html, /class="text-button" data-action="enrichment-request"[^>]*>공개자료 추가 요청 · GitHub/);
  assert.match(html, /GitHub의 공개 요청 작성 화면에서 제출/);
});

test('a failed latest lookup clearly keeps the prior successful status and its original time', () => {
  const lastSuccess = status({ checkedAt: OLD });
  const failure = status({ outcome: 'error', businessStatus: 'unknown', taxType: '', message: '일시적인 연결 오류입니다.' });
  const html = render({ result: failure, partner: { businessNumber: BNO, lastSuccess, lastCheck: failure, history: [failure, lastSuccess] } });
  assert.match(html, /이번 조회를 완료하지 못했습니다/);
  assert.match(html, /직전 성공 기록 · 계속사업자/);
  assert.match(html, /<time datetime="2026-10-11T10:00:00.000Z"/);
  assert.match(html, /마지막 조회 시도 · <time datetime="2026-10-21T13:00:00.000Z"/);
  assert.match(html, /이전 상태와 과세유형입니다. 현재 상태를 확인한 결과가 아닙니다/);
  assert.match(html, /일시적인 연결 오류입니다/);
  assert.match(html, /부가가치세 일반과세자/);
  assert.doesNotMatch(html, /badge positive dot|계속사업자로 확인됐습니다/);
  const noSuccess = render({ result: failure, publicRecord: null });
  assert.match(noSuccess, /조회 실패 · 상태 미확인/);
  assert.doesNotMatch(noSuccess, /계속사업자|직전 성공 ·/);
});

test('no registration result requests number correction while connection failures request a retry', () => {
  for (const outcome of ['not_found', 'not_configured', 'error']) {
    const html = render({ result: status({ outcome, businessStatus: 'unknown', taxType: '' }), publicRecord: null });
    const nextStep = html.match(/<section class="lookup-next-step"[\s\S]*?<\/section>/)?.[0] || '';
    assert.match(nextStep, new RegExp('data-action="' + (outcome === 'not_found' ? 'edit-lookup-number' : 'insight-refresh-status') + '"'));
    assert.match(nextStep, /data-bno="6901100416"/);
    assert.doesNotMatch(html, /badge positive dot|조회 결과는 폐업자|계속사업자로 확인됐습니다|data-action="enrichment-request"/);
  }
});

test('stale status and collection failures have separate meanings and never become a current green status', () => {
  const html = render({ result: status({ checkedAt: OLD }), publicRecord: record({ collection: { status: 'partial', lastAttemptAt: STAMP } }) });
  assert.match(html, /이전 조회 기록은 계속사업자입니다/);
  assert.match(html, /마지막 정상 조회 후 7일을 넘겼습니다/);
  assert.match(html, /수집 문제를 업체 상태 변화로 판단하지 않습니다/);
  assert.doesNotMatch(html, /badge positive dot|계속사업자로 확인됐습니다|data-action="enrichment-request"/);
  const nextStep = html.match(/<section class="lookup-next-step"[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(nextStep, /data-action="insight-refresh-status"/);
});

test('refresh preserves selected context while disabling retry actions and keeping disclosure IDs stable', () => {
  const data = input({ result: status({ outcome: 'error', businessStatus: 'unknown' }), refreshing: true, tab: 'sources', loading: true });
  const html = renderBusinessWorkbench(data);
  assert.match(html, /이전 조회 결과를 표시합니다/);
  assert.match(html, /data-action="insight-refresh-status" data-bno="6901100416" disabled/);
  assert.match(html, /data-action="reload-enrichment" data-bno="6901100416" disabled/);
  assert.match(html, /id="lookup-tab-sources"[^>]+aria-selected="true"/);
  for (const details of html.matchAll(/<details\b[^>]*>/g)) assert.match(details[0], /id="lookup-/);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test('mismatched profiles, evidence and models cannot leak into a selected company', () => {
  const wrongRecord = record({ businessNumber: OTHER, sources: [source({ businessNumber: OTHER })], fields: [{ field: 'name', value: '타 업체 이름', sourceId: 'directory' }] });
  const wrongLinked = resolveBusinessProfile({ businessNumber: OTHER, record: wrongRecord, partner: { businessNumber: OTHER, name: '타 업체 별칭' } });
  const wrongModel = buildBusinessInsights({ businessNumber: OTHER, check: status({ businessNumber: OTHER }), summary: summarizeEnrichment(wrongRecord), now: NOW });
  const html = renderBusinessWorkbench({ result: status(), linked: wrongLinked, model: wrongModel, record: wrongRecord, summary: summarizeEnrichment(wrongRecord), tab: 'facts' });
  assert.doesNotMatch(html, /타 업체 이름|타 업체 별칭/);
  assert.equal((html.match(/class="lookup-fact is-missing"/g) || []).length, 6);
  assert.match(html, /690-11-00416/);
});

test('saved aliases stay private to the header and do not become external discovery queries', () => {
  const html = render({ partner: { businessNumber: BNO, name: '내부 전용 별칭' }, tab: 'sources', registered: true });
  assert.match(html, /내부 전용 별칭<\/h2>/);
  assert.match(html, /공개 상호 · 서해박속낙지전문점/);
  assert.match(html, /거래처 정보 수정/);
  assert.ok(html.includes(encodeURIComponent('서해박속낙지전문점')));
  assert.ok(!html.includes(encodeURIComponent('내부 전용 별칭')));
  const identical = render({ partner: { businessNumber: BNO, name: '서해박속낙지전문점' } });
  assert.doesNotMatch(identical, /공개 상호 · 서해박속낙지전문점/);
});

test('history retains successful and failed queries with source attribution and escaped values', () => {
  const result = status({ businessStatus: 'suspended' });
  const html = render({ tab: 'history', result, partner: { businessNumber: BNO, history: [
    status({ checkedAt: OLD }), status({ checkedAt: '2026-10-20T10:00:00Z', outcome: 'error', businessStatus: 'unknown' }),
  ] } });
  assert.equal((html.match(/class="lookup-history-item"/g) || []).length, 3);
  assert.match(html, /계속사업자 → 휴업자/);
  assert.match(html, /조회 실패/);
  assert.match(html, /같은 출처의 정상 조회 비교/);
});

test('remote strings cannot inject elements, attributes, action names or unsafe links in any panel', () => {
  const attack = '<img src=x onerror="alert(1)">';
  const data = input({ partner: { businessNumber: BNO, name: attack }, error: attack });
  data.model.profile.basic[0].value = '<script>alert(1)</script>';
  data.model.profile.basic[0].source.url = 'javascript:alert(1)';
  data.model.actions.unshift({ id: 'bad" onclick="alert(1)', title: attack, description: attack, action: 'insight-view-sources', label: '" onfocus="alert(1)' });
  data.model.actions.push({ id: 'untrusted-action', title: attack, action: 'onclick', label: attack });
  data.model.status.sourceUrl = 'https://user:secret@example.com/';
  data.model.timeline[0].sourceUrl = 'https://example.com/?token=secret';
  data.model.timeline[0].sourceName = attack;
  for (const tab of LOOKUP_TABS) {
    const html = renderBusinessWorkbench({ ...data, tab: tab.id });
    assert.doesNotMatch(html, /<img\b|<script\b|href="javascript:|href="https:\/\/user:|href="[^"]*token=secret|data-action="onclick"/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
    for (const button of html.matchAll(/<button\b[^>]*>/g)) assert.match(button[0], /data-bno="6901100416"/);
  }
});
