import { isValidBusinessNumber, normalizeBusinessNumber } from './domain.mjs';
import { ENRICHMENT_FIELDS, normalizeEnrichment, summarizeEnrichment } from './enrichment.mjs';

const MATCH_RANK = { candidate: 0, confirmed_domain: 1, exact_bno: 2 };
const MAX_SNAPSHOT_BYTES = 8_000_000;
const plainObject = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const stamp = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const cleanName = value => typeof value === 'string' ? value.trim().slice(0, 200) : '';
const matchError = () => new Error('공개정보의 사업자번호가 거래처와 일치하지 않습니다.');

/** One private snapshot belongs to exactly one BRN; backup imports cannot change that link. */
export function normalizePartnerEnrichment(input, number) {
  const businessNumber = normalizeBusinessNumber(number);
  if (!isValidBusinessNumber(businessNumber) || !plainObject(input)) throw matchError();
  if (input.businessNumber != null && input.bno != null
    && normalizeBusinessNumber(input.businessNumber) !== normalizeBusinessNumber(input.bno)) throw matchError();
  if (!Array.isArray(input.sources) || input.sources.length > 1200
    || !Array.isArray(input.fields) || input.fields.length > 12000
    || !input.sources.every(plainObject) || !input.fields.every(plainObject)) {
    throw new Error('저장할 공개정보의 출처와 항목 형식을 확인해 주세요.');
  }
  let serialized;
  try { serialized = JSON.stringify(input); } catch { throw new Error('저장할 공개정보의 형식을 확인해 주세요.'); }
  if (new TextEncoder().encode(serialized).length > MAX_SNAPSHOT_BYTES) {
    throw new Error('사업자 공개정보는 한 거래처당 8MB 이하만 보관할 수 있습니다.');
  }
  const record = normalizeEnrichment(input);
  if (!record || record.businessNumber !== businessNumber) throw matchError();
  return record;
}

/** Unknown legacy names remain user names. Public name provenance must point to its exact fact. */
export function normalizePartnerNameOrigin(origin, name, record) {
  if (origin == null) return null;
  if (!plainObject(origin) || !['user', 'public'].includes(origin.kind)) {
    throw new Error('저장된 거래처 이름의 출처 형식을 확인해 주세요.');
  }
  if (origin.kind === 'user') return { kind: 'user' };
  const source = record?.sources?.find(item => item.id === origin.sourceId && Object.hasOwn(MATCH_RANK, item.match));
  const field = source && record?.fields?.find(item => item.field === 'name' && Object.hasOwn(MATCH_RANK, item.match)
    && item.sourceId === origin.sourceId && item.value === origin.value && item.value === name);
  // Editing an imported/automatic name makes it a user label, never a false source assertion.
  return field ? { kind: 'public', value: field.value, sourceId: field.sourceId } : { kind: 'user' };
}

/** The UI calls this for a user edit; an unchanged auto-filled name keeps its attribution. */
export function setPartnerName(partner, value) {
  const name = cleanName(value);
  const origin = name === partner?.name
    ? normalizePartnerNameOrigin(partner?.nameOrigin, name, partner?.enrichment) : null;
  return { ...partner, name, nameOrigin: origin || { kind: 'user' } };
}

function mergeEvidence(previous, incoming) {
  if (!previous) return incoming;
  // Reviewed web imports and automatic collectors can assign different IDs to one page.
  // Registry APIs, in contrast, can expose several distinct records under one documentation URL.
  const historical = source => source.id.startsWith('historical-reviewed-');
  const key = source => historical(source) || ['public_data', 'registry'].includes(source.channel) ? `id:${source.id}` : `url:${source.url}`;
  const oldSources = new Map(previous.sources.map(source => [key(source), source]));
  const newSources = new Map(incoming.sources.map(source => [key(source), source]));
  const revoked = new Map();
  for (const status of [...(previous.collection?.sourceStatuses || []), ...(incoming.collection?.sourceStatuses || [])]) {
    // A network error or omitted number is not evidence of a different company.
    // This explicit collector code identifies an entity-scope correction for a particular page.
    if (status.provider === 'web_page' && status.status === 'identity_mismatch'
      && status.errorCode === 'entity_scope_mismatch' && status.sourceUrl && stamp(status.checkedAt)) {
      revoked.set(status.sourceUrl, Math.max(revoked.get(status.sourceUrl) || 0, stamp(status.checkedAt)));
    }
  }
  // A durable scope rejection can outlive the latest per-request error status.
  // Without its original correction status, require evidence newer than that retained envelope.
  for (const record of [previous, incoming]) for (const source of record.sources) {
    if (source.identityMismatch === true && !revoked.has(source.url)) {
      revoked.set(source.url, stamp(record.collection?.lastAttemptAt) || stamp(source.collectedAt));
    }
  }
  const rawObservation = (source, record) => {
    if (!source) return { source: null, fields: [] };
    const fields = record.fields.filter(field => field.sourceId === source.id);
    const invalidated = revoked.has(source.url) && stamp(source.collectedAt) <= revoked.get(source.url);
    return invalidated ? { source: { ...source, match: 'candidate', identityMismatch: true },
      fields: fields.map(field => ({ ...field, match: 'candidate' })) } : { source, fields };
  };
  const refreshedFields = new Map();
  for (const source of incoming.sources.filter(source => !historical(source))) {
    const next = rawObservation(source, incoming);
    if (next.source.match === 'candidate' || !stamp(next.source.collectedAt)) continue;
    const fields = refreshedFields.get(source.url) || new Map();
    for (const field of next.fields.filter(field => field.match !== 'candidate')) {
      fields.set(field.field, Math.max(fields.get(field.field) || 0, stamp(next.source.collectedAt)));
    }
    refreshedFields.set(source.url, fields);
  }
  const observation = (source, record) => {
    const result = rawObservation(source, record);
    if (!source || !historical(source)) return result;
    const refreshed = refreshedFields.get(source.url);
    result.fields = result.fields.filter(field => !refreshed?.has(field.field)
      || refreshed.get(field.field) < stamp(source.collectedAt));
    // Do not resurrect historical values intentionally retired by the collector.
    return result.fields.length ? result : { source: null, fields: [] };
  };
  const chosen = [];
  let retained = false;
  // A source and its fields are an atomic observation. Do not attach old values to a new date.
  for (const id of new Set([...newSources.keys(), ...oldSources.keys()])) {
    const { source: old, fields: oldFields } = observation(oldSources.get(id), previous);
    const { source: next, fields: newFields } = observation(newSources.get(id), incoming);
    const keepOld = old && (!next || stamp(old.collectedAt) > stamp(next.collectedAt)
      || MATCH_RANK[old.match] > MATCH_RANK[next.match]
      || (oldFields.some(field => field.match !== 'candidate') && !newFields.some(field => field.match !== 'candidate')));
    if (keepOld) { chosen.push({ source: old, fields: oldFields }); retained ||= Boolean(next); }
    else if (next) chosen.push({ source: next, fields: newFields });
  }
  const latestAttempt = stamp(incoming.collection?.lastAttemptAt) >= stamp(previous.collection?.lastAttemptAt)
    ? incoming.collection : previous.collection;
  const collection = latestAttempt ? { ...latestAttempt } : null;
  if (retained && collection?.status === 'success') collection.status = 'partial';
  if (collection) {
    const corrections = new Map();
    for (const status of [...(previous.collection?.sourceStatuses || []), ...(incoming.collection?.sourceStatuses || [])]) {
      if (status.provider !== 'web_page' || status.status !== 'identity_mismatch' || status.errorCode !== 'entity_scope_mismatch') continue;
      if (!chosen.some(item => item.source.url === status.sourceUrl && item.source.match === 'candidate'
        && stamp(item.source.collectedAt) <= stamp(status.checkedAt))) continue;
      if (stamp(status.checkedAt) >= stamp(corrections.get(status.sourceUrl)?.checkedAt)) corrections.set(status.sourceUrl, status);
    }
    collection.sourceStatuses = [...corrections.values(), ...(collection.sourceStatuses || []).filter(status =>
      !(status.provider === 'web_page' && status.status === 'identity_mismatch' && corrections.has(status.sourceUrl)))].slice(0, 80);
  }
  return normalizePartnerEnrichment({
    ...previous, ...incoming,
    entityType: incoming.entityType === 'unknown' ? previous.entityType : incoming.entityType,
    officialDomain: incoming.officialDomain || previous.officialDomain,
    collectedAt: stamp(incoming.collectedAt) >= stamp(previous.collectedAt) ? incoming.collectedAt : previous.collectedAt,
    sources: chosen.map(item => item.source), fields: chosen.flatMap(item => item.fields),
    ...(collection ? { collection } : {}),
  }, previous.businessNumber);
}

function connectedRecord(partner, latestRecord) {
  const number = normalizeBusinessNumber(partner?.businessNumber);
  if (!isValidBusinessNumber(number)) throw new Error('올바른 거래처 사업자번호가 필요합니다.');
  const previous = partner?.enrichment == null ? null : normalizePartnerEnrichment(partner.enrichment, number);
  const incoming = latestRecord == null ? null : normalizePartnerEnrichment(latestRecord, number);
  return incoming ? mergeEvidence(previous, incoming) : previous;
}

/** Save public evidence separately from private notes and preserve a deliberately entered name. */
export function attachPartnerEnrichment(partner, latestRecord, { now = new Date().toISOString() } = {}) {
  const enrichment = connectedRecord(partner, latestRecord);
  if (!enrichment) return { ...partner };
  const summary = summarizeEnrichment(enrichment);
  const previousOrigin = normalizePartnerNameOrigin(partner.nameOrigin, partner.name, partner.enrichment);
  const canFillName = !cleanName(partner.name) || previousOrigin?.kind === 'public';
  const nameField = summary.fields.find(field => field.field === 'name');
  const next = { ...partner, enrichment };
  if (canFillName && nameField) {
    next.name = nameField.value;
    next.nameOrigin = { kind: 'public', value: nameField.value, sourceId: nameField.sourceId };
  } else if (previousOrigin?.kind === 'public' && !nameField) {
    // An automatic label must not become a purported user alias after its identity is withdrawn.
    // The original value remains in the candidate evidence for review.
    next.name = '';
    delete next.nameOrigin;
  } else if (previousOrigin) next.nameOrigin = normalizePartnerNameOrigin(previousOrigin, partner.name, enrichment);
  if (JSON.stringify(next) !== JSON.stringify(partner)) {
    if (!Number.isFinite(Date.parse(now))) throw new Error('공개정보 저장시각을 확인해 주세요.');
    next.updatedAt = new Date(now).toISOString();
  }
  return next;
}

const PROFILE_CHECKS = [
  { field: 'name', label: '공개 상호', any: ['name'] },
  { field: 'address', label: '사업장 주소', any: ['address'] },
  { field: 'industry', label: '업종·사업 분야', any: ['industry', 'businessType', 'businessCategory'] },
  { field: 'website', label: '공개 웹사이트', any: ['website'] },
  { field: 'contact', label: '공개 업무 연락처', any: ['phone', 'email'] },
];

function evidenceState(summary, { now = Date.now(), staleDays = 30 } = {}) {
  const today = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(today) || !Number.isFinite(staleDays) || staleDays < 1) {
    throw new Error('정보 확인 기준일과 갱신 기간을 확인해 주세요.');
  }
  const fields = summary?.fields || [], sources = summary?.sources || [];
  const byId = new Map(sources.map(source => [source.id, source]));
  const missingFields = PROFILE_CHECKS.filter(check => !check.any.some(field => summary?.profile?.[field]))
    .map(({ field, label }) => ({ field, label }));
  const conflicts = fields.filter(field => field.conflict);
  const dated = fields.map(field => ({ field, source: byId.get(field.sourceId) }))
    .filter(item => stamp(item.source?.collectedAt));
  const staleFields = dated.filter(item => today - stamp(item.source.collectedAt) >= staleDays * 86_400_000);
  const dates = dated.map(item => item.source.collectedAt).sort((a, b) => stamp(a) - stamp(b));
  const metrics = {
    fieldCount: fields.length, sourceCount: sources.length,
    confirmedCount: summary?.confirmedCount || 0, candidateCount: summary?.candidateCount || 0,
    conflictCount: conflicts.length, staleCount: staleFields.length, undatedCount: fields.length - dated.length,
    missingCount: missingFields.length, coverageCount: PROFILE_CHECKS.length - missingFields.length,
    coverageTotal: PROFILE_CHECKS.length, oldestCollectedAt: dates[0] || null,
    latestCollectedAt: dates.at(-1) || null, collectionStatus: summary?.collection?.status || 'not_collected',
  };
  const insights = [];
  if (conflicts.length) insights.push({ id: 'public-conflicts', tone: 'warning',
    title: `출처별로 다른 정보 ${conflicts.length}개`,
    description: `${conflicts.map(field => ENRICHMENT_FIELDS[field.field] || field.field).join(' · ')} 값이 출처마다 다릅니다. 최신 등록자료와 각 원문을 대조하세요.`,
    action: '다른 출처 값 확인', fields: conflicts.map(field => field.field),
    sourceIds: [...new Set(conflicts.flatMap(field => [field.sourceId, ...field.alternatives.map(item => item.sourceId)]))] });
  if (staleFields.length) insights.push({ id: 'public-stale', tone: 'neutral',
    title: `${staleDays}일 이상 지난 확인 정보 ${staleFields.length}개`,
    description: '각 항목의 원래 확인일을 기준으로 계산했습니다. 수집 실행일이 최근이어도 과거 자료의 확인일은 바뀌지 않습니다.',
    action: '자료 새로고침', sourceIds: [...new Set(staleFields.map(item => item.field.sourceId))] });
  if (['failed', 'partial'].includes(summary?.collection?.status)) insights.push({ id: 'public-collection', tone: 'neutral',
    title: summary.collection.status === 'failed' ? '최근 추가 수집을 완료하지 못했습니다' : '일부 출처의 갱신을 확인해 주세요',
    description: '확보한 자료는 각 출처의 확인일과 함께 보관합니다. 수집 실패를 사업자의 영업 상태 변화로 해석하지 않습니다.',
    action: '수집 현황 확인', sourceIds: [] });
  const identityCorrections = (summary?.collection?.sourceStatuses || []).filter(status => status.provider === 'web_page'
    && status.status === 'identity_mismatch' && status.errorCode === 'entity_scope_mismatch'
    && sources.some(source => source.url === status.sourceUrl && source.match === 'candidate'
      && stamp(source.collectedAt) <= stamp(status.checkedAt)));
  if (identityCorrections.length) insights.unshift({ id: 'public-identity-review', tone: 'warning',
    title: '동일 사업자 연결을 다시 확인할 자료가 있습니다',
    description: '페이지의 다른 업체나 운영사 정보가 섞인 것으로 확인된 출처는 확정 정보에서 제외하고 후보 자료로 보관합니다. 원문과 사업자번호를 다시 대조하세요.',
    action: '후보 출처 확인', sourceIds: sources.filter(source => identityCorrections.some(status => status.sourceUrl === source.url)).map(source => source.id) });
  if (missingFields.length) insights.push({ id: 'public-missing', tone: 'neutral',
    title: `기본 공개정보 ${PROFILE_CHECKS.length}종 중 ${PROFILE_CHECKS.length - missingFields.length}종 확인`,
    description: `아직 연결하지 못한 항목: ${missingFields.map(field => field.label).join(' · ')}. 자료 부족은 거래처의 신용이나 영업 상태를 의미하지 않습니다.`,
    action: '공개정보 수집 요청', fields: missingFields.map(field => field.field), sourceIds: [] });
  if (metrics.candidateCount) insights.push({ id: 'public-candidates', tone: 'neutral',
    title: `동일 업체인지 확인할 자료 ${metrics.candidateCount}곳`,
    description: '상호가 같거나 관련 링크에서 찾은 후보입니다. 사업자번호·주소·공식 채널 연결을 확인한 뒤 정보를 반영합니다.',
    action: '후보 출처 확인', sourceIds: (summary?.candidates || []).map(source => source.id) });
  return { metrics, insights, missingFields };
}

/** Shared view model for lookup, saved-partner lists, and partner details. Never mutates or saves. */
export function derivePartnerProfile(partner, latestRecord = null, options = {}) {
  const record = connectedRecord(partner, latestRecord);
  const summary = record ? summarizeEnrichment(record) : null;
  const savedName = cleanName(partner.name), publicName = summary?.profile?.name || '';
  const origin = normalizePartnerNameOrigin(partner.nameOrigin, partner.name, partner.enrichment);
  const publicDisplay = !savedName || origin?.kind === 'public';
  const name = publicDisplay ? publicName : savedName;
  const nameField = summary?.fields.find(field => field.field === 'name');
  const nameSource = publicDisplay && publicName
    ? summary.sources.find(source => source.id === nameField.sourceId) : null;
  const state = evidenceState(summary, options);
  if (!publicDisplay && publicName && savedName.normalize('NFKC').replace(/\s+/g, '') !== publicName.normalize('NFKC').replace(/\s+/g, '')) {
    state.insights.unshift({ id: 'public-name-difference', tone: 'neutral', title: '저장한 이름과 공개 상호가 다릅니다',
      description: `저장한 이름: ${savedName} · 공개 상호: ${publicName}. 별칭일 수 있으므로 사용자 입력을 그대로 보관합니다.`,
      action: '상호와 출처 대조', fields: ['name'], sourceIds: nameField ? [nameField.sourceId] : [] });
  }
  return { businessNumber: normalizeBusinessNumber(partner.businessNumber), name, publicName,
    nameSourceLabel: nameSource ? nameSource.title : !publicDisplay && savedName ? '사용자 입력' : '이름 미확인',
    record, summary, profile: summary?.profile || {}, fields: summary?.fields || [], ...state };
}


const channelNames = {
  public_data: '공공데이터', registry: '공개 등록자료', official_website: '공식 웹사이트',
  website: '웹사이트', directory: '민간 기업정보', news: '뉴스·보도', jobs: '채용',
  social: 'SNS', commerce: '커머스', user_document: '제공 자료',
};

/** A summary's profile alone is not identity evidence. Reconstruct attributable observations. */
function recordFromSummary(summary) {
  if (!plainObject(summary)) return null;
  const fields = Array.isArray(summary.fields) ? summary.fields.slice(0, 12000) : [];
  const observations = [];
  for (const field of fields) {
    if (observations.length >= 12000) break;
    if (!plainObject(field)) continue;
    observations.push(field);
    if (Array.isArray(field.alternatives)) observations.push(...field.alternatives.slice(0, Math.min(1200, 12000 - observations.length)));
  }
  if (Array.isArray(summary.candidateFields)) observations.push(...summary.candidateFields.slice(0, 12000 - observations.length));
  return normalizeEnrichment({
    businessNumber: summary.businessNumber,
    entityType: summary.entityType,
    officialDomain: summary.officialDomain,
    collectedAt: summary.collectedAt,
    sources: summary.sources,
    fields: observations,
    collection: summary.collection,
  });
}

/**
 * One canonical number-based projection for search, saved counterparties, history and CSV.
 * Saved evidence participates in the same atomic merge as partner details; user aliases remain private.
 */
export function resolveBusinessProfile({ businessNumber, partner = null, record = null, summary = null } = {}) {
  const number = normalizeBusinessNumber(businessNumber);
  const validNumber = isValidBusinessNumber(number);
  const matchedPartner = validNumber && plainObject(partner)
    && normalizeBusinessNumber(partner.businessNumber) === number ? partner : null;
  const normalized = record !== null ? normalizeEnrichment(record) : recordFromSummary(summary);
  const matchedRecord = validNumber && normalized?.businessNumber === number ? normalized : null;
  let savedRecord = null, origin = null;
  if (matchedPartner?.enrichment != null) {
    try { savedRecord = normalizePartnerEnrichment(matchedPartner.enrichment, number); } catch { /* Invalid imports cannot supply public identity. */ }
  }
  if (matchedPartner) {
    try { origin = normalizePartnerNameOrigin(matchedPartner.nameOrigin, matchedPartner.name, savedRecord); } catch { /* Unmarked names remain user labels. */ }
  }
  const linkedRecord = matchedRecord ? mergeEvidence(savedRecord, matchedRecord) : savedRecord;
  const linkedSummary = linkedRecord ? summarizeEnrichment(linkedRecord) : null;
  const userName = origin?.kind === 'public' ? '' : cleanName(matchedPartner?.name);
  const publicName = cleanName(linkedSummary?.profile?.name);
  const nameField = linkedSummary?.fields.find(field => field.field === 'name');
  const publicSource = nameField ? linkedSummary.sources.find(source => source.id === nameField.sourceId) : null;
  const publicNameSourceLabel = publicSource
    ? `${channelNames[publicSource.channel] || '웹 자료'} · ${publicSource.title}` : '';
  const nameSource = userName ? 'user' : publicName ? 'public' : 'missing';
  return {
    businessNumber: validNumber ? number : '',
    displayName: userName || publicName || '이름 미입력',
    userName,
    publicName,
    hasCustomName: Boolean(userName && publicName && userName !== publicName),
    nameSource,
    nameSourceLabel: nameSource === 'user' ? '사용자 입력' : publicNameSourceLabel || '연결된 상호 없음',
    nameSourceUrl: nameSource === 'public' ? publicSource?.url || null : null,
    nameCollectedAt: nameSource === 'public' ? publicSource?.collectedAt || null : null,
    publicNameSourceLabel,
    publicNameSourceUrl: publicSource?.url || null,
    publicNameCollectedAt: publicSource?.collectedAt || null,
    nameHasConflict: Boolean(nameField?.conflict),
    nameMatch: nameSource === 'public' ? nameField.match : nameSource === 'user' ? 'user' : null,
    hasPublicRecord: Boolean(linkedRecord),
    identityMatched: Boolean(linkedSummary?.confirmedCount),
    summary: linkedSummary,
  };
}
