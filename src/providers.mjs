/**
 * Shared public-data provider adapters for browser-direct and optional local server use.
 * Contracts checked 2026-10-20 against the providers' published Swagger:
 * NTS: https://infuser.odcloud.kr/api/stages/28493/api-docs
 * FTC: https://www.data.go.kr/data/15126315/openapi.do (embedded Swagger)
 * No live authenticated response has been tested without a supplied key.
 */

export const PROVIDER_SOURCES = Object.freeze({
  nts: Object.freeze({
    name: '국세청 사업자등록정보',
    url: 'https://www.data.go.kr/data/15081808/openapi.do',
  }),
  ftc: Object.freeze({
    name: '공정거래위원회 통신판매사업자',
    url: 'https://www.data.go.kr/data/15126315/openapi.do',
  }),
});

const NTS_BASE = 'https://api.odcloud.kr/api/nts-businessman/v1/';
const FTC_DETAIL = 'https://apis.data.go.kr/1130000/MllBsDtl_3Service/getMllBsInfoDetail_3';
const MAX_RESPONSE_BYTES = 2_000_000;
const FTC_PAGE_SIZE = 100;
const MAX_FTC_PAGES = 3;
const own = (value, name) => Object.hasOwn(value, name);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => typeof value === 'string' ? value.trim() : '';
const nullableText = (value) => text(value) || null;
const normalizedNumber = (value) => text(value).replace(/[\s-]/g, '');
const now = () => new Date().toISOString();

function getKey(env, provider) {
  const raw = provider === 'nts'
    ? text(env.NTS_SERVICE_KEY) || text(env.DATA_GO_KR_SERVICE_KEY)
    : text(env.FTC_SERVICE_KEY);
  if (!raw) return '';
  // The portal provides both encoded and decoded keys. URLSearchParams encodes
  // once; a literal '+' must not be converted to a space.
  try { return raw.includes('%') ? decodeURIComponent(raw) : raw; }
  catch { return raw; }
}

export function getProviderHealth(env = globalThis.process?.env ?? {}) {
  return Object.fromEntries(['nts', 'ftc'].map((provider) => [provider, {
    configured: Boolean(getKey(env, provider)),
    configuration: getKey(env, provider) ? 'configured' : 'missing_key',
    authentication: 'not_checked',
    source: PROVIDER_SOURCES[provider],
  }]));
}

/** Preserve large integer identifiers before JSON.parse can round them. */
export function parseJsonLossless(input) {
  let output = '';
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') {
      quoted = true;
      output += char;
      continue;
    }
    if (char === '-' || /[0-9]/.test(char)) {
      let end = index + 1;
      while (end < input.length && /[0-9.eE+\-]/.test(input[end])) end += 1;
      const token = input.slice(index, end);
      const isInteger = /^-?(?:0|[1-9]\d*)$/.test(token);
      output += isInteger && !Number.isSafeInteger(Number(token)) ? `"${token}"` : token;
      index = end - 1;
      continue;
    }
    output += char;
  }
  return JSON.parse(output);
}

function failure(code, message, retryable = false) {
  return { ok: false, errorCode: code, message, retryable };
}

function knownFailure(code, httpStatus = 200) {
  const value = String(code ?? '').trim();
  if (['20', '30', '31', 'SERVICE_KEY_IS_NULL', 'SERVICE_ACCESS_DENIED_ERROR',
    'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', 'DEADLINE_HAS_EXPIRED_ERROR',
    'PERMISSION_DENIED'].includes(value) || [401, 403].includes(httpStatus)) {
    return failure('provider_unauthorized', '공공데이터 API 인증 또는 활용 승인 상태를 확인해야 합니다.');
  }
  if (['22', '23', 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR',
    'LIMITED_NUMBER_OF_SERVICE_REQUESTS_PER_SECOND_EXCEEDS_ERROR'].includes(value) || httpStatus === 429) {
    return failure('provider_rate_limited', '공공데이터 API 호출 한도를 초과했습니다. 잠시 후 다시 조회하세요.', true);
  }
  if (['29', 'BLACKLIST_IP_ACCESS_ERROR'].includes(value)) {
    return failure('provider_access_denied', '공공데이터 제공기관에서 요청을 허용하지 않았습니다.');
  }
  if (['05', 'SERVICETIMEOUT_ERROR'].includes(value) || [408, 504].includes(httpStatus)) {
    return failure('provider_timeout', '공공데이터 제공기관의 응답을 기다리는 시간이 초과됐습니다.', true);
  }
  if (['BAD_JSON_REQUEST', 'REQUEST_DATA_MALFORMED', 'TOO_LARGE_REQUEST',
    '10', '11', 'INVALID_REQUEST_PARAMETER_ERROR', 'ESSENTIAL_PARAMETER_ERROR'].includes(value)) {
    return failure('provider_request_rejected', '공공데이터 제공기관에서 조회 요청 형식을 거절했습니다.');
  }
  if (['12', 'NO_OPENAPI_SERVICE_ERROR'].includes(value) || httpStatus === 404) {
    return failure('provider_endpoint_unavailable', '공공데이터 API 경로를 사용할 수 없습니다. 사업자 조회 결과가 아닙니다.');
  }
  if (['01', '04', 'APPLICATION_ERROR', 'HTTP_ERROR', 'INTERNAL_ERROR'].includes(value) || httpStatus >= 500) {
    return failure('provider_unavailable', '공공데이터 제공기관에서 오류가 발생했습니다. 잠시 후 다시 조회하세요.', true);
  }
  return null;
}

function xmlErrorCode(body) {
  // Gateways may return XML errors even when JSON was requested. Do not parse
  // arbitrary XML entities, DTDs, or provider messages into the public response.
  for (const name of ['returnReasonCode', 'returnAuthMsg', 'resultCode', 'StatusCode']) {
    const match = body.match(new RegExp(`<${name}\\b[^>]*>\\s*([^<]{1,160})\\s*</${name}>`, 'i'));
    if (match) return match[1].trim();
  }
  return '';
}

function envelope(payload) {
  const root = object(payload?.response) ? payload.response : payload;
  return {
    root,
    header: object(root?.header) ? root.header : root,
    body: object(root?.body) ? root.body : root,
  };
}

function errorCodeFromPayload(payload) {
  if (!object(payload)) return '';
  if (typeof payload.status_code === 'string' && payload.status_code !== 'OK') return payload.status_code;
  const gateway = payload.OpenAPI_ServiceResponse?.cmmMsgHeader ?? payload.cmmMsgHeader;
  if (object(gateway)) return gateway.returnReasonCode ?? gateway.returnAuthMsg ?? '';
  const { header, body } = envelope(payload);
  return header?.resultCode ?? body?.resultCode ?? '';
}

async function requestProvider(url, init, env, fetchImpl, deadline = Infinity) {
  const configuredTimeout = Number(env.PROVIDER_TIMEOUT_MS);
  const requestedTimeout = Number.isFinite(configuredTimeout)
    ? Math.max(100, Math.min(30_000, configuredTimeout)) : 10_000;
  const timeoutMs = Math.min(requestedTimeout, deadline - Date.now());
  if (timeoutMs <= 0) return failure('provider_timeout', '공공데이터 API 응답 시간이 초과됐습니다.', true);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      redirect: 'error',
      headers: { Accept: 'application/json', ...init.headers },
    });
    const contentLength = Number(response.headers.get('content-length'));
    if (contentLength > MAX_RESPONSE_BYTES) {
      controller.abort();
      return failure('invalid_upstream_response', '제공기관의 응답이 허용 크기를 초과했습니다.');
    }
    const bodyText = await response.text();
    if (new TextEncoder().encode(bodyText).length > MAX_RESPONSE_BYTES) {
      return failure('invalid_upstream_response', '제공기관의 응답이 허용 크기를 초과했습니다.');
    }
    let payload;
    try { payload = parseJsonLossless(bodyText); }
    catch {
      const mapped = knownFailure(xmlErrorCode(bodyText), response.status);
      return mapped ?? failure('invalid_upstream_response', '제공기관의 응답 형식을 확인할 수 없습니다. 조회 결과 없음과 다릅니다.');
    }
    const mapped = knownFailure(errorCodeFromPayload(payload), response.status);
    if (mapped) return mapped;
    if (!response.ok) {
      return failure('provider_http_error', '공공데이터 API 요청을 완료하지 못했습니다.', response.status >= 500);
    }
    return { ok: true, payload };
  } catch {
    // Fetch errors often contain the full URL including the serviceKey. Never
    // return or log the exception, provider response text, or request URL.
    return controller.signal.aborted
      ? failure('provider_timeout', '공공데이터 API 응답 시간이 초과됐습니다.', true)
      : failure('provider_network_error', '공공데이터 API에 연결하지 못했습니다.', true);
  } finally {
    clearTimeout(timeout);
  }
}

function statusBase(businessNumber, checkedAt, outcome = 'error') {
  return {
    businessNumber,
    outcome,
    businessStatus: 'unknown',
    statusLabel: '확인되지 않음',
    taxType: null,
    closedAt: null,
    checkedAt,
    source: PROVIDER_SOURCES.nts,
    sourceUrl: PROVIDER_SOURCES.nts.url,
  };
}

function publicError(result) {
  return { errorCode: result.errorCode, message: result.message, retryable: result.retryable ?? false };
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return null;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().startsWith(iso) ? iso : null;
}

function mapNtsStatus(row, businessNumber, checkedAt) {
  const base = statusBase(businessNumber, checkedAt);
  if (!object(row) || normalizedNumber(row.b_no) !== businessNumber) {
    return { ...base, ...publicError(failure('identity_mismatch', '응답의 사업자등록번호가 요청과 일치하지 않습니다.')) };
  }
  const statuses = {
    '01': ['active', '계속사업자'],
    '02': ['suspended', '휴업자'],
    '03': ['closed', '폐업자'],
  };
  const statusCode = text(row.b_stt_cd);
  const mapped = own(statuses, statusCode) ? statuses[statusCode] : null;
  if (!mapped) {
    const notRegistered = /^국세청에 등록되지 않은 사업자등록번호입니다\.?$/.test(text(row.tax_type));
    if (!text(row.b_stt_cd) && notRegistered) {
      return {
        ...base,
        outcome: 'not_found',
        statusLabel: '국세청 조회 결과 없음',
        message: '국세청에서 확인되지 않았습니다. 신규 등록 반영 지연 또는 삭제된 정보도 포함될 수 있습니다.',
      };
    }
    return { ...base, ...publicError(failure('invalid_upstream_response', '사업 상태 코드가 없거나 알려지지 않은 값입니다.')) };
  }
  return {
    ...base,
    outcome: 'ok',
    businessStatus: mapped[0],
    statusLabel: mapped[1],
    taxType: nullableText(row.tax_type),
    taxTypeCode: nullableText(row.tax_type_cd),
    closedAt: validDate(row.end_dt),
    taxTypeChangedAt: validDate(row.tax_type_change_dt),
    invoiceAppliedAt: validDate(row.invoice_apply_dt),
    previousTaxType: nullableText(row.rbf_tax_type),
    previousTaxTypeCode: nullableText(row.rbf_tax_type_cd),
    unitTaxConversion: row.utcc_yn === 'Y' ? true : row.utcc_yn === 'N' ? false : null,
  };
}

export async function queryNtsStatuses(businessNumbers, env = globalThis.process?.env ?? {}, fetchImpl = fetch) {
  const checkedAt = now();
  const key = getKey(env, 'nts');
  if (!key) {
    return businessNumbers.map((number) => ({
      ...statusBase(number, checkedAt, 'not_configured'),
      errorCode: 'not_configured',
      message: '국세청 API 인증키가 설정되지 않았습니다.',
    }));
  }
  const unique = [...new Set(businessNumbers)];
  const url = new URL('status', NTS_BASE);
  url.searchParams.set('serviceKey', key);
  url.searchParams.set('returnType', 'JSON');
  const response = await requestProvider(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ b_no: unique }),
  }, env, fetchImpl);
  if (!response.ok) {
    return businessNumbers.map((number) => ({ ...statusBase(number, checkedAt), ...publicError(response) }));
  }
  const payload = response.payload;
  if (!object(payload) || payload.status_code !== 'OK' || !Array.isArray(payload.data)) {
    return businessNumbers.map((number) => ({
      ...statusBase(number, checkedAt),
      ...publicError(failure('invalid_upstream_response', '국세청 응답 구조를 확인할 수 없습니다.')),
    }));
  }
  const rows = new Map();
  const duplicateRows = new Set();
  for (const row of payload.data) {
    if (!object(row)) continue;
    const number = normalizedNumber(row.b_no);
    if (rows.has(number)) duplicateRows.add(number);
    rows.set(number, row);
  }
  return businessNumbers.map((number) => {
    if (!rows.has(number) || duplicateRows.has(number)) {
      return {
        ...statusBase(number, checkedAt),
        ...publicError(failure('invalid_upstream_response', '요청한 사업자의 응답이 누락되었거나 중복됐습니다.')),
      };
    }
    return mapNtsStatus(rows.get(number), number, checkedAt);
  });
}

export async function validateNtsBusinesses(businesses, env = globalThis.process?.env ?? {}, fetchImpl = fetch) {
  const checkedAt = now();
  const key = getKey(env, 'nts');
  const base = (business) => ({
    ...statusBase(business.b_no, checkedAt),
    valid: null,
    verification: 'not_checked',
  });
  if (!key) {
    return businesses.map((business) => ({
      ...base(business),
      outcome: 'not_configured',
      errorCode: 'not_configured',
      message: '국세청 API 인증키가 설정되지 않았습니다.',
    }));
  }
  const url = new URL('validate', NTS_BASE);
  url.searchParams.set('serviceKey', key);
  url.searchParams.set('returnType', 'JSON');
  const response = await requestProvider(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businesses }),
  }, env, fetchImpl);
  if (!response.ok) return businesses.map((business) => ({ ...base(business), ...publicError(response) }));
  const payload = response.payload;
  if (!object(payload) || payload.status_code !== 'OK' || !Array.isArray(payload.data)
    || payload.data.length !== businesses.length) {
    return businesses.map((business) => ({
      ...base(business),
      ...publicError(failure('invalid_upstream_response', '국세청 진위확인 응답 구조를 확인할 수 없습니다.')),
    }));
  }
  return businesses.map((business, index) => {
    const row = payload.data[index];
    const sameRequest = object(row?.request_param)
      && Object.entries(business).every(([name, value]) => row.request_param[name] === value);
    if (!object(row) || normalizedNumber(row.b_no) !== business.b_no || !sameRequest) {
      return { ...base(business), ...publicError(failure('identity_mismatch', '진위확인 응답의 요청 정보가 일치하지 않습니다.')) };
    }
    if (row.valid === '02') {
      return {
        ...base(business),
        outcome: 'ok',
        valid: false,
        verification: 'unconfirmed',
        message: '입력한 정보와 국세청 등록 정보의 일치 여부를 확인할 수 없습니다. 정보 불일치와 조회 불가를 구분할 수 없습니다.',
      };
    }
    if (row.valid !== '01') {
      return { ...base(business), ...publicError(failure('invalid_upstream_response', '알려지지 않은 진위확인 결과 코드입니다.')) };
    }
    const status = mapNtsStatus(row.status, business.b_no, checkedAt);
    if (status.outcome !== 'ok') return { ...base(business), ...status, valid: null, verification: 'not_checked' };
    return { ...status, valid: true, verification: 'matched', message: '입력 정보가 국세청 등록 정보와 일치합니다. 대표자 본인인증 결과는 아닙니다.' };
  });
}

function count(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) && result >= 0 ? result : null;
}

function readCommercePage(payload) {
  if (!object(payload)) return failure('invalid_upstream_response', '공정위 응답 구조를 확인할 수 없습니다.');
  const { header, body } = envelope(payload);
  const resultCode = String(header?.resultCode ?? body?.resultCode ?? '').trim();
  // Unknown success/error codes are not interpreted as an empty registry.
  if (!['00', '0'].includes(resultCode)) {
    return knownFailure(resultCode) ?? failure('invalid_upstream_response', '공정위 결과 코드를 확인할 수 없습니다.');
  }
  const totalCount = count(body?.totalCount);
  if (totalCount === null || !own(body, 'items')) {
    return failure('invalid_upstream_response', '공정위의 전체 건수 또는 목록 정보가 누락됐습니다.');
  }
  let items = body.items;
  if (object(items) && own(items, 'item')) items = items.item;
  if (totalCount === 0 && (items === '' || items === null || items === undefined
    || (object(items) && Object.keys(items).length === 0))) items = [];
  const rows = Array.isArray(items) ? items : object(items) ? [items] : null;
  if (!rows || rows.some((row) => !object(row)) || (totalCount > 0 && rows.length === 0)
    || rows.length > totalCount) {
    return failure('invalid_upstream_response', '공정위 목록의 형식을 확인할 수 없습니다.');
  }
  return { ok: true, rows, totalCount };
}

function commerceRecord(row, businessNumber) {
  const sourceUrl = new URL('https://www.ftc.go.kr/www/selectBizCommList.do');
  sourceUrl.searchParams.set('key', '254');
  sourceUrl.searchParams.set('searchCnd', 'BRNO');
  sourceUrl.searchParams.set('searchKrwd', businessNumber);
  return {
    name: nullableText(row.bzmnNm),
    businessNumber,
    address: nullableText(row.lctnRnAddr) ?? nullableText(row.rnAddr) ?? nullableText(row.lctnAddr),
    representative: nullableText(row.rprsvNm),
    registrationNumber: nullableText(row.prmmiMnno),
    statusLabel: nullableText(row.operSttusCdNm),
    domain: nullableText(row.domnCn),
    sourceUrl: sourceUrl.href,
    recordId: typeof row.opnSn === 'string' ? row.opnSn
      : Number.isSafeInteger(row.opnSn) ? String(row.opnSn) : null,
    updatedAt: nullableText(row.opnMdfcnDt),
    reportedAt: nullableText(row.dclrDate),
    closedAt: nullableText(row.clsbizDate),
    corporateNumber: nullableText(row.crno),
    salesMethod: nullableText(row.ntslMthdNm) ?? nullableText(row.ntslMthdCn),
    products: nullableText(row.trtmntPrdlstNm),
  };
}

export async function queryCommerce(businessNumber, env = globalThis.process?.env ?? {}, fetchImpl = fetch) {
  const checkedAt = now();
  const deadline = Date.now() + 18_000;
  const base = { businessNumber, records: [], checkedAt, source: PROVIDER_SOURCES.ftc };
  const key = getKey(env, 'ftc');
  if (!key) {
    return { ...base, outcome: 'not_configured', errorCode: 'not_configured', message: '공정위 통신판매 API 인증키가 설정되지 않았습니다.' };
  }
  const collected = [];
  const seen = new Set();
  let scanned = 0;
  let totalCount = 0;
  let mismatchCount = 0;
  for (let page = 1; page <= MAX_FTC_PAGES; page += 1) {
    const url = new URL(FTC_DETAIL);
    url.searchParams.set('serviceKey', key);
    url.searchParams.set('pageNo', String(page));
    url.searchParams.set('numOfRows', String(FTC_PAGE_SIZE));
    url.searchParams.set('resultType', 'json');
    url.searchParams.set('brno', businessNumber);
    const response = await requestProvider(url, { method: 'GET' }, env, fetchImpl, deadline);
    const parsed = response.ok ? readCommercePage(response.payload) : response;
    if (!parsed.ok) {
      return { ...base, outcome: 'error', records: collected, partial: collected.length > 0, ...publicError(parsed) };
    }
    totalCount = parsed.totalCount;
    scanned += parsed.rows.length;
    if (totalCount === 0) {
      if (page > 1) return { ...base, outcome: 'error', ...publicError(failure('invalid_upstream_response', '페이지를 조회하는 동안 공정위 목록의 건수가 변경됐습니다.')) };
      return { ...base, outcome: 'not_found', totalCount: 0, message: '공정위 통신판매 자료에서 조회되지 않았습니다. 모든 업종이 이 자료에 포함되는 것은 아닙니다.' };
    }
    let newRows = 0;
    for (const row of parsed.rows) {
      if (normalizedNumber(row.brno) !== businessNumber) {
        mismatchCount += 1;
        continue;
      }
      const record = commerceRecord(row, businessNumber);
      const identity = record.recordId ?? JSON.stringify([record.registrationNumber, record.name, record.address, record.statusLabel]);
      if (!seen.has(identity)) {
        seen.add(identity);
        collected.push(record);
        newRows += 1;
      }
    }
    if (scanned >= totalCount) break;
    if (page > 1 && newRows === 0) {
      return { ...base, outcome: 'error', records: collected, partial: true, ...publicError(failure('invalid_upstream_response', '공정위의 다음 페이지가 중복되어 전체 결과를 확인하지 못했습니다.')) };
    }
  }
  if (!collected.length) {
    return { ...base, outcome: 'error', ...publicError(failure('identity_mismatch', '공정위 응답에 요청한 사업자등록번호와 일치하는 자료가 없습니다.')) };
  }
  const partial = scanned < totalCount || mismatchCount > 0;
  return {
    ...base,
    outcome: 'ok',
    records: collected,
    totalCount,
    partial,
    ...(partial ? { message: '사업자등록번호가 정확히 일치하는 일부 자료를 표시합니다. 공정위 원문에서 전체 내역을 확인하세요.' } : {}),
  };
}
