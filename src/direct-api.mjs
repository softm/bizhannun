import { getProviderHealth, queryNtsStatuses, validateNtsBusinesses, queryCommerce } from './providers.mjs';
import { normalizeNumber, normalizeBusinesses } from './provider-input.mjs';

/** Fixed official endpoints only: ignore all previously saved proxy origins. */
export async function callDirectApi(path, payload, config = {}, { signal, fetchImpl = globalThis.fetch } = {}) {
  signal?.throwIfAborted();
  const env = { NTS_SERVICE_KEY: config.ntsServiceKey || '' };
  const fetchProvider = (url, init) => fetchImpl(url, {
    ...init, credentials: 'omit', cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, init.signal].filter(Boolean)) : init.signal,
  });
  if (path === 'health') return {
    service: 'bizhannun-browser', deployed: true, mode: 'direct',
    providers: getProviderHealth(env), checkedAt: new Date().toISOString(),
  };
  if (path === 'status') {
    if (!Array.isArray(payload?.businessNumbers) || !payload.businessNumbers.length || payload.businessNumbers.length > 100) throw new Error('사업자등록번호는 1~100개를 입력하세요.');
    const numbers = payload.businessNumbers.map(normalizeNumber);
    return { results: await queryNtsStatuses(numbers, env, fetchProvider), checkedAt: new Date().toISOString() };
  }
  if (path === 'validate') return { results: await validateNtsBusinesses(normalizeBusinesses(payload || {}), env, fetchProvider), checkedAt: new Date().toISOString() };
  // FTC remains honestly unconfigured until a separately authorized key exists.
  if (path === 'commerce') return queryCommerce(normalizeNumber(payload?.businessNumber), env, fetchProvider);
  throw new Error('지원하지 않는 조회 경로입니다.');
}
