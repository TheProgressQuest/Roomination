/**
 * "Select an area" (Match my room → Pick colour): the model files, as published with this
 * website (public/models/mobilesam/, see its README for their origin and licences). Each file is
 * checked against its SHA-256 before use, so a damaged or altered download is refused.
 *
 * The feature is optional and self-contained: set AREA_SELECT_AVAILABLE to false and nothing
 * of it is shown, downloaded or run; the manual colour and texture tools never depend on it.
 */
export const AREA_SELECT_AVAILABLE = true;

export interface ModelFile {
  /** Path under the site's base URL. */
  path: string;
  bytes: number;
  sha256: string;
}

export const AREA_MODEL: { encoder: ModelFile; decoder: ModelFile } = {
  encoder: { path: 'models/mobilesam/encoder.onnx', bytes: 14_273_500, sha256: 'b69539ee6a956091b44fd8c81ed9c89c6339f2a78f4ed51888b1121dfd2b7797' },
  decoder: { path: 'models/mobilesam/decoder.onnx', bytes: 4_742_230, sha256: '9b379aa76d28aba44a50eb657dfa5b8cb1922a1e0af5278a245bd1837396bbd3' },
};

/** The WebAssembly engine (onnxruntime-web, shared with Smart remove), for the size notice. */
export const ENGINE_BYTES = 14_239_897;

/** Where the downloaded, checked files are kept (the browser's Cache Storage). */
export const MODEL_CACHE = 'roomination-models-v1';

export const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;
