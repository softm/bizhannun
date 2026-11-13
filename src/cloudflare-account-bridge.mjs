// BusinessHannun adapter for the shared Cloudflare account OAuth client.
// Identity only: the existing local / Firebase business workspace is not migrated.
export const ACCOUNT_ORIGIN = 'https://softm-hannun-account.softm.workers.dev';
export const SITE_ID = 'bizhannun';

export function createCloudflareBizSdk(clientFactory) {
  if (typeof clientFactory !== 'function') throw new TypeError('계정 클라이언트가 필요합니다.');
  return Object.freeze({
    createSiteClient({siteId} = {}) {
      if (siteId !== SITE_ID) throw new Error('사업자한눈 계정 연결만 허용합니다.');
      const client = clientFactory({baseUrl: ACCOUNT_ORIGIN, siteId});
      const listeners = new Set();
      const emit = () => {
        for (const listener of listeners) {
          try { listener(client.currentUser); } catch { /* A subscriber must not interrupt authentication. */ }
        }
      };
      return Object.freeze({
        siteId,
        get currentUser() { return client.currentUser; },
        onUser(listener) {
          if (typeof listener !== 'function') throw new TypeError('상태 구독 함수가 필요합니다.');
          listeners.add(listener);
          listener(client.currentUser);
          return () => listeners.delete(listener);
        },
        async login({popup, mode = 'login'} = {}) {
          if (!['login', 'signup'].includes(mode)) throw new Error('지원하지 않는 계정 흐름입니다.');
          // The Worker creates new memberships on first authorized SNS sign-in.
          // The same identity never creates another account merely by choosing signup.
          const result = await client.login({popup, mode});
          emit();
          return result;
        },
        async logout() {
          try { await client.logout(); }
          finally { emit(); }
        }
      });
    }
  });
}
