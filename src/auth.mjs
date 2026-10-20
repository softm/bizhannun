import { validateApiBase } from './api-client.mjs';

const PROVIDERS = ['google', 'kakao', 'naver', 'email'];
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const SOCIAL_MESSAGE = 'bizhannun:oauth';
const APP_NAME = 'bizhannun';
const emptyProviders = () => Object.fromEntries(PROVIDERS.map(name => [name, { configured: false }]));

export class AuthClientError extends Error {
  constructor(code, message = authErrorMessage({ code })) { super(message); this.name = 'AuthClientError'; this.code = code; }
}

/** Never show upstream messages, credentials, URLs, or account-enumeration details. */
export function authErrorMessage(error) {
  const code = String(error?.code || '');
  const messages = {
    'auth/unauthorized-domain': '이 사이트 주소의 로그인이 아직 허용되지 않았습니다. Firebase의 승인된 도메인을 확인해 주세요.',
    'auth/operation-not-allowed': '선택한 로그인 방식이 아직 활성화되지 않았습니다.',
    'auth/popup-blocked': '로그인 창이 차단되었습니다. 이 사이트의 팝업을 허용하고 다시 눌러 주세요.',
    'auth/popup-closed-by-user': '로그인 창을 닫았습니다. 다시 로그인할 수 있습니다.',
    'auth/cancelled-popup-request': '진행 중인 로그인 창을 확인해 주세요.',
    'auth/invalid-email': '이메일 주소 형식을 확인해 주세요.',
    'auth/invalid-credential': '이메일과 비밀번호를 확인해 주세요.',
    'auth/user-not-found': '이메일과 비밀번호를 확인해 주세요.',
    'auth/wrong-password': '이메일과 비밀번호를 확인해 주세요.',
    'auth/email-already-in-use': '이 주소로 가입할 수 없습니다. 기존 로그인 방식이나 비밀번호 재설정을 이용해 주세요.',
    'auth/weak-password': '비밀번호를 8자 이상으로 입력해 주세요. 프로젝트의 비밀번호 조건도 충족해야 합니다.',
    'auth/password-does-not-meet-requirements': '프로젝트의 비밀번호 조건을 충족하지 않습니다. 더 강한 비밀번호를 입력해 주세요.',
    'auth/too-many-requests': '요청이 많습니다. 잠시 후 다시 시도해 주세요.',
    'auth/network-request-failed': '로그인 서버에 연결할 수 없습니다. 네트워크를 확인해 주세요.',
    'auth/web-storage-unsupported': '브라우저의 로그인 저장소를 사용할 수 없습니다. 사이트 저장 공간을 허용해 주세요.',
    'auth/account-exists-with-different-credential': '다른 방식으로 가입한 계정이 있습니다. 이전에 사용한 로그인 방식을 선택해 주세요.',
    'auth/user-disabled': '이 계정을 사용할 수 없습니다. 서비스 운영자에게 문의해 주세요.',
    'auth/requires-recent-login': '계정 확인을 위해 다시 로그인해 주세요.',
    'auth/invalid-custom-token': 'SNS 로그인 정보를 확인하지 못했습니다. 다시 로그인해 주세요.',
    'auth/custom-token-mismatch': 'SNS 로그인과 Firebase 프로젝트 설정이 일치하지 않습니다.',
    'auth/invalid-api-key': '로그인 서비스의 Firebase 설정을 확인해 주세요.',
    not_configured: '로그인 서비스 설정을 준비하고 있습니다. 현재 기기의 자료는 그대로 보관됩니다.',
    provider_not_configured: '이 로그인 방식은 서비스 설정 후 사용할 수 있습니다.',
    configuration_error: '로그인 서비스 설정을 읽지 못했습니다. 운영자의 설정 확인이 필요합니다.',
    config_network_error: '로그인 설정을 불러오지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.',
    not_ready: '로그인 서비스를 연결하는 중입니다. 잠시 후 다시 눌러 주세요.',
    auth_busy: '로그인 작업이 진행 중입니다. 현재 창의 작업을 마쳐 주세요.',
    timeout: '로그인 대기 시간이 지났습니다. 다시 시도해 주세요.',
    invalid_response: '로그인 응답을 확인하지 못했습니다. 다시 시도해 주세요.',
    access_denied: '로그인 동의를 취소했습니다. 필요할 때 다시 로그인해 주세요.',
    invalid_state: '로그인 요청이 만료되었거나 일치하지 않습니다. 다시 시작해 주세요.',
    state_expired: '로그인 요청이 만료되었습니다. 다시 시작해 주세요.',
    missing_user: '먼저 로그인해 주세요.',
    disposed: '로그인 연결이 종료되었습니다. 화면을 새로고침해 주세요.',
  };
  return messages[code] || '로그인 작업을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

function authError(error) { return error instanceof AuthClientError ? error : new AuthClientError(error?.code || 'auth_error'); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function text(value, limit = 300) { return typeof value === 'string' && value.length <= limit ? value : ''; }
function requireEmail(value) {
  const email = typeof value === 'string' ? value.trim() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthClientError('auth/invalid-email');
  return email;
}
function requirePassword(value, signup = false) {
  if (typeof value !== 'string' || value.length > 4096 || value.length < (signup ? 8 : 1)) {
    throw new AuthClientError(signup ? 'auth/weak-password' : 'auth/invalid-credential');
  }
  return value;
}

/** A public configuration allowlist. Private or unrelated server fields never propagate. */
export function normalizeAuthConfig(input, pageOrigin) {
  if (!object(input)) throw new AuthClientError('configuration_error');
  const providers = emptyProviders();
  for (const name of PROVIDERS) {
    const source = input.providers?.[name];
    providers[name] = { configured: source?.configured === true, ...(typeof source?.reason === 'string' ? { reason: source.reason.slice(0, 200) } : {}) };
  }
  const firebase = {};
  const source = object(input.firebase) ? input.firebase : {};
  for (const key of ['apiKey', 'authDomain', 'projectId', 'appId', 'messagingSenderId', 'storageBucket', 'measurementId']) {
    if (typeof source[key] === 'string' && source[key].trim()) firebase[key] = source[key].trim();
  }
  const configured = ['apiKey', 'authDomain', 'projectId', 'appId'].every(key => Boolean(firebase[key]));
  if (configured) {
    if (!/^[a-z][a-z\d-]{4,28}[a-z\d]$/.test(firebase.projectId)
      || !/^[A-Za-z0-9_-]{20,300}$/.test(firebase.apiKey)
      || !/^[A-Za-z0-9:._-]{5,250}$/.test(firebase.appId)
      || !/^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}$/i.test(firebase.authDomain)) throw new AuthClientError('configuration_error');
  } else {
    for (const provider of Object.values(providers)) provider.configured = false;
  }
  const databaseId = input.firestore?.databaseId || '(default)';
  if (databaseId !== '(default)' && !/^[a-z][a-z\d-]{2,61}[a-z\d]$/.test(databaseId)) throw new AuthClientError('configuration_error');
  const edition = String(input.firestore?.edition || 'STANDARD').toUpperCase();
  if (!['STANDARD', 'ENTERPRISE'].includes(edition)) throw new AuthClientError('configuration_error');
  const result = { configured, firebase: configured ? firebase : null, providers, firestore: { databaseId, edition } };
  if (input.emulators !== undefined) {
    let page;
    try { page = new URL(pageOrigin); } catch { throw new AuthClientError('configuration_error'); }
    if (!LOOPBACK.has(page.hostname) || !object(input.emulators)) throw new AuthClientError('configuration_error');
    result.emulators = {};
    if (input.emulators.auth) {
      let url;
      try { url = new URL(input.emulators.auth); } catch { throw new AuthClientError('configuration_error'); }
      if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new AuthClientError('configuration_error');
      result.emulators.auth = url.origin;
    }
    if (input.emulators.firestore) {
      const { host, port } = input.emulators.firestore;
      if (!LOOPBACK.has(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new AuthClientError('configuration_error');
      result.emulators.firestore = { host, port };
    }
  }
  return result;
}

/** Match every browser binding before considering the untrusted message body. */
export function matchesSocialMessage(event, { apiOrigin, popup, provider, nonce }) {
  return Boolean(event && event.origin === apiOrigin && event.source === popup
    && object(event.data) && event.data.type === SOCIAL_MESSAGE
    && event.data.provider === provider && event.data.nonce === nonce);
}

function visibleUser(user) {
  if (!user || typeof user.uid !== 'string') return null;
  return Object.freeze({ uid: user.uid, displayName: text(user.displayName, 300), email: text(user.email, 254),
    emailVerified: user.emailVerified === true, photoURL: text(user.photoURL, 2048),
    providerIds: Object.freeze((user.providerData || []).map(item => text(item.providerId, 100)).filter(Boolean)) });
}

async function fetchConfiguration(url, fetchImpl) {
  const response = await fetchImpl(url, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!response.ok || !(response.headers.get('content-type') || '').includes('application/json')) throw new AuthClientError('config_network_error');
  if (Number(response.headers.get('content-length')) > 65536) throw new AuthClientError('configuration_error');
  const body = await response.text();
  if (body.length > 65536) throw new AuthClientError('configuration_error');
  try { return JSON.parse(body); } catch { throw new AuthClientError('configuration_error'); }
}

/** Authentication only; caller selects the UID-scoped workspace on user change. */
export function createAuthClient({ apiBase = '', onStateChange, fetchImpl = globalThis.fetch,
  sdkLoader = () => import('./firebase-sdk.mjs'), windowRef = globalThis.window, socialTimeoutMs = 120000 } = {}) {
  const origin = windowRef?.location?.origin;
  let apiOrigin;
  try { apiOrigin = validateApiBase(apiBase) || new URL(origin).origin; } catch { throw new AuthClientError('configuration_error'); }
  let state = { phase: 'idle', configured: false, user: null, providers: emptyProviders(), error: null, config: null };
  let context = null, initPromise = null, unsubscribeAuth, cancelSocial;
  let disposed = false, busy = false;
  const listeners = new Set(typeof onStateChange === 'function' ? [onStateChange] : []);
  const emit = changes => {
    if (disposed) return;
    state = { ...state, ...changes };
    for (const listener of listeners) {
      try { listener({ ...state }); } catch { /* A view callback must not corrupt authentication state. */ }
    }
  };
  const assertReady = provider => {
    if (disposed) throw new AuthClientError('disposed');
    if (!context || !state.configured) throw new AuthClientError(state.phase === 'unconfigured' ? 'not_configured' : 'not_ready');
    if (busy) throw new AuthClientError('auth_busy');
    if (provider && !state.providers[provider]?.configured) throw new AuthClientError('provider_not_configured');
  };
  const run = (operation, { phase = 'authenticating' } = {}) => {
    busy = true;
    emit({ phase, error: null });
    let result;
    try { result = operation(); } catch (error) { result = Promise.reject(error); }
    return Promise.resolve(result).catch(error => {
      const safe = authError(error);
      emit({ error: safe.message });
      throw safe;
    }).finally(() => { busy = false; emit({ phase: 'ready', user: visibleUser(context?.auth.currentUser) }); });
  };
  const socialLogin = provider => {
    const bytes = new Uint8Array(32);
    try { (windowRef.crypto || globalThis.crypto).getRandomValues(bytes); } catch { throw new AuthClientError('configuration_error'); }
    const nonce = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    const url = new URL('/api/auth', apiOrigin);
    url.search = new URLSearchParams({ action: 'start', provider, returnOrigin: origin, nonce }).toString();
    // Invoke synchronously in the user click handler, before any await.
    const popup = windowRef.open(url.href, `bizhannun-${provider}-${nonce.slice(0, 12)}`, 'popup=yes,width=500,height=680');
    if (!popup) throw new AuthClientError('auth/popup-blocked');
    return new Promise((resolve, reject) => {
      let settled = false, timer, polling;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer); clearInterval(polling);
        windowRef.removeEventListener('message', receive);
        cancelSocial = undefined;
        try { popup.close(); } catch { /* Cross-origin window may already be closed. */ }
        if (error) reject(error); else resolve(value);
      };
      const receive = event => {
        if (!matchesSocialMessage(event, { apiOrigin, popup, provider, nonce })) return;
        if (event.data.error) return finish(new AuthClientError(text(event.data.error.code, 100) || 'invalid_response'));
        const token = event.data.customToken;
        if (typeof token !== 'string' || token.length < 64 || token.length > 16384 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return finish(new AuthClientError('invalid_response'));
        finish(null, token);
      };
      cancelSocial = () => finish(new AuthClientError('disposed'));
      windowRef.addEventListener('message', receive);
      timer = setTimeout(() => finish(new AuthClientError('timeout')), Math.max(500, Math.min(socialTimeoutMs, 600000)));
      polling = setInterval(() => {
        try { if (popup.closed) finish(new AuthClientError('auth/popup-closed-by-user')); } catch { /* Provider policy can limit window access. */ }
      }, 750);
    }).then(token => {
      if (disposed) throw new AuthClientError('disposed');
      return context.sdk.signInWithCustomToken(context.auth, token);
    });
  };
  return {
    init() {
      // Missing deployment configuration can become available without a page reload.
      if (initPromise && state.phase !== 'unconfigured') return initPromise;
      if (disposed) return Promise.reject(new AuthClientError('disposed'));
      emit({ phase: 'initializing', error: null });
      initPromise = (async () => {
        const config = normalizeAuthConfig(await fetchConfiguration(`${apiOrigin}/api/config`, fetchImpl), origin);
        if (disposed) throw new AuthClientError('disposed');
        if (!config.configured) { emit({ phase: 'unconfigured', configured: false, config, providers: config.providers, user: null }); return { ...state }; }
        const sdk = await sdkLoader();
        if (disposed) throw new AuthClientError('disposed');
        const existing = sdk.getApps().find(app => app.name === APP_NAME);
        if (existing && existing.options.projectId !== config.firebase.projectId) throw new AuthClientError('configuration_error');
        const app = existing || sdk.initializeApp(config.firebase, APP_NAME);
        const auth = sdk.getAuth(app);
        auth.languageCode = 'ko';
        if (config.emulators?.auth) {
          if (typeof sdk.connectAuthEmulator !== 'function') throw new AuthClientError('configuration_error');
          sdk.connectAuthEmulator(auth, config.emulators.auth, { disableWarnings: true });
        }
        await sdk.setPersistence(auth, sdk.browserLocalPersistence);
        if (disposed) throw new AuthClientError('disposed');
        context = { app, auth, sdk, config };
        await new Promise((resolve, reject) => {
          let initial = true;
          unsubscribeAuth = sdk.onAuthStateChanged(auth, user => {
            emit({ phase: busy ? 'authenticating' : 'ready', configured: true, providers: config.providers, config, user: visibleUser(user), error: null });
            if (initial) { initial = false; resolve(); }
          }, error => { if (initial) { initial = false; reject(error); } else emit({ error: authErrorMessage(error) }); });
        });
        return { ...state };
      })().catch(error => {
        const safe = error instanceof AuthClientError ? error : new AuthClientError(error?.code || 'config_network_error');
        unsubscribeAuth?.(); unsubscribeAuth = undefined; context = null;
        emit({ phase: 'error', configured: false, providers: emptyProviders(), user: null, error: safe.message });
        initPromise = null;
        return { ...state };
      });
      return initPromise;
    },
    signIn(provider) {
      try {
        assertReady(provider);
        if (!['google', 'kakao', 'naver'].includes(provider)) throw new AuthClientError('provider_not_configured');
        return run(() => {
          if (provider !== 'google') return socialLogin(provider);
          const google = new context.sdk.GoogleAuthProvider();
          google.setCustomParameters({ prompt: 'select_account' });
          return context.sdk.signInWithPopup(context.auth, google);
        });
      } catch (error) { return Promise.reject(authError(error)); }
    },
    signInEmail(email, password) {
      try { assertReady('email'); const address = requireEmail(email); const secret = requirePassword(password); return run(() => context.sdk.signInWithEmailAndPassword(context.auth, address, secret)); }
      catch (error) { return Promise.reject(authError(error)); }
    },
    signUpEmail(email, password) {
      try {
        assertReady('email'); const address = requireEmail(email); const secret = requirePassword(password, true);
        return run(async () => {
          const result = await context.sdk.createUserWithEmailAndPassword(context.auth, address, secret);
          try { await context.sdk.sendEmailVerification(result.user); return { user: visibleUser(result.user), verificationSent: true }; }
          catch { return { user: visibleUser(result.user), verificationSent: false, warning: '계정을 만들었습니다. 인증 메일 발송은 완료하지 못했으니 계정 화면에서 다시 보내 주세요.' }; }
        });
      } catch (error) { return Promise.reject(authError(error)); }
    },
    resetPassword(email) {
      try {
        assertReady('email'); const address = requireEmail(email);
        return run(async () => {
          try { await context.sdk.sendPasswordResetEmail(context.auth, address); }
          catch (error) { if (error?.code !== 'auth/user-not-found') throw error; }
          return { message: '등록된 이메일이면 비밀번호 재설정 안내가 발송됩니다. 받은편지함과 스팸함을 확인해 주세요.' };
        });
      } catch (error) { return Promise.reject(authError(error)); }
    },
    sendVerification() {
      try {
        assertReady(); const user = context.auth.currentUser;
        if (!user?.email) throw new AuthClientError('missing_user');
        if (user.emailVerified) return Promise.resolve({ alreadyVerified: true });
        return run(async () => { await context.sdk.sendEmailVerification(user); return { verificationSent: true }; });
      } catch (error) { return Promise.reject(authError(error)); }
    },
    signOut() {
      try { assertReady(); return run(() => context.sdk.signOut(context.auth), { phase: 'signing-out' }); }
      catch (error) { return Promise.reject(authError(error)); }
    },
    getState() { return { ...state }; },
    getContext() { return context; },
    subscribe(listener) { listeners.add(listener); listener({ ...state }); return () => listeners.delete(listener); },
    destroy() { disposed = true; cancelSocial?.(); unsubscribeAuth?.(); listeners.clear(); context = null; },
  };
}
