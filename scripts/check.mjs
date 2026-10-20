import { readFile, readdir } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const scripts = ['app-config.js'];
const json = ['package.json', 'vercel.json', 'manifest.webmanifest'];
const requiredFiles = [
  'index.html', 'data-status.html', 'styles.css', 'assets/favicon.svg',
  ...['app', 'domain', 'storage', 'api-client', 'programs'].map((name) => `src/${name}.mjs`),
  'data/programs.json', 'data/collection-status.json',
];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(join(ROOT, directory), { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const filename = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`검사 경로에 심볼릭 링크가 있습니다: ${filename}`);
    if (entry.isDirectory()) files.push(...await walk(filename));
    else if (entry.isFile()) files.push(filename);
  }
  return files;
}

for (const directory of ['src', 'server', 'scripts', 'api', 'tests', 'data']) {
  for (const filename of await walk(directory)) {
    if (['.js', '.mjs'].includes(extname(filename))) scripts.push(filename);
    if (extname(filename) === '.json') json.push(filename);
  }
}

let failures = 0;
for (const filename of scripts) {
  const result = spawnSync(process.execPath, ['--check', join(ROOT, filename)], { encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`${filename}: 구문 검사 실패\n${result.stderr || result.error?.message || ''}`);
    failures += 1;
  }
}
for (const filename of json) {
  try { JSON.parse(await readFile(join(ROOT, filename), 'utf8')); }
  catch { console.error(`${filename}: JSON 검사 실패`); failures += 1; }
}
for (const filename of requiredFiles) {
  try { await readFile(join(ROOT, filename)); }
  catch { console.error(`${filename}: 필수 공개 파일이 없습니다.`); failures += 1; }
}
for (const filename of scripts.filter((name) => name.startsWith(`src${sep}`))) {
  const source = await readFile(join(ROOT, filename), 'utf8');
  const imports = /\b(?:import|export)\s+(?:[^;"']*?\s+from\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(imports)) {
    const specifier = match[1] || match[2];
    if (!specifier.startsWith('.')) continue;
    try { await readFile(fileURLToPath(new URL(specifier, pathToFileURL(join(ROOT, filename))))); }
    catch { console.error(`${filename}: import 파일이 없습니다: ${specifier}`); failures += 1; }
  }
}
if (failures) process.exitCode = 1;
else console.log(`JavaScript ${scripts.length}개 구문, JSON ${json.length}개 및 필수 공개 파일을 확인했습니다. 동작 테스트는 npm test로 실행합니다.`);
