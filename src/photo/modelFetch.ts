import { MODEL_CACHE, type ModelFile } from './areaSelectModel';

/**
 * Gets a model file for an on-device AI tool: from the browser's Cache Storage if it's there
 * and still matches its SHA-256, otherwise downloaded from this website, checked, and cached.
 * A file that doesn't match is never used (nor kept).
 */

export class ModelFetchError extends Error {
  constructor(
    readonly kind: 'download' | 'integrity',
    message: string,
  ) {
    super(message);
  }
}

const NOT_EXPECTED = 'The downloaded model isn’t the expected file, so it wasn’t used.';

export async function obtainModelFile(
  file: ModelFile & { url: string },
  fetchFile: (url: string) => Promise<Response>,
  cache: Pick<Cache, 'match' | 'put' | 'delete'> | null,
  onProgress: (loaded: number) => void,
): Promise<{ bytes: Uint8Array; fromCache: boolean }> {
  const hit = await cache?.match(file.url).catch(() => undefined);
  if (hit) {
    const bytes = new Uint8Array(await hit.arrayBuffer());
    if ((await sha256(bytes)) === file.sha256) {
      onProgress(file.bytes);
      return { bytes, fromCache: true };
    }
    await cache?.delete(file.url).catch(() => undefined);
  }
  let response: Response;
  try {
    response = await fetchFile(file.url);
  } catch {
    throw new ModelFetchError('download', 'The model couldn’t be downloaded. Check the connection and try again.');
  }
  if (!response.ok || !response.body) throw new ModelFetchError('download', `The model couldn’t be downloaded (${response.status}).`);
  const reader = response.body.getReader();
  const bytes = new Uint8Array(file.bytes);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.length > bytes.length) {
      await reader.cancel().catch(() => undefined);
      throw new ModelFetchError('integrity', NOT_EXPECTED);
    }
    bytes.set(value, received);
    received += value.length;
    onProgress(received);
  }
  if (received !== file.bytes || (await sha256(bytes)) !== file.sha256) throw new ModelFetchError('integrity', NOT_EXPECTED);
  await cache?.put(file.url, new Response(new Blob([bytes as Uint8Array<ArrayBuffer>]))).catch(() => undefined);
  return { bytes, fromCache: false };
}

/** Cache Storage, where the browser offers it (not in some private modes or insecure pages). */
export async function openModelCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(MODEL_CACHE);
  } catch {
    return null;
  }
}

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
