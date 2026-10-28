import {
  STORE_CATALOG_LIMITS, StoreCatalogError, StoreSearchAccumulator, compileStoreQuery,
  matchStoreRow, selectStoreShardIndices, validateStoreManifest, validateStoreRouting, validateStoreRows,
} from './store-catalog.mjs';

export function storeCatalogAbortError() {
  const error = new Error('상가 검색을 취소했습니다.'); error.name = 'AbortError'; return error;
}
const throwIfAborted = signal => { if (signal?.aborted) throw storeCatalogAbortError(); };
const yieldTask = () => new Promise(resolve => setTimeout(resolve, 0));

/** Exact byte accounting: cache decompressed UTF-8, not unbounded JS row objects. */
export class DecodedStoreCache {
  constructor(maxBytes = STORE_CATALOG_LIMITS.cacheBytes) {
    this.maxBytes = Number.isSafeInteger(maxBytes) && maxBytes >= 0
      ? Math.min(maxBytes, STORE_CATALOG_LIMITS.cacheBytes) : STORE_CATALOG_LIMITS.cacheBytes;
    this.bytes = 0; this.entries = new Map();
  }
  get(key) {
    const value = this.entries.get(key);
    if (!value) return null;
    this.entries.delete(key); this.entries.set(key, value); return value;
  }
  set(key, bytes) {
    const previous = this.entries.get(key);
    if (previous) { this.entries.delete(key); this.bytes -= previous.byteLength; }
    if (bytes.byteLength > this.maxBytes) return;
    while (this.bytes + bytes.byteLength > this.maxBytes && this.entries.size) {
      const first = this.entries.keys().next().value;
      this.bytes -= this.entries.get(first).byteLength; this.entries.delete(first);
    }
    this.entries.set(key, bytes); this.bytes += bytes.byteLength;
  }
  clear() { this.entries.clear(); this.bytes = 0; }
  stats() { return { bytes: this.bytes, maxBytes: this.maxBytes, entries: this.entries.size }; }
}

function parseJson(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new StoreCatalogError('invalid_json', '상가 검색 파일을 해석할 수 없습니다.'); }
}

async function readBoundedStream(stream, maxBytes, signal) {
  throwIfAborted(signal);
  if (!stream || typeof stream.getReader !== 'function') throw new StoreCatalogError('empty_response', '상가 검색 파일의 내용이 없습니다.');
  const reader = stream.getReader(), chunks = [];
  let length = 0;
  const abort = () => { reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      throwIfAborted(signal);
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new StoreCatalogError('file_too_large', '상가 검색 파일이 게시된 크기를 초과했습니다.');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally {
    signal?.removeEventListener('abort', abort);
    try { reader.releaseLock(); } catch { /* Cancellation may still be releasing a read. */ }
  }
}

async function verifiedGzip({ manifestUrl, manifest, file, signal, fetchImpl, cryptoImpl, DecompressionStreamImpl, timeoutMs }) {
  if (!cryptoImpl?.subtle || typeof DecompressionStreamImpl !== 'function') {
    throw new StoreCatalogError('unsupported_browser', '현재 브라우저는 압축 상가 검색을 지원하지 않습니다. 최신 브라우저로 다시 시도해 주세요.');
  }
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const url = new URL(file.path, manifestUrl);
  // Both source updates and republishing a corrected index for the same source
  // must receive a fresh CDN key. The descriptor checksum identifies the bytes.
  url.searchParams.set('v', manifest.version);
  url.searchParams.set('sha', file.sha256);
  try {
    throwIfAborted(signal);
    // Same-origin routing/shard files share the authenticated deployment session;
    // a catalog hosted on another origin still receives no browser credentials.
    const response = await fetchImpl(url.href, {
      signal: controller.signal, cache: 'force-cache', credentials: 'same-origin', redirect: 'error',
    });
    throwIfAborted(signal);
    if (!response.ok) throw new StoreCatalogError('http_error', `상가 검색 파일을 불러오지 못했습니다. (HTTP ${response.status})`);
    const length = response.headers?.get('content-length');
    if (length && Number(length) > file.compressedBytes) throw new StoreCatalogError('file_too_large', '압축 상가 검색 파일이 게시된 크기를 초과했습니다.');
    const compressed = await readBoundedStream(response.body, file.compressedBytes, controller.signal);
    if (compressed.byteLength !== file.compressedBytes) throw new StoreCatalogError('compressed_size_mismatch', '압축 상가 검색 파일의 크기가 게시 정보와 다릅니다.');
    const hash = await cryptoImpl.subtle.digest('SHA-256', compressed);
    throwIfAborted(controller.signal);
    const actual = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
    if (actual !== file.sha256) throw new StoreCatalogError('checksum_mismatch', '상가 검색 파일의 무결성 검사가 일치하지 않습니다.');
    let decoded;
    try {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStreamImpl('gzip'));
      decoded = await readBoundedStream(stream, file.uncompressedBytes, controller.signal);
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof StoreCatalogError) throw error;
      throw new StoreCatalogError('invalid_gzip', '상가 검색 파일의 압축을 풀 수 없습니다.');
    }
    throwIfAborted(controller.signal);
    if (decoded.byteLength !== file.uncompressedBytes) throw new StoreCatalogError('uncompressed_size_mismatch', '상가 검색 파일의 압축 해제 크기가 게시 정보와 다릅니다.');
    return decoded;
  } catch (error) {
    if (signal?.aborted) throw storeCatalogAbortError();
    if (timedOut) throw new StoreCatalogError('request_timeout', '상가 검색 파일을 불러오는 시간이 초과되었습니다. 다시 검색해 주세요.');
    if (error instanceof StoreCatalogError) throw error;
    throw new StoreCatalogError('fetch_failed', '상가 검색 파일을 불러오지 못했습니다. 연결 상태를 확인하고 다시 검색해 주세요.');
  } finally {
    clearTimeout(timeout); signal?.removeEventListener('abort', forwardAbort);
  }
}

function failure(error, file, kind = 'shard') {
  return { kind, id: file.id || null, path: file.path, regionCode: file.regionCode || null,
    rowCount: file.rowCount ?? null, code: error.code || 'search_failed',
    message: error instanceof StoreCatalogError ? error.message : '상가 검색 파일을 처리하지 못했습니다.' };
}

/** The worker and unit tests use the same cancellation-aware search engine. */
export function createStoreCatalogEngine({
  fetchImpl = globalThis.fetch?.bind(globalThis), cryptoImpl = globalThis.crypto,
  DecompressionStreamImpl = globalThis.DecompressionStream, concurrency = 2,
  cacheBytes = STORE_CATALOG_LIMITS.cacheBytes, timeoutMs = 30_000,
} = {}) {
  const cache = new DecodedStoreCache(cacheBytes);
  const parallel = concurrency === 4 ? 4 : 2;
  let active = null, sequence = 0, closed = false, activeVersion = '';

  function cancel() { sequence++; active?.abort(); active = null; }

  async function search({ manifest: input, manifestUrl, query, regionCode = '', limit = 200, onProgress, signal } = {}) {
    if (closed) throw new StoreCatalogError('closed', '상가 검색이 종료되었습니다.');
    cancel();
    const id = sequence, controller = new AbortController();
    active = controller;
    const forwardAbort = () => controller.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });
    if (signal?.aborted) controller.abort();
    const check = () => {
      throwIfAborted(controller.signal);
      if (id !== sequence) throw storeCatalogAbortError();
    };
    try {
      check();
      const manifest = validateStoreManifest(input), compiled = compileStoreQuery(query);
      if (!compiled.valid) throw new StoreCatalogError('invalid_query', compiled.error);
      let base;
      try {
        base = new URL(manifestUrl);
        if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password) throw new Error();
      } catch { throw new StoreCatalogError('invalid_manifest_url', '상가 검색 자료 주소가 올바르지 않습니다.'); }
      if (regionCode && !manifest.regions.some(region => region.code === regionCode)) throw new StoreCatalogError('invalid_region', '검색할 지역을 다시 선택해 주세요.');
      const version = `${base.href}|${manifest.version}`;
      if (version !== activeVersion) { cache.clear(); activeVersion = version; }
      const accumulator = new StoreSearchAccumulator(limit), failures = [];
      const progress = { phase: 'routing', completedShards: 0, totalShards: null, successfulShards: 0,
        failedShards: 0, scannedRows: 0, candidateRows: 0, failedRows: 0, cachedFiles: 0 };
      let lastProgressAt = -Infinity;

      function result({ finished = false, status = 'searching' } = {}) {
        const complete = finished && status === 'complete';
        const results = accumulator.results();
        return { query: compiled.query, regionCode, catalogVersion: manifest.version,
          results, total: complete ? accumulator.total : null, foundCount: accumulator.total,
          shownCount: results.length, capped: accumulator.total > accumulator.limit, limit: accumulator.limit,
          complete, finished, status, progress: { ...progress }, failures: failures.map(item => ({ ...item })) };
      }

      function emit(force = false) {
        check();
        const now = Date.now();
        if (!force && now - lastProgressAt < 150) return;
        lastProgressAt = now;
        if (typeof onProgress === 'function') {
          try { onProgress(result()); } catch { /* Rendering callbacks cannot corrupt the search. */ }
        }
      }

      async function load(file, validate) {
        check();
        const key = `${version}|${file.path}|${file.sha256}`;
        let bytes = cache.get(key);
        if (bytes) progress.cachedFiles++;
        else bytes = await verifiedGzip({ manifestUrl: base.href, manifest, file,
          signal: controller.signal, fetchImpl, cryptoImpl, DecompressionStreamImpl, timeoutMs });
        check();
        const parsed = validate(parseJson(bytes));
        check();
        cache.set(key, bytes);
        return parsed;
      }

      emit(true);
      let routing;
      try { routing = await load(manifest.routing, parsed => validateStoreRouting(parsed, manifest.shards.length)); }
      catch (error) {
        check(); failures.push(failure(error, manifest.routing, 'routing')); progress.phase = 'error';
        return result({ finished: true, status: 'error' });
      }
      check();
      const selected = selectStoreShardIndices(manifest, routing, compiled, { regionCode });
      // Drop the large routing object before loading row shards. Only compact
      // decompressed bytes remain in the bounded LRU for subsequent searches.
      routing = null;
      progress.phase = 'search'; progress.totalShards = selected.length;
      progress.candidateRows = selected.reduce((sum, index) => sum + manifest.shards[index].rowCount, 0);
      emit(true);
      let next = 0;
      async function run() {
        while (next < selected.length) {
          check();
          const shard = manifest.shards[selected[next++]];
          try {
            const rows = await load(shard, parsed => validateStoreRows(parsed, shard));
            let lastYield = Date.now();
            for (let i = 0; i < rows.length; i++) {
              const match = matchStoreRow(rows[i], compiled);
              if (match) accumulator.add(rows[i], match, manifest);
              if (i % 256 === 0 && Date.now() - lastYield >= 12) {
                await yieldTask(); check(); lastYield = Date.now();
              }
            }
            progress.scannedRows += rows.length; progress.successfulShards++;
          } catch (error) {
            check();
            failures.push(failure(error, shard)); progress.failedShards++; progress.failedRows += shard.rowCount;
          }
          progress.completedShards++;
          emit();
          // Yield actual tasks, not only microtasks, so a new query/cancel message
          // can interrupt a nationwide scan even when every file is cached.
          await yieldTask(); check();
        }
      }
      await Promise.all(Array.from({ length: Math.min(parallel, selected.length) }, run));
      check();
      const status = !failures.length ? 'complete' : progress.successfulShards ? 'partial' : 'error';
      progress.phase = status;
      return result({ finished: true, status });
    } finally {
      signal?.removeEventListener('abort', forwardAbort);
      if (active === controller) active = null;
    }
  }

  return { search, cancel, close() { closed = true; cancel(); cache.clear(); }, cacheStats: () => cache.stats() };
}

// Importing this module in Node does not install a worker or perform any fetch.
if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof document === 'undefined') {
  const engine = createStoreCatalogEngine();
  let activeId = null;
  self.addEventListener('message', event => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'cancel') { activeId = null; engine.cancel(); return; }
    if (message.type === 'close') { activeId = null; engine.close(); self.close(); return; }
    if (message.type !== 'search' || !Number.isSafeInteger(message.id)) return;
    const id = message.id; activeId = id;
    engine.search({ manifest: message.manifest, manifestUrl: message.manifestUrl,
      query: message.query, regionCode: message.regionCode, limit: message.limit,
      onProgress: result => { if (activeId === id) self.postMessage({ type: 'progress', id, result }); },
    }).then(result => {
      if (activeId === id) self.postMessage({ type: 'result', id, result });
    }, error => {
      if (activeId === id && error.name !== 'AbortError') self.postMessage({ type: 'error', id,
        error: { name: error.name, code: error.code || 'search_failed', message: error.message } });
    });
  });
}
