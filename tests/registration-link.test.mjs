import test from 'node:test';
import assert from 'node:assert/strict';
import { findRegistrationCandidates } from '../src/registration-link.mjs';
import { renderStoreCatalogDetail } from '../src/store-catalog-view.mjs';

test('only exact name and complete road address propose a registration candidate',()=>{
  const shop={name:'다온상사',roadAddress:'서울특별시 중구 을지로 12'};
  const row={businessNumber:'2208162517',name:'다온상사',address:'서울특별시 중구 을지로 12'};
  assert.deepEqual(findRegistrationCandidates(shop,[row]),[row]);
  assert.equal(findRegistrationCandidates(shop,[{...row,address:'서울특별시 중구 을지로 13'}]).length,0);
  assert.equal(findRegistrationCandidates(shop,[{...row,name:'다른 상호'}]).length,0);
  assert.equal(findRegistrationCandidates({name:'다온상사',roadAddress:''},[row]).length,0);
});
test('store detail identifies matching public number only as a candidate',()=>{
  const html=renderStoreCatalogDetail({entry:{id:'semas:a',name:'다온상사',roadAddress:'서울특별시 중구 을지로 12'},registrationRecords:[
    {businessNumber:'2208162517',name:'다온상사',address:'서울특별시 중구 을지로 12'}
  ]});
  assert.match(html,/220-81-62517/);
  assert.match(html,/동일 사업자 여부는 별도 확인/);
  assert.match(html,/select-registration-result/);
  const unknown=renderStoreCatalogDetail({entry:{id:'semas:b',name:'다온상사',roadAddress:'서울특별시 중구 을지로 13'},registrationRecords:[
    {businessNumber:'2208162517',name:'다온상사',address:'서울특별시 중구 을지로 12'}
  ]});
  assert.doesNotMatch(unknown,/220-81-62517/);
});
