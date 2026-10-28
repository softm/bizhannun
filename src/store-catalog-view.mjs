import { safeEnrichmentUrl } from './enrichment.mjs';
import { renderStoreStory, renderStoreListCue } from './store-story.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const count = value => new Intl.NumberFormat('ko-KR').format(integer(value));
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('ko-KR', { timeZone:'Asia/Seoul', dateStyle:'medium', timeStyle:'short' }).format(new Date(value))
  : '기록 없음';
const date = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '기준일 미제공';
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value ? value : '기준일 미제공';
};
const external = (url, label) => {
  const safe = safeEnrichmentUrl(url);
  return safe ? `<a href="${esc(safe)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : esc(label);
};
const sourceName = manifest => manifest?.source?.name || '소상공인시장진흥공단 상가정보';
const regions = manifest => Array.isArray(manifest?.regions) ? manifest.regions : [];
const failedCount = result => Array.isArray(result?.failures) ? result.failures.length : integer(result?.progress?.failedShards);
const foundCount = result => Number.isSafeInteger(result?.total) ? integer(result.total) : integer(result?.foundCount);
const isComplete = result => result?.complete === true && Number.isSafeInteger(result?.total) && result.total >= 0;
const branch = entry => entry?.branchName && entry.branchName !== entry.name ? entry.branchName : '';
const industry = entry => typeof entry?.industry === 'string' ? entry.industry : entry?.industry?.label || entry?.industryName || '';

function resultSummary(result, loading, error) {
  const total = foundCount(result);
  if (loading) return total ? `검색 중 · 현재 ${count(total)}곳 확인` : '상가 명부에서 검색 중';
  if (error || failedCount(result) || !isComplete(result)) return total ? `현재 확인한 결과 ${count(total)}곳 · 검색 미완료` : '검색을 완료하지 못했습니다';
  return `${count(total)}곳`;
}

function coverageFooter(manifest) {
  return `<footer class="store-catalog-foot"><p>${external(manifest?.source?.url, sourceName(manifest))}<span>원천 기준일 <strong>${esc(date(manifest?.sourceDate))}</strong></span></p><details><summary>검색 범위와 갱신 정보</summary><div><p>이름 일부와 <strong>%</strong>·<strong>*</strong>로 검색합니다. 공백·영문 대소문자·앞뒤 법인 표기를 정리하며, 이름과 지역을 함께 입력할 수 있습니다. 초성·오타 보정은 지원하지 않습니다.</p><p>공개 상가 명부에 수록된 업소를 찾습니다. 국내 모든 사업자등록 상호가 포함된 자료는 아니며, 검색 결과로 현재 영업 여부를 판단할 수 없습니다.</p><p>이 자료에는 사업자등록번호가 없습니다. 같은 이름의 업체나 다른 공개자료와 자동으로 연결하지 않습니다.</p><p>실제 자료 수집 <strong>${esc(time(manifest?.collectedAt))}</strong> · 검색 대상 ${count(manifest?.acceptedCount)}곳</p></div></details></footer>`;
}

/** Store IDs identify source rows, never a tax registration or an NTS lookup target. */
export function renderStoreCatalogSearch({ query='', manifest=null, result=null, loading=false, error='', regionCode='', selectedId='', page=1 } = {}) {
  const entries = Array.isArray(result?.results) ? result.results : [];
  const pages = Math.max(1, Math.ceil(entries.length / 10));
  const currentPage = Math.min(pages, Math.max(1, integer(page) || 1));
  const rows = entries.slice((currentPage - 1) * 10, currentPage * 10);
  const incomplete = !loading && Boolean(error || failedCount(result) || !isComplete(result));
  const processed = integer(result?.progress?.completedShards);
  const planned = integer(result?.progress?.totalShards);
  const progress = planned ? Math.min(100, Math.round(processed / planned * 100)) : 0;
  const selectedRegion = regions(manifest).find(item => item.code === regionCode)?.name || '전국';
  const capped = Boolean(result?.capped || integer(result?.total) > entries.length) && entries.length > 0;
  return `<section class="card store-catalog-search" aria-labelledby="store-results-title" aria-busy="${loading}">
    <div class="store-catalog-header"><div><h2 id="store-results-title" tabindex="-1">이름으로 찾은 상가</h2><p class="store-catalog-result-summary" role="status" aria-atomic="true"><span>“${esc(query)}”</span> · <strong>${esc(resultSummary(result, loading, error))}</strong></p></div><div class="store-catalog-controls"><label for="store-region-filter">지역</label><select id="store-region-filter" name="storeRegion" aria-label="전국 상가 검색 지역"><option value="" ${!regionCode?'selected':''}>전국</option>${regions(manifest).map(item => `<option value="${esc(item.code)}" ${item.code===regionCode?'selected':''}>${esc(item.name)} (${count(item.count)})</option>`).join('')}</select></div></div>
    <div class="store-catalog-scope"><span class="badge neutral">주소·업종 확인</span><p>이 명부에는 사업자등록번호가 없습니다. 같은 상호라도 지점과 주소가 다르면 별도로 표시합니다.</p></div>
    ${loading?`<div class="store-catalog-progress"><progress max="100" ${planned?`value="${progress}"`:''} aria-label="상가 검색 진행률"></progress><span>${planned?`검색 범위 ${count(progress)}% 확인`:'검색 자료를 준비하고 있습니다.'}</span></div>`:''}
    ${incomplete?`<div class="store-catalog-notice" role="alert"><p>${esc(error || '일부 검색 자료를 확인하지 못했습니다.')} ${entries.length?'확인된 결과만 표시하며, 전체 건수는 확정되지 않았습니다.':'검색 결과가 없다고 판단할 수 없습니다.'}</p><button class="button small" data-action="retry-store-search">다시 검색</button></div>`:''}
    ${rows.length?`<div class="store-catalog-column-head" aria-hidden="true"><span>업체명 · 지점</span><span>주소</span><span>업종</span><span></span></div><ul class="store-catalog-list">${rows.map(entry => {
      const selected = entry.id === selectedId;
      const branchName = branch(entry);
      return `<li class="store-catalog-row${selected?' is-selected':''}"><div class="store-catalog-company">${renderStoreListCue(entry)}<h3>${esc(entry.name || '상호 미제공')}</h3>${branchName?`<p>${esc(branchName)}</p>`:''}${selected?'<span class="badge positive">선택한 상가</span>':''}</div><p class="store-catalog-address">${esc(entry.roadAddress || entry.address || entry.landAddress || '주소 미제공')}</p><p class="store-catalog-industry">${esc(industry(entry) || '업종 미제공')}</p><button class="button small" data-action="select-store-result" data-id="${esc(entry.id)}" aria-label="${esc([entry.name, branchName, entry.roadAddress || entry.address || entry.landAddress].filter(Boolean).join(' '))} 주소·업종 보기" ${selected?'aria-current="true"':''}>주소·업종 보기</button></li>`;
    }).join('')}</ul>`:loading?'<div class="store-catalog-empty"><span class="spinner" aria-hidden="true"></span><p>업체명과 주소를 확인하고 있습니다.</p></div>':incomplete?'':`<div class="store-catalog-empty"><h3>일치하는 상가를 찾지 못했습니다.</h3><p>${esc(selectedRegion)} 상가 명부에서 다른 이름이나 짧은 검색어로 찾아보세요.<br>자료에 없다는 뜻이며, 업체의 폐업 여부를 의미하지 않습니다.</p><div class="button-row store-catalog-empty-actions"><button type="button" class="button small" data-action="search-by-number">사업자번호 입력</button><button type="button" class="text-button" data-action="number-help">번호 찾는 방법</button></div></div>`}
    ${pages>1?`<nav class="store-catalog-pagination" aria-label="전국 상가 검색 결과 페이지"><button class="button small" data-action="store-search-prev" ${currentPage===1?'disabled':''}>이전</button><span>${count(currentPage)} / ${count(pages)} 페이지</span><button class="button small" data-action="store-search-next" ${currentPage===pages?'disabled':''}>다음</button></nav>`:''}
    ${capped?`<p class="store-catalog-limit">${loading||incomplete?'현재 확인한 결과 중':`전체 ${count(result.total)}곳 중`} 상위 ${count(entries.length)}곳을 표시합니다. 지역을 선택하거나 검색어를 더 입력하면 범위를 좁힐 수 있습니다.</p>`:''}
    ${coverageFooter(manifest)}
  </section>`;
}

/** A separate detail view keeps numberless directory evidence out of confirmed business profiles. */
export function renderStoreCatalogDetail({ entry, manifest=null } = {}) {
  if (!entry) return '';
  const facts = [
    ['도로명주소', entry.roadAddress || entry.address || '미제공'],
    ...(entry.landAddress && entry.landAddress !== (entry.roadAddress || entry.address)?[['지번주소', entry.landAddress]]:[]),
    ['업종', industry(entry) || '미제공'],
  ];
  const metadata = [
    ['업종 분류체계', '소상공인 상권업종분류'],
    ['사업자등록번호', '원천에서 제공하지 않음'],
    ['원천 상가업소번호', entry.sourceRecordId || '미제공'],
    ['원천 기준일', date(entry.sourceDate || manifest?.sourceDate)],
    ['실제 자료 수집', time(manifest?.collectedAt)],
  ];
  return `<section class="card store-catalog-detail" aria-labelledby="store-detail-title"><div class="store-catalog-detail-back"><button type="button" class="text-button" data-action="return-store-results">← 상가 검색 결과</button></div><div class="store-catalog-header"><div><h2 id="store-detail-title" tabindex="-1">${esc(entry.name || '상가 정보')}</h2>${branch(entry)?`<p>${esc(branch(entry))}</p>`:''}</div><span class="badge neutral">주소·업종 정보</span></div>${renderStoreStory(entry)}<p class="store-catalog-detail-intro">공개 상가 명부에 기록된 주소·업종입니다. 현재 영업 여부를 뜻하지 않으며, 이 명부에는 사업자등록번호가 없습니다.</p><dl class="store-catalog-facts">${facts.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><div class="store-catalog-detail-action"><div><h3>휴업·폐업 등 등록 상태도 확인하시겠어요?</h3><p>사업자등록번호 10자리가 필요합니다. 입력한 번호와 이 상가의 관계는 자동으로 확정하지 않습니다.</p></div><div class="button-row store-catalog-number-actions"><button type="button" class="button primary" data-action="search-by-number">사업자번호 입력</button><button type="button" class="text-button" data-action="number-help">번호 찾는 방법</button></div></div><details id="store-detail-metadata" class="store-catalog-detail-metadata"><summary>자료 출처와 기준일</summary><div class="store-catalog-detail-source"><span>자료 출처</span>${external(manifest?.source?.url, sourceName(manifest))}</div><dl class="store-catalog-facts">${metadata.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl><p class="fine-print">상가업소번호는 사업자등록번호와 다른 식별자입니다.</p></details></section>`;
}

export function renderStoreCatalogStatus({ manifest=null, status={}, error='', loading=false } = {}) {
  const state = status?.status || (manifest ? 'success' : 'not_collected');
  const failed = ['failed', 'error', 'partial'].includes(state) || Boolean(error);
  const label = loading?'불러오는 중':({success:'수집 완료',unchanged:'최신 원천 확인 완료',failed:'최근 갱신 실패',error:'최근 갱신 실패',partial:'갱신 확인 필요',not_collected:'아직 수집 전',running:'갱신 확인 중'})[state] || '수집 상태 확인 필요';
  const available = integer(manifest?.acceptedCount);
  const lastSuccess = status?.lastSuccessAt || manifest?.lastSuccessAt || manifest?.collectedAt;
  const lastAttempt = status?.lastAttemptAt || manifest?.lastAttemptAt;
  const schedule = status?.schedule?.label || manifest?.schedule?.label || '자동 확인 일정 미설정';
  const message = error || (failed ? status?.lastError || status?.message || '최근 원천 확인 또는 자료 갱신에 실패했습니다.' : '');
  return `<section class="card store-catalog-status section-spacer" aria-labelledby="store-catalog-status-title"><div class="store-catalog-header"><div><h2 id="store-catalog-status-title">전국 상가 검색 자료</h2><p>상호로 찾고 주소·업종을 확인하는 공개 상가 명부입니다.</p></div><span class="badge ${failed?'warning':available?'positive':'neutral'}">${esc(label)}</span></div><dl class="store-catalog-highlights"><div><dt>자동 갱신 확인</dt><dd>${esc(schedule)}</dd></div><div><dt>마지막 실제 자료 수집</dt><dd>${esc(time(lastSuccess))}</dd></div><div><dt>마지막 원천 확인 시도</dt><dd>${esc(time(lastAttempt))}</dd></div></dl>${message?`<p class="store-catalog-status-alert" role="alert">${esc(message)}${available?' 이전에 수집한 정상 자료를 유지하고 있습니다.':''}</p>`:''}<div class="store-catalog-status-summary"><span>검색 대상 <strong>${count(available)}곳</strong></span><span>수록 지역 <strong>${count(regions(manifest).length)}개</strong></span><span>원천 기준일 <strong>${esc(date(manifest?.sourceDate))}</strong></span></div><div class="store-catalog-status-scope"><p>전국 상가 중 원천 명부에 수록된 업소 범위입니다. 국내 전체 사업자등록 명부와 다르며, 사업자번호 확인 업체 수에는 합산하지 않습니다.</p>${regions(manifest).length?`<details><summary>지역별 수록 건수와 출처</summary><div class="store-catalog-regions"><table><caption class="sr-only">전국 상가 명부의 지역별 수록 건수</caption><thead><tr><th scope="col">지역</th><th scope="col">검색 가능한 상가</th></tr></thead><tbody>${regions(manifest).map(item => `<tr><th scope="row">${esc(item.name)}</th><td>${count(item.count)}곳</td></tr>`).join('')}</tbody></table></div><p>원천 ${count(manifest?.sourceCount)}행 · 제외 ${count(manifest?.rejectedCount)}행 · 같은 상가번호 중복 ${count(manifest?.duplicateCount)}행</p></details>`:''}</div><footer class="store-catalog-foot"><p>${external(manifest?.source?.url, sourceName(manifest))}${external('https://github.com/softm/bizhannun/actions/workflows/pages.yml', '자동 수집 실행 기록')}</p></footer></section>`;
}
