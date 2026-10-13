import { deflateSync } from 'node:zlib';

/** Writes a small RGBA PNG (for upload tests) from a pixel function. */
export function makePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function crc32(data: Buffer): number {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

/**
 * A photo of an L-shaped loveseat seen from above: brown furniture on a pale floor,
 * 400 × 300 px. The furniture spans x 50–350 and y 50–250, with the bottom-right
 * 150 × 100 px corner cut out.
 */
export function loveseatPhoto(): Buffer {
  return makePng(400, 300, (x, y) => {
    const inside = x >= 50 && x < 350 && y >= 50 && y < 250 && !(x >= 200 && y >= 150);
    return inside ? [122, 72, 44, 255] : [232 + ((x * 3 + y) % 5), 229, 224, 255];
  });
}
