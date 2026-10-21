import test from 'node:test';
import assert from 'node:assert/strict';
import { renderEnrichment, enrichmentNote, discoveryLinks } from '../src/enrichment-view.mjs';
test('business profile shows facts with field-level sources and separates discovery from confirmed data',()=>{
 const source={id:'s',url:'https://example.org/company',title:'회사 공개자료',channel:'directory',match:'exact_bno',collectedAt:'2026-10-21T10:00:00Z'};
 const summary={profile:{name:'예시'},fields:[{field:'name',label:'상호',value:'예시',sourceId:'s',match:'exact_bno',alternatives:[]}],sources:[source],candidates:[],collectedAt:source.collectedAt};
 const html=renderEnrichment({businessNumber:'2208162517',summary,record:{}});
 assert.match(html,/민간 기업정보/);assert.match(html,/https:\/\/example.org\/company/);assert.match(html,/외부 검색 링크/);assert.match(enrichmentNote(summary),/출처: https:\/\/example.org\/company/);
 assert.equal(discoveryLinks('2208162517','예시').length,6);
 summary.collection={status:'failed',lastAttemptAt:source.collectedAt};
 assert.match(renderEnrichment({businessNumber:'2208162517',summary}),/최근 웹 수집 실패/);
 assert.match(renderEnrichment({businessNumber:'2208162517',summary}),/이전에 확보한 자료/);
});
test('remote content cannot inject script, attributes, or unsafe links into profile rendering',()=>{
 const html=renderEnrichment({businessNumber:'2208162517',summary:{profile:{name:'<script>x</script>'},fields:[{field:'name',label:'<img>',value:'<img onerror=alert(1)>',sourceId:'s',alternatives:[]}],sources:[{id:'s',url:'javascript:alert(1)',title:'bad',collectedAt:null}],candidates:[]}});
 assert.equal(html.includes('<script>'),false);assert.equal(html.includes('<img'),false);assert.equal(html.includes('href="javascript:'),false);
});
test('uncollected business remains explicit and offers an attributable public collection request',()=>{
 const html=renderEnrichment({businessNumber:'2208162517'});assert.match(html,/확인된 추가 정보가 아직 없습니다/);assert.match(html,/웹 정보 수집 요청/);assert.match(html,/disabled>수집 자료 JSON/);
});
