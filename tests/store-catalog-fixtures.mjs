import { gzipSync } from 'node:zlib';
import { createHash, webcrypto } from 'node:crypto';
import { storeNameGrams } from '../src/store-catalog.mjs';
import { createStoreCatalogEngine } from '../src/store-catalog-worker.mjs';

export const MANIFEST_URL = 'https://softm.github.io/bizhannun/data/store-catalog/manifest.json';
export function row(id, name, { branch = '', road = '서울특별시 강남구 테헤란로 1', land = '',
  region = '11', district = '강남구', industry = '커피 전문점' } = {}) {
  return [id, name, branch, road, land, region, district, 'I21201', industry, 127.01, 37.5];
}
export function pack(value, path) {
  const raw = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  const bytes = gzipSync(raw);
  return { bytes, descriptor: { path, compressedBytes: bytes.length, uncompressedBytes: raw.length,
    sha256: createHash('sha256').update(bytes).digest('hex') } };
}
export function fixture(groups) {
  const files = new Map(), grams = {}, regionCounts = new Map();
  const shards = groups.map((rows, index) => {
    const id = `${rows[0][5]}-${String(index).padStart(4, '0')}`;
    const packed = pack(rows, `shards/${id}.json.gz`);
    files.set(packed.descriptor.path, packed.bytes);
    regionCounts.set(rows[0][5], (regionCounts.get(rows[0][5]) || 0) + rows.length);
    const groupGrams = new Set();
    for (const row of rows) for (const name of [row[1], `${row[1]} ${row[2]}`]) {
      for (const gram of storeNameGrams(name)) groupGrams.add(gram);
    }
    for (const gram of groupGrams) (grams[gram] ||= []).push(index);
    return { id, ...packed.descriptor, rowCount: rows.length, regionCode: rows[0][5] };
  });
  const routing = pack({ schemaVersion: 1, grams }, 'routing.json.gz');
  files.set(routing.descriptor.path, routing.bytes);
  const count = groups.flat().length;
  const manifest = {
    schemaVersion: 1, version: 'semas-20260630-test', sourceDate: '2026-06-30', collectedAt: '2026-10-21T18:00:00.000Z',
    sourceCount: count, acceptedCount: count, rejectedCount: 0, duplicateCount: 0,
    source: { provider: 'semas', name: '소상공인시장진흥공단 상가(상권)정보',
      url: 'https://www.data.go.kr/data/15083033/fileData.do', license: '공공누리 제1유형' },
    regions: [...regionCounts].map(([code, count]) => ({ code, name: code === '11' ? '서울특별시' : code === '41' ? '경기도' : '부산광역시', count })),
    shards, routing: routing.descriptor,
  };
  const calls = [];
  const fetchImpl = async (value, options = {}) => {
    const url = new URL(value), path = url.pathname.split('/store-catalog/')[1];
    calls.push({ url: url.href, path, options });
    if (path === 'manifest.json') return new Response(JSON.stringify(manifest));
    return files.has(path) ? new Response(files.get(path), { headers: { 'content-length': String(files.get(path).length) } })
      : new Response('not found', { status: 404 });
  };
  return { manifest, files, calls, fetchImpl, engine: options => createStoreCatalogEngine({ fetchImpl, cryptoImpl: webcrypto, ...options }) };
}
