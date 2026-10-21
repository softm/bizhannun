import { isValidBusinessNumber, normalizeBusinessNumber } from './domain.mjs';
import { normalizeEnrichment, summarizeEnrichment } from './enrichment.mjs';

const channelNames = {
  public_data: '공공데이터', registry: '공개 등록자료', official_website: '공식 웹사이트',
  website: '웹사이트', directory: '민간 기업정보', news: '뉴스·보도', jobs: '채용',
  social: 'SNS', commerce: '커머스', user_document: '제공 자료',
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nameText = value => typeof value === 'string' ? value.trim().slice(0, 200) : '';

/** A summary's profile alone is not identity evidence. Reconstruct attributable observations. */
function recordFromSummary(summary) {
  if (!object(summary)) return null;
  const fields = Array.isArray(summary.fields) ? summary.fields.slice(0, 12000) : [];
  const observations = [];
  for (const field of fields) {
    if (observations.length >= 12000) break;
    if (!object(field)) continue;
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
 * One canonical number-based projection for search results, saved counterparties and history.
 * This never mutates or silently replaces a user's name, notes, tags or stored public evidence.
 */
export function resolveBusinessProfile({ businessNumber, partner = null, record = null, summary = null } = {}) {
  const number = normalizeBusinessNumber(businessNumber);
  const validNumber = isValidBusinessNumber(number);
  const matchedPartner = validNumber && object(partner)
    && normalizeBusinessNumber(partner.businessNumber) === number ? partner : null;
  const normalized = record !== null ? normalizeEnrichment(record) : recordFromSummary(summary);
  const matchedRecord = validNumber && normalized?.businessNumber === number ? normalized : null;
  const linkedSummary = matchedRecord ? summarizeEnrichment(matchedRecord) : null;
  const userName = nameText(matchedPartner?.name);
  const publicName = nameText(linkedSummary?.profile?.name);
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
    hasPublicRecord: Boolean(matchedRecord),
    identityMatched: Boolean(linkedSummary?.confirmedCount),
    summary: linkedSummary,
  };
}
