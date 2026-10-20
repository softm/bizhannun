import { readFile } from 'node:fs/promises';
import { getAllowedAuthOrigins, getSocialAuthStatus } from './social-auth.mjs';
import { getFirebaseAdminProjectId } from './firebase-admin.mjs';

const PUBLIC_KEYS = ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId', 'measurementId'];
const REQUIRED_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fallbackUrl = new URL('../config/firebase-public.json', import.meta.url);

function parseObject(raw) {
  if (typeof raw !== 'string' || raw.length > 64_000) throw new Error('Invalid public configuration');
  const value = JSON.parse(raw);
  if (!object(value)) throw new Error('Invalid public configuration');
  return value;
}

function publicFirebase(source) {
  if (source === undefined || source === null) return null;
  if (!object(source)) throw new Error('Invalid public configuration');
  const config = {};
  for (const key of PUBLIC_KEYS) {
    if (!Object.hasOwn(source, key)) continue;
    if (typeof source[key] !== 'string' || source[key].length > 2048 || /[\u0000-\u001f\u007f]/.test(source[key])) throw new Error('Invalid public configuration');
    config[key] = source[key].trim();
  }
  if (!REQUIRED_KEYS.every((key) => config[key])) return null;
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(config.projectId) || !/^[a-zA-Z0-9.-]+$/.test(config.authDomain)) throw new Error('Invalid public configuration');
  return config;
}

function enabled(override, fallback) {
  if (override === undefined || override === '') return fallback === true;
  if (override === 'true') return true;
  if (override === 'false') return false;
  throw new Error('Invalid public configuration');
}

export async function getPublicConfig(env = process.env, deps = {}) {
  let fallback = {};
  try { fallback = parseObject(await (deps.readFile ?? readFile)(fallbackUrl, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new Error('Invalid public configuration'); }
  const firebase = publicFirebase(env.FIREBASE_WEB_CONFIG ? parseObject(env.FIREBASE_WEB_CONFIG) : fallback.firebase);
  const configured = Boolean(firebase);
  const databaseId = env.FIRESTORE_DATABASE_ID || fallback.firestore?.databaseId || 'bizhannun';
  const edition = env.FIRESTORE_EDITION || fallback.firestore?.edition || 'ENTERPRISE';
  if (typeof databaseId !== 'string' || !/^(?:\(default\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$/.test(databaseId) || !['STANDARD', 'ENTERPRISE'].includes(edition)) throw new Error('Invalid public configuration');
  const providers = {
    google: { configured: configured && enabled(env.FIREBASE_GOOGLE_ENABLED, fallback.providers?.google?.configured) },
    email: { configured: configured && enabled(env.FIREBASE_EMAIL_ENABLED, fallback.providers?.email?.configured) },
    ...getSocialAuthStatus(env),
  };
  const sameAdminProject = configured && getFirebaseAdminProjectId(env) === firebase.projectId;
  for (const provider of ['kakao', 'naver']) {
    if (!sameAdminProject) providers[provider] = { configured: false, reason: '같은 Firebase 프로젝트의 서버 인증 설정이 필요합니다.' };
  }
  return { configured, firebase, providers, firestore: { databaseId, edition } };
}

export async function handlePublicConfig(request, env = process.env, deps = {}) {
  const origin = request.headers.get('origin');
  const allowed = !origin || getAllowedAuthOrigins(env, new URL(request.url).origin).has(origin);
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
  if (allowed && origin) headers['Access-Control-Allow-Origin'] = origin;
  const error = (code, message, status) => new Response(JSON.stringify({ error: { code, message } }), { status, headers });
  if (!allowed) return error('origin_not_allowed', '허용되지 않은 웹사이트의 요청입니다.', 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } });
  if (request.method !== 'GET') {
    headers.Allow = 'GET, OPTIONS';
    return error('method_not_allowed', '지원하지 않는 요청 방식입니다.', 405);
  }
  try { return new Response(JSON.stringify(await getPublicConfig(env, deps)), { status: 200, headers }); }
  catch { return error('configuration_error', '로그인 공개 설정을 읽을 수 없습니다. 서버 설정을 확인해 주세요.', 503); }
}

export const handleConfig = handlePublicConfig;
