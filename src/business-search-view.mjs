import { formatBusinessNumber } from './domain.mjs';
import { safeEnrichmentUrl } from './enrichment.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const count = value => new Intl.NumberFormat('ko-KR').format(value || 0);
const when = value => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'}).format(new Date(value))
  : '시각 미제공';

/** Search results describe their own coverage, not a nationwide business registry. */
export function renderBusinessSearch({query, result, index, loading=false, error='', meta={}, selectedNumber=''}) {
  const rows = result.results;
  const total = result.total;
  const page = Math.floor(result.offset / result.limit) + 1;
  const pages = Math.max(1, Math.ceil(total / result.limit));
  const publicStatus = error ? '공개자료 연결 확인 필요' : loading ? '공개자료 불러오는 중'
    : meta.status === 'not_collected' ? '공개자료 수집 전' : `공개자료 ${count(index.publicCount)}곳`;
  return `<section class="card business-search-results" aria-labelledby="name-results-title" aria-busy="${loading}">
    <div class="card-header"><div><h2 id="name-results-title" tabindex="-1">“${esc(query)}” 이름 검색</h2><p class="name-results-summary" role="status">${loading?'검색자료를 불러오고 있습니다. ':''}${count(total)}곳${loading?' · 현재 확인한 자료 기준':''}</p></div><button class="button small" data-action="retry-name-search" ${loading?'disabled':''}>자료 새로고침</button></div>
    <div class="name-search-scope"><span class="badge ${error?'warning':'neutral'}">${esc(publicStatus)}</span><span class="badge neutral">내 저장정보 ${count(index.savedCount)}곳</span><p>공개 수집자료와 현재 ${esc('계정·기기')}에 불러온 거래처·내 사업 정보에서 검색합니다. 같은 이름도 사업자번호가 다르면 별도로 표시합니다.</p></div>
    ${error?`<div class="callout warning name-search-warning" role="alert"><span>${esc(error)} 내 저장정보는 계속 검색할 수 있습니다.</span></div>`:''}
    ${rows.length?`<ul class="business-candidates">${rows.map(entry=>{
      const selected = entry.businessNumber === selectedNumber;
      const sourceUrl = safeEnrichmentUrl(entry.sourceUrl);
      return `<li class="business-candidate ${selected?'is-selected':''}">
        <div class="candidate-content"><div class="candidate-title"><h3>${esc(entry.name)}</h3>${selected?'<span class="badge positive">선택한 업체</span>':''}</div>
          <p class="candidate-number">${formatBusinessNumber(entry.businessNumber)}</p>
          ${entry.matchedName && entry.matchedName!==entry.name?`<p class="candidate-alias">검색된 이름 · ${esc(entry.matchedName)}</p>`:''}
          <p class="candidate-address">${esc(entry.address || '주소 자료 없음')}${entry.industry?` <span>· ${esc(entry.industry)}</span>`:''}</p>
          <div class="candidate-sources">${(entry.sourceLabels||[]).map(label=>`<span class="badge neutral">${esc(label)}</span>`).join('')}${sourceUrl?`<a href="${esc(sourceUrl)}" target="_blank" rel="noopener noreferrer">상호 출처 ↗</a>`:''}${entry.fromPublic?`<span>자료 수집 ${esc(when(entry.collectedAt))}</span>`:''}</div>
        </div><button class="button ${selected?'light':'primary'} small" data-action="select-name-result" data-number="${esc(entry.businessNumber)}" aria-label="${esc(entry.name)} ${formatBusinessNumber(entry.businessNumber)} 선택 후 조회">${selected?'다시 조회':'선택 후 조회'}</button>
      </li>`;
    }).join('')}</ul>`:loading?'<div class="name-search-empty" role="status"><span class="spinner"></span><p>업체명과 사업자번호를 연결한 공개자료를 확인하고 있습니다.</p></div>':`<div class="name-search-empty"><h3>${error?'현재 확인할 수 있는 저장정보에서 찾지 못했습니다.':'수집·저장된 자료에서 찾지 못했습니다.'}</h3><p>업체가 없거나 폐업했다는 뜻은 아닙니다. 상호의 일부로 다시 검색하거나 사업자등록번호로 조회해 주세요.</p><div class="button-row"><button class="button light small" data-action="search-by-number">사업자번호로 조회</button><button class="button small" data-action="add-partner-from-search">이 이름으로 거래처 등록</button></div></div>`}
    ${pages>1?`<nav class="name-search-pagination" aria-label="이름 검색 결과 페이지"><button class="button small" data-action="name-search-prev" ${page<=1?'disabled':''}>이전</button><span>${count(page)} / ${count(pages)} 페이지 · ${count(total)}곳</span><button class="button small" data-action="name-search-next" ${page>=pages?'disabled':''}>다음</button></nav>`:''}
    <div class="name-search-foot"><p>업체를 선택하면 해당 <strong>사업자번호로 국세청 상태·과세유형과 통합정보</strong>를 조회합니다. 상호와 주소는 표시된 출처의 자료입니다.</p><details><summary>검색 범위와 갱신 정보</summary><p>공개자료와 내 저장정보의 같은 사업자번호를 합친 검색 대상은 ${count(index.totalCount)}곳입니다. 전국 모든 사업자의 상호가 수집된 것은 아닙니다.</p><div class="search-data-highlights"><span>공개자료 수집 일정 <strong>매일 06:17 (한국시간)</strong></span><span>공개 목록 생성 <strong>${esc(when(meta.generatedAt||meta.collectedAt))}</strong></span></div><p>내 거래처와 프로필은 저장 후 검색에 반영됩니다. 업체별 자료 기준 시각은 각 결과에서 확인하세요.</p></details>${!loading&&!total?`<p class="name-external-search">외부에서 더 찾기: <a href="https://search.naver.com/search.naver?query=${encodeURIComponent(query+' 사업자등록번호')}" target="_blank" rel="noopener noreferrer">네이버 검색 ↗</a><span>외부 검색 결과는 자동으로 연결되지 않습니다.</span></p>`:''}</div>
  </section>`;
}
