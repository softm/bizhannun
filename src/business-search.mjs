import { isValidBusinessNumber, normalizeBusinessNumber } from './domain.mjs';
import { summarizeEnrichment } from './enrichment.mjs';

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
  if (!/[\p{L}\p{N}]/u.test(normalizeBusinessName(query))) {
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

/**
 * Build a fresh, account-scoped index. Private partners/profile stay in memory;
 * there are no network calls, persisted caches, or promotion of candidate facts.
 */
export function buildBusinessSearchIndex({ records = [], partners = [], profile = {} } = {}) {
  const byNumber = new Map();
  const getEntry = value => {
    const businessNumber = canonicalNumber(value);
    if (!isValidBusinessNumber(businessNumber)) return null;
    if (!byNumber.has(businessNumber)) byNumber.set(businessNumber, {
      businessNumber, name: '', aliases: [], address: '', industry: '', sourceLabels: [],
      sourceUrl: '', sourceTitle: '', collectedAt: null,
      fromPublic: false, fromSaved: false, fromProfile: false,
    });
    return byNumber.get(businessNumber);
  };
  for (const record of Array.isArray(records) ? records : []) {
    const summary = summarizeEnrichment(record);
    if (!summary) continue;
    const nameField = summary.fields.find(field => field.field === 'name');
    // A configured seed name, search snippet, or candidate is not an identified business name.
    if (!nameField || !normalizeBusinessName(nameField.value)) continue;
    const entry = getEntry(summary.businessNumber);
    if (!entry) continue;
    const source = summary.sources.find(value => value.id === nameField.sourceId);
    const collectedAt = source?.collectedAt || summary.collectedAt || null;
    const newer = !entry.fromPublic || (collectedAt || '') > (entry.collectedAt || '');
    addAlias(entry, nameField.value);
    for (const alternative of nameField.alternatives || []) addAlias(entry, alternative.value);
    if (newer) {
      entry.name = displayText(nameField.value);
      entry.address = displayText(summary.profile.address, 500);
      entry.industry = displayText(summary.profile.industry || summary.profile.businessCategory || summary.profile.businessType, 500);
      entry.sourceUrl = source?.url || '';
      entry.sourceTitle = source?.title || '';
      entry.collectedAt = collectedAt;
    }
    entry.fromPublic = true;
    addLabel(entry, '공개 수집 자료');
  }
  for (const partner of Array.isArray(partners) ? partners : []) {
    if (!isObject(partner) || !normalizeBusinessName(partner.name)) continue;
    const entry = getEntry(partner.businessNumber);
    if (!entry) continue;
    addAlias(entry, partner.name);
    entry.fromSaved = true;
    addLabel(entry, '내 거래처');
    if (!entry.address) entry.address = displayText(partner.address, 500);
    if (!entry.industry) entry.industry = displayText(partner.industry, 500);
  }
  if (isObject(profile) && normalizeBusinessName(profile.name)) {
    const entry = getEntry(profile.businessNumber);
    if (entry) {
      addAlias(entry, profile.name);
      entry.fromProfile = true;
      addLabel(entry, '내 사업 프로필');
      if (!entry.address) entry.address = displayText(profile.address || profile.region, 500);
      if (!entry.industry) entry.industry = displayText(profile.industry, 500);
    }
  }
  const entries = [...byNumber.values()].filter(entry => entry.aliases.length)
    .sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.businessNumber.localeCompare(b.businessNumber));
  return {
    entries,
    publicCount: entries.filter(entry => entry.fromPublic).length,
    savedCount: entries.filter(entry => entry.fromSaved || entry.fromProfile).length,
    totalCount: entries.length,
  };
}

function matchEntry(entry, query, tokens) {
  const location = displayText(entry.address, 500).normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/gu, '');
  let best = null;
  for (const alias of entry.aliases || []) {
    const name = normalizeBusinessName(alias);
    if (!name) continue;
    let rank = name === query ? 0 : name.startsWith(query) ? 1 : name.includes(query) ? 2 : null;
    if (rank === null && tokens.length > 1
      && tokens.some(token => name.includes(token))
      && tokens.every(token => name.includes(token) || location.includes(token))) rank = 3;
    if (rank !== null && (best === null || rank < best.rank)) best = { rank, matchedName: alias };
  }
  return best;
}

/** Name search is separate from number classification so numeric business names work in name mode. */
export function searchBusinesses(index, value, { limit = 20, offset = 0 } = {}) {
  const pageLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
  const pageOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const normalized = nameText(value), query = normalized.replace(/\s+/gu, '');
  const empty = { results: [], total: 0, offset: pageOffset, limit: pageLimit };
  if (!query || !/[\p{L}\p{N}]/u.test(query) || typeof value !== 'string' || value.length > MAX_QUERY_LENGTH) return empty;
  const tokens = normalized.split(' ').filter(Boolean);
  const matches = [];
  for (const entry of Array.isArray(index?.entries) ? index.entries : []) {
    const match = matchEntry(entry, query, tokens);
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
