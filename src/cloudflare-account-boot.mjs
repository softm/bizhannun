// Cloudflare account UI for BusinessHannun. No Firebase auth/vault is imported
// on the default path. The old vault is explicit opt-in to protect older data.
import {ACCOUNT_ORIGIN, SITE_ID, createCloudflareBizSdk} from './cloudflare-account-bridge.mjs';

const LEGACY_URL = 'https://softm.github.io/bizhannun/?legacyAccount=1#account';
const SHARED = 'https://softm.github.io/shared/platform/v1';
const CLIENT_MODULE = 'https://softm.github.io/services/cloudflare-account/src/client.mjs';

async function mount() {
  if (location.protocol === 'file:' || location.hostname === 'appassets.androidplatform.net') return;
  if (new URLSearchParams(location.search).get('legacyAccount') === '1') {
    // Previous encrypted backups require the old account SDK and UID.
    await import(SHARED + '/boot.mjs?site=bizhannun&v=20261029-account-1');
    return;
  }
  // Cloudflare's site-origin allowlist currently includes this GitHub Pages origin.
  if (location.origin !== 'https://softm.github.io') {
    console.warn('사업자한눈 공통 로그인은 등록된 운영 주소에서 사용할 수 있습니다.');
    return;
  }
  const [context, menu, sdk] = await Promise.all([
    import(SHARED + '/site-account.mjs?v=20261113-bizhannun-1'),
    import(SHARED + '/account-menu.mjs?v=20261112-header-slot-1'),
    import(CLIENT_MODULE + '?v=20261113-native-auth-1')
  ]);
  const account = context.createAccountContext({
    siteId: SITE_ID,
    sdkLoader: () => Promise.resolve(createCloudflareBizSdk(sdk.createCloudflareAccountClient)),
    accountPageUrl: ACCOUNT_ORIGIN + '/account',
    legacyVaultUrl: LEGACY_URL
  });
  const ui = menu.mountSiteAccount({
    siteId: SITE_ID,
    name: '사업자한눈',
    account,
    accountTarget: '#siteAccountSlot, .topbar .top-tools, .topbar',
    vault: null
  });
  window.SoftmAccounts ||= new Map();
  window.SoftmAccounts.set(SITE_ID, account);
  window.BizHannunCloudflare = Object.freeze({open: () => ui.open()});
  const unsubscribe = account.subscribe(() => {
    window.dispatchEvent(new CustomEvent('bizhannun:cloudflare-account-changed'));
  });
  window.dispatchEvent(new CustomEvent('softm:account-ready', {
    detail: {siteId: SITE_ID, account, backend: 'cloudflare'}
  }));
  window.addEventListener('pagehide', () => {
    unsubscribe();
    ui.destroy();
    account.destroy();
    window.SoftmAccounts?.delete(SITE_ID);
    delete window.BizHannunCloudflare;
  }, {once: true});
}
const start = () => { void mount().catch(() => {
  console.warn('공통 로그인 메뉴를 연결하지 못했습니다. 기존 사업자 조회와 기기 자료는 계속 사용할 수 있습니다.');
}); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true});
else start();
