import { isValidBusinessNumber, normalizeBusinessNumber } from './domain.mjs';

/** Public business facts only. Values retain their origin and never imply a credit score. */
export const ENRICHMENT_FIELDS = Object.freeze({
  name: '상호·법인명', businessType: '업태', businessCategory: '종목', address: '사업장 주소', phone: '업무용 전화', email: '업무용 이메일',
  website: '공식 웹사이트', description: '사업 소개', industry: '업종·사업 분야',
  foundedAt: '설립·개업일', representative: '공개된 법인 대표자', products: '제품·서비스',
  employees: '공개 인원 정보', revenue: '공개 매출 정보', corporateNumber: '법인등록번호',
  registration: '인허가·등록 정보', insuranceEmployeeCount: '보험 기준 상시인원', insuranceEstablishedAt: '보험 성립일', insuranceIndustry: '보험 적용 업종', insuranceType: '가입 보험 구분', hours: '운영시간', certifications: '인증·특허 정보',
});
const FIELD_LIMITS = { name: 200, businessType: 500, businessCategory: 500, address: 500, phone: 80, email: 254, website: 2048,
  description: 2000, industry: 500, foundedAt: 100, representative: 100,
  products: 1000, employees: 200, revenue: 300, corporateNumber: 80,
  registration: 1000, insuranceEmployeeCount: 200, insuranceEstablishedAt: 200, insuranceIndustry: 500, insuranceType: 100, hours: 500, certifications: 1000 };
const CHANNELS = new Set(['official_website', 'website', 'public_data', 'registry', 'news', 'jobs', 'social', 'commerce', 'directory', 'user_document']);
const SOURCE_PRIORITY = { public_data: 0, registry: 1, official_website: 2, website: 3, commerce: 4, jobs: 5, news: 6, social: 7, directory: 8, user_document: 9 };
const MATCH_RANK = { exact_bno: 0, confirmed_domain: 1, candidate: 2 };
const MAX_BYTES = 8_000_000;
const MAX_RECORDS = 5000;
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeText = (value, limit = 200) => typeof value === 'string'
  ? value.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';

/** A URL to a public resource, not a credential-bearing API request or local endpoint. */
export function safeEnrichmentUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
      || !host.includes('.') || host === 'localhost' || /\.(?:localhost|local|internal|test|invalid)$/.test(host)
      || /^\[|^\d+(?:\.\d+)*$/.test(host)
      || (url.port && !['80', '443'].includes(url.port))) return null;
    for (const [key] of url.searchParams) {
      if (/(?:api.?key|service.?key|secret|token|password|passwd|authorization|signature|credential|access.?key)/i.test(key) || /^(?:key|auth|code|sig|jwt)$/i.test(key)) return null;
    }
    url.hash = '';
    return url.href;
  } catch { return null; }
}
const hostOf = value => {
  const url = safeEnrichmentUrl(value);
  return url ? new URL(url).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '') : '';
};
function officialHost(input) {
  if (typeof input.officialDomain === 'string') {
    const host = hostOf(input.officialDomain.includes('://') ? input.officialDomain : `https://${input.officialDomain}`);
    if (host) return host;
  }
  return hostOf(input.website);
}
function timestamp(value) {
  if (typeof value !== 'string' || value.length > 50 || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return null;
  const calendar = new Date(value.slice(0, 10) + 'T00:00:00.000Z');
  if (!Number.isFinite(+calendar) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  const date = new Date(value);
  return Number.isFinite(+date) ? date.toISOString() : null;
}
function matchLevel(source, bno, domain) {
  const reported = [source.businessNumber, source.matchedBusinessNumber].filter(value => value != null && value !== '');
  if (source.identityMismatch === true || reported.some(value => normalizeBusinessNumber(value) !== bno)) return 'candidate';
  if (source.match === 'exact_bno') {
    const matched = normalizeBusinessNumber(source.businessNumber ?? source.matchedBusinessNumber);
    if (source.businessNumber != null && source.matchedBusinessNumber != null
      && normalizeBusinessNumber(source.businessNumber) !== normalizeBusinessNumber(source.matchedBusinessNumber)) return 'candidate';
    return matched === bno ? 'exact_bno' : 'candidate';
  }
  if (source.match === 'confirmed_domain' && domain && hostOf(source.url) === domain) return 'confirmed_domain';
  return 'candidate';
}
function normalizedFieldValue(field, raw) {
  const value = safeText(raw, FIELD_LIMITS[field]);
  if (!value) return '';
  if (field === 'website') return safeEnrichmentUrl(value) || '';
  if (field === 'email') return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) ? value : '';
  if (field === 'phone') return /[0-9]/.test(value) && !/[A-Za-z<>]/.test(value) ? value : '';
  return value;
}

/** Normalize a collector record. Incomplete identity evidence remains a candidate. */
export function normalizeEnrichment(input) {
  if (!object(input)) return null;
  const businessNumber = normalizeBusinessNumber(input.businessNumber ?? input.bno);
  if (!isValidBusinessNumber(businessNumber)) return null;
  if (input.businessNumber != null && input.bno != null
    && normalizeBusinessNumber(input.businessNumber) !== normalizeBusinessNumber(input.bno)) return null;
  const domain = officialHost(input);
  const entityType = ['corporation', 'business'].includes(input.entityType) ? input.entityType : 'unknown';
  const sources = [], ids = new Set();
  for (const raw of Array.isArray(input.sources) ? input.sources.slice(0, 1200) : []) {
    if (!object(raw)) continue;
    const id = safeText(raw.id, 120), url = safeEnrichmentUrl(raw.url);
    if (!id || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,119}$/.test(id) || ids.has(id) || !url) continue;
    ids.add(id);
    const source = { id, url, title: safeText(raw.title, 500) || new URL(url).hostname,
      channel: CHANNELS.has(raw.channel) ? raw.channel : 'website',
      collectedAt: timestamp(raw.collectedAt) || timestamp(input.collectedAt),
      publishedAt: timestamp(raw.publishedAt), match: matchLevel({ ...raw, url }, businessNumber, domain),
      scope: raw.scope === 'public_business' ? 'public_business' : null };
    // Keep enough identity evidence to make repeated normalization lossless.
    if (source.match === 'exact_bno') source.businessNumber = businessNumber;
    else if (raw.identityMismatch === true || [raw.businessNumber, raw.matchedBusinessNumber]
      .filter(value => value != null && value !== '').some(value => normalizeBusinessNumber(value) !== businessNumber)) {
      source.identityMismatch = true;
      for (const key of ['businessNumber', 'matchedBusinessNumber']) {
        const reported = normalizeBusinessNumber(raw[key]);
        if (/^\d{10}$/.test(reported)) source[key] = reported;
      }
    }
    const discoveredFrom = safeEnrichmentUrl(raw.discoveredFrom);
    if (discoveredFrom) source.discoveredFrom = discoveredFrom;
    sources.push(source);
  }
  const byId = new Map(sources.map(value => [value.id, value]));
  const fields = [], duplicates = new Set();
  for (const raw of Array.isArray(input.fields) ? input.fields.slice(0, 12000) : []) {
    if (!object(raw) || typeof raw.field !== 'string' || !own(ENRICHMENT_FIELDS, raw.field)) continue;
    const source = byId.get(raw.sourceId);
    if (!source) continue;
    const scope = raw.scope === 'public_business' || source.scope === 'public_business' ? 'public_business' : null;
    if (['email', 'phone'].includes(raw.field) && !scope) continue;
    if (raw.field === 'representative' && (entityType !== 'corporation' || !scope)) continue;
    const value = normalizedFieldValue(raw.field, raw.value);
    if (!value) continue;
    // A field cannot upgrade its origin's identity. Explicit candidates stay candidates.
    const match = raw.match === 'candidate' ? 'candidate' : source.match;
    const identity = JSON.stringify([raw.field, value, source.id, match]);
    if (duplicates.has(identity)) continue;
    duplicates.add(identity);
    fields.push({ field: raw.field, value, sourceId: source.id, match, ...(scope ? { scope } : {}) });
  }
  const collection = object(input.collection) ? {
    status: ['success', 'partial', 'failed', 'not_collected', 'not_configured'].includes(input.collection.status) ? input.collection.status : 'not_collected',
    lastAttemptAt: timestamp(input.collection.lastAttemptAt), lastSuccessAt: timestamp(input.collection.lastSuccessAt),
    sourceStatuses: (Array.isArray(input.collection.sourceStatuses) ? input.collection.sourceStatuses.slice(0, 30) : []).filter(object).map(value => ({
      provider: safeText(value.provider, 50), insuranceType: safeText(value.insuranceType, 10), label: safeText(value.label, 100),
      sourceUrl: safeEnrichmentUrl(value.sourceUrl), checkedAt: timestamp(value.checkedAt),
      status: ['success','partial','not_found','not_configured','identity_mismatch','error'].includes(value.status) ? value.status : 'error',
      pages: Number.isSafeInteger(value.pages) && value.pages >= 0 ? value.pages : 0,
      returnedCount: Number.isSafeInteger(value.returnedCount) && value.returnedCount >= 0 ? value.returnedCount : 0,
      matchedCount: Number.isSafeInteger(value.matchedCount) && value.matchedCount >= 0 ? value.matchedCount : 0,
      totalCount: Number.isSafeInteger(value.totalCount) && value.totalCount >= 0 ? value.totalCount : null,
      truncated: value.truncated === true,
      ...(safeText(value.errorCode, 80) ? {errorCode:safeText(value.errorCode, 80)} : {}),
      ...(safeText(value.message, 300) ? {message:safeText(value.message, 300)} : {}),
    })),
    ...(safeText(input.collection.error, 300) ? { error: safeText(input.collection.error, 300) } : {}),
  } : null;
  return { businessNumber, bno: businessNumber, entityType, officialDomain: domain || null,
    collectedAt: timestamp(input.collectedAt), sources, fields, ...(collection ? { collection } : {}) };
}

const valueKey = (field, value) => field === 'phone' ? value.replace(/[^\d+]/g, '')
  : value.normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g, ' ').trim();

/** Select attributable facts while preserving conflicting observations and unresolved candidates. */
export function summarizeEnrichment(input) {
  const record = normalizeEnrichment(input);
  if (!record) return null;
  const byId = new Map(record.sources.map(source => [source.id, source]));
  const compare = (left, right) => {
    const a = byId.get(left.sourceId), b = byId.get(right.sourceId);
    return MATCH_RANK[left.match] - MATCH_RANK[right.match]
      || SOURCE_PRIORITY[a.channel] - SOURCE_PRIORITY[b.channel]
      || (b.collectedAt || '').localeCompare(a.collectedAt || '') || a.id.localeCompare(b.id);
  };
  const profile = {}, fields = [];
  for (const field of Object.keys(ENRICHMENT_FIELDS)) {
    const confirmed = record.fields.filter(value => value.field === field && value.match !== 'candidate').sort(compare);
    if (!confirmed.length) continue;
    const selected = confirmed[0];
    profile[field] = selected.value;
    fields.push({ ...selected, label: ENRICHMENT_FIELDS[field],
      conflict: new Set(confirmed.map(value => valueKey(field, value.value))).size > 1,
      alternatives: confirmed.slice(1) });
  }
  return { businessNumber: record.businessNumber, entityType: record.entityType, officialDomain: record.officialDomain,
    profile, fields, sources: record.sources,
    candidates: record.sources.filter(source => source.match === 'candidate'),
    candidateFields: record.fields.filter(field => field.match === 'candidate'),
    confirmedCount: record.sources.filter(source => source.match !== 'candidate').length,
    candidateCount: record.sources.filter(source => source.match === 'candidate').length,
    fieldCount: fields.length, collectedAt: record.collectedAt, collection: record.collection || null };
}

async function readBoundedJson(response) {
  if (Number(response.headers?.get('content-length')) > MAX_BYTES) throw new Error('사업자 보강 정보가 허용 크기를 초과했습니다.');
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('사업자 보강 정보가 허용 크기를 초과했습니다.');
    return JSON.parse(text);
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '', bytes = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) { void reader.cancel().catch(() => {}); throw new Error('사업자 보강 정보가 허용 크기를 초과했습니다.'); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally { reader.releaseLock(); }
}

/** Read one bounded, validated public snapshot for name search and every number-based view. */
export async function loadEnrichmentCatalog({ fetcher = globalThis.fetch,
  url = new URL('../data/enrichment/index.json', import.meta.url), signal } = {}) {
  const response = await fetcher(url, { cache: 'no-cache', credentials: 'omit', ...(signal ? { signal } : {}) });
  if (response.status === 404) return { records: [], meta: {
    status: 'not_collected', loadedCount: 0, inputCount: 0, excludedCount: 0,
    generatedAt: null, collectedAt: null,
  } };
  if (!response.ok) throw new Error('사업자 보강 정보를 불러오지 못했습니다.');
  const data = await readBoundedJson(response);
  if (!object(data) || !Array.isArray(data.businesses)) throw new Error('사업자 보강 정보의 형식을 확인할 수 없습니다.');
  if (data.businesses.length > MAX_RECORDS) throw new Error('사업자 보강 정보가 허용 건수를 초과했습니다.');
  const records = [], seen = new Set();
  for (const input of data.businesses) {
    const record = normalizeEnrichment(input);
    if (!record) continue;
    if (seen.has(record.businessNumber)) throw new Error('같은 사업자의 보강 기록이 중복되어 확인이 필요합니다.');
    seen.add(record.businessNumber);
    records.push(record);
  }
  const inputMeta = object(data.meta) ? data.meta : {};
  const meta = { status: safeText(inputMeta.status, 50) || 'available',
    generatedAt: timestamp(inputMeta.generatedAt), collectedAt: timestamp(inputMeta.collectedAt),
    loadedCount: records.length, inputCount: data.businesses.length,
    excludedCount: data.businesses.length - records.length };
  return { records, meta };
}

/** Compatibility interface for workspace joins; validation stays in the catalog loader. */
export async function loadEnrichmentIndex(options = {}) {
  const { records, meta } = await loadEnrichmentCatalog(options);
  return { records, meta: { ...meta, rejectedCount: meta.excludedCount } };
}

/** Public snapshot lookup; a missing record is an honest coverage gap, not an empty company. */
export async function loadEnrichment(bno, options = {}) {
  const businessNumber = normalizeBusinessNumber(bno);
  if (!isValidBusinessNumber(businessNumber)) throw new Error('올바른 사업자등록번호가 필요합니다.');
  const { records, meta } = await loadEnrichmentIndex(options);
  const record = records.find(value => value.businessNumber === businessNumber) || null;
  return { record, summary: record ? summarizeEnrichment(record) : null, meta };
}
