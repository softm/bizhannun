import { isValidBusinessNumber, normalizeBusinessNumber } from './domain.mjs';
import { normalizeEnrichment } from './enrichment.mjs';
import { attachPartnerEnrichment, normalizePartnerEnrichment, resolveBusinessProfile } from './business-profile.mjs';

const MAX_QUERY_LENGTH = 200;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// These are display strings, not HTML. The view must escape them when rendering.
const displayText = (value, max = 200) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max) : '';
const canonicalNumber = value => normalizeBusinessNumber(typeof value === 'string' ? value.normalize('NFKC') : value);
const corporateStart = /^(?:(?:주식회사|유한책임회사|유한회사|합자회사|합명회사|사단법인|재단법인)|\(\s*(?:주|유|사|재)\s*\))\s*/u;
const corporateEnd = /\s*(?:(?:주식회사|유한책임회사|유한회사|합자회사|합명회사|사단법인|재단법인)|\(\s*(?:주|유|사|재)\s*\))$/u;

function nameText(value) {
  let text = displayText(value).normalize('NFKC').toLocaleLowerCase('ko');
  // Legal entity markers are removed only at the beginning/end, never inside names.
  for (let i = 0; i < 4; i++) {
    const next = text.replace(corporateStart, '').replace(corporateEnd, '').trim();
    if (next === text) break;
    text = next;
  }
  return text.replace(/\s+/gu, ' ').trim();
}

export function normalizeBusinessName(value) {
  return nameText(value).replace(/\s+/gu, '');
}

// A search already includes both ends; explicit surrounding wildcards mean the same thing.
// Keep name normalization separate so literal names containing % or * remain intact.
function queryText(value) {
  const trimmed = displayText(value).normalize('NFKC').replace(/^[%*\s]+|[%*\s]+$/gu, '');
  return nameText(trimmed).replace(/^[%*\s]+|[%*\s]+$/gu, '');
}

/** Auto-detect names/numbers; an explicit name mode supports purely numeric names. */
export function classifyBusinessQuery(value, { type = 'auto' } = {}) {
  const raw = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  const query = raw.replace(/\s+/gu, ' ');
  if (!query) return { kind: 'invalid', query, error: '사업자등록번호 또는 상호·업체명을 입력해 주세요.' };
  if (query.length > MAX_QUERY_LENGTH) return { kind: 'invalid', query, error: '검색어는 200자 이내로 입력해 주세요.' };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(query)) {
    return { kind: 'invalid', query, error: '검색어에 사용할 수 없는 문자가 있습니다.' };
  }
  if (type === 'number' || (type !== 'name' && /^[\d\s-]+$/u.test(query))) {
    const businessNumber = canonicalNumber(query);
    return isValidBusinessNumber(businessNumber)
      ? { kind: 'number', query, businessNumber }
      : { kind: 'invalid', query, error: '사업자등록번호 10자리와 검증번호를 확인해 주세요.' };
  }
  if (!/[\p{L}\p{N}]/u.test(queryText(query))) {
    return { kind: 'invalid', query, error: '검색할 상호·업체명을 입력해 주세요.' };
  }
  return { kind: 'name', query };
}

function addAlias(entry, value) {
  const name = displayText(value);
  if (!name || !/[\p{L}\p{N}]/u.test(normalizeBusinessName(name))) return;
  const key = name.normalize('NFKC').toLocaleLowerCase('ko');
  if (!entry.aliases.some(alias => alias.normalize('NFKC').toLocaleLowerCase('ko') === key)) entry.aliases.push(name);
  if (!entry.name) entry.name = name;
}
function addLabel(entry, label) {
  if (!entry.sourceLabels.includes(label)) entry.sourceLabels.push(label);
}

function mergeSearchEvidence(previous, incoming, businessNumber) {
  if (!incoming) return previous;
  if (!previous) return incoming;
  // Reuse the detail view's source-atomic merge, including identity-scope corrections.
  return attachPartnerEnrichment({ businessNumber, enrichment: previous }, incoming).enrichment;
}

function containsNameObservation(record, field, source) {
  return Boolean(record && field && source
    && record.sources.some(item => item.id === source.id && item.url === source.url
      && item.collectedAt === source.collectedAt && item.match !== 'candidate')
    && record.fields.some(item => item.field === 'name' && item.value === field.value
      && item.sourceId === source.id && item.match !== 'candidate'));
}

/**
 * Build a fresh, account-scoped index. Private partners/profile stay in memory;
 * there are no network calls, persisted caches, or promotion of candidate facts.
 */
export function buildBusinessSearchIndex({ records = [], partners = [], profile = {} } = {}) {
  const byNumber = new Map();
  const getGroup = value => {
    const businessNumber = canonicalNumber(value);
    if (!isValidBusinessNumber(businessNumber)) return null;
    if (!byNumber.has(businessNumber)) byNumber.set(businessNumber, {
      businessNumber, publicRecord: null, saved: [],
    });
    return byNumber.get(businessNumber);
  };
  for (const input of Array.isArray(records) ? records : []) {
    const record = normalizeEnrichment(input);
    if (!record) continue;
    const group = getGroup(record.businessNumber);
    group.publicRecord = mergeSearchEvidence(group.publicRecord, record, group.businessNumber);
  }
  for (const partner of Array.isArray(partners) ? partners : []) {
    if (!isObject(partner)) continue;
    getGroup(partner.businessNumber)?.saved.push({ partner, role: 'partner' });
  }
  if (isObject(profile)) getGroup(profile.businessNumber)?.saved.push({ partner: profile, role: 'profile' });

  const entries = [];
  for (const { businessNumber, publicRecord, saved } of byNumber.values()) {
    const savedRecords = [];
    let linkedRecord = null;
    for (const { partner } of saved) {
      if (partner.enrichment == null) continue;
      try {
        const record = normalizePartnerEnrichment(partner.enrichment, businessNumber);
        savedRecords.push(record);
        linkedRecord = mergeSearchEvidence(linkedRecord, record, businessNumber);
      } catch { /* A malformed or different-number snapshot cannot supply search facts. */ }
    }
    linkedRecord = mergeSearchEvidence(linkedRecord, publicRecord, businessNumber);
    const linked = resolveBusinessProfile({ businessNumber, record: linkedRecord });
    const catalog = publicRecord ? resolveBusinessProfile({ businessNumber, record: publicRecord }) : null;
    const summary = linked.summary;
    const nameField = summary?.fields.find(field => field.field === 'name');
    const source = nameField && summary.sources.find(item => item.id === nameField.sourceId);
    const entry = {
      businessNumber, name: '', aliases: [],
      address: displayText(summary?.profile.address, 500),
      industry: displayText(summary?.profile.industry || summary?.profile.businessCategory || summary?.profile.businessType, 500),
      sourceLabels: [], sourceUrl: source?.url || '', sourceTitle: source?.title || '',
      collectedAt: source?.collectedAt || summary?.collectedAt || null,
      fromPublic: Boolean(catalog?.publicName && normalizeBusinessName(catalog.publicName)),
      fromSaved: false, fromProfile: false,
      fromSavedEvidence: !containsNameObservation(publicRecord, nameField, source)
        && savedRecords.some(record => containsNameObservation(record, nameField, source)),
    };
    // Only the final canonical observations enter the index, never seeds or revoked aliases.
    if (nameField) {
      addAlias(entry, nameField.value);
      for (const alternative of nameField.alternatives || []) addAlias(entry, alternative.value);
    }
    if (entry.fromPublic) addLabel(entry, '공개 수집 자료');
    for (const { partner, role } of saved) {
      const projected = resolveBusinessProfile({ businessNumber,
        partner: { ...partner, businessNumber }, record: linkedRecord });
      // Invalid imported evidence must not turn an untouched automatic label into a user alias.
      const automaticName = partner.nameOrigin?.kind === 'public' && partner.name === partner.nameOrigin.value;
      if (!automaticName) addAlias(entry, projected.userName);
      if (role === 'partner') { entry.fromSaved = true; addLabel(entry, '내 거래처'); }
      else { entry.fromProfile = true; addLabel(entry, '내 사업 프로필'); }
      if (!entry.address) entry.address = displayText(partner.address || (role === 'profile' ? partner.region : ''), 500);
      if (!entry.industry) entry.industry = displayText(partner.industry, 500);
    }
    if (entry.fromSavedEvidence) addLabel(entry, '저장한 공개자료');
    if (entry.aliases.length) entries.push(entry);
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.businessNumber.localeCompare(b.businessNumber));
  return {
    entries,
    publicCount: entries.filter(entry => entry.fromPublic).length,
    savedCount: entries.filter(entry => entry.fromSaved || entry.fromProfile).length,
    totalCount: entries.length,
  };
}

function patternParts(value) {
  return value.split(/[%*]+/u).filter(Boolean);
}

/** Match ordered literal pieces with monotonically advancing cursors; never compile user regex. */
function patternStart(text, parts) {
  if (!parts.length) return -1;
  let cursor = 0, start = -1;
  for (const part of parts) {
    const found = text.indexOf(part, cursor);
    if (found < 0) return -1;
    if (start < 0) start = found;
    cursor = found + part.length;
  }
  return start;
}

function matchEntry(entry, parts, tokens) {
  const location = displayText(entry.address, 500).normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/gu, '');
  const literal = parts.join('');
  let best = null;
  for (const alias of entry.aliases || []) {
    const name = normalizeBusinessName(alias);
    if (!name) continue;
    const start = patternStart(name, parts);
    let rank = start < 0 ? null : name === literal ? 0 : start === 0 ? 1 : 2;
    if (rank === null && tokens.length > 1
      && tokens.some(token => patternStart(name, token) >= 0)
      && tokens.every(token => patternStart(name, token) >= 0 || patternStart(location, token) >= 0)) rank = 3;
    if (rank !== null && (best === null || rank < best.rank)) best = { rank, matchedName: alias };
  }
  return best;
}

/** Name search is separate from number classification so numeric business names work in name mode. */
export function searchBusinesses(index, value, { limit = 20, offset = 0 } = {}) {
  const pageLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
  const pageOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const normalized = queryText(value), query = normalized.replace(/\s+/gu, '');
  const empty = { results: [], total: 0, offset: pageOffset, limit: pageLimit };
  if (!query || !/[\p{L}\p{N}]/u.test(query) || typeof value !== 'string' || value.length > MAX_QUERY_LENGTH) return empty;
  const parts = patternParts(query);
  const tokens = normalized.split(' ').filter(Boolean).map(patternParts).filter(parts => parts.length);
  const matches = [];
  for (const entry of Array.isArray(index?.entries) ? index.entries : []) {
    const match = matchEntry(entry, parts, tokens);
    if (match) matches.push({ entry, ...match });
  }
  matches.sort((a, b) => a.rank - b.rank || a.entry.name.localeCompare(b.entry.name, 'ko')
    || a.entry.businessNumber.localeCompare(b.entry.businessNumber));
  return {
    results: matches.slice(pageOffset, pageOffset + pageLimit).map(({ entry, matchedName }) => ({
      ...entry, aliases: [...entry.aliases], sourceLabels: [...entry.sourceLabels], matchedName,
    })),
    total: matches.length, offset: pageOffset, limit: pageLimit,
  };
}
