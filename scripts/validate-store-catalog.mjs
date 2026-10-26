import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { validateStoreManifest, validateStoreRouting, validateStoreRows } from '../src/store-catalog.mjs';

// Validate every published fragment rather than trusting the importer counts.
const base = new URL('../data/store-catalog/', import.meta.url);
const manifest = validateStoreManifest(JSON.parse(await readFile(new URL('manifest.json', base), 'utf8')));
let rows = 0;
for (const file of [manifest.routing, ...manifest.shards]) {
  const bytes = await readFile(new URL(file.path, base));
  if (bytes.length !== file.compressedBytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error(`압축 파일 불일치: ${file.path}`);
  const raw = gunzipSync(bytes, { maxOutputLength:file.uncompressedBytes });
  if (raw.length !== file.uncompressedBytes) throw new Error(`압축 해제 크기 불일치: ${file.path}`);
  const parsed = JSON.parse(raw.toString('utf8'));
  if (file === manifest.routing) validateStoreRouting(parsed, manifest.shards.length);
  else rows += validateStoreRows(parsed, file).length;
}
if (rows !== manifest.acceptedCount) throw new Error('전체 검색 행 수가 수록 건수와 다릅니다.');
console.log(`전국 상가 ${rows.toLocaleString('ko-KR')}곳, ${manifest.regions.length}개 시도, ${manifest.shards.length}개 검색 파일의 행·크기·SHA-256 확인 완료`);
