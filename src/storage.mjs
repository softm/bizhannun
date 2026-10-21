import { isValidBusinessNumber } from './domain.mjs';
import { validateApiBase } from './api-client.mjs';
import { normalizePartnerEnrichment, normalizePartnerNameOrigin } from './business-profile.mjs';

const DB_NAME = 'bizhannun-workspace';
const STORE = 'workspaces';
const KEY = 'personal';
const SCHEMA = 1;

export function emptyWorkspace() {
  return { schemaVersion: SCHEMA, revision: 0, partners: [], events: [], checks: [], profile: {}, preferences: {}, updatedAt: null };
}

let database;
function openDatabase() {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('이 브라우저에서 저장소를 사용할 수 없습니다.'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}

export async function loadWorkspace() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(KEY);
    request.onsuccess = () => {
      try {
        resolve(request.result ? normalizeWorkspace(request.result, { stored: true }) : emptyWorkspace());
      } catch (error) { reject(error); }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function saveWorkspace(workspace) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    let conflict = false;
    const current = store.get(KEY);
    const next = { ...workspace, revision: (workspace.revision || 0) + 1, updatedAt: new Date().toISOString() };
    current.onsuccess = () => {
      if ((current.result?.revision || 0) !== (workspace.revision || 0)) { conflict = true; tx.abort(); return; }
      store.put(next, KEY);
    };
    tx.oncomplete = () => resolve(next);
    tx.onerror = () => reject(tx.error || new Error('저장하지 못했습니다.'));
    tx.onabort = () => reject(new Error(conflict ? '다른 탭에서 정보가 변경되었습니다. 새로고침 후 다시 시도해 주세요.' : '브라우저 저장 공간을 확인해 주세요.'));
  });
}

export function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const OUTCOMES = new Set(['ok', 'not_found', 'error', 'not_configured']);
const STATUSES = new Set(['active', 'suspended', 'closed', 'unknown']);
const INTERESTS = new Set(['금융', '창업', '기술', '경영', '수출', '인력', '내수']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function invalid(field) { throw new Error(`저장 정보의 ${field} 형식을 확인해 주세요. 유효한 사업자한눈 백업이 필요합니다.`); }
function record(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(field);
  return value;
}
function text(value, field, max = 200, fallback = '') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') invalid(field);
  return value.slice(0, max);
}
function id(value, field, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid(field);
  return value;
}
function list(value, field, max) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) invalid(field);
  return value;
}
function businessNumber(value, field, optional = false) {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !/^\d{10}$/.test(value) || !isValidBusinessNumber(value)) invalid(field);
  return value;
}
function timestamp(value, field, required = false) {
  if (!required && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) invalid(field);
  date(value.slice(0, 10), field);
  return new Date(value).toISOString();
}
function date(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(field);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) invalid(field);
  return value;
}
function safeUrl(value, field, optional = false) {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || value.length > 2048) invalid(field);
  let parsed;
  try { parsed = new URL(value); } catch { invalid(field); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) invalid(field);
  return parsed.href;
}
function source(value) {
  if (typeof value === 'string') return id(value, '조회 출처');
  const item = record(value, '조회 출처');
  return { name: id(item.name, '조회 출처명'), url: safeUrl(item.url, '조회 출처 주소') };
}
function nullableText(value, field, max = 500) {
  return value === null || value === undefined ? null : text(value, field, max);
}
function optionalBoolean(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') invalid(field);
  return value;
}
function snapshot(value, number, field) {
  const item = record(value, field);
  if (businessNumber(item.businessNumber, `${field} 사업자번호`) !== number) invalid(`${field} 사업자번호 일치`);
  if (!OUTCOMES.has(item.outcome) || !STATUSES.has(item.businessStatus)
    || (item.outcome !== 'ok' && item.businessStatus !== 'unknown')) invalid(`${field} 조회 결과`);
  const result = {
    businessNumber: number, outcome: item.outcome, businessStatus: item.businessStatus,
    statusLabel: text(item.statusLabel, `${field} 상태명`),
    taxType: nullableText(item.taxType, `${field} 과세유형`),
    closedAt: date(item.closedAt, `${field} 폐업일`),
    checkedAt: timestamp(item.checkedAt, `${field} 조회시각`, true),
    source: source(item.source),
  };
  if (own(item, 'id')) result.id = id(item.id, `${field} 식별자`, 64000);
  if (own(item, 'sourceUrl')) result.sourceUrl = safeUrl(item.sourceUrl, `${field} 출처 주소`, true);
  for (const key of ['taxTypeCode', 'previousTaxType', 'previousTaxTypeCode']) {
    if (own(item, key)) result[key] = nullableText(item[key], `${field} ${key}`);
  }
  for (const key of ['taxTypeChangedAt', 'invoiceAppliedAt']) {
    if (own(item, key)) result[key] = date(item[key], `${field} ${key}`);
  }
  for (const key of ['unitTaxConversion', 'retryable']) {
    if (own(item, key)) result[key] = optionalBoolean(item[key], `${field} ${key}`);
  }
  for (const key of ['errorCode', 'message']) {
    if (own(item, key)) result[key] = text(item[key], `${field} ${key}`, key === 'message' ? 5000 : 100);
  }
  return result;
}
function partner(value) {
  const item = record(value, '거래처');
  const number = businessNumber(item.businessNumber, '거래처 사업자번호');
  if (typeof item.name !== 'string') invalid('거래처 이름');
  const tags = list(item.tags, '거래처 태그', 1000).map(tag => {
    if (typeof tag !== 'string') invalid('거래처 태그');
    return text(tag, '거래처 태그');
  }).slice(0, 10);
  const result = {
    id: id(item.id, '거래처 식별자'), businessNumber: number,
    name: text(item.name, '거래처 이름'), note: text(item.note, '거래처 메모', 5000), tags,
    createdAt: timestamp(item.createdAt, '거래처 등록일'), updatedAt: timestamp(item.updatedAt, '거래처 수정일'),
    history: list(item.history, '거래처 조회 이력', 50).map(entry => snapshot(entry, number, '거래처 조회 이력')),
  };
  if (item.lastCheck != null) result.lastCheck = snapshot(item.lastCheck, number, '최근 조회');
  if (item.lastSuccess != null) {
    result.lastSuccess = snapshot(item.lastSuccess, number, '최근 성공 조회');
    if (result.lastSuccess.outcome !== 'ok') invalid('최근 성공 조회');
  }
  if (item.enrichment != null) result.enrichment = normalizePartnerEnrichment(item.enrichment, number);
  if (item.nameOrigin != null) result.nameOrigin = normalizePartnerNameOrigin(item.nameOrigin, result.name, result.enrichment);
  return result;
}
function integer(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid(field);
  return value;
}
function profile(value) {
  if (value === undefined) return {};
  const item = record(value, '사업 프로필');
  const interests = list(item.interests, '관심 지원 분야', 7).map(interest => {
    if (!INTERESTS.has(interest)) invalid('관심 지원 분야');
    return interest;
  });
  const businessKind = text(item.businessKind, '사업자 유형');
  if (!['', '개인사업자', '법인사업자', '예비창업자'].includes(businessKind)) invalid('사업자 유형');
  const result = {
    name: text(item.name, '사업 프로필 이름'), businessNumber: businessNumber(item.businessNumber, '사업 프로필 사업자번호', true),
    region: text(item.region, '사업장 지역', 100), industry: text(item.industry, '업종', 100),
    foundedAt: date(item.foundedAt, '개업일') || '', businessKind,
    employees: integer(item.employees, '근로자 수', { max: 10000000, optional: true }),
    revenue: integer(item.revenue, '연 매출', { optional: true }), revenueUnit: '만원',
    revenueYear: integer(item.revenueYear, '매출 기준연도', { min: 1900, max: 2100, optional: true }),
    interests: [...new Set(interests)], providedBy: 'user', updatedAt: timestamp(item.updatedAt, '사업 프로필 수정일'),
  };
  if (item.enrichment != null) result.enrichment = normalizePartnerEnrichment(item.enrichment, result.businessNumber);
  return result;
}
function event(value, partners) {
  const item = record(value, '상태 변경 기록');
  const partnerId = id(item.partnerId, '상태 변경 거래처 식별자');
  const number = businessNumber(item.businessNumber, '상태 변경 사업자번호');
  if (partners.get(partnerId)?.businessNumber !== number) invalid('상태 변경 거래처 일치');
  if (item.type !== 'business_status_changed' || !STATUSES.has(item.from) || !STATUSES.has(item.to)
    || item.from === 'unknown' || item.to === 'unknown' || item.from === item.to) invalid('상태 변경 내용');
  const result = {
    id: id(item.id, '상태 변경 식별자', 64000), partnerId, businessNumber: number,
    type: item.type, from: item.from, to: item.to,
    source: source(item.source), occurredAt: timestamp(item.occurredAt, '상태 변경 시각', true),
    title: text(item.title, '상태 변경 제목', 1000), message: text(item.message, '상태 변경 설명', 5000),
    acknowledgedAt: timestamp(item.acknowledgedAt, '상태 변경 확인시각'),
  };
  if (own(item, 'sourceUrl')) result.sourceUrl = safeUrl(item.sourceUrl, '상태 변경 출처 주소', true);
  return result;
}
function check(value) {
  const item = record(value, '일괄 확인 기록');
  const result = {
    id: id(item.id, '일괄 확인 식별자'), total: integer(item.total, '일괄 확인 수', { max: 1000 }),
    ok: integer(item.ok, '응답 확인 수', { max: 1000 }), failed: integer(item.failed, '미확인 수', { max: 1000 }),
    checkedAt: timestamp(item.checkedAt, '일괄 확인 시각', true),
  };
  if (result.ok + result.failed !== result.total) invalid('일괄 확인 합계');
  return result;
}
function unique(values, field) {
  if (new Set(values).size !== values.length) invalid(`${field} 중복`);
}
function normalizeWorkspace(value, { stored = false } = {}) {
  const item = record(value, '워크스페이스');
  if (item.schemaVersion !== SCHEMA) throw new Error('지원하지 않는 백업 버전입니다. 현재 버전의 사업자한눈 백업을 선택해 주세요.');
  if (!Array.isArray(item.partners)) invalid('거래처 목록');
  const partners = list(item.partners, '거래처 목록', 1000).map(partner);
  unique(partners.map(entry => entry.id), '거래처 식별자');
  unique(partners.map(entry => entry.businessNumber), '사업자번호');
  const byId = new Map(partners.map(entry => [entry.id, entry]));
  const events = list(item.events, '상태 변경 목록', 1000).map(entry => event(entry, byId));
  const checks = list(item.checks, '일괄 확인 목록', 100).map(check);
  unique(events.map(entry => entry.id), '상태 변경 식별자');
  unique(checks.map(entry => entry.id), '일괄 확인 식별자');
  const revision = item.revision === undefined ? 0 : integer(item.revision, '저장 버전');
  const preferences = {};
  // Imported files cannot select a server. Only the existing local setting is kept on load.
  if (stored && item.preferences !== undefined) {
    const settings = record(item.preferences, '연결 설정');
    if (own(settings, 'apiBase')) {
      if (typeof settings.apiBase !== 'string') invalid('서버 주소');
      preferences.apiBase = validateApiBase(settings.apiBase);
    }
  }
  return {
    ...emptyWorkspace(), revision: stored ? revision : 0, partners, events, checks,
    profile: profile(item.profile), preferences, updatedAt: timestamp(item.updatedAt, '저장 시각'),
  };
}

/** Validate before replacing local data; copy only supported, well-typed fields. */
export function validateBackup(value) { return normalizeWorkspace(value); }

