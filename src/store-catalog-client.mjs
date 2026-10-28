import { STORE_CATALOG_LIMITS, StoreCatalogError, validateStoreManifest } from './store-catalog.mjs';

const abortError = () => { const error = new Error('상가 검색을 취소했습니다.'); error.name = 'AbortError'; return error; };

async function readManifest(response, signal) {
  const advertised = response.headers?.get('content-length');
  if (advertised && Number(advertised) > STORE_CATALOG_LIMITS.manifestBytes) {
    throw new StoreCatalogError('manifest_too_large', '상가 검색 목록의 크기가 허용 범위를 초과했습니다.');
  }
  if (!response.body?.getReader) throw new StoreCatalogError('empty_manifest', '상가 검색 목록의 내용이 없습니다.');
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      if (signal.aborted) throw abortError();
      const { done, value } = await reader.read();
      if (signal.aborted) throw abortError();
      if (done) break;
      length += value.byteLength;
      if (length > STORE_CATALOG_LIMITS.manifestBytes) {
        await reader.cancel();
        throw new StoreCatalogError('manifest_too_large', '상가 검색 목록의 크기가 허용 범위를 초과했습니다.');
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    let parsed;
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new StoreCatalogError('invalid_manifest', '상가 검색 목록을 해석할 수 없습니다.'); }
    return validateStoreManifest(parsed);
  } finally {
    signal.removeEventListener('abort', cancel);
    try { reader.releaseLock(); } catch { /* An aborted read may still be releasing its lock. */ }
  }
}

function freezeManifest(manifest) {
  for (const value of manifest.regions) Object.freeze(value);
  for (const value of manifest.shards) Object.freeze(value);
  Object.freeze(manifest.regions); Object.freeze(manifest.shards);
  Object.freeze(manifest.source); Object.freeze(manifest.routing);
  if (manifest.schedule) Object.freeze(manifest.schedule);
  return Object.freeze(manifest);
}

/**
 * Public API:
 *   loadManifest({ force: false }) -> validated source/coverage metadata
 *     force cancels the active search and revalidates the published snapshot;
 *     a failed refresh rejects but retains the last verified manifest.
 *   search(query, { regionCode, onProgress, limit: 200 }) -> final result
 *   cancel() rejects the active search with AbortError but retains public cache
 *   close() releases the worker and all cache
 *
 * During progress or a partial failure, total is null and foundCount is only a
 * lower bound. finished says the request ended; complete says coverage succeeded.
 */
export function createStoreCatalogClient({
  manifestUrl = new URL('../data/store-catalog/manifest.json', import.meta.url).href,
  workerUrl, workerFactory, fetchImpl = globalThis.fetch?.bind(globalThis), timeoutMs = 20_000,
} = {}) {
  const url = new URL(workerUrl || './store-catalog-worker.mjs', import.meta.url);
  // build.mjs versions this client's static import. Carry that version to the
  // worker URL as well, since a new URL() expression is not a static import.
  if (!workerUrl) url.search = new URL(import.meta.url).search;
  let manifest = null, manifestPromise = null, manifestController = null;
  let worker = null, sequence = 0, pending = null, closed = false;

  function rejectPending(error) {
    if (!pending) return;
    const current = pending; pending = null; current.reject(error);
  }

  function cancel() {
    sequence++;
    rejectPending(abortError());
    if (worker) worker.postMessage({ type: 'cancel' });
  }

  function onMessage(event) {
    const message = event.data;
    if (!pending || !message || message.id !== pending.id) return;
    if (message.type === 'progress') {
      if (typeof pending.onProgress === 'function') {
        try { pending.onProgress(message.result); } catch { /* UI callbacks do not affect worker state. */ }
      }
    } else if (message.type === 'result') {
      const current = pending; pending = null; current.resolve(message.result);
    } else if (message.type === 'error') {
      rejectPending(new StoreCatalogError(message.error?.code || 'search_failed',
        message.error?.message || '상가 검색을 완료하지 못했습니다.'));
    }
  }

  function disposeWorker() {
    if (!worker) return;
    worker.removeEventListener?.('message', onMessage);
    worker.removeEventListener?.('error', onWorkerError);
    worker.removeEventListener?.('messageerror', onWorkerError);
    worker.terminate(); worker = null;
  }

  function onWorkerError() {
    rejectPending(new StoreCatalogError('worker_failed', '상가 검색을 시작하지 못했습니다. 페이지를 새로고침하고 다시 검색해 주세요.'));
    disposeWorker();
  }

  function getWorker() {
    if (worker) return worker;
    if (!workerFactory && typeof globalThis.Worker !== 'function') {
      throw new StoreCatalogError('unsupported_browser', '현재 브라우저는 전국 상가 검색을 지원하지 않습니다. 최신 브라우저로 다시 시도해 주세요.');
    }
    try {
      worker = workerFactory ? workerFactory(url.href, { type: 'module', name: 'bizhannun-store-catalog' })
        : new Worker(url.href, { type: 'module', name: 'bizhannun-store-catalog' });
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onWorkerError);
      worker.addEventListener('messageerror', onWorkerError);
      return worker;
    } catch (error) {
      disposeWorker();
      if (error instanceof StoreCatalogError) throw error;
      throw new StoreCatalogError('worker_failed', '전국 상가 검색을 시작하지 못했습니다.');
    }
  }

  async function loadManifest({ force = false } = {}) {
    if (closed) throw new StoreCatalogError('closed', '상가 검색이 종료되었습니다.');
    if (force) cancel();
    // A query submitted during an explicit refresh must not silently start
    // against the old snapshot. Concurrent refreshes share the same request.
    if (manifestPromise) return manifestPromise;
    if (manifest && !force) return manifest;
    const controller = new AbortController(); manifestController = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    // Start on a microtask so even a synchronously throwing transport clears the
    // already-assigned promise, allowing the next attempt to retry normally.
    manifestPromise = Promise.resolve().then(async () => {
      try {
        // Use an existing deployment session only for same-origin public assets.
        const response = await fetchImpl(manifestUrl, {
          signal: controller.signal, cache: 'no-cache', credentials: 'same-origin', redirect: 'error',
        });
        if (!response.ok) throw new StoreCatalogError('manifest_http_error',
          response.status === 404 ? '전국 상가 검색 자료가 아직 게시되지 않았습니다.' : `상가 검색 목록을 불러오지 못했습니다. (HTTP ${response.status})`);
        const validated = await readManifest(response, controller.signal);
        if (closed || controller.signal.aborted) throw abortError();
        manifest = freezeManifest(validated);
        return manifest;
      } catch (error) {
        if (closed) throw abortError();
        if (timedOut) throw new StoreCatalogError('manifest_timeout', '상가 검색 목록을 불러오는 시간이 초과되었습니다. 다시 시도해 주세요.');
        if (error instanceof StoreCatalogError) throw error;
        throw new StoreCatalogError('manifest_fetch_failed', '상가 검색 목록을 불러오지 못했습니다. 연결 상태를 확인해 주세요.');
      } finally {
        clearTimeout(timer);
        if (manifestController === controller) manifestController = null;
        manifestPromise = null;
      }
    });
    return manifestPromise;
  }

  function search(query, { regionCode = '', onProgress, limit = 200 } = {}) {
    if (closed) return Promise.reject(new StoreCatalogError('closed', '상가 검색이 종료되었습니다.'));
    cancel();
    const id = sequence;
    const promise = new Promise((resolve, reject) => { pending = { id, resolve, reject, onProgress }; });
    (async () => {
      const currentManifest = await loadManifest();
      if (closed || !pending || pending.id !== id) return;
      getWorker().postMessage({ type: 'search', id, manifest: currentManifest, manifestUrl,
        query, regionCode, limit });
    })().catch(error => { if (pending?.id === id) rejectPending(error); });
    return promise;
  }

  return {
    loadManifest, search, cancel,
    close() {
      if (closed) return;
      closed = true; cancel(); manifestController?.abort(); disposeWorker(); manifest = null;
    },
  };
}
