import test from 'node:test';
import assert from 'node:assert/strict';
import { operatorEvidenceForStore, storeLocationLinks, renderStoreStory, renderStoreListCue } from '../src/store-story.mjs';
const shop = (extra={}) => ({ id:'semas:123', name:'스타벅스', branchName:'홍대역', roadAddress:'서울특별시 마포구 양화로 165', industryName:'카페', latitude:37.5571, longitude:126.9248, sourceDate:'2026-06-30',...extra });

test('store detail provides geolocated map preview and Naver location and photo searches',()=>{
  const links=storeLocationLinks(shop());
  assert.match(links.preview,/openstreetmap\.org\/export\/embed\.html/);
  assert.match(links.naverSearch,/map\.naver\.com\/p\/search\//);
  assert.match(links.naverPhotos,/where=image/);
  const html=renderStoreStory(shop());
  assert.match(html,/위치 미리보기/);
  assert.match(html,/iframe title=/);
  assert.match(html,/네이버지도에서 위치 보기/);
  assert.match(html,/이 지점 사진 검색/);
  assert.match(html,/영업시간·시설·매장 전화/);
  assert.match(html,/현재 영업 여부/);
  assert.match(html,/출처/);
});

test('official Starbucks company identity remains separate from individual store business number',()=>{
  const evidence=operatorEvidenceForStore(shop({businessNumber:'123'}));
  assert.equal(evidence.businessNumber,'2018121515');
  const html=renderStoreStory(shop({businessNumber:'123'}));
  assert.match(html,/주식회사 에스씨케이컴퍼니/);
  assert.match(html,/201-81-21515/);
  assert.match(html,/브랜드 운영회사가 공개한 번호/);
  assert.match(html,/지점의 사업자등록번호나 영업 상태로 확정하지 않습니다/);
  assert.match(html,/data-action="lookup-brand-company" data-bno="2018121515"/);
  assert.doesNotMatch(html,/data-bno="123"|해당 지점의 사진입니다/);
  assert.match(html,/Public Domain/);
  assert.match(html,/선택한 지점 사진 아님/);
});
test('unrelated stores never inherit brand photos or tax identifiers',()=>{
  const html=renderStoreStory(shop({name:'임의카페',branchName:'중앙',businessNumber:'2018121515'}));
  assert.match(html,/이 지점의 확인된 사진이 아직 없습니다/);
  assert.doesNotMatch(html,/lookup-brand-company|commons\.wikimedia|2018121515|에스씨케이컴퍼니/);
  assert.equal(operatorEvidenceForStore({name:'스타벅스카페'}),null);
  assert.match(renderStoreListCue({industryName:'카페'}),/☕/);
});
test('bad coordinates do not render a map iframe or leak malicious text or links',()=>{
  const bad=shop({name:'<img src=x onerror=alert(1)>',branchName:'<script>bad</script>',roadAddress:'"><script>1</script>',latitude:0,longitude:999});
  const links=storeLocationLinks(bad);
  assert.equal(links.preview,'');
  const html=renderStoreStory(bad);
  assert.doesNotMatch(html,/<script>|<img src=x/);
  assert.match(html,/&lt;script&gt;/);
  assert.match(html,/원천 좌표가 없어/);
  assert.doesNotMatch(html,/<iframe/);
});
test('invalid or missing coordinates do not produce fabricated positions',()=>{
  for (const value of [undefined,null,'',NaN,91,-1]) {
    const o=shop({latitude:value});
    assert.equal(storeLocationLinks(o).preview,'');
  }
});
