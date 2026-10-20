// Public notice metadata only. Search relevance is never an eligibility decision.
export const safeHttpUrl = value => {
  try { const u = new URL(String(value || '')); return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; }
};
export const textOnly = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\s+/g, ' ').trim();
const list = value => [...new Set((Array.isArray(value) ? value : []).map(textOnly).filter(Boolean))];
export const koreanToday = (now = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now);
export function strictDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? value : null;
}
const conditionalPeriod = /예산.{0,12}소진|상시|수시|추후|미정|선착순|모집.{0,8}완료/;
export function normalizeProgram(row) {
  if (!row || typeof row !== 'object') return null;
  const id = textOnly(row.id), title = textOnly(row.title || row.fullTitle), sourceUrl = safeHttpUrl(row.sourceUrl);
  if (!id || !title || !sourceUrl || id.length > 160) return null;
  const region = textOnly(row.region);
  const regions = list(row.regions);
  if (!regions.length && region && !['지역 확인', '복수지역', '전체'].includes(region)) regions.push(region);
  const periodText = textOnly(row.periodText).slice(0, 300);
  const conditional = row.conditionalPeriod === true || row.budgetLimited === true || conditionalPeriod.test(periodText);
  const source = textOnly(row.source || ({ bizinfo: '기업마당', npay: 'Npay 마이비즈' }[row.sourceProvider]) || '지원한눈 공개 목록');
  return {
    id, title: title.slice(0, 800), agency: textOnly(row.agency).slice(0, 400), source, sourceUrl,
    ...(safeHttpUrl(row.applyUrl || row.application) ? { applyUrl: safeHttpUrl(row.applyUrl || row.application) } : {}),
    regions, categories: list(row.categories || [row.category]).slice(0, 20),
    industryTags: list(row.industryTags || row.industries).slice(0, 40),
    regionSoft: row.regionSoft !== false,
    startDate: strictDate(row.startDate || row.start), endDate: conditional ? null : strictDate(row.endDate || row.end),
    ...(periodText ? { periodText } : {}), conditionalPeriod: conditional,
    ...(typeof row.sourceActive === 'boolean' ? { sourceActive: row.sourceActive } : {}),
    publishedAt: strictDate(row.publishedAt || row.published), checkedAt: textOnly(row.checkedAt).slice(0, 40),
  };
}
export function periodState(program, today = koreanToday()) {
  if (program.sourceActive === false) return 'closed';
  if (!program.conditionalPeriod && strictDate(program.endDate) && program.endDate < today) return 'closed';
  if (strictDate(program.startDate) && program.startDate > today) return 'upcoming';
  if (!program.conditionalPeriod && strictDate(program.endDate)) return 'open';
  return 'unknown';
}
export async function loadPrograms({ fetcher = globalThis.fetch, url = new URL('../data/programs.json', import.meta.url) } = {}) {
  const response = await fetcher(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error('지원사업 목록을 불러오지 못했습니다.');
  const data = await response.json();
  if (!data || !Array.isArray(data.programs)) throw new Error('지원사업 자료 형식을 확인할 수 없습니다.');
  const seen = new Set();
  const programs = data.programs.map(normalizeProgram).filter(p => p && !seen.has(p.id) && seen.add(p.id));
  return { programs, meta: { ...(data.meta || {}), loadedCount: programs.length } };
}
const norm = value => textOnly(value).normalize('NFKC').toLocaleLowerCase('ko').replace(/\s/g, '');
const hasValue = value => value !== null && value !== undefined && String(value).trim() !== '';
export function rankPrograms(programs, profile = {}, { query = '', category = '', openOnly = true, today = koreanToday() } = {}) {
  profile ||= {};
  const tokens = textOnly(query).toLocaleLowerCase('ko').split(/\s+/).filter(Boolean);
  const result = [];
  for (const input of Array.isArray(programs) ? programs : []) {
    const p = normalizeProgram(input);
    if (!p || (openOnly && periodState(p, today) === 'closed')) continue;
    if (category && category !== '전체' && !p.categories.includes(category)) continue;
    const hay = [p.title, p.agency, p.source, ...p.regions, ...p.categories, ...p.industryTags].join(' ').toLocaleLowerCase('ko');
    if (!tokens.every(t => hay.includes(t))) continue;
    const reasons = [], missing = ['업력·기업 규모·제외조건은 공고 원문에서 확인해야 합니다.'];
    let relevance = 0, mismatch = false;
    const regionMatch = p.regions.some(r => r === '전국' || norm(r) === norm(profile.region));
    if (!hasValue(profile.region)) missing.push('사업장 지역을 입력해 주세요.');
    else if (!p.regions.length) missing.push('공고의 대상 지역이 명확하지 않습니다.');
    else if (regionMatch) { relevance++; reasons.push(p.regionSoft ? '입력 지역과 검색 분류가 관련됩니다. 소재지 요건은 원문 확인이 필요합니다.' : '공고에 표시된 지역 조건과 일치합니다.'); }
    else if (p.regionSoft) missing.push('지역 검색 분류가 다릅니다. 신청 제외 여부는 원문 확인이 필요합니다.');
    else { mismatch = true; reasons.push('공고에 표시된 대상 지역과 입력 지역이 다릅니다.'); }
    if (!hasValue(profile.industry)) missing.push('사업 업종을 입력해 주세요.');
    if (!p.industryTags.length) missing.push('공개 목록에 확정된 대상 업종 정보가 없습니다.');
    else if (hasValue(profile.industry) && p.industryTags.some(t => norm(t) === norm(profile.industry))) { relevance++; reasons.push('입력 업종과 공고 업종 분류가 관련됩니다.'); }
    else if (hasValue(profile.industry)) missing.push('대상 업종과 입력 업종의 관계를 원문에서 확인해 주세요.');
    if (list(profile.interests).some(i => p.categories.some(c => norm(c) === norm(i)))) { relevance++; reasons.push('선택한 관심 분야에 해당하는 공고입니다.'); }
    if (!hasValue(profile.foundedAt)) missing.push('개업일이 입력되지 않았습니다.');
    if (!hasValue(profile.employees)) missing.push('상시근로자 수가 입력되지 않았습니다.');
    if (!hasValue(profile.revenue)) missing.push('매출 정보가 입력되지 않았습니다.');
    const period = periodState(p, today);
    if (period === 'closed') reasons.push('표시된 신청 기간 또는 제공처 상태 기준으로 마감된 공고입니다.');
    if (period === 'upcoming') reasons.push('접수 시작일 전입니다.');
    if (period === 'unknown') missing.push('확정된 마감일이 없어 접수 가능 여부를 원문에서 확인해야 합니다.');
    if (!reasons.length) reasons.push('공개 목록의 제목·기관·원문 링크를 확인할 수 있습니다.');
    result.push({ program: p, assessment: mismatch ? 'mismatch' : relevance ? 'candidate' : 'unknown', reasons, missing: [...new Set(missing)], relevance });
  }
  const order = { candidate: 0, unknown: 1, mismatch: 2 };
  return result.sort((a, b) => order[a.assessment] - order[b.assessment] || b.relevance - a.relevance || (b.program.publishedAt || '').localeCompare(a.program.publishedAt || '')).map(({ relevance, ...item }) => item);
}
