const text = value => typeof value === 'string' ? value : '';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const page = value => Number.isFinite(value)
  ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.floor(value))) : 1;

const entryFields = [
  'kind', 'id', 'sourceRecordId', 'name', 'branchName', 'displayName',
  'roadAddress', 'landAddress', 'address', 'regionCode', 'regionName', 'districtName',
  'industry', 'industryCode', 'industryName', 'longitude', 'latitude',
  'source', 'sourceUrl', 'sourceDate', 'collectedAt', 'rank', 'matchedName',
];
const resultFields = [
  'query', 'regionCode', 'catalogVersion', 'total', 'foundCount', 'shownCount',
  'capped', 'limit', 'complete', 'finished', 'status', 'progress', 'failures',
];

function copyFields(value, fields) {
  const copy = {};
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) continue;
    try { copy[field] = structuredClone(value[field]); }
    catch { /* A callback or other live transport value is not search context. */ }
  }
  return copy;
}

function copyEntry(value) {
  if (!object(value) || !text(value.id).trim()) return null;
  // Catalog rows are numberless evidence, including rows with a numeric source ID.
  return { ...copyFields(value, entryFields), businessNumber: null };
}

function copyResult(value) {
  if (!object(value)) return null;
  return {
    ...copyFields(value, resultFields),
    results: Array.isArray(value.results) ? value.results.map(copyEntry).filter(Boolean) : [],
  };
}

function copyStoreSearch(value, query) {
  const search = object(value) ? value : {};
  return {
    query: text(search.query).trim() ? search.query : query,
    result: copyResult(search.result),
    loading: false,
    error: text(search.error),
    regionCode: text(search.regionCode),
    selected: copyEntry(search.selected),
    page: page(search.page),
  };
}

/** Keep a name-search origin independently from a subsequent number lookup. */
export function createLookupOrigin({ query = '', namePage = 1, storeSearch = null } = {}) {
  const originQuery = text(query).trim() ? query : text(storeSearch?.query);
  if (!originQuery.trim()) return null;
  const search = copyStoreSearch(storeSearch, originQuery);
  return {
    query: originQuery,
    namePage: page(namePage),
    storeSearch: search,
    selectedStore: copyEntry(search.selected),
  };
}

/** Restore a fresh copy; rendering or another search must not mutate the origin. */
export function restoreLookupOrigin(origin) {
  if (!object(origin) || !text(origin.query).trim()) return null;
  return {
    lookupQuery: origin.query,
    nameQuery: origin.query,
    nameSearchPage: page(origin.namePage),
    lookupType: 'name',
    storeSearch: copyStoreSearch(origin.storeSearch, origin.query),
  };
}
