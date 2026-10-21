import { formatBusinessNumber, isValidBusinessNumber, normalizeBusinessNumber } from './domain.mjs';
import { ENRICHMENT_FIELDS, safeEnrichmentUrl } from './enrichment.mjs';
import { resolveBusinessProfile } from './business-profile.mjs';

/** Recheck reminders are app policies, not a claim about official update cadence. */
export const INSIGHT_POLICY = Object.freeze({ statusDays: 7, publicDataDays: 30 });
export const BASIC_BUSINESS_FIELDS = Object.freeze(['name', 'address', 'phone', 'businessType', 'businessCategory', 'website']);
const DAY = 86_400_000;
const STATUS = { active: '계속사업자', suspended: '휴업자', closed: '폐업자' };
const OUTCOMES = new Set(['ok', 'error', 'not_found', 'not_configured']);
// Different prose, lists and unaligned measurement periods are not identity conflicts.
const CONFLICT_FIELDS = new Set([
  'name', 'address', 'phone', 'email', 'website', 'businessType', 'businessCategory',
  'industry', 'foundedAt', 'representative', 'corporateNumber', 'hours',
]);
const clean = (value, limit = 500) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit) : '';
const own = (value, key) => value && Object.hasOwn(value, key);
const sameNumber = (value, number) => !!number && normalizeBusinessNumber(value?.businessNumber) === number;

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return null;
  const calendar = new Date(value.slice(0, 10) + 'T00:00:00.000Z');
  const time = Date.parse(value);
  if (!Number.isFinite(+calendar) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10) || !Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function clock(value) {
  const time = value instanceof Date ? +value : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(time) ? time : Date.now();
}

function freshness(value, days, now) {
  const checkedAt = timestamp(value);
  if (!checkedAt) return { state: 'unknown', checkedAt: null, ageDays: null, thresholdDays: days };
  const age = now - Date.parse(checkedAt);
  if (age < -300_000) return { state: 'future', checkedAt, ageDays: null, thresholdDays: days };
  return { state: age > days * DAY ? 'stale' : 'fresh', checkedAt, ageDays: Math.max(0, Math.floor(age / DAY)), thresholdDays: days };
}

function publicSource(source, businessNumber) {
  const url = safeEnrichmentUrl(source?.url);
  const exact = source?.match === 'exact_bno' && sameNumber(source, businessNumber);
  const domain = source?.match === 'confirmed_domain';
  if (!url || !clean(source?.id) || (!exact && !domain)) return null;
  return {
    id: clean(source.id, 120), url, title: clean(source.title) || new URL(url).hostname,
    channel: clean(source.channel, 50), match: exact ? 'exact_bno' : 'confirmed_domain',
    collectedAt: timestamp(source.collectedAt), publishedAt: timestamp(source.publishedAt),
    host: new URL(url).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, ''),
  };
}

function valueKey(field, value) {
  if (field === 'phone') return value.replace(/[^\d+]/g, '');
  return value.normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g, ' ').trim();
}

function sourceIdentity(check) {
  const source = typeof check?.source === 'object' && check.source ? check.source : {};
  return safeEnrichmentUrl(source.url || check?.sourceUrl) || clean(source.name || check?.source, 200);
}

function validCheck(value, businessNumber) {
  if (!sameNumber(value, businessNumber) || !OUTCOMES.has(value?.outcome)) return null;
  const source = typeof value.source === 'object' && value.source ? value.source : {};
  return {
    businessNumber, outcome: value.outcome,
    businessStatus: value.outcome === 'ok' && own(STATUS, value.businessStatus) ? value.businessStatus : 'unknown',
    taxType: value.outcome === 'ok' ? clean(value.taxType, 200) : '',
    checkedAt: timestamp(value.checkedAt), closedAt: timestamp(value.closedAt)?.slice(0, 10) || null,
    taxTypeChangedAt: timestamp(value.taxTypeChangedAt)?.slice(0, 10) || null,
    sourceName: clean(source.name || (typeof value.source === 'string' ? value.source : ''), 200) || '조회 출처 미제공',
    sourceUrl: safeEnrichmentUrl(source.url || value.sourceUrl), sourceIdentity: sourceIdentity(value),
  };
}

function newest(values) {
  return [...values].sort((a, b) => orderTime(b.checkedAt) - orderTime(a.checkedAt))[0] || null;
}
const orderTime = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : -Infinity;

/** Business-number join only. Neither a same-name candidate nor a failed fetch is a business fact. */
export function buildBusinessInsights({ businessNumber, partner = null, check = null, summary = null, now = Date.now() } = {}) {
  const number = normalizeBusinessNumber(businessNumber);
  const validNumber = isValidBusinessNumber(number);
  const currentTime = clock(now);
  const linkedPartner = validNumber && sameNumber(partner, number) ? partner : null;
  const matchingSummary = validNumber && sameNumber(summary, number) ? summary : null;
  const linkedSummary = matchingSummary ? resolveBusinessProfile({ businessNumber: number, summary: matchingSummary }).summary : null;
  const identityRejected = !!((partner && !linkedPartner) || (summary && !matchingSummary) || (check && (!validNumber || !sameNumber(check, number))));
  const sourceMap = new Map();
  for (const item of (Array.isArray(linkedSummary?.sources) ? linkedSummary.sources : []).slice(0, 1200)) {
    const source = publicSource(item, number);
    if (source && !sourceMap.has(source.id)) sourceMap.set(source.id, source);
  }
  const sources = [...sourceMap.values()];
  const fields = [], fieldKeys = new Set();
  for (const item of (Array.isArray(linkedSummary?.fields) ? linkedSummary.fields : []).slice(0, 12000)) {
    if (!own(ENRICHMENT_FIELDS, item?.field) || fieldKeys.has(item.field) || item.match === 'candidate') continue;
    const source = sourceMap.get(item.sourceId);
    const value = clean(item.value, 2000);
    if (!source || !value) continue;
    if (item.field === 'website' && !safeEnrichmentUrl(value)) continue;
    const alternatives = [];
    for (const alternate of (Array.isArray(item.alternatives) ? item.alternatives : []).slice(0, 1200)) {
      const alternateSource = sourceMap.get(alternate?.sourceId);
      const alternateValue = clean(alternate?.value, 2000);
      if (!alternateSource || alternate.match === 'candidate' || !alternateValue || (alternate.field && alternate.field !== item.field)) continue;
      if (item.field === 'website' && !safeEnrichmentUrl(alternateValue)) continue;
      alternatives.push({ value: alternateValue, source: alternateSource });
    }
    fieldKeys.add(item.field);
    fields.push({
      field: item.field, label: ENRICHMENT_FIELDS[item.field], value, source, alternatives,
      conflict: new Set([value, ...alternatives.map(entry => entry.value)].map(v => valueKey(item.field, v))).size > 1,
      freshness: freshness(source.collectedAt, INSIGHT_POLICY.publicDataDays, currentTime),
    });
  }
  const byField = new Map(fields.map(item => [item.field, item]));
  const publicName = byField.get('name')?.value || '';
  const userName = clean(linkedPartner?.name, 200);
  const basic = BASIC_BUSINESS_FIELDS.map(field => ({
    field, label: ENRICHMENT_FIELDS[field], confirmed: byField.has(field), ...(byField.get(field) || {}),
  }));
  const missing = basic.filter(item => !item.confirmed);
  const conflicts = fields.filter(item => item.conflict && CONFLICT_FIELDS.has(item.field)).map(item => ({
    field: item.field, label: item.label, values: [{ value: item.value, source: item.source }, ...item.alternatives],
  }));
  const checkValues = validNumber ? [check, linkedPartner?.lastCheck, linkedPartner?.lastSuccess, ...(Array.isArray(linkedPartner?.history) ? linkedPartner.history : []).slice(0, 50)]
    .map(item => validCheck(item, number)).filter(Boolean) : [];
  const latest = newest(checkValues);
  const success = newest(checkValues.filter(item => item.outcome === 'ok' && own(STATUS, item.businessStatus)));
  const usingPrevious = !!success && latest?.outcome !== 'ok';
  const statusFreshness = freshness(success?.checkedAt, INSIGHT_POLICY.statusDays, currentTime);
  const staleFields = fields.filter(item => item.freshness.state === 'stale');
  const undatedFields = fields.filter(item => ['unknown', 'future'].includes(item.freshness.state));
  const candidateCount = new Set((Array.isArray(linkedSummary?.sources) ? linkedSummary.sources : [])
    .filter(item => !sourceMap.has(item?.id) && safeEnrichmentUrl(item?.url)).map(item => item.id)).size;
  const domainCount = new Set(sources.map(item => item.host)).size;
  const sourceDates = fields.map(item => item.source.collectedAt).filter(Boolean).sort();
  const actions = [];
  const add = (id, title, description, action, label, priority, tone = 'neutral') => actions.push({ id, title, description, action, label, priority, tone });
  if (!validNumber) add('invalid-number', '사업자번호를 먼저 확인하세요', '사업자등록증의 10자리 번호를 확인한 뒤 다시 조회하세요. 번호가 맞기 전에는 다른 자료를 연결하지 않습니다.', 'insight-refresh-status', '번호 다시 확인', 0, 'warning');
  else if (identityRejected) add('identity-mismatch', '연결 번호가 다른 자료를 제외했습니다', '조회·저장·공개자료 중 사업자번호가 다른 정보가 있어 인사이트에서 제외했습니다. 해당 번호의 자료를 다시 불러오세요.', 'insight-refresh-status', '이 번호로 다시 확인', 0, 'warning');
  if (validNumber && latest?.outcome && latest.outcome !== 'ok') {
    const message = latest.outcome === 'not_found'
      ? '이번 조회에서 등록정보를 찾지 못했습니다. 번호와 원본 등록증을 대조하세요. 조회되지 않았다는 이유로 폐업으로 판단하지 않습니다.'
      : latest.outcome === 'not_configured' ? '상태 조회 연결을 아직 사용할 수 없습니다. 연결 상태를 확인한 뒤 다시 조회하세요.'
        : '최근 상태 조회를 완료하지 못했습니다. ' + (success ? '아래 상태는 직전 성공한 조회의 기록입니다.' : '현재 사업자 상태는 미확인입니다.');
    add('latest-query-failed', '현재 상태를 다시 확인하세요', message, 'insight-refresh-status', '상태 다시 확인', 1, 'warning');
  } else if (validNumber && (!success || statusFreshness.state !== 'fresh')) {
    add('status-recheck', success ? '상태 확인 시점을 갱신하세요' : '사업자 상태부터 확인하세요',
      success ? statusFreshness.state === 'stale' ? '마지막 정상 조회 후 7일이 지났습니다. 거래 전에 새 상태를 확인하세요.' : '조회 시각이 없거나 현재보다 미래입니다. 상태와 기준시각을 다시 확인하세요.'
        : '번호 형식만으로 실제 등록 상태를 알 수 없습니다. 국세청 상태 조회를 진행하세요.',
      'insight-refresh-status', '상태 새로 확인', 2, 'warning');
  }
  if (success && ['suspended', 'closed'].includes(success.businessStatus)) {
    add('operation-check', (usingPrevious ? '직전 조회에 ' : '조회 결과에 ') + STATUS[success.businessStatus] + '로 표시됩니다',
      '표시된 조회일을 확인하고 현재 업무 진행 여부와 계약·거래 일정을 거래처에 확인하세요.' + (success.closedAt ? ' 응답의 폐업일: ' + success.closedAt + '.' : ''),
      'validate-registration', '등록정보 대조', 3, 'warning');
  }
  if (conflicts.length) add('field-conflicts', conflicts.length + '개 항목의 출처별 값이 다릅니다',
    conflicts.map(item => item.label).join(' · ') + '의 값과 수집일을 비교하세요. 출처마다 기준·시점·표현이 다를 수 있어 오류로 단정하지 않습니다.',
    'insight-view-sources', '출처 차이 확인', 4, 'warning');
  if (staleFields.length || undatedFields.length) add('public-recheck', '공개자료의 기준일을 확인하세요',
    [staleFields.length ? '수집 후 30일이 지난 항목 ' + staleFields.length + '개' : '', undatedFields.length ? '수집 시각을 확인할 항목 ' + undatedFields.length + '개' : ''].filter(Boolean).join(' · ') + '. 수집본이 최신 현황과 다를 수 있습니다.',
    'enrichment-request', '자료 보강 요청', 5);
  if (['failed', 'partial'].includes(linkedSummary?.collection?.status)) add('collection-incomplete', '최근 자료 수집이 일부 또는 전부 완료되지 않았습니다',
    '확보된 자료는 해당 출처의 수집일과 함께 유지했습니다. 수집 실패를 업체 상태 변화로 해석하지 않습니다.',
    'insight-view-sources', '수집 상태 보기', 6);
  if (validNumber && missing.length) add('profile-gaps', '기본정보 ' + missing.length + '개 항목을 더 확인할 수 있습니다',
    missing.map(item => item.label).join(' · ') + '. 아직 연결된 출처가 없는 항목입니다. 정보 부재는 업체의 문제를 뜻하지 않습니다.',
    'enrichment-request', '자료 보강 요청', 7);
  if (validNumber) add('registration-cross-check', '등록증과 거래 서류의 정보를 대조하세요',
    '사업자번호·개업일·대표자 등을 입력해 국세청 등록정보와 대조할 수 있습니다. 상태 조회만으로 상호·주소가 확인되는 것은 아닙니다.',
    'validate-registration', '등록정보 대조', 8);
  if (candidateCount) add('candidates', '연결 전 확인할 웹 자료가 있습니다',
    candidateCount + '개 후보는 동일 사업자 확인 전이므로 기본정보와 인사이트 계산에 합치지 않았습니다.',
    'insight-view-sources', '연결 후보 보기', 9);
  actions.sort((a, b) => a.priority - b.priority);

  const history = [...new Map(checkValues.map(item => [JSON.stringify([item.checkedAt, item.outcome, item.businessStatus, item.sourceIdentity, item.taxType]), item])).values()]
    .sort((a, b) => orderTime(b.checkedAt) - orderTime(a.checkedAt));
  const timeline = history.map((item, index) => {
    const previous = history.slice(index + 1).find(old => old.outcome === 'ok' && own(STATUS, old.businessStatus) && old.sourceIdentity && old.sourceIdentity === item.sourceIdentity && old.checkedAt && item.checkedAt && Date.parse(old.checkedAt) < Date.parse(item.checkedAt));
    const changed = item.outcome === 'ok' && own(STATUS, item.businessStatus) && previous && previous.businessStatus !== item.businessStatus;
    return {
      checkedAt: item.checkedAt, outcome: item.outcome, businessStatus: item.businessStatus,
      label: item.outcome === 'ok' ? STATUS[item.businessStatus] || '상태 해석 확인 필요' : ({ error: '조회 실패', not_found: '조회 결과 없음', not_configured: '연결 설정 대기' })[item.outcome],
      taxType: item.taxType, sourceName: item.sourceName, sourceUrl: item.sourceUrl,
      change: changed ? { from: previous.businessStatus, to: item.businessStatus, label: STATUS[previous.businessStatus] + ' → ' + STATUS[item.businessStatus] } : null,
    };
  }).slice(0, 8);

  return {
    businessNumber: number, validNumber, identityMatched: !!linkedSummary && sources.length > 0, identityRejected,
    displayName: userName || publicName || (validNumber ? formatBusinessNumber(number) : '사업자번호 미확인'),
    userName, publicName, nameDifference: !!userName && !!publicName && valueKey('name', userName) !== valueKey('name', publicName),
    headline: actions[0]?.priority <= 5 ? actions[0].title : '확인한 정보와 다음 행동을 한눈에',
    status: {
      latestOutcome: latest?.outcome || null, latestCheckedAt: latest?.checkedAt || null,
      businessStatus: success?.businessStatus || 'unknown', label: STATUS[success?.businessStatus] || '미확인',
      taxType: success?.taxType || '', checkedAt: success?.checkedAt || null, closedAt: success?.closedAt || null,
      usingPrevious, freshness: statusFreshness, sourceName: success?.sourceName || latest?.sourceName || '',
      needsRefresh: !success || latest?.outcome !== 'ok' || statusFreshness.state !== 'fresh',
      sourceUrl: success?.sourceUrl || latest?.sourceUrl || null,
    },
    profile: { fields, basic, confirmedCount: basic.length - missing.length, totalCount: BASIC_BUSINESS_FIELDS.length, missing, publicName },
    evidence: {
      sourceCount: new Set(sources.map(item => item.url)).size, domainCount, sources,
      exactNumberSourceCount: sources.filter(item => item.match === 'exact_bno').length,
      candidateCount, staleFieldCount: staleFields.length, undatedFieldCount: undatedFields.length,
      oldestCollectedAt: sourceDates[0] || null, latestCollectedAt: sourceDates.at(-1) || null,
      collectionStatus: clean(linkedSummary?.collection?.status, 50) || 'not_collected',
    },
    conflicts, actions, timeline, policy: INSIGHT_POLICY,
  };
}
