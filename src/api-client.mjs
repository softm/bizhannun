import { callDirectApi } from './direct-api.mjs';
export class ApiError extends Error {
  constructor(message, code = 'network_error') { super(message); this.code = code; }
}

export function validateApiBase(value) {
  if (!value || !value.trim()) return '';
  const url = new URL(value.trim());
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) throw new Error('HTTPS 서버 주소를 입력해 주세요.');
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('경로나 비밀키를 제외한 서버 주소만 입력해 주세요.');
  return url.origin;
}

export async function callApi(path, payload, apiBase = '', { signal } = {}) {
  if (globalThis.window?.BIZHANNUN_CONFIG?.mode === 'direct') return callDirectApi(path, payload, window.BIZHANNUN_CONFIG, { signal });
  const base = validateApiBase(apiBase);
  const timeout = AbortSignal.timeout(22000);
  try {
    const response = await fetch(base + '/api/' + path, {
      method: payload === undefined ? 'GET' : 'POST',
      ...(payload === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
      credentials: 'omit', cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
    if (!(response.headers.get('content-type') || '').includes('application/json')) {
      throw new ApiError('사업자 조회 서버에 아직 연결되지 않았습니다.', 'not_deployed');
    }
    const data = await response.json();
    if (!response.ok) throw new ApiError(data.message || data.error?.message || '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.', data.code || data.error?.code || 'api_error');
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error.name === 'AbortError' || error.name === 'TimeoutError') throw new ApiError('조회 시간이 초과되었습니다. 기존 확인 기록은 보관됩니다.', 'timeout');
    throw new ApiError('조회 서버에 연결할 수 없습니다. 연결 상태를 확인하고 다시 시도해 주세요.');
  }
}

export function failureResult(businessNumber, error) {
  return { businessNumber, outcome: error.code === 'not_deployed' ? 'not_configured' : 'error', businessStatus: 'unknown', statusLabel: '확인하지 못함', taxType: '', closedAt: '', checkedAt: new Date().toISOString(), source: { name: '국세청', url: 'https://www.data.go.kr/data/15081808/openapi.do' }, message: error.message };
}
