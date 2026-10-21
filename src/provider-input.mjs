import { isValidBusinessNumber } from './domain.mjs';
const own = (value, name) => Object.hasOwn(value, name);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export class InputError extends Error {}

export function normalizeNumber(value) {
  if (typeof value !== 'string' || !/^[\d\s-]{10,32}$/.test(value)) {
    throw new InputError('사업자등록번호를 숫자 10자리로 입력하세요.');
  }
  const normalized = value.replace(/[\s-]/g, '');
  if (!isValidBusinessNumber(normalized)) throw new InputError('사업자등록번호의 자리수와 검증번호를 확인하세요.');
  return normalized;
}

function normalizeDate(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) {
    throw new InputError('개업일자는 YYYYMMDD 형식의 숫자 8자리여야 합니다.');
  }
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.valueOf()) || !parsed.toISOString().startsWith(iso)) {
    throw new InputError('실제 달력에 존재하는 개업일자를 입력하세요.');
  }
  return value;
}

export function normalizeBusinesses(body) {
  if (!Array.isArray(body.businesses) || !body.businesses.length || body.businesses.length > 100) {
    throw new InputError('businesses에는 1개 이상 100개 이하의 사업자 정보를 입력하세요.');
  }
  return body.businesses.map((business) => {
    if (!object(business)) throw new InputError('각 사업자 정보는 객체여야 합니다.');
    if (typeof business.p_nm !== 'string' || !business.p_nm.trim() || business.p_nm.length > 100) {
      throw new InputError('대표자성명 p_nm을 100자 이내로 입력하세요.');
    }
    const result = {
      b_no: normalizeNumber(business.b_no),
      start_dt: normalizeDate(business.start_dt),
      p_nm: business.p_nm.trim(),
    };
    const optional = { p_nm2: 100, b_nm: 400, b_sector: 200, b_type: 200, b_adr: 500 };
    for (const [name, limit] of Object.entries(optional)) {
      if (!own(business, name)) continue;
      if (typeof business[name] !== 'string' || business[name].length > limit) {
        throw new InputError(`${name}은 ${limit}자 이내의 문자열이어야 합니다.`);
      }
      // Omission and an explicitly supplied empty value have different NTS
      // verification semantics; preserve intentional empty strings.
      result[name] = business[name].trim();
    }
    if (own(business, 'corp_no')) {
      if (typeof business.corp_no !== 'string') throw new InputError('corp_no는 문자열이어야 합니다.');
      const corporateNumber = business.corp_no.replace(/[\s-]/g, '');
      if (corporateNumber && !/^\d{13}$/.test(corporateNumber)) throw new InputError('법인등록번호는 숫자 13자리여야 합니다.');
      result.corp_no = corporateNumber;
    }
    return result;
  });
}

