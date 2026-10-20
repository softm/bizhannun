import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { handleApi } from '../api/index.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ROOT_FILES = new Set([
  '/index.html', '/data-status.html', '/app-config.js', '/styles.css',
  '/manifest.webmanifest', '/favicon.ico', '/favicon.svg',
]);
const SOURCE_EXTENSIONS = new Set(['.mjs', '.js', '.css', '.json']);
const ASSET_EXTENSIONS = new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.otf']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.gz': 'application/gzip',
};
const PUBLIC_HEADERS = {
  'Cache-Control': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function publicFile(pathname) {
  if (ROOT_FILES.has(pathname)) return true;
  const extension = extname(pathname).toLowerCase();
  if (pathname.startsWith('/src/')) return SOURCE_EXTENSIONS.has(extension);
  if (pathname.startsWith('/assets/')) return ASSET_EXTENSIONS.has(extension);
  if (pathname.startsWith('/data/')) return extension === '.json' || pathname.endsWith('.json.gz');
  return false;
}

function safePath(rawUrl) {
  if (!rawUrl?.startsWith('/')) return null;
  let decoded;
  try { decoded = decodeURIComponent(rawUrl.split(/[?#]/, 1)[0]); } catch { return null; }
  if (decoded.includes('\\') || /[\u0000-\u001f\u007f]/.test(decoded)) return null;
  if (decoded.split('/').some((part) => part === '.' || part === '..' || part.startsWith('.'))) return null;
  if (decoded === '/bizhannun') return { redirect: '/bizhannun/' };
  const pathname = decoded.startsWith('/bizhannun/') ? decoded.slice('/bizhannun'.length) : decoded;
  return { pathname: pathname === '/' ? '/index.html' : pathname };
}

function sendText(response, status, message, method = 'GET') {
  response.writeHead(status, { ...PUBLIC_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(method === 'HEAD' ? undefined : message);
}

async function serveApi(request, response, pathname, env, fetchImpl) {
  const localPort = request.socket.localPort || 4173;
  const url = new URL(request.url, `http://127.0.0.1:${localPort}`);
  url.pathname = pathname;
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  // Trust the local socket, not a caller-supplied forwarding header.
  headers.delete('x-vercel-forwarded-for');
  headers.set('x-forwarded-for', request.socket.remoteAddress || 'local');
  const options = { method: request.method, headers };
  if (!['GET', 'HEAD'].includes(request.method)) {
    options.body = Readable.toWeb(request);
    options.duplex = 'half';
  }
  const result = await handleApi(new Request(url, options), env, fetchImpl);
  response.writeHead(result.status, Object.fromEntries(result.headers));
  if (!result.body || request.method === 'HEAD') response.end();
  else await pipeline(Readable.fromWeb(result.body), response);
}

/** Loopback-only development server; it never serves repository directories. */
export function createDevServer({ env = process.env, fetchImpl = fetch } = {}) {
  return http.createServer(async (request, response) => {
    try {
      const path = safePath(request.url);
      if (!path) return sendText(response, 400, '잘못된 경로입니다.', request.method);
      if (path.redirect) {
        response.writeHead(308, { ...PUBLIC_HEADERS, Location: path.redirect });
        return response.end();
      }
      const { pathname } = path;
      if (pathname.startsWith('/api/')) return await serveApi(request, response, pathname, env, fetchImpl);
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.setHeader('Allow', 'GET, HEAD');
        return sendText(response, 405, '지원하지 않는 요청 방식입니다.', request.method);
      }
      if (!publicFile(pathname)) return sendText(response, 404, '파일을 찾을 수 없습니다.', request.method);
      const candidate = resolve(ROOT, `.${pathname}`);
      if (!candidate.startsWith(`${ROOT.replace(/[\\/]$/, '')}${sep}`)) {
        return sendText(response, 404, '파일을 찾을 수 없습니다.', request.method);
      }
      let resolved;
      let info;
      try {
        [resolved, info] = await Promise.all([realpath(candidate), stat(candidate)]);
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(error.code)) return sendText(response, 404, '파일을 찾을 수 없습니다.', request.method);
        throw error;
      }
      // A link in src/assets/data must not expose a file from another directory.
      if (resolved !== candidate || !info.isFile()) return sendText(response, 404, '파일을 찾을 수 없습니다.', request.method);
      response.writeHead(200, {
        ...PUBLIC_HEADERS,
        'Content-Type': MIME[extname(pathname).toLowerCase()] || 'application/octet-stream',
        'Content-Length': info.size,
      });
      response.end(request.method === 'HEAD' ? undefined : await readFile(candidate));
    } catch {
      // Exceptions can include provider URLs and keys. Keep local errors generic.
      if (!response.headersSent && !response.destroyed) sendText(response, 500, '요청을 처리하지 못했습니다.', request.method);
      else if (!response.destroyed) response.destroy();
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rawPort = process.env.PORT ?? '4173';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT는 1부터 65535 사이의 정수여야 합니다.');
  const server = createDevServer();
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? '개발 서버 포트가 이미 사용 중입니다. PORT 값을 변경하세요.' : '개발 서버를 시작하지 못했습니다.');
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`사업자한눈: http://127.0.0.1:${port}/`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close());
}
