import {
  formatBusinessNumber, isValidBusinessNumber, MAX_HISTORY_ENTRIES, normalizeBusinessNumber, toCsv,
} from './domain.mjs';
import { safeEnrichmentUrl } from './enrichment.mjs';

const DAY = 86_400_000;
const KST = 9 * 60 * 60 * 1000;
const STATUS = Object.freeze({ active: '계속사업자', suspended: '휴업자', closed: '폐업자' });
const OUTCOME = Object.freeze({ error: '조회 실패', not_found: '조회 결과 없음', not_configured: '연결 설정 대기' });
const OUTCOMES = new Set(['ok', 'error', 'not_found', 'not_configured']);
const FILTERS = new Set(['all', 'status', 'tax', 'issues']);
const PERIODS = new Set(['all', '30', '90', '365']);
const UNKNOWN_TAX = new Set([
  '', '-', '--', '미확인', '확인필요', '확인되지않음', '알수없음', '정보없음', '해당없음',
  '없음', '불명', 'unknown', 'n/a', 'na', 'null', 'undefined',
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = (value, limit = 500) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const knownStatus = value => Object.hasOwn(STATUS, value);

/** Persisted checks use zoned ISO timestamps. A timezone-less date is not an observation instant. */
function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const calendar = new Date(value.slice(0, 10) + 'T00:00:00.000Z');
  const time = Date.parse(value);
  if (!Number.isFinite(+calendar) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10) || !Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function clock(value) {
  const time = value instanceof Date ? +value : typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(time) ? time : Date.now();
}

function canonicalUrl(value) {
  const safe = safeEnrichmentUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  return url.origin + url.pathname.replace(/\/+$/, '') + url.search;
}

function sourceOf(check) {
  const source = object(check.source) ? check.source : {};
  const name = clean(source.name || (typeof check.source === 'string' ? check.source : ''), 200);
  const url = canonicalUrl(source.url) || canonicalUrl(check.sourceUrl);
  const hasReportedUrl = [source.url, check.sourceUrl].some(value => typeof value === 'string' ? !!value.trim() : value != null);
  return {
    sourceName: name || '조회 출처 미제공', sourceUrl: url,
    // Do not compare unrelated observations merely because both omitted their source.
    sourceIdentity: url ? `url:${url}` : !hasReportedUrl && name ? `name:${name.normalize('NFKC')}` : '',
  };
}

function taxValue(row) {
  const text = row.taxType.normalize('NFKC').trim();
  const placeholder = text.toLowerCase().replace(/[\s.]/g, '');
  if (UNKNOWN_TAX.has(placeholder) || /등록되지\s*않은\s*사업자등록번호/.test(text)) return null;
  // A code alone has no user-readable meaning. Keep it in the row, but do not infer a tax change from it.
  const code = /^\d{2}$/.test(row.taxTypeCode) && !['00', '99'].includes(row.taxTypeCode) ? row.taxTypeCode : '';
  return { text: row.taxType, code, key: text.replace(/^부가가치세\s*/, '').replace(/\s+/g, '').toLowerCase() };
}

function sameTax(a, b) {
  return a.code && b.code ? a.code === b.code : a.key === b.key;
}

function normalizeCheck(value, businessNumber) {
  if (!object(value) || normalizeBusinessNumber(value.businessNumber) !== businessNumber || !OUTCOMES.has(value.outcome)) return null;
  const success = value.outcome === 'ok';
  const businessStatus = success && knownStatus(value.businessStatus) ? value.businessStatus : 'unknown';
  return {
    businessNumber, checkedAt: timestamp(value.checkedAt), outcome: value.outcome, businessStatus,
    label: success ? STATUS[businessStatus] || '상태 해석 확인 필요' : OUTCOME[value.outcome],
    taxType: success ? clean(value.taxType, 200) : '',
    taxTypeCode: success ? clean(value.taxTypeCode, 40) : '',
    ...sourceOf(value), statusChange: null, taxChange: null, previousCheckedAt: null,
    statusConflict: false, taxConflict: false, issue: false, issueReason: '',
  };
}

function observationKey(row) {
  return JSON.stringify([row.checkedAt, row.outcome, row.businessStatus, row.sourceIdentity]);
}

function sameTaxObservation(a, b) {
  const first = taxValue(a), second = taxValue(b);
  return first && second ? sameTax(first, second) : a.taxType === b.taxType && a.taxTypeCode === b.taxTypeCode;
}

function compareTime(a, b, sort = 'newest') {
  if (!a.checkedAt && !b.checkedAt) return 0;
  if (!a.checkedAt) return 1;
  if (!b.checkedAt) return -1;
  const difference = Date.parse(a.checkedAt) - Date.parse(b.checkedAt);
  return sort === 'oldest' ? difference : -difference;
}

function taxChange(before, after, previousCheckedAt) {
  // If labels stayed identical but explicit codes differ, preserve that distinction in the exported/displayed evidence.
  const showCode = before.text === after.text && before.code && after.code && before.code !== after.code;
  const from = before.text + (showCode ? ` (코드 ${before.code})` : '');
  const to = after.text + (showCode ? ` (코드 ${after.code})` : '');
  return { from, to, label: `${from} → ${to}`, previousCheckedAt };
}

/** Compare complete observations before applying display limits, dates, or type filters. */
function addChanges(rows, now) {
  const sources = new Map();
  const chronological = [...rows].sort((a, b) => compareTime(a, b, 'oldest'));
  for (let index = 0; index < chronological.length;) {
    const checkedAt = chronological[index].checkedAt;
    const group = [];
    do { group.push(chronological[index++]); } while (index < chronological.length && chronological[index].checkedAt === checkedAt);
    if (!checkedAt || Date.parse(checkedAt) > now) continue;
    const bySource = new Map();
    for (const row of group) {
      if (row.outcome !== 'ok' || !row.sourceIdentity) continue;
      if (!bySource.has(row.sourceIdentity)) bySource.set(row.sourceIdentity, []);
      bySource.get(row.sourceIdentity).push(row);
    }
    for (const [identity, checks] of bySource) {
      const baseline = sources.get(identity) || { status: null, tax: null };
      const statuses = checks.filter(row => knownStatus(row.businessStatus));
      const taxes = checks.map(row => ({ row, value: taxValue(row) })).filter(item => item.value);
      const statusConflict = new Set(statuses.map(row => row.businessStatus)).size > 1;
      const taxConflict = taxes.some((item, position) => taxes.slice(position + 1).some(other => !sameTax(item.value, other.value)));
      for (const row of checks) {
        row.statusConflict = statusConflict;
        row.taxConflict = taxConflict;
        const tax = taxValue(row);
        if (knownStatus(row.businessStatus) && !statusConflict && baseline.status) {
          row.previousCheckedAt = baseline.status.checkedAt;
          if (baseline.status.value !== row.businessStatus) row.statusChange = {
            from: baseline.status.value, to: row.businessStatus,
            label: `${STATUS[baseline.status.value]} → ${STATUS[row.businessStatus]}`,
            previousCheckedAt: baseline.status.checkedAt,
          };
        }
        if (tax && !taxConflict && baseline.tax) {
          row.previousCheckedAt ||= baseline.tax.checkedAt;
          if (!sameTax(baseline.tax.value, tax)) row.taxChange = taxChange(baseline.tax.value, tax, baseline.tax.checkedAt);
        }
      }
      // A conflicting instant interrupts that dimension's comparison chain. An unknown value or failed request does not invent a new baseline.
      if (statusConflict) baseline.status = null;
      else if (statuses.length) baseline.status = { value: statuses[0].businessStatus, checkedAt };
      if (taxConflict) baseline.tax = null;
      else if (taxes.length) {
        const preferred = taxes.find(item => item.value.code) || taxes[0];
        baseline.tax = { value: preferred.value, checkedAt };
      }
      sources.set(identity, baseline);
    }
  }
  for (const row of rows) {
    const reasons = [];
    if (row.outcome !== 'ok') reasons.push(row.label);
    else if (!knownStatus(row.businessStatus)) reasons.push('응답의 사업자 상태를 해석할 수 없습니다.');
    if (!row.checkedAt) reasons.push('조회 시각이 없어 이전 응답과 비교하지 않습니다.');
    else if (Date.parse(row.checkedAt) > now) reasons.push('미래로 기록된 조회 시각을 확인해 주세요. 이전 응답과 비교하지 않습니다.');
    if (row.statusConflict || row.taxConflict) reasons.push('같은 시각의 응답이 달라 해당 항목의 비교를 보류했습니다.');
    row.issue = reasons.length > 0;
    row.issueReason = reasons.join(' ');
  }
}

const kstDay = checkedAt => new Date(Date.parse(checkedAt) + KST).toISOString().slice(0, 10);

function groupedRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = row.checkedAt ? kstDay(row.checkedAt) : 'undated';
    if (!groups.has(key)) {
      const [year, month, day] = key.split('-');
      groups.set(key, {
        key, label: key === 'undated' ? '조회 시각 없음' : `${year}년 ${Number(month)}월 ${Number(day)}일`, rows: [],
      });
    }
    groups.get(key).rows.push(row);
  }
  return [...groups.values()];
}

/** Observed status/tax history for one saved business, not a claim about the real-world effective date of a change. */
export function buildBusinessHistory({ partner = null, businessNumber = partner?.businessNumber, filter = 'all', period = 'all', sort = 'newest', now = new Date() } = {}) {
  const number = normalizeBusinessNumber(businessNumber);
  const currentTime = clock(now);
  const selectedFilter = FILTERS.has(filter) ? filter : 'all';
  const selectedPeriod = PERIODS.has(String(period)) ? String(period) : 'all';
  const selectedSort = sort === 'oldest' ? 'oldest' : 'newest';
  const linked = isValidBusinessNumber(number) && object(partner) && normalizeBusinessNumber(partner.businessNumber) === number ? partner : null;
  const observations = linked ? [linked.lastCheck, linked.lastSuccess, ...(Array.isArray(linked.history) ? linked.history : [])] : [];
  const unique = new Map();
  for (const value of observations) {
    const row = normalizeCheck(value, number);
    if (!row) continue;
    const key = observationKey(row);
    if (!unique.has(key)) unique.set(key, []);
    const matches = unique.get(key);
    const existing = matches.find(item => sameTaxObservation(item, row));
    if (!existing) matches.push(row);
    else {
      if (existing.sourceName === '조회 출처 미제공' && row.sourceName !== '조회 출처 미제공') existing.sourceName = row.sourceName;
      // Older copies can omit the tax code. The same timestamp/value is still one observation.
      if (!taxValue(existing)?.code && taxValue(row)?.code) existing.taxTypeCode = row.taxTypeCode;
    }
  }
  const normalized = [...unique.values()].flat();
  addChanges(normalized, currentTime);
  const allRows = normalized.sort((a, b) => compareTime(a, b)).slice(0, MAX_HISTORY_ENTRIES);
  const today = Math.floor((currentTime + KST) / DAY);
  const periodRows = selectedPeriod === 'all' ? allRows : allRows.filter(row => {
    if (!row.checkedAt) return false;
    const time = Date.parse(row.checkedAt);
    const day = Math.floor((time + KST) / DAY);
    return time <= currentTime && day >= today - Number(selectedPeriod) + 1 && day <= today;
  });
  const counts = {
    all: periodRows.length, status: periodRows.filter(row => row.statusChange).length,
    tax: periodRows.filter(row => row.taxChange).length, issues: periodRows.filter(row => row.issue).length,
  };
  const rows = periodRows.filter(row => selectedFilter === 'all'
    || (selectedFilter === 'status' && row.statusChange)
    || (selectedFilter === 'tax' && row.taxChange)
    || (selectedFilter === 'issues' && row.issue)).sort((a, b) => compareTime(a, b, selectedSort));
  return {
    allRows, rows, groups: groupedRows(rows), counts,
    summary: {
      latestCheckedAt: allRows.find(row => row.checkedAt && Date.parse(row.checkedAt) <= currentTime)?.checkedAt || null,
      statusChanges: allRows.filter(row => row.statusChange).length,
      taxChanges: allRows.filter(row => row.taxChange).length, issues: allRows.filter(row => row.issue).length,
    },
    filter: selectedFilter, period: selectedPeriod, sort: selectedSort, businessNumber: number,
  };
}

function kstTime(value) {
  const checkedAt = timestamp(value);
  return checkedAt ? new Date(Date.parse(checkedAt) + KST).toISOString().replace('T', ' ').replace('Z', ' +09:00') : '';
}

function csvType(row) {
  const types = [];
  if (row.statusChange) types.push('사업자 상태 변경');
  if (row.taxChange) types.push('과세 유형 변경');
  if (row.issue || row.outcome !== 'ok') types.push('미완료·확인 필요');
  return types.join(' / ') || '상태 확인';
}

/** Explicit public-evidence columns only; domain.toCsv protects spreadsheet formula cells and adds UTF-8 BOM/CRLF. */
export function buildBusinessHistoryCsv({ businessNumber, rows = [] } = {}) {
  const number = normalizeBusinessNumber(businessNumber);
  if (!isValidBusinessNumber(number)) throw new TypeError('내보낼 사업자등록번호를 확인해 주세요.');
  if (!Array.isArray(rows) || rows.some(row => !object(row))) throw new TypeError('내보낼 조회 이력 형식을 확인해 주세요.');
  if (rows.some(row => Object.hasOwn(row, 'businessNumber') && normalizeBusinessNumber(row.businessNumber) !== number)) {
    throw new TypeError('다른 사업자의 조회 이력이 포함되어 내보내기를 중단했습니다.');
  }
  const statusLabel = value => knownStatus(value) ? STATUS[value] : clean(value, 200);
  return toCsv(rows, [
    { key: 'businessNumber', label: '사업자등록번호', value: () => formatBusinessNumber(number) },
    { key: 'checkedAt', label: '조회 시각 (UTC)', value: row => timestamp(row.checkedAt) || '' },
    { key: 'checkedAtKst', label: '조회 시각 (KST)', value: row => kstTime(row.checkedAt) },
    { key: 'type', label: '기록 유형', value: csvType },
    { key: 'outcome', label: '조회 결과', value: row => row.outcome === 'ok' ? '조회 성공' : Object.hasOwn(OUTCOME, row.outcome) ? OUTCOME[row.outcome] : '확인 필요' },
    { key: 'businessStatus', label: '확인한 사업자 상태', value: row => row.outcome === 'ok' ? statusLabel(row.businessStatus) : '미확인' },
    { key: 'taxType', label: '확인한 과세 유형' },
    { key: 'statusFrom', label: '변경 전 사업자 상태', value: row => statusLabel(row.statusChange?.from) },
    { key: 'statusTo', label: '변경 후 사업자 상태', value: row => statusLabel(row.statusChange?.to) },
    { key: 'statusPreviousCheckedAt', label: '상태 비교 기준 조회 (UTC)', value: row => timestamp(row.statusChange?.previousCheckedAt) || '' },
    { key: 'statusPreviousCheckedAtKst', label: '상태 비교 기준 조회 (KST)', value: row => kstTime(row.statusChange?.previousCheckedAt) },
    { key: 'taxFrom', label: '변경 전 과세 유형', value: row => row.taxChange?.from || '' },
    { key: 'taxTo', label: '변경 후 과세 유형', value: row => row.taxChange?.to || '' },
    { key: 'taxPreviousCheckedAt', label: '과세 비교 기준 조회 (UTC)', value: row => timestamp(row.taxChange?.previousCheckedAt) || '' },
    { key: 'taxPreviousCheckedAtKst', label: '과세 비교 기준 조회 (KST)', value: row => kstTime(row.taxChange?.previousCheckedAt) },
    { key: 'issueReason', label: '확인 필요 사유' },
    { key: 'sourceName', label: '출처명' },
    { key: 'sourceUrl', label: '출처 URL', value: row => canonicalUrl(row.sourceUrl) || '' },
  ]);
}
