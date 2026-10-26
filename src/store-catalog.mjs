import { classifyBusinessQuery, normalizeBusinessName } from './business-search.mjs';

// This catalog contains source store IDs, never tax-registration identities.
export const STORE_CATALOG_LIMITS = Object.freeze({
  manifestBytes: 8 * 1024 * 1024,
  shardBytes: 4_000_000,
  shardCompressedBytes: 4_100_000,
  routingBytes: 64 * 1024 * 1024,
  routingCompressedBytes: 32 * 1024 * 1024,
  cacheBytes: 64 * 1024 * 1024,
  shards: 20_000,
  rows: 20_000_000,
  results: 200,
});

export class StoreCatalogError extends Error {
  constructor(code, message) { super(message); this.name = 'StoreCatalogError'; this.code = code; }
}

const fail = (code, message) => { throw new StoreCatalogError(code, message); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const safeText = (value, max = 200) => typeof value === 'string'
  ? value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, max) : '';
const corporateStart = /^(?:(?:주식회사|유한책임회사|유한회사|합자회사|합명회사|사단법인|재단법인)|\(\s*(?:주|유|사|재)\s*\))\s*/u;
const corporateEnd = /\s*(?:(?:주식회사|유한책임회사|유한회사|합자회사|합명회사|사단법인|재단법인)|\(\s*(?:주|유|사|재)\s*\))$/u;
const collator = new Intl.Collator('ko');

function timestamp(value, field) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) fail('invalid_manifest', `${field} 시각이 올바르지 않습니다.`);
  return new Date(value).toISOString();
}

function publicUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    return url.href;
  } catch { fail('invalid_manifest', '상가 자료의 공개 출처 주소가 올바르지 않습니다.'); }
}

function descriptor(input, kind) {
  if (!isObject(input)) fail('invalid_manifest', '상가 검색 파일 정보가 없습니다.');
  const validPath = kind === 'routing' ? input.path === 'routing.json.gz'
    : typeof input.path === 'string' && /^shards\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,150}\.json\.gz$/u.test(input.path);
  if (!validPath || input.path.includes('..')) fail('invalid_manifest', '허용되지 않은 상가 검색 파일 경로입니다.');
  const rawLimit = kind === 'routing' ? STORE_CATALOG_LIMITS.routingBytes : STORE_CATALOG_LIMITS.shardBytes;
  const compressedLimit = kind === 'routing' ? STORE_CATALOG_LIMITS.routingCompressedBytes : STORE_CATALOG_LIMITS.shardCompressedBytes;
  if (!isCount(input.compressedBytes) || input.compressedBytes < 1 || input.compressedBytes > compressedLimit
    || !isCount(input.uncompressedBytes) || input.uncompressedBytes < 1 || input.uncompressedBytes > rawLimit
    || typeof input.sha256 !== 'string' || !/^[a-fA-F0-9]{64}$/u.test(input.sha256)) {
    fail('invalid_manifest', '상가 검색 파일의 크기 또는 무결성 정보가 올바르지 않습니다.');
  }
  return { path: input.path, compressedBytes: input.compressedBytes,
    uncompressedBytes: input.uncompressedBytes, sha256: input.sha256.toLowerCase() };
}

/** Validate the complete snapshot before fetching any relative file it names. */
export function validateStoreManifest(input) {
  if (!isObject(input) || input.schemaVersion !== 1
    || typeof input.version !== 'string' || !/^[a-zA-Z0-9._:-]{1,160}$/u.test(input.version)
    || typeof input.sourceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(input.sourceDate)
    || !Number.isFinite(Date.parse(input.sourceDate)) || new Date(input.sourceDate).toISOString().slice(0, 10) !== input.sourceDate) {
    fail('invalid_manifest', '상가 검색 자료의 버전 또는 기준일이 올바르지 않습니다.');
  }
  for (const key of ['sourceCount', 'acceptedCount', 'rejectedCount', 'duplicateCount']) {
    if (!isCount(input[key]) || input[key] > STORE_CATALOG_LIMITS.rows) fail('invalid_manifest', '상가 검색 자료의 건수가 올바르지 않습니다.');
  }
  if (input.sourceCount !== input.acceptedCount + input.rejectedCount + input.duplicateCount) {
    fail('invalid_manifest', '상가 검색 자료의 원본·수록·제외 건수가 일치하지 않습니다.');
  }
  if (!isObject(input.source) || input.source.provider !== 'semas' || !safeText(input.source.name)
    || typeof input.source.license !== 'string') fail('invalid_manifest', '상가 자료의 출처 정보가 없습니다.');
  if (!Array.isArray(input.regions) || input.regions.length > 30
    || !Array.isArray(input.shards) || input.shards.length > STORE_CATALOG_LIMITS.shards) {
    fail('invalid_manifest', '상가 검색 자료의 지역 또는 파일 목록이 올바르지 않습니다.');
  }
  const regionCodes = new Set();
  const regions = input.regions.map(region => {
    if (!isObject(region) || typeof region.code !== 'string' || !/^\d{2}$/u.test(region.code)
      || regionCodes.has(region.code) || !safeText(region.name, 100) || !isCount(region.count)) {
      fail('invalid_manifest', '상가 검색 자료의 지역 정보가 올바르지 않습니다.');
    }
    regionCodes.add(region.code);
    return { code: region.code, name: safeText(region.name, 100), count: region.count };
  });
  const ids = new Set(), paths = new Set(), regionRows = new Map();
  const shards = input.shards.map(shard => {
    const file = descriptor(shard, 'shard');
    if (typeof shard.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,150}$/u.test(shard.id)
      || ids.has(shard.id) || paths.has(shard.path) || !regionCodes.has(shard.regionCode)
      || !isCount(shard.rowCount) || shard.rowCount < 1 || shard.rowCount > STORE_CATALOG_LIMITS.rows) {
      fail('invalid_manifest', '상가 검색 파일의 식별자 또는 행 정보가 올바르지 않습니다.');
    }
    ids.add(shard.id); paths.add(shard.path);
    regionRows.set(shard.regionCode, (regionRows.get(shard.regionCode) || 0) + shard.rowCount);
    return { id: shard.id, ...file, regionCode: shard.regionCode, rowCount: shard.rowCount };
  });
  if (shards.reduce((sum, item) => sum + item.rowCount, 0) !== input.acceptedCount
    || regions.reduce((sum, item) => sum + item.count, 0) !== input.acceptedCount
    || regions.some(region => (regionRows.get(region.code) || 0) !== region.count)) {
    fail('invalid_manifest', '상가 검색 자료의 지역·파일별 수록 건수가 일치하지 않습니다.');
  }
  const result = {
    schemaVersion: 1, version: input.version, sourceDate: input.sourceDate,
    collectedAt: timestamp(input.collectedAt, '수집'),
    sourceCount: input.sourceCount, acceptedCount: input.acceptedCount,
    rejectedCount: input.rejectedCount, duplicateCount: input.duplicateCount,
    source: { provider: 'semas', name: safeText(input.source.name), url: publicUrl(input.source.url),
      license: safeText(input.source.license, 500) },
    regions, shards, routing: descriptor(input.routing, 'routing'),
  };
  for (const key of ['lastAttemptAt', 'lastSuccessAt']) if (input[key]) result[key] = timestamp(input[key], key);
  if (isObject(input.schedule)) result.schedule = {
    cron: safeText(input.schedule.cron, 100), timezone: safeText(input.schedule.timezone, 100),
    label: safeText(input.schedule.label, 300),
  };
  if (typeof input.coverage === 'string') result.coverage = safeText(input.coverage, 1000);
  if (typeof input.status === 'string') result.status = safeText(input.status, 100);
  return result;
}

// Query normalization mirrors business-search.mjs. Differential tests protect this
// contract; name normalization and validity classification are shared directly.
export function compileStoreQuery(value) {
  const classification = classifyBusinessQuery(value, { type: 'name' });
  if (classification.kind !== 'name' || typeof value !== 'string' || value.length > 200) {
    return { valid: false, query: '', parts: [], tokens: [], error: classification.error || '검색어는 200자 이내로 입력해 주세요.' };
  }
  let normalized = safeText(value).normalize('NFKC').replace(/^[%*\s]+|[%*\s]+$/gu, '').toLocaleLowerCase('ko');
  for (let i = 0; i < 4; i++) {
    const next = normalized.replace(corporateStart, '').replace(corporateEnd, '').trim();
    if (next === normalized) break;
    normalized = next;
  }
  normalized = normalized.replace(/\s+/gu, ' ').trim().replace(/^[%*\s]+|[%*\s]+$/gu, '');
  const pieces = text => text.split(/[%*]+/u).filter(Boolean);
  return { valid: true, query: classification.query,
    parts: pieces(normalized.replace(/\s+/gu, '')),
    tokens: normalized.split(' ').filter(Boolean).map(pieces).filter(parts => parts.length) };
}

/** Shared with the publisher: all Unicode code-point unigrams and bigrams. */
export function storeNameGrams(value) {
  const chars = Array.from(normalizeBusinessName(value)), grams = new Set();
  for (let i = 0; i < chars.length; i++) {
    grams.add(chars[i]);
    if (i + 1 < chars.length) grams.add(chars[i] + chars[i + 1]);
  }
  return [...grams];
}

export function validateStoreRouting(input, shardCount) {
  if (!isObject(input) || input.schemaVersion !== 1 || !isObject(input.grams)) {
    fail('invalid_routing', '상가 검색 색인 형식이 올바르지 않습니다.');
  }
  const grams = Object.create(null);
  for (const key of Object.keys(input.grams)) {
    const length = Array.from(key).length, indices = input.grams[key];
    if (length < 1 || length > 2 || !Array.isArray(indices) || indices.length > shardCount) {
      fail('invalid_routing', '상가 검색 색인의 글자 또는 파일 목록이 올바르지 않습니다.');
    }
    let previous = -1;
    for (const index of indices) {
      if (!Number.isSafeInteger(index) || index <= previous || index >= shardCount) {
        fail('invalid_routing', '상가 검색 색인의 파일 순서가 올바르지 않습니다.');
      }
      previous = index;
    }
    grams[key] = Uint32Array.from(indices);
  }
  return { schemaVersion: 1, grams };
}

function intersectSorted(left, right) {
  const result = []; let a = 0, b = 0;
  while (a < left.length && b < right.length) {
    if (left[a] === right[b]) { result.push(left[a]); a++; b++; }
    else if (left[a] < right[b]) a++;
    else b++;
  }
  return result;
}

function shardsForParts(routing, parts) {
  const grams = new Set();
  for (const part of parts) {
    const chars = Array.from(part);
    if (chars.length === 1) grams.add(chars[0]);
    else for (let i = 0; i + 1 < chars.length; i++) grams.add(chars[i] + chars[i + 1]);
  }
  const lists = [...grams].map(gram => routing.grams[gram] || []);
  if (!lists.length) return [];
  lists.sort((a, b) => a.length - b.length);
  let result = lists[0];
  for (let i = 1; result.length && i < lists.length; i++) result = intersectSorted(result, lists[i]);
  return result;
}

/** The address-token route is a union, so address terms cannot hide name matches. */
export function selectStoreShardIndices(manifest, routing, compiled, { regionCode = '' } = {}) {
  if (!compiled.valid) return [];
  if (regionCode && !manifest.regions.some(region => region.code === regionCode)) {
    fail('invalid_region', '검색할 지역을 다시 선택해 주세요.');
  }
  const candidates = new Set(shardsForParts(routing, compiled.parts));
  if (compiled.tokens.length > 1) {
    for (const token of compiled.tokens) for (const index of shardsForParts(routing, token)) candidates.add(index);
  }
  return [...candidates].filter(index => !regionCode || manifest.shards[index].regionCode === regionCode).sort((a, b) => a - b);
}

function fieldText(value, limit, required = false) {
  if (typeof value !== 'string' || value.length > limit) fail('invalid_shard', '상가 자료의 문자열 필드가 올바르지 않습니다.');
  const text = safeText(value, limit);
  if (required && !text) fail('invalid_shard', '상가 자료의 필수 식별자 또는 이름이 없습니다.');
  return text;
}

function coordinate(value, limit) {
  if (value === null || value === '') return null;
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(number) || Math.abs(number) > limit) fail('invalid_shard', '상가 자료의 좌표가 올바르지 않습니다.');
  return number;
}

/** Positional tuples cannot carry or invent business-registration numbers. */
export function validateStoreRows(input, shard) {
  if (!Array.isArray(input) || input.length !== shard.rowCount) fail('row_count_mismatch', '상가 검색 파일의 행 수가 게시 정보와 다릅니다.');
  const seen = new Set();
  return input.map(row => {
    if (!Array.isArray(row) || row.length !== 11 || row[5] !== shard.regionCode) {
      fail('invalid_shard', '상가 자료의 필드 또는 지역 정보가 올바르지 않습니다.');
    }
    const values = [fieldText(row[0], 128, true), fieldText(row[1], 200, true), fieldText(row[2], 200),
      fieldText(row[3], 500), fieldText(row[4], 500), row[5], fieldText(row[6], 100),
      fieldText(row[7], 40), fieldText(row[8], 200), coordinate(row[9], 180), coordinate(row[10], 90)];
    if (seen.has(values[0])) fail('duplicate_store_id', '상가 검색 파일에 중복된 원본 식별자가 있습니다.');
    seen.add(values[0]);
    return values;
  });
}

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

export function matchStoreRow(row, compiled) {
  if (!compiled.valid) return null;
  const aliases = row[2] ? [row[1], `${row[1]} ${row[2]}`] : [row[1]];
  const location = `${row[3]} ${row[4]} ${row[6]}`.normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/gu, '');
  const literal = compiled.parts.join('');
  let best = null;
  for (const alias of aliases) {
    const name = normalizeBusinessName(alias);
    const start = patternStart(name, compiled.parts);
    let rank = start < 0 ? null : name === literal ? 0 : start === 0 ? 1 : 2;
    if (rank === null && compiled.tokens.length > 1
      && compiled.tokens.some(token => patternStart(name, token) >= 0)
      && compiled.tokens.every(token => patternStart(name, token) >= 0 || patternStart(location, token) >= 0)) rank = 3;
    if (rank !== null && (best === null || rank < best.rank)) best = { rank, matchedName: alias };
  }
  return best;
}

export function storeResultFromRow(row, manifest, match) {
  return {
    kind: 'store', id: `semas:${row[0]}`, sourceRecordId: row[0], businessNumber: null,
    name: row[1], branchName: row[2], displayName: row[2] ? `${row[1]} ${row[2]}` : row[1],
    roadAddress: row[3], landAddress: row[4], address: row[3] || row[4],
    regionCode: row[5], regionName: manifest.regions.find(region => region.code === row[5])?.name || '',
    districtName: row[6], industryCode: row[7], industryName: row[8],
    longitude: row[9], latitude: row[10], source: { ...manifest.source },
    sourceUrl: manifest.source.url, sourceDate: manifest.sourceDate, collectedAt: manifest.collectedAt,
    rank: match.rank, matchedName: match.matchedName,
  };
}

export function compareStoreMatches(a, b) {
  return a.rank - b.rank || collator.compare(a.name, b.name) || collator.compare(a.id, b.id);
}

/** A maximum heap retains only the best 200 rows while counting every match. */
export class StoreSearchAccumulator {
  constructor(limit = STORE_CATALOG_LIMITS.results) {
    this.limit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, STORE_CATALOG_LIMITS.results) : STORE_CATALOG_LIMITS.results;
    this.total = 0; this.heap = [];
  }
  add(row, match, manifest) {
    this.total++;
    const candidate = { rank: match.rank, name: row[1], id: `semas:${row[0]}` };
    if (this.heap.length >= this.limit && compareStoreMatches(candidate, this.heap[0]) >= 0) return;
    const result = storeResultFromRow(row, manifest, match);
    if (this.heap.length < this.limit) {
      this.heap.push(result);
      let child = this.heap.length - 1;
      while (child > 0) {
        const parent = Math.floor((child - 1) / 2);
        if (compareStoreMatches(this.heap[parent], this.heap[child]) >= 0) break;
        [this.heap[parent], this.heap[child]] = [this.heap[child], this.heap[parent]]; child = parent;
      }
    } else {
      this.heap[0] = result;
      let parent = 0;
      while (true) {
        const left = parent * 2 + 1, right = left + 1;
        let worst = parent;
        if (left < this.heap.length && compareStoreMatches(this.heap[left], this.heap[worst]) > 0) worst = left;
        if (right < this.heap.length && compareStoreMatches(this.heap[right], this.heap[worst]) > 0) worst = right;
        if (worst === parent) break;
        [this.heap[parent], this.heap[worst]] = [this.heap[worst], this.heap[parent]]; parent = worst;
      }
    }
  }
  results() { return [...this.heap].sort(compareStoreMatches); }
}
