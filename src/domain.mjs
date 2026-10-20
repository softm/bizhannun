/** Pure domain helpers shared by the browser UI and Node's test runner. */

export const MAX_IMPORT_ROWS = 1000;
export const MAX_HISTORY_ENTRIES = 50;

const KNOWN_STATUSES = new Set(['active', 'suspended', 'closed']);
const OUTCOMES = new Set(['ok', 'not_found', 'error', 'not_configured']);
const STATUS_LABELS = {
  active: '계속사업자',
  suspended: '휴업자',
  closed: '폐업자',
  unknown: '확인되지 않음',
};

/** Return digits, or an empty string when the input contains other characters. */
export function normalizeBusinessNumber(value) {
  if (value == null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return '';
  const input = String(value).trim();
  if (!input || !/^[0-9\s-]+$/u.test(input)) return '';
  return input.replace(/[\s-]/gu, '');
}

export function formatBusinessNumber(value) {
  const number = normalizeBusinessNumber(value);
  return number.length === 10
    ? `${number.slice(0, 3)}-${number.slice(3, 5)}-${number.slice(5)}`
    : number;
}

/** Format/checksum validation only; this does not establish registration. */
export function isValidBusinessNumber(value) {
  const number = normalizeBusinessNumber(value);
  if (!/^\d{10}$/.test(number) || number === '0000000000') return false;
  const digits = [...number].map(Number);
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = weights.reduce((total, weight, index) => total + weight * digits[index], 0);
  sum += Math.floor((digits[8] * 5) / 10);
  return (10 - (sum % 10)) % 10 === digits[9];
}

/**
 * Parse RFC 4180 records, also accepting LF/CR record separators and a UTF-8 BOM.
 * Quoted commas, doubled quotes and embedded line endings remain intact.
 * Invalid quoting throws a SyntaxError with one-based `row` and `line` fields.
 */
export function parseCsv(text) {
  if (typeof text !== 'string') throw new TypeError('CSV 내용은 문자열이어야 합니다.');
  const input = text.replace(/^\uFEFF/u, '');
  if (!input) return [];
  const records = [];
  let record = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  let line = 1;

  const fail = (message) => {
    const error = new SyntaxError(message);
    error.row = records.length + 1;
    error.line = line;
    throw error;
  };
  const endField = () => {
    record.push(field);
    field = '';
    afterQuote = false;
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          afterQuote = true;
        }
      } else if (char === '\r' && input[index + 1] === '\n') {
        field += '\r\n';
        index += 1;
        line += 1;
      } else {
        field += char;
        if (char === '\r' || char === '\n') line += 1;
      }
      continue;
    }

    if (char === ',') {
      endField();
    } else if (char === '\r' || char === '\n') {
      endRecord();
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      line += 1;
    } else if (afterQuote) {
      fail('닫는 따옴표 뒤에는 쉼표 또는 줄바꿈만 올 수 있습니다.');
    } else if (char === '"') {
      if (field !== '') fail('필드 중간의 따옴표는 큰따옴표 두 개로 이스케이프해야 합니다.');
      quoted = true;
    } else {
      field += char;
    }
  }
  if (quoted) fail('CSV의 큰따옴표가 닫히지 않았습니다.');
  if (field !== '' || record.length > 0 || afterQuote) endRecord();
  return records;
}

const HEADER_ALIASES = {
  businessNumber: new Set(['사업자등록번호', '사업자번호', 'businessnumber', 'businessregistrationnumber', 'brn']),
  name: new Set(['업체명', '상호', '회사명', 'name']),
  tags: new Set(['태그', 'tags']),
  note: new Set(['메모', '비고', 'note', 'notes']),
};

function headerKey(value) {
  return String(value ?? '').trim().replace(/[\s_-]/gu, '').toLowerCase();
}

function normalizeTags(value) {
  const values = Array.isArray(value) ? value : String(value ?? '').split(/[,;|\r\n]/u);
  return [...new Set(values.map((tag) => String(tag).trim()).filter(Boolean))];
}

/**
 * CSV (named or positional columns) or one business number per line.
 * Valid unique records are returned; invalid rows are reported individually.
 * An over-limit file is rejected as a whole, never silently truncated.
 * Repeated numbers keep the first valid record and increment `duplicates`.
 */
export function parseBusinessImport(text) {
  let records;
  try {
    records = parseCsv(text);
  } catch (error) {
    return { rows: [], errors: [{ row: error.row ?? 1, message: error.message }], duplicates: 0 };
  }
  const populated = records
    .map((cells, index) => ({ cells, row: index + 1 }))
    .filter(({ cells }) => cells.some((cell) => cell.trim() !== ''));
  if (!populated.length) {
    return { rows: [], errors: [{ row: 1, message: '가져올 사업자번호가 없습니다.' }], duplicates: 0 };
  }

  const first = populated[0];
  const headers = first.cells.map(headerKey);
  const columns = Object.fromEntries(Object.entries(HEADER_ALIASES).map(([key, aliases]) => [
    key, headers.findIndex((header) => aliases.has(header)),
  ]));
  const hasHeader = columns.businessNumber >= 0;
  if (!hasHeader && Object.values(columns).some((index) => index >= 0)) {
    return {
      rows: [],
      errors: [{ row: first.row, message: '사업자등록번호 또는 businessNumber 헤더가 필요합니다.' }],
      duplicates: 0,
    };
  }
  if (hasHeader) {
    const numberColumns = headers.filter((header) => HEADER_ALIASES.businessNumber.has(header));
    if (numberColumns.length > 1) {
      return {
        rows: [],
        errors: [{ row: first.row, message: '사업자등록번호 열이 중복되어 어느 열을 사용할지 확인이 필요합니다.' }],
        duplicates: 0,
      };
    }
  } else {
    Object.assign(columns, { businessNumber: 0, name: 1, tags: 2, note: 3 });
  }

  const data = hasHeader ? populated.slice(1) : populated;
  if (data.length > MAX_IMPORT_ROWS) {
    return {
      rows: [],
      errors: [{
        row: data[MAX_IMPORT_ROWS].row,
        message: `한 번에 최대 ${MAX_IMPORT_ROWS.toLocaleString('ko-KR')}개 행을 가져올 수 있습니다. 총 ${data.length.toLocaleString('ko-KR')}개 행이 있어 파일을 나누어야 합니다. 저장된 행은 없습니다.`,
      }],
      duplicates: 0,
    };
  }
  if (!data.length) {
    return { rows: [], errors: [{ row: first.row + 1, message: '헤더 아래에 가져올 사업자번호가 없습니다.' }], duplicates: 0 };
  }

  const rows = [];
  const errors = [];
  const seen = new Set();
  let duplicates = 0;
  for (const { cells, row } of data) {
    const get = (key) => columns[key] >= 0 ? (cells[columns[key]] ?? '') : '';
    const input = get('businessNumber');
    const businessNumber = normalizeBusinessNumber(input);
    if (!isValidBusinessNumber(businessNumber)) {
      errors.push({ row, message: '사업자등록번호는 숫자 10자리와 올바른 검증번호가 필요합니다. 원본 번호를 확인해 주세요.' });
      continue;
    }
    if (seen.has(businessNumber)) {
      duplicates += 1;
      continue;
    }
    seen.add(businessNumber);
    rows.push({
      businessNumber,
      name: get('name').trim(),
      tags: normalizeTags(get('tags')),
      note: get('note'),
    });
  }
  return { rows, errors, duplicates };
}

function csvCell(value) {
  let cell = value == null ? '' : Array.isArray(value) ? value.join('|') : String(value);
  // CSV quoting alone does not stop spreadsheet applications evaluating formulas.
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(cell) || /^[\t\r\n]/u.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}

/**
 * Export objects as BOM-prefixed, CRLF-separated CSV. `columns` accepts keys or
 * {key, label/header, value?: (row) => unknown}. Omitted columns use object keys.
 */
export function toCsv(rows, columns) {
  const values = Array.isArray(rows) ? rows : [];
  const keys = columns ?? [...new Set(values.flatMap((row) => Object.keys(row ?? {})))];
  const definitions = keys.map((column) => typeof column === 'string'
    ? { key: column, label: column }
    : { ...column, label: column.label ?? column.header ?? column.key });
  if (!definitions.length) return '\uFEFF';
  const lines = [definitions.map((column) => csvCell(column.label)).join(',')];
  for (const row of values) {
    lines.push(definitions.map((column) => csvCell(
      typeof column.value === 'function' ? column.value(row) : row?.[column.key],
    )).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function exportPartnersCsv(partners) {
  return toCsv(partners, [
    { key: 'businessNumber', label: '사업자등록번호', value: (row) => formatBusinessNumber(row.businessNumber) },
    { key: 'name', label: '업체명' },
    { key: 'tags', label: '태그' },
    { key: 'note', label: '메모' },
    { key: 'checkedAt', label: '최종조회', value: (row) => row.lastCheck?.checkedAt ?? '' },
    { key: 'outcome', label: '조회결과', value: (row) => row.lastCheck?.outcome ?? '' },
    { key: 'status', label: '사업상태', value: (row) => row.lastSuccess?.statusLabel ?? '' },
    { key: 'taxType', label: '과세유형', value: (row) => row.lastSuccess?.taxType ?? '' },
  ]);
}

function canonicalSource(snapshot) {
  const source = snapshot?.source;
  if (typeof source === 'object' && source !== null) {
    const url = source.url || snapshot?.sourceUrl;
    if (typeof url === 'string' && url.trim()) return url.trim().replace(/\/$/, '');
    return typeof source.name === 'string' ? source.name.trim() : '';
  }
  if (typeof snapshot?.sourceUrl === 'string' && snapshot.sourceUrl.trim()) {
    return snapshot.sourceUrl.trim().replace(/\/$/, '');
  }
  return typeof source === 'string' ? source.trim() : '';
}

function validTime(value) {
  if (value == null || value === '') return null;
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function isoTime(value, fallback) {
  return new Date(validTime(value) ?? validTime(fallback) ?? Date.now()).toISOString();
}

function stableId(prefix, values) {
  // Keep the full encoded identity; no probabilistic hash collisions.
  return `${prefix}:${encodeURIComponent(JSON.stringify(values))}`;
}

function checkIdentity(snapshot) {
  return stableId('check', [
    normalizeBusinessNumber(snapshot.businessNumber), canonicalSource(snapshot),
    snapshot.checkedAt, snapshot.outcome, snapshot.businessStatus,
    snapshot.statusLabel ?? '', snapshot.taxType ?? '', snapshot.closedAt ?? '',
    snapshot.message ?? '',
  ]);
}

function successful(snapshot) {
  return snapshot?.outcome === 'ok';
}

function sameBusiness(snapshot, number) {
  return normalizeBusinessNumber(snapshot?.businessNumber) === number;
}

function previousComparable(partner, snapshot) {
  const source = canonicalSource(snapshot);
  if (!source) return null;
  return [partner.lastSuccess, ...(Array.isArray(partner.history) ? partner.history : [])]
    .filter((entry) => successful(entry)
      && sameBusiness(entry, snapshot.businessNumber)
      && canonicalSource(entry) === source
      && (validTime(entry.checkedAt) ?? -Infinity) <= (validTime(snapshot.checkedAt) ?? Infinity))
    .sort((left, right) => (validTime(right.checkedAt) ?? 0) - (validTime(left.checkedAt) ?? 0))[0] ?? null;
}

function statusLabel(snapshot) {
  return snapshot?.statusLabel || STATUS_LABELS[snapshot?.businessStatus] || STATUS_LABELS.unknown;
}

/**
 * Immutable reconciliation. History is newest-first; failures never overwrite
 * lastSuccess. Events only compare successful, known statuses for the same
 * full business number and canonical source. Older responses cannot roll back
 * a newer check, and retrying a stored response is idempotent.
 */
export function applyCheckResults(partners, results, now = new Date()) {
  const fallbackTime = isoTime(now);
  const grouped = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const businessNumber = normalizeBusinessNumber(result?.businessNumber);
    if (!/^\d{10}$/.test(businessNumber)) continue;
    const outcome = OUTCOMES.has(result?.outcome) ? result.outcome : 'error';
    const businessStatus = outcome === 'ok' && KNOWN_STATUSES.has(result.businessStatus)
      ? result.businessStatus : 'unknown';
    const snapshot = {
      ...result,
      businessNumber,
      outcome,
      businessStatus,
      statusLabel: outcome === 'ok' ? (result.statusLabel || STATUS_LABELS[businessStatus]) : STATUS_LABELS.unknown,
      checkedAt: isoTime(result.checkedAt, fallbackTime),
    };
    snapshot.id = checkIdentity(snapshot);
    if (!grouped.has(businessNumber)) grouped.set(businessNumber, []);
    grouped.get(businessNumber).push(snapshot);
  }
  for (const snapshots of grouped.values()) {
    snapshots.sort((left, right) => Date.parse(left.checkedAt) - Date.parse(right.checkedAt));
  }

  const events = [];
  const emitted = new Set();
  const updated = (Array.isArray(partners) ? partners : []).map((original) => {
    const businessNumber = normalizeBusinessNumber(original.businessNumber);
    const incoming = grouped.get(businessNumber);
    if (!incoming?.length) return original;
    let partner = { ...original, history: [...(Array.isArray(original.history) ? original.history : [])].slice(0, MAX_HISTORY_ENTRIES) };
    for (const snapshot of incoming) {
      if ((validTime(snapshot.checkedAt) ?? 0) < (validTime(partner.lastCheck?.checkedAt) ?? 0)) continue;
      if ([partner.lastCheck, ...partner.history].some((entry) => entry && checkIdentity(entry) === snapshot.id)) continue;

      const previous = previousComparable(partner, snapshot);
      if (successful(snapshot)
        && KNOWN_STATUSES.has(snapshot.businessStatus)
        && previous && KNOWN_STATUSES.has(previous.businessStatus)
        && previous.businessStatus !== snapshot.businessStatus) {
        const from = previous.businessStatus;
        const to = snapshot.businessStatus;
        const id = stableId('business-status', [
          partner.id ?? businessNumber, businessNumber, canonicalSource(snapshot),
          previous.checkedAt, from, snapshot.checkedAt, to,
        ]);
        if (!emitted.has(id)) {
          emitted.add(id);
          events.push({
            id,
            partnerId: partner.id,
            businessNumber,
            source: snapshot.source,
            sourceUrl: snapshot.sourceUrl ?? (typeof snapshot.source === 'object' ? snapshot.source?.url : undefined),
            type: 'business_status_changed',
            from,
            to,
            occurredAt: snapshot.checkedAt,
            title: `${partner.name || formatBusinessNumber(businessNumber)} 사업자 상태 변경`,
            message: `${statusLabel(previous)} → ${statusLabel(snapshot)}. 동일 출처의 정상 조회 결과를 비교했습니다.`,
          });
        }
      }

      partner.lastCheck = snapshot;
      if (successful(snapshot)) partner.lastSuccess = snapshot;
      partner.history = [snapshot, ...partner.history].slice(0, MAX_HISTORY_ENTRIES);
    }
    return partner;
  });
  return { partners: updated, events };
}

/** Evidence-based operational prompts; deliberately no credit or safety score. */
export function buildInsights(partner) {
  const insights = [];
  const number = normalizeBusinessNumber(partner?.businessNumber);
  const check = sameBusiness(partner?.lastCheck, number) ? partner.lastCheck : null;
  const lastSuccess = successful(partner?.lastSuccess) && sameBusiness(partner.lastSuccess, number)
    ? partner.lastSuccess : null;
  if (!check) {
    insights.push({
      id: 'check-needed', tone: 'neutral', title: '사업자 상태를 확인해 보세요',
      description: '번호 형식 검증은 실제 등록 여부를 확인한 결과가 아닙니다. 공식 조회 결과를 받아 확인할 수 있습니다.',
      action: '상태 조회',
    });
  } else if (check.outcome === 'not_configured') {
    insights.push({
      id: 'connection-needed', tone: 'neutral', title: '실시간 조회 연결이 필요합니다',
      description: '공식 조회 결과를 아직 받지 못했습니다. 연결 설정을 확인한 뒤 다시 조회하세요.',
      action: '연결 설정 확인',
    });
  } else if (check.outcome === 'error') {
    insights.push({
      id: 'check-failed', tone: 'warning', title: '최근 조회를 완료하지 못했습니다',
      description: lastSuccess
        ? '이전 정상 조회 정보는 유지됩니다. 아래 사업자 상태는 마지막으로 성공한 조회 시점의 결과입니다.'
        : '이번 조회 실패로 현재 사업자 상태를 판단할 수 없습니다. 잠시 후 다시 조회하세요.',
      action: '다시 조회',
    });
  } else if (check.outcome === 'not_found') {
    insights.push({
      id: 'record-not-found', tone: 'warning', title: '조회에서 등록 정보를 찾지 못했습니다',
      description: '사업자번호와 원본 등록정보를 다시 확인하세요. 조회되지 않은 결과를 폐업으로 해석하지 않습니다.',
      action: '사업자번호 확인',
    });
  }

  if (lastSuccess && KNOWN_STATUSES.has(lastSuccess.businessStatus)) {
    const state = lastSuccess.businessStatus;
    const checkedAt = lastSuccess.checkedAt || '기준일 미확인';
    insights.push({
      id: `status-${state}`,
      tone: state === 'active' ? 'neutral' : 'warning',
      title: `마지막 정상 조회: ${statusLabel(lastSuccess)}`,
      description: state === 'closed'
        ? `${checkedAt} 조회 결과입니다.${lastSuccess.closedAt ? ` 폐업일: ${lastSuccess.closedAt}.` : ''} 진행 중인 거래의 계약·증빙 정보를 확인하세요.`
        : state === 'suspended'
          ? `${checkedAt} 조회 결과입니다. 현재 업무 진행 여부와 거래 일정을 거래처에 확인하세요.`
          : `${checkedAt} 조회 결과입니다. 사업자등록 상태만을 나타내며 거래 이행 능력을 평가한 결과는 아닙니다.`,
      action: state === 'active' ? '조회 결과 보기' : '거래처에 확인',
    });
  } else if (check?.outcome === 'ok') {
    insights.push({
      id: 'status-unknown', tone: 'neutral', title: '사업자 상태를 확정하지 못했습니다',
      description: '응답에서 해석할 수 있는 상태가 확인되지 않았습니다. 원문 조회 결과와 등록정보를 확인하세요.',
      action: '조회 결과 확인',
    });
  }

  if (lastSuccess?.taxType) {
    insights.push({
      id: 'tax-type', tone: 'neutral', title: `조회된 과세유형: ${lastSuccess.taxType}`,
      description: '마지막 정상 조회 기준입니다. 필요한 거래 증빙은 실제 거래조건과 함께 확인하세요.',
      action: '증빙 정보 확인',
    });
  }
  return insights;
}
