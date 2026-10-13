import { sniffImageType } from '../storage/assets';
import type { RGBAImage } from './imageOps';

/** Photos are kept at most this many pixels on their longest side (plenty for textures). */
export const MAX_PHOTO_SIZE = 1600;
const MAX_FILE_BYTES = 30 * 1024 * 1024;

/**
 * Opens a photo chosen by the person: checks its size, decodes it (honouring the camera's
 * orientation) and scales it down. HEIC photos open where the browser supports them (Safari).
 */
export async function imageFromFile(file: File): Promise<RGBAImage> {
  if (file.size > MAX_FILE_BYTES) throw new Error('That photo is too large (over 30 MB). Try a smaller copy.');
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const isHeic = /hei[cf]/i.test(file.type) || new TextDecoder().decode(head.slice(4, 12)).includes('ftyphei');
  if (!sniffImageType(head) && !isHeic) throw new Error('That file isn’t a photo Roomination can open. Use a JPEG, PNG or WebP image.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(isHeic ? 'This browser can’t open HEIC photos. Export the photo as JPEG (or open Roomination in Safari) and try again.' : 'That photo couldn’t be opened.');
  }
  const scale = Math.min(1, MAX_PHOTO_SIZE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas(width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
}

export function canvas(width: number, height: number): CanvasRenderingContext2D {
  const el = document.createElement('canvas');
  el.width = width;
  el.height = height;
  return el.getContext('2d', { willReadFrequently: true })!;
}

export function toImageData(image: RGBAImage): ImageData {
  return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
}

/** Encodes as WebP (keeping transparency), or PNG where WebP isn't supported. */
export async function encodeImage(image: RGBAImage): Promise<Blob> {
  const ctx = canvas(image.width, image.height);
  ctx.putImageData(toImageData(image), 0, 0);
  const webp = await new Promise<Blob | null>((resolve) => ctx.canvas.toBlob(resolve, 'image/webp', 0.9));
  if (webp && webp.type === 'image/webp') return webp;
  const png = await new Promise<Blob | null>((resolve) => ctx.canvas.toBlob(resolve, 'image/png'));
  if (!png) throw new Error('This browser couldn’t save the image.');
  return png;
}

export async function imageToUrl(image: RGBAImage): Promise<string> {
  return URL.createObjectURL(await encodeImage(image));
}

/** Rotates by a multiple of 90° or a fine angle; the canvas grows to fit, leaving corners transparent. */
export function rotateImage(image: RGBAImage, degrees: number): RGBAImage {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const width = Math.round(image.width * cos + image.height * sin);
  const height = Math.round(image.width * sin + image.height * cos);
  const source = canvas(image.width, image.height);
  source.putImageData(toImageData(image), 0, 0);
  const ctx = canvas(width, height);
  ctx.translate(width / 2, height / 2);
  ctx.rotate(rad);
  ctx.drawImage(source.canvas, -image.width / 2, -image.height / 2);
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
}

export function cropImage(image: RGBAImage, x: number, y: number, width: number, height: number): RGBAImage {
  const source = canvas(image.width, image.height);
  source.putImageData(toImageData(image), 0, 0);
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return { width: w, height: h, data: source.getImageData(Math.round(x), Math.round(y), w, h).data };
}
