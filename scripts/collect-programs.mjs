import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { normalizeProgram, koreanToday, periodState, textOnly } from '../src/programs.mjs';

export const DEFAULT_MANIFEST = 'https://policyfundfinder.designboard.net/data/manifest.json';
const root = fileURLToPath(new URL('../', import.meta.url));
const dataRoot = resolve(root, 'data');
class UpstreamError extends Error {}
async function atomicJson(path, value) { const temp = path + '.tmp'; await writeFile(temp, JSON.stringify(value) + '\n'); await rename(temp, path); }
async function bytesFrom(url, fetcher, maxBytes) {
  let response;
  try { response = await fetcher(url, { signal: AbortSignal.timeout(25000), headers: { Accept: 'application/json, application/gzip' } }); } catch { throw new UpstreamError('공개 공고 원천 연결이 지연되거나 실패했습니다.'); }
  if (!response.ok) throw new UpstreamError(`공개 공고 원천 HTTP ${response.status}`);
  if (Number(response.headers.get('content-length')) > maxBytes) throw new UpstreamError('원천 파일이 허용 크기를 초과했습니다.');
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > maxBytes) { await reader.cancel(); throw new UpstreamError('원천 파일이 허용 크기를 초과했습니다.'); } chunks.push(value); } } catch (e) { throw e instanceof UpstreamError ? e : new UpstreamError('원천 다운로드가 완료되지 않았습니다.'); }
  return Buffer.concat(chunks);
}
export async function collectPrograms({ fetcher = globalThis.fetch, manifestUrl = process.env.PROGRAMS_MANIFEST_URL || DEFAULT_MANIFEST, outputDir = dataRoot, limit = 2000, now = new Date() } = {}) {
  const attempted = now.toISOString();
  await mkdir(outputDir, { recursive: true });
  const programsPath = resolve(outputDir, 'programs.json'), statusPath = resolve(outputDir, 'collection-status.json');
  let previous;
  try { previous = JSON.parse(await readFile(programsPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw new Error('기존 공고 JSON을 읽을 수 없어 수집을 중단했습니다.'); previous = { schema: 1, meta: { status: 'not_collected' }, programs: [] }; }
  if (!Array.isArray(previous.programs)) throw new Error('기존 공고 목록 형식이 손상되어 수집을 중단했습니다.');
  const u = new URL(manifestUrl);
  if (u.protocol !== 'https:' || !['policyfundfinder.designboard.net', 'softm.github.io', 'raw.githubusercontent.com'].includes(u.hostname) || u.username || u.password) throw new Error('허용된 지원한눈 HTTPS 원천 URL이 아닙니다.');
  const selectionLimit = Math.max(1, Math.min(2000, Math.trunc(Number(limit) || 2000)));
  try {
    const manifestBytes = await bytesFrom(u.href, fetcher, 2 * 1024 * 1024);
    let manifest;
    try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { throw new Error('원천 manifest JSON 형식이 올바르지 않습니다.'); }
    if (manifest.schema !== 1 || !/^v-[\w.-]{1,100}$/.test(manifest.version || '') || !manifest.files?.['index.json.gz']) throw new Error('지원하지 않는 원천 manifest 형식입니다.');
    const indexUrl = new URL(`${manifest.version}/index.json.gz`, new URL('./', u)).href;
    const gzip = await bytesFrom(indexUrl, fetcher, 16 * 1024 * 1024);
    const expected = manifest.files['index.json.gz'];
    if (expected.bytes !== gzip.length || expected.sha256 !== createHash('sha256').update(gzip).digest('hex')) throw new Error('원천 목록의 파일 크기 또는 SHA-256이 일치하지 않습니다.');
    let index;
    try { index = JSON.parse(gunzipSync(gzip, { maxOutputLength: 128 * 1024 * 1024 }).toString('utf8')); } catch { throw new Error('원천 압축 목록을 읽을 수 없습니다.'); }
    if (!Array.isArray(index.programs) || !index.programs.length || index.programs.length !== manifest.status?.count) throw new Error('원천 공고 건수가 manifest와 일치하지 않습니다.');
    const seen = new Set(), reasons = { invalidMetadata: 0, duplicateId: 0, beyondLimit: 0 };
    const valid = [];
    for (const row of index.programs) { const p = normalizeProgram(row); if (!p) { reasons.invalidMetadata++; continue; } if (seen.has(p.id)) { reasons.duplicateId++; continue; } seen.add(p.id); valid.push(p); }
    if (!valid.length) throw new Error('사용 가능한 공고 메타데이터가 없어 이전 성공본을 유지합니다.');
    const today = koreanToday(now);
    valid.sort((a, b) => Number(periodState(a, today) === 'closed') - Number(periodState(b, today) === 'closed') || (b.publishedAt || '').localeCompare(a.publishedAt || ''));
    const programs = valid.slice(0, selectionLimit); reasons.beyondLimit = Math.max(0, valid.length - programs.length);
    const upstreamWarnings = [textOnly(manifest.status?.bizinfoError).slice(0, 1000)].filter(Boolean);
    const upstreamSources = {
      bizinfo: { lastSuccessAt: textOnly(manifest.status?.bizinfoLastSuccess) || null, warning: upstreamWarnings[0] || null },
      npay: { lastSuccessAt: textOnly(manifest.status?.catalog?.lastSuccess) || null, sourceCount: manifest.status?.catalog?.npaySourceCount ?? null, activeCount: manifest.status?.catalog?.npayActiveCount ?? null },
    };
    const meta = {
      status: 'success', collectedAt: attempted, lastAttemptAt: attempted, lastSuccessAt: attempted,
      upstreamLastSuccessAt: manifest.status?.lastSuccess || null, upstreamVersion: manifest.version,
      upstreamSources, upstreamWarnings,
      sourceCount: index.programs.length, inputCount: index.programs.length, count: programs.length,
      excludedCount: index.programs.length - programs.length, exclusionReasons: reasons,
      partial: programs.length < index.programs.length, selectionLimit,
      selectionPolicy: '마감되지 않은 공고 우선, 원천 게시일 내림차순, 게시일 미제공은 원천 순서 유지',
      sourceUrl: u.href, indexUrl, upstreamStale: !Number.isFinite(Date.parse(manifest.status?.lastSuccess)) || +now - Date.parse(manifest.status.lastSuccess) > 36 * 3600000,
      message: `원천 ${index.programs.length}건 중 메타데이터 ${programs.length}건을 연결했습니다. 공고 본문·첨부는 재배포하지 않습니다.${upstreamWarnings.length ? ' ' + upstreamWarnings.join(' ') : ''}`,
    };
    await atomicJson(programsPath, { schema: 1, meta, programs });
    await atomicJson(statusPath, { schema: 1, ...meta, errorType: null });
    return { status: 'success', count: programs.length, sourceCount: index.programs.length, partial: meta.partial };
  } catch (e) {
    if (!(e instanceof UpstreamError)) throw e;
    const lastSuccessAt = previous.meta?.lastSuccessAt || previous.meta?.collectedAt || null;
    const status = { schema: 1, status: 'failed', errorType: 'upstream', lastAttemptAt: attempted, lastSuccessAt,
      sourceCount: previous.meta?.sourceCount || 0, inputCount: previous.meta?.inputCount || 0,
      excludedCount: previous.meta?.excludedCount || 0, count: previous.programs.length,
      partial: previous.meta?.partial ?? false, selectionLimit: previous.meta?.selectionLimit ?? selectionLimit,
      upstreamSources: previous.meta?.upstreamSources || {}, upstreamWarnings: previous.meta?.upstreamWarnings || [],
      sourceUrl: u.href, preservedPrevious: Boolean(lastSuccessAt), message: e.message + (lastSuccessAt ? ' 이전 성공 목록을 유지합니다.' : ' 아직 성공한 수집본이 없습니다.') };
    if (!lastSuccessAt && !previous.programs.length) await atomicJson(programsPath, { schema: 1, meta: { ...status, status: 'not_collected' }, programs: [] });
    await atomicJson(statusPath, status);
    return { status: 'failed', errorType: 'upstream', count: previous.programs.length };
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  collectPrograms().then(result => console.log(JSON.stringify(result))).catch(async error => {
    console.error(error.message);
    try { await atomicJson(resolve(dataRoot, 'collection-status.json'), { schema: 1, status: 'failed', errorType: 'integrity', lastAttemptAt: new Date().toISOString(), message: error.message }); } catch {}
    process.exitCode = 1;
  });
}
