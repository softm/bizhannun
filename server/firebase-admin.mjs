import { createHash, createPrivateKey } from 'node:crypto';

const configuredApps = new Map();
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Server-only credentials. Never return this object from an API. */
function readCredentials(env) {
  let source;
  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    if (typeof env.FIREBASE_SERVICE_ACCOUNT_JSON !== 'string' || env.FIREBASE_SERVICE_ACCOUNT_JSON.length > 100_000) throw new Error('Invalid server configuration');
    source = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else {
    source = { project_id: env.FIREBASE_PROJECT_ID, client_email: env.FIREBASE_CLIENT_EMAIL, private_key: env.FIREBASE_PRIVATE_KEY };
  }
  if (!object(source)) throw new Error('Invalid server configuration');
  const projectId = source.project_id ?? source.projectId;
  const clientEmail = source.client_email ?? source.clientEmail;
  const rawKey = source.private_key ?? source.privateKey;
  if (typeof projectId !== 'string' || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId)) throw new Error('Invalid server configuration');
  if (typeof clientEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(clientEmail)) throw new Error('Invalid server configuration');
  if (typeof rawKey !== 'string' || rawKey.length > 32_000) throw new Error('Invalid server configuration');
  const privateKey = rawKey.replace(/\\n/g, '\n');
  if (!privateKey.includes('-----BEGIN PRIVATE KEY-----') || createPrivateKey(privateKey).asymmetricKeyType !== 'rsa') throw new Error('Invalid server configuration');
  return { projectId, clientEmail, privateKey };
}

export function getFirebaseAdminProjectId(env = process.env) {
  try { return readCredentials(env).projectId; } catch { return null; }
}

export function isFirebaseAdminConfigured(env = process.env) {
  return getFirebaseAdminProjectId(env) !== null;
}

export function socialUid(provider, subject) {
  if (!['kakao', 'naver'].includes(provider) || typeof subject !== 'string' || !subject || subject.length > 512 || /[\u0000-\u001f\u007f]/.test(subject)) throw new Error('Invalid social identity');
  return `${provider}:${createHash('sha256').update(subject).digest('hex')}`;
}

async function getServerAuth(env) {
  const credentials = readCredentials(env);
  const key = createHash('sha256').update(JSON.stringify(credentials)).digest('hex');
  let promise = configuredApps.get(key);
  if (!promise) {
    promise = (async () => {
      const [{ initializeApp, getApps, cert }, { getAuth }] = await Promise.all([import('firebase-admin/app'), import('firebase-admin/auth')]);
      const name = `bizhannun-social-${key.slice(0, 24)}`;
      const app = getApps().find((item) => item.name === name) ?? initializeApp({ credential: cert(credentials), projectId: credentials.projectId }, name);
      return getAuth(app);
    })();
    configuredApps.set(key, promise);
    promise.catch(() => configuredApps.delete(key));
  }
  return promise;
}

/** Identity is obtained only from the provider API by social-auth.mjs. */
export async function createFirebaseSocialToken(identity, env = process.env) {
  const uid = socialUid(identity.provider, identity.subject);
  const auth = await getServerAuth(env);
  const displayName = typeof identity.displayName === 'string' ? identity.displayName.trim().slice(0, 100) : '';
  let user;
  try { user = await auth.getUser(uid); } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error;
    try {
      user = await auth.createUser({ uid, ...(displayName ? { displayName } : {}) });
    } catch (createError) {
      if (createError.code !== 'auth/uid-already-exists') throw createError;
      user = await auth.getUser(uid);
    }
  }
  if (user.disabled) throw new Error('Social sign-in unavailable');
  // Do not copy email or link an existing email account. Provider identities
  // remain distinct even when the same person uses several providers.
  return auth.createCustomToken(uid, { socialProvider: identity.provider });
}
