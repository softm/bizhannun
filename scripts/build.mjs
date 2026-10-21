import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DIST = join(ROOT, 'dist');
const ROOT_FILES = ['index.html', 'data-status.html', 'app-config.js', 'styles.css', 'manifest.webmanifest'];
const REQUIRED_FILES = [
  ...ROOT_FILES, 'assets/favicon.svg',
  ...['app', 'domain', 'storage', 'api-client', 'programs'].map((name) => `src/${name}.mjs`),
  'data/programs.json', 'data/collection-status.json',
];
const RULES = {
  src: new Set(['.mjs', '.js', '.css', '.json']),
  assets: new Set(['.svg', '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.otf']),
  data: new Set(['.json']),
};

async function collectFiles(directory, extensions, prefix = '') {
  const directoryInfo = await lstat(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error('공개 파일 경로는 실제 디렉터리여야 합니다.');
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const relative = join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`공개 디렉터리의 심볼릭 링크는 빌드할 수 없습니다: ${relative}`);
    if (entry.isDirectory()) result.push(...await collectFiles(join(directory, entry.name), extensions, relative));
    else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) result.push(relative);
  }
  return result;
}

// Direct mode injects the user-authorized public runtime key only into dist.
// Never commit generated settings or print the key.
const files = [...ROOT_FILES];
for (const [directory, extensions] of Object.entries(RULES)) {
  files.push(...(await collectFiles(join(ROOT, directory), extensions)).map((name) => join(directory, name)));
}
const copiedPaths = new Set(files.map((name) => resolve(ROOT, name)));
for (const required of REQUIRED_FILES) {
  if (!copiedPaths.has(resolve(ROOT, required))) throw new Error(`필수 공개 파일이 없습니다: ${required}`);
  const info = await lstat(join(ROOT, required));
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`필수 공개 파일은 실제 파일이어야 합니다: ${required}`);
  await readFile(join(ROOT, required));
}
for (const filename of files.filter((name) => name.startsWith(`src${sep}`) && ['.mjs', '.js'].includes(extname(name)))) {
  const source = await readFile(join(ROOT, filename), 'utf8');
  const imports = /\b(?:import|export)\s+(?:[^;"']*?\s+from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(imports)) {
    const specifier = match[1] || match[2];
    if (!specifier.startsWith('.')) continue;
    const importedPath = fileURLToPath(new URL(specifier, pathToFileURL(join(ROOT, filename))));
    if (!copiedPaths.has(importedPath)) throw new Error(`빌드에 포함되지 않는 브라우저 모듈 import: ${filename} → ${specifier}`);
  }
}
// Read and validate data before replacing a previous build.
for (const filename of files.filter((name) => name.endsWith('.json') || name.endsWith('.webmanifest'))) {
  JSON.parse(await readFile(join(ROOT, filename), 'utf8'));
}

const auth = JSON.parse(await readFile(join(ROOT, 'config/firebase-public.json'), 'utf8'));
auth.providers.kakao = { configured: false, reason: '별도 인증 서버 연결 준비 중입니다.' };
auth.providers.naver = { configured: false, reason: '별도 인증 서버 연결 준비 중입니다.' };
const runtime = { mode: 'direct', apiBase: '', version: '0.5.0',
  ntsServiceKey: process.env.NTS_SERVICE_KEY?.trim() || '', auth };
if (process.env.GITHUB_ACTIONS === 'true' && !runtime.ntsServiceKey) {
  throw new Error('Repository Secret NTS_SERVICE_KEY를 등록한 뒤 배포하세요.');
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
for (const filename of files) {
  await mkdir(join(DIST, filename, '..'), { recursive: true });
  await copyFile(join(ROOT, filename), join(DIST, filename));
}
await writeFile(join(DIST, 'app-config.js'), `window.BIZHANNUN_CONFIG = Object.freeze(${JSON.stringify(runtime).replaceAll('<', '\\u003c')});\n`);
// Give HTML, settings and every browser module the same content-based version.
// This prevents an older cached import from mixing with a newly deployed page.
const browserFiles = files.filter((name) => name === 'app-config.js' || name === 'styles.css' || (name.startsWith(`src${sep}`) && ['.mjs', '.js'].includes(extname(name)))).sort();
const hash = createHash('sha256');
for (const filename of browserFiles) hash.update(filename).update(await readFile(join(DIST, filename)));
const version = hash.digest('hex').slice(0, 12);
for (const filename of browserFiles.filter((name) => name.startsWith(`src${sep}`))) {
  const content = await readFile(join(DIST, filename), 'utf8');
  const versioned = content.replace(/((?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'])(\.{1,2}\/[^"']+\.(?:mjs|js))(["'])/g, `$1$2?v=${version}$3`);
  await writeFile(join(DIST, filename), versioned);
}
for (const filename of ['index.html', 'data-status.html']) {
  const content = await readFile(join(DIST, filename), 'utf8');
  const versioned = content.replace(/((?:src|href)=["'])(\.\/(?:src\/app\.mjs|styles\.css|app-config\.js))(["'])/g, `$1$2?v=${version}$3`);
  await writeFile(join(DIST, filename), versioned);
}
await writeFile(join(DIST, '.nojekyll'), '');
console.log(`공개 파일 ${files.length + 1}개를 dist/에 빌드했습니다. 서버 코드·서버 인증정보·문서는 포함하지 않습니다. 직접 조회용 키는 배포 설정에 주입됩니다.`);
