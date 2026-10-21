import { createHash } from 'node:crypto';
import { isValidBusinessNumber, normalizeBusinessNumber } from '../src/domain.mjs';

// Official contract read 2026-10-21:
// https://www.data.go.kr/data/15059256/openapi.do
export const BUSINESS_PUBLIC_SOURCE = 'https://www.data.go.kr/data/15059256/openapi.do';
const ENDPOINT = 'https://apis.data.go.kr/B490001/gySjbPstateInfoService/getGySjBoheomBsshItem';
const MAX_BYTES = 1_000_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 5;
const REQUEST_TIMEOUT = 12_000;
const TYPES = [{ code: '1', name: '산재보험' }, { code: '2', name: '고용보험' }];
const text = (value, limit = 500) => typeof value === 'string'
  ? value.replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) : '';
class PublicCollectionError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const fail = (code, message) => { throw new PublicCollectionError(code, message); };
const malformed = () => fail('invalid_response', '근로복지공단 응답 형식을 확인하지 못했습니다.');
const localName = value => value.split(':').at(-1);
function decodeXml(value) {
  return value.replace(/&([^;\s]+);/g, (_match, name) => {
    const predefined = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (Object.hasOwn(predefined, name)) return predefined[name];
    if (/^#x[0-9a-f]+$/i.test(name) || /^#\d+$/.test(name)) {
      const point = name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      if (point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)) return String.fromCodePoint(point);
    }
    return malformed();
  });
}

/** Minimal bounded XML tree; external entities, DTDs and processing are never resolved. */
function parseXml(xml) {
  if (typeof xml !== 'string' || /<!\s*(?:DOCTYPE|ENTITY)/i.test(xml)) malformed();
  const wrapper = { name: '#document', children: [], text: '' }, stack = [wrapper];
  let cursor = 0, count = 0;
  while (cursor < xml.length) {
    if (xml[cursor] !== '<') {
      const end = xml.indexOf('<', cursor), stop = end < 0 ? xml.length : end;
      const raw = xml.slice(cursor, stop);
      if (stack.length === 1 && raw.trim()) malformed();
      stack.at(-1).text += decodeXml(raw); cursor = stop; continue;
    }
    if (xml.startsWith('<!--', cursor)) {
      const end = xml.indexOf('-->', cursor + 4); if (end < 0) malformed(); cursor = end + 3; continue;
    }
    if (xml.startsWith('<![CDATA[', cursor)) {
      const end = xml.indexOf(']]>', cursor + 9); if (end < 0 || stack.length === 1) malformed();
      stack.at(-1).text += xml.slice(cursor + 9, end); cursor = end + 3; continue;
    }
    if (xml.startsWith('<?', cursor)) {
      const end = xml.indexOf('?>', cursor + 2); if (end < 0) malformed(); cursor = end + 2; continue;
    }
    let end = cursor + 1, quote = null;
    for (; end < xml.length; end++) {
      const character = xml[end];
      if (quote) { if (character === quote) quote = null; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    if (end >= xml.length || quote) malformed();
    const tag = xml.slice(cursor + 1, end).trim();
    if (tag.startsWith('/')) {
      const name = tag.slice(1).trim();
      if (!/^[A-Za-z_][\w:.-]*$/.test(name) || stack.length < 2 || stack.at(-1).rawName !== name) malformed();
      stack.pop();
    } else {
      const selfClosing = tag.endsWith('/');
      const body = selfClosing ? tag.slice(0, -1).trim() : tag;
      const match = body.match(/^([A-Za-z_][\w:.-]*)(?:\s+[\s\S]*)?$/);
      if (!match || body.includes('<') || ++count > 20_000 || stack.length > 12) malformed();
      const node = { name: localName(match[1]), rawName: match[1], children: [], text: '' };
      stack.at(-1).children.push(node);
      if (!selfClosing) stack.push(node);
    }
    cursor = end + 1;
  }
  if (stack.length !== 1 || wrapper.children.length !== 1) malformed();
  return wrapper.children[0];
}
const child = (node, name) => node?.children.find(value => value.name === name);
const leaf = (node, name) => text(child(node, name)?.text || '', 1000);
function parseResponse(xml) {
  const root = parseXml(xml.replace(/^\uFEFF/, ''));
  const header = child(root, 'header') || child(root, 'cmmMsgHeader');
  const resultCode = leaf(header, 'resultCode') || leaf(header, 'returnReasonCode') || leaf(root, 'resultCode');
  if (!resultCode) malformed();
  if (resultCode !== '00') {
    const safeCode = /^[A-Za-z0-9_-]{1,80}$/.test(resultCode) ? resultCode : 'unknown';
    if (['20', '30', '31'].includes(safeCode)) fail('not_authorized', '근로복지공단 API 활용신청·인증키·이용기간 확인이 필요합니다.');
    if (['22', '23'].includes(safeCode)) fail('rate_limited', '근로복지공단 API 요청 한도에 도달했습니다.');
    fail('provider_error', '근로복지공단 API가 정상 조회 결과를 반환하지 않았습니다.');
  }
  const body = child(root, 'body');
  if (!body) malformed();
  const itemsNode = child(body, 'items');
  const nodes = itemsNode ? itemsNode.children.filter(value => value.name === 'item') : body.children.filter(value => value.name === 'item');
  const totalRaw = leaf(body, 'totalCount');
  const totalCount = /^\d+$/.test(totalRaw) && Number.isSafeInteger(Number(totalRaw)) ? Number(totalRaw) : null;
  const items = nodes.map(node => Object.fromEntries(['saeopjangNm', 'addr', 'post', 'sangsiInwonCnt', 'seongripDt',
    'saeopjaDrno', 'gyEopjongNm', 'gyEopjongCd', 'sjEopjongNm', 'sjEopjongCd', 'opaBoheomFg', 'saeopFg'].map(name => [name, leaf(node, name)])));
  if ((totalCount !== null && totalCount < nodes.length) || nodes.length > PAGE_SIZE || (!itemsNode && !nodes.length && totalCount !== 0)) malformed();
  return { items, totalCount };
}
function keyValue(raw) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 2048) return '';
  try { return raw.includes('%') ? decodeURIComponent(raw.trim()) : raw.trim(); } catch { return ''; }
}
async function boundedPage(url, fetchImpl) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => {
    controller.abort(); reject(new PublicCollectionError('timeout', '근로복지공단 API 응답 시간이 초과됐습니다.'));
  }, REQUEST_TIMEOUT); });
  const operation = (async () => {
    const response = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/xml, text/xml' },
      credentials: 'omit', redirect: 'error', signal: controller.signal });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if ([401, 403].includes(response.status)) fail('not_authorized', '근로복지공단 API 활용신청·인증키 확인이 필요합니다.');
      if (response.status === 429) fail('rate_limited', '근로복지공단 API 요청 한도에 도달했습니다.');
      fail('http_error', '근로복지공단 API HTTP 응답을 확인하지 못했습니다.');
    }
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      void response.body?.cancel().catch(() => {}); fail('response_too_large', '근로복지공단 API 응답이 허용 크기를 초과했습니다.');
    }
    const reader = response.body?.getReader();
    if (!reader) malformed();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let body = '', bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BYTES) { void reader.cancel().catch(() => {}); fail('response_too_large', '근로복지공단 API 응답이 허용 크기를 초과했습니다.'); }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    return parseResponse(body);
  })();
  try { return await Promise.race([operation, deadline]); }
  catch (error) {
    if (error instanceof PublicCollectionError) throw error;
    fail('network_error', '근로복지공단 API 연결 또는 응답을 확인하지 못했습니다.');
  } finally { clearTimeout(timer); }
}
function validDate(raw) {
  if (!/^\d{8}$/.test(raw)) return '';
  const value = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}`;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? value : '';
}
function mapItem(item, insurance, businessNumber, collectedAt) {
  const normalized = normalizeBusinessNumber(item.saeopjaDrno);
  if (normalized !== businessNumber || (item.opaBoheomFg && item.opaBoheomFg !== insurance.code)) return null;
  const identity = [insurance.code, normalized, item.saeopjangNm, item.addr, item.post, item.seongripDt,
    item.sangsiInwonCnt, item.gyEopjongNm, item.gyEopjongCd, item.sjEopjongNm, item.sjEopjongCd, item.saeopFg].join('\u0000');
  const id = `comwel:${insurance.code}:${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
  const source = { id, url: BUSINESS_PUBLIC_SOURCE, title: `근로복지공단 · ${insurance.name}${item.saeopjangNm ? ` · ${item.saeopjangNm}` : ''}`,
    channel: 'public_data', collectedAt, publishedAt: null, match: 'exact_bno', businessNumber, scope: 'public_business' };
  const fields = [];
  const add = (field, value) => { if (value) fields.push({ field, value, sourceId: id, match: 'exact_bno', scope: 'public_business' }); };
  add('name', item.saeopjangNm);
  add('address', item.addr ? `${item.addr}${/^\d{5,6}$/.test(item.post) ? ` (우편번호 ${item.post})` : ''}` : '');
  add('insuranceType', insurance.name);
  if (/^\d{1,9}$/.test(item.sangsiInwonCnt)) add('insuranceEmployeeCount', `${insurance.name} 기준 ${Number(item.sangsiInwonCnt).toLocaleString('en-US')}명`);
  const established = validDate(item.seongripDt); if (established) add('insuranceEstablishedAt', `${insurance.name} 성립일 ${established}`);
  const industryName = insurance.code === '1' ? item.sjEopjongNm : item.gyEopjongNm;
  const industryCode = insurance.code === '1' ? item.sjEopjongCd : item.gyEopjongCd;
  if (industryName || industryCode) add('insuranceIndustry', `${insurance.name} 업종 ${industryName}${industryCode ? ` (${industryCode})` : ''}`.trim());
  return { source, fields };
}

/** Optional official business enrichment. Shared keys still require separate API usage approval. */
export async function collectPublicBusiness(bno, { key = process.env.BUSINESS_PUBLIC_SERVICE_KEY || process.env.NTS_SERVICE_KEY || '',
  fetchImpl = globalThis.fetch, now = () => new Date() } = {}) {
  const businessNumber = normalizeBusinessNumber(bno);
  if (!isValidBusinessNumber(businessNumber)) throw new Error('올바른 사업자등록번호가 필요합니다.');
  const observed = typeof now === 'function' ? now() : now;
  const date = observed instanceof Date ? observed : new Date(observed);
  if (!Number.isFinite(+date)) throw new Error('수집 시각이 올바르지 않습니다.');
  const collectedAt = date.toISOString(), serviceKey = keyValue(key), sources = [], fields = [], sourceStatuses = [];
  for (const insurance of TYPES) {
    const status = { provider: 'comwel', insuranceType: insurance.code, label: insurance.name,
      sourceUrl: BUSINESS_PUBLIC_SOURCE, status: serviceKey ? 'success' : 'not_configured',
      checkedAt: collectedAt, pages: 0, returnedCount: 0, matchedCount: 0, totalCount: null, truncated: false };
    if (!serviceKey) {
      status.message = '근로복지공단 API 인증키와 별도 활용신청 승인이 필요합니다.';
      sourceStatuses.push(status); continue;
    }
    const seen = new Set();
    let complete = false;
    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url = new URL(ENDPOINT);
        for (const [name, value] of Object.entries({ serviceKey, v_saeopjaDrno: businessNumber,
          opaBoheomFg: insurance.code, pageNo: String(page), numOfRows: String(PAGE_SIZE) })) url.searchParams.set(name, value);
        const response = await boundedPage(url, fetchImpl);
        status.pages++;
        status.returnedCount += response.items.length;
        if (response.totalCount !== null) {
          if (status.totalCount !== null && status.totalCount !== response.totalCount) status.changedDuringCollection = true;
          status.totalCount = response.totalCount;
        }
        let newCount = 0;
        for (const item of response.items) {
          const mapped = mapItem(item, insurance, businessNumber, collectedAt);
          if (!mapped || seen.has(mapped.source.id)) continue;
          seen.add(mapped.source.id); newCount++; status.matchedCount++;
          sources.push(mapped.source); fields.push(...mapped.fields);
        }
        if (!response.items.length || response.items.length < PAGE_SIZE) {
          complete = status.totalCount === null || status.returnedCount >= status.totalCount;
          if (!complete) { status.status = 'partial'; status.truncated = true; }
          break;
        }
        if (status.totalCount !== null && status.returnedCount >= status.totalCount) { complete = true; break; }
        if (newCount === 0) { status.status = 'partial'; status.truncated = true; break; }
      }
      if (!complete || status.changedDuringCollection) { status.status = 'partial'; status.truncated = true; }
      else if (status.returnedCount > 0 && status.matchedCount === 0) {
        status.status = 'identity_mismatch'; status.message = '응답 사업자번호가 요청 번호와 일치하지 않아 정보를 채택하지 않았습니다.';
      } else if (status.returnedCount === 0) {
        status.status = 'not_found'; status.message = '이 보험 구분의 공개 사업장 조회 결과가 없습니다. 미등록·폐업을 뜻하지 않습니다.';
      }
    } catch (error) {
      status.status = status.matchedCount ? 'partial' : 'error';
      status.errorCode = error instanceof PublicCollectionError ? error.code : 'collection_error';
      status.message = error instanceof PublicCollectionError ? error.message : '근로복지공단 정보 수집을 완료하지 못했습니다.';
      status.truncated = status.matchedCount > 0;
    }
    sourceStatuses.push(status);
  }
  const successes = sourceStatuses.filter(value => ['success', 'not_found'].includes(value.status)).length;
  const status = !serviceKey ? 'not_configured' : successes === TYPES.length ? 'success' : sources.length || successes ? 'partial' : 'failed';
  return { businessNumber, sources, fields, collection: { status, lastAttemptAt: collectedAt,
    lastSuccessAt: status === 'success' ? collectedAt : null, sourceStatuses } };
}
