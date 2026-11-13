import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ACCOUNT_ORIGIN, SITE_ID, createCloudflareBizSdk} from '../src/cloudflare-account-bridge.mjs';

test('Cloudflare account bridge uses only the registered BusinessHannun origin and site', async () => {
  assert.equal(SITE_ID, 'bizhannun');
  assert.equal(ACCOUNT_ORIGIN, 'https://softm-hannun-account.softm.workers.dev');
  const received = [];
  const client = {
    currentUser: null,
    async login(options) { received.push(['login', options.mode]); this.currentUser={uid:'cloudflare-test',displayName:'테스트',photoURL:'https://example.com/photo.png'}; return {uid:'cloudflare-test'}; },
    async logout() { received.push(['logout']); this.currentUser=null; }
  };
  const sdk=createCloudflareBizSdk((args)=>{received.push(['factory',args]);return client;});
  assert.throws(()=>sdk.createSiteClient({siteId:'weatherhannun'}),/사업자한눈/);
  const session=sdk.createSiteClient({siteId:'bizhannun'});
  const changes=[];
  const unsubscribe=session.onUser(value=>changes.push(value?.uid||null));
  assert.deepEqual(changes,[null]);
  assert.equal((await session.login({mode:'signup'})).uid,'cloudflare-test');
  assert.equal(session.currentUser.photoURL,'https://example.com/photo.png');
  assert.deepEqual(changes,[null,'cloudflare-test']);
  unsubscribe();
  await session.logout();
  assert.equal(session.currentUser,null);
  assert.deepEqual(received[0],[ 'factory', {baseUrl:ACCOUNT_ORIGIN,siteId:'bizhannun'} ]);
  assert.deepEqual(received.slice(1).map(row=>row[0]),['login','logout']);
});

test('BusinessHannun loads Cloudflare by default and preserves explicitly selected Firebase recovery', async () => {
  const index=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const boot=await readFile(new URL('../src/cloudflare-account-boot.mjs',import.meta.url),'utf8');
  const app=await readFile(new URL('../src/app.mjs',import.meta.url),'utf8');
  assert.match(index,/src\/cloudflare-account-boot\.mjs/);
  assert.doesNotMatch(index,/shared\/platform\/v1\/boot\.mjs\?site=bizhannun/);
  assert.match(boot,/legacyAccount/);
  assert.match(boot,/createCloudflareBizSdk/);
  assert.match(boot,/accountPageUrl/);
  assert.match(boot,/vault:\s*null/);
  assert.match(app,/id="siteAccountSlot"/);
  assert.match(app,/cloudflareAccountIntro/);
  assert.match(app,/기존 Firebase 계정/);
  assert.match(app,/createCloudWorkspace/);
  assert.match(app,/window\.SoftmSiteState/);
});
