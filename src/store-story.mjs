/**
 * Visual store detail based on a public store-directory row.
 * Brand evidence is expressly NOT a verified link between a particular
 * branch/store ID and a tax registration number.
 */
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char =>
  ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[char]);
const sourceBrand = Object.freeze({
  name: "스타벅스",
  company: "주식회사 에스씨케이컴퍼니",
  businessNumber: "2018121515",
  representativePhone: "1522-3232",
  source: "https://www.starbucks.co.kr/index.html",
  storeFinder: "https://www.starbucks.co.kr/store/store_map.do",
  image: "https://commons.wikimedia.org/wiki/Special:FilePath/Starbucks_in_Seoul_South_Korea.jpg",
  imageSource: "https://commons.wikimedia.org/wiki/File:Starbucks_in_Seoul_South_Korea.jpg",
  imageCredit: "BrianAdler · Public Domain · 2008년 서울의 스타벅스 (선택한 지점 사진 아님)"
});
const coffee = entry => /카페|커피|음료|다방/u.test(String(entry?.industryName || entry?.industry?.label || ""));
const isStarbucks = entry => String(entry?.name || "").normalize("NFKC").trim().replace(/\s+/gu,"") === "스타벅스";

/** Curated brand identity is displayed separately from the selected branch. */
export const operatorEvidenceForStore = entry => isStarbucks(entry) ? sourceBrand : null;

export function storeLocationLinks(entry) {
  const address = String(entry?.roadAddress || entry?.address || entry?.landAddress || "").trim().slice(0, 350);
  const name = [entry?.name, entry?.branchName].filter(Boolean).map(x => String(x).slice(0, 100)).join(" ");
  const phrase = [name, address].filter(Boolean).join(" ");
  const naverSearch = phrase ? "https://map.naver.com/p/search/" + encodeURIComponent(phrase) : "";
  const naverPhotos = phrase ? "https://search.naver.com/search.naver?where=image&query=" + encodeURIComponent(phrase+" 매장") : "";
  const lat = Number(entry?.latitude);
  const lon = Number(entry?.longitude);
  const hasCoordinates = entry?.latitude !== null && entry?.latitude !== undefined
    && entry?.longitude !== null && entry?.longitude !== undefined
    && Number.isFinite(lat) && Number.isFinite(lon)
    && lat >= 33 && lat <= 39.5 && lon >= 124 && lon <= 132;
  const fixedLat = lat.toFixed(5), fixedLon = lon.toFixed(5);
  const bounding = hasCoordinates
    ? [lon-.0035, lat-.0025, lon+.0035, lat+.0025].map(n => n.toFixed(5)).join(",")
    : "";
  const preview = hasCoordinates
    ? "https://www.openstreetmap.org/export/embed.html?bbox=" + encodeURIComponent(bounding)
      + "&layer=mapnik&marker=" + encodeURIComponent(fixedLat+","+fixedLon)
    : "";
  return { naverSearch, naverPhotos, preview, hasCoordinates, lat, lon };
}

export function renderStoreListCue(entry) {
  const pictogram = coffee(entry) ? "☕" : "⌂";
  return '<span class="store-catalog-symbol" aria-hidden="true">' + pictogram + "</span>";
}

const externalLink = (href, label, cls = "") => href
  ? '<a class="'+escapeHtml(cls)+'" href="'+escapeHtml(href)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(label)+'</a>'
  : "";

export function renderStoreStory(entry) {
  if (!entry) return "";
  const brand = operatorEvidenceForStore(entry);
  const links = storeLocationLinks(entry);
  const address = entry.roadAddress || entry.address || entry.landAddress || "";
  const placeLabel = [entry.name, entry.branchName].filter(Boolean).join(" ");
  const category = entry.industryName || entry.industry?.label || "업종 확인 필요";
  const media = brand
    ? '<figure class="store-story-media"><img src="'+escapeHtml(brand.image)+'" loading="lazy" decoding="async" alt="2008년 서울의 스타벅스 매장 참고 사진. 선택한 지점의 사진은 아님"><figcaption>'
      +escapeHtml(brand.imageCredit)+" · "+externalLink(brand.imageSource,"사진 원본·저작권 확인")+"</figcaption></figure>"
    : '<div class="store-story-no-photo" role="img" aria-label="실제 매장 사진이 확보되지 않았습니다">'
      +'<span aria-hidden="true">'+(coffee(entry)?"☕":"⌂")+'</span><strong>이 지점의 확인된 사진이 아직 없습니다</strong>'
      +'<p>다른 지점의 사진을 대신 보여주지 않습니다.</p></div>';
  const preview = links.preview
    ? '<iframe title="'+escapeHtml(placeLabel)+' 위치 지도 미리보기" loading="lazy" referrerpolicy="no-referrer" src="'+escapeHtml(links.preview)+'"></iframe>'
      +'<p class="store-story-map-source">좌표 기준 위치 · 미리보기 지도 © OpenStreetMap 기여자 · 도로·출입구 위치는 현장과 다를 수 있습니다.</p>'
    : '<div class="store-story-map-empty">원천 좌표가 없어 지도를 표시하지 않았습니다. 주소를 통해 위치를 확인하세요.</div>';
  const company = brand ? '<section class="store-story-operator" aria-label="브랜드 운영회사 공개 정보">'
    +'<div class="store-story-section-title"><h3>브랜드 운영회사</h3><span>공식 홈페이지 공개자료</span></div>'
    +'<p class="store-story-company">'+escapeHtml(brand.company)+'</p>'
    +'<p class="store-story-num">공개 사업자등록번호 <strong>'+escapeHtml(brand.businessNumber.replace(/^(\d{3})(\d{2})(\d{5})$/, "$1-$2-$3"))+'</strong></p>'
    +'<p>대표 고객센터 '+escapeHtml(brand.representativePhone)+' · 매장 직통 전화가 아닙니다.</p>'
    +'<p class="store-story-caution">이 번호는 브랜드 운영회사가 공개한 번호입니다. <strong>'+escapeHtml(placeLabel)+'</strong> 지점의 사업자등록번호나 영업 상태로 확정하지 않습니다.</p>'
    +'<div class="store-story-links">'+externalLink(brand.source,"공식 홈페이지 근거")+externalLink(brand.storeFinder,"공식 매장 찾기")
    +'<button type="button" class="button small" data-action="lookup-brand-company" data-bno="'+escapeHtml(brand.businessNumber)+'">운영회사 등록 상태 확인</button></div></section>'
    : '<section class="store-story-operator" aria-label="사업자번호 확인 방법"><div class="store-story-section-title"><h3>운영회사·사업자번호</h3><span>아직 확인 전</span></div>'
    +'<p>현재 공개 상가 명부에는 사업자번호가 없습니다. 번호가 없는 업체도 지도와 공개자료를 먼저 살펴볼 수 있습니다.</p>'
    +'<div class="store-story-links"><button type="button" class="button small" data-action="number-help">사업자번호 찾는 방법</button></div></section>';
  return '<div class="store-story">'
    +'<div class="store-story-hero">'+media+'<div class="store-story-hero-copy">'
    +'<p class="store-story-eyebrow">상가 탐색 · 현재 운영 여부 미확인</p><h3>'+escapeHtml(placeLabel || "상가 정보")+'</h3>'
    +'<p class="store-story-category">'+escapeHtml(category)+'</p><p>'+escapeHtml(address || "주소 미제공")+'</p>'
    +'<div class="store-story-links">'+externalLink(links.naverSearch,"네이버지도에서 위치 보기","store-story-main-link")
    +externalLink(links.naverPhotos,"이 지점 사진 검색")+'</div>'
    +'<p class="store-story-caution">사진 검색 결과는 외부 자료이며, 이 업체·지점과 일치하는지 직접 확인해야 합니다.</p>'
    +'</div></div>'
    +'<div class="store-story-grid"><section class="store-story-location"><div class="store-story-section-title"><h3>위치와 방문 정보</h3><span>상가 명부 '+escapeHtml(entry.sourceDate || "기준일 확인")+'</span></div>'
    +'<p class="store-story-address">'+escapeHtml(address || "주소 미제공")+'</p>'
    +'<dl class="store-story-stat"><div><dt>업종</dt><dd>'+escapeHtml(category)+'</dd></div>'
    +'<div><dt>좌표</dt><dd>'+(links.hasCoordinates ? escapeHtml(links.lat.toFixed(5)+", "+links.lon.toFixed(5)) : "미제공")+'</dd></div>'
    +'<div><dt>영업시간·시설·매장 전화</dt><dd>아직 확인된 매장별 자료 없음</dd></div></dl>'
    +'<p class="store-story-caution">현재 영업 여부·주차·전화·영업시간은 이 명부에서 확인되지 않습니다.</p></section>'
    +'<section class="store-story-map"><div class="store-story-section-title"><h3>위치 미리보기</h3><span>지점 좌표</span></div>'+preview+'</section></div>'
    +company
    +'</div>';
}
