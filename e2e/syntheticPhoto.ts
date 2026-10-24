/**
 * A SYNTHETIC room photo for testing "Select an area": a painted wall, a striped wooden floor
 * and an L-shaped sofa in brown upholstery, with what real photos add (soft shading across
 * the cushions, a window highlight, a red throw on the seat, a dark gap at the floor, sensor
 * noise). Every pixel's true surface is known, so mask quality and colour accuracy can be
 * measured exactly. Deterministic: the same call gives the same photo.
 */

export interface SyntheticPhoto {
  width: number;
  height: number;
  /** RGBA. */
  data: Uint8ClampedArray;
  /** 1 where the surface is, at the photo's size. */
  masks: { sofa: Uint8Array; wall: Uint8Array; floor: Uint8Array };
  /** The surfaces' true colours (what a perfect pick would give). */
  colours: { sofa: string; wall: string; floor: string };
  /** A point well inside each surface, to tap. */
  taps: { sofa: { x: number; y: number }; wall: { x: number; y: number }; floor: { x: number; y: number } };
}

const SOFA = [112, 62, 48];
const WALL = [176, 180, 184];
const FLOOR = [196, 150, 98];
const THROW = [170, 30, 36];

const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

export function syntheticRoomPhoto(width = 960, height = 720): SyntheticPhoto {
  const data = new Uint8ClampedArray(width * height * 4);
  const sofa = new Uint8Array(width * height);
  const wall = new Uint8Array(width * height);
  const floor = new Uint8Array(width * height);
  let seed = 12345;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x7fffffff - 0.5) * 10;
  };
  const horizon = Math.round(height * 0.58);
  // The sofa: a long back/seat block and a chaise reaching forward at its left end.
  const inBack = (x: number, y: number) => x > width * 0.22 && x < width * 0.82 && y > height * 0.4 && y < height * 0.7;
  const inChaise = (x: number, y: number) => x > width * 0.22 && x < width * 0.42 && y >= height * 0.7 && y < height * 0.9;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let c: number[];
      if (inBack(x, y) || inChaise(x, y)) {
        sofa[i] = 1;
        // Cushion shading: darker towards seams every ~20% of the width, lighter on top.
        const seam = Math.abs(Math.sin((x / width) * Math.PI * 5));
        const shade = 0.82 + 0.18 * seam + (y < height * 0.48 ? 0.06 : 0);
        c = SOFA.map((v) => v * shade);
        // A red throw on part of the seat (an outlier the colour should ignore).
        if (x > width * 0.55 && x < width * 0.66 && y > height * 0.55 && y < height * 0.66) c = THROW;
        // A window highlight across the back.
        if (x > width * 0.62 && x < width * 0.74 && y > height * 0.42 && y < height * 0.47) c = [235, 225, 215];
        // A dark gap along the bottom.
        if ((inBack(x, y) && y > height * 0.68) || (inChaise(x, y) && y > height * 0.88)) c = [28, 20, 18];
      } else if (y < horizon) {
        wall[i] = 1;
        c = WALL.map((v) => v * (0.92 + 0.08 * (y / horizon)));
      } else {
        floor[i] = 1;
        const plank = Math.floor((x + (y - horizon) * 0.6) / 48) % 3;
        c = FLOOR.map((v) => v * (0.9 + plank * 0.06));
      }
      data[i * 4] = c[0] + noise();
      data[i * 4 + 1] = c[1] + noise();
      data[i * 4 + 2] = c[2] + noise();
      data[i * 4 + 3] = 255;
    }
  }
  return {
    width,
    height,
    data,
    masks: { sofa, wall, floor },
    // The typical lit colour of each surface (its shading's middle), what a careful person would pick.
    colours: { sofa: hex(SOFA.map((v) => v * 0.94)), wall: hex(WALL.map((v) => v * 0.96)), floor: hex(FLOOR.map((v) => v * 0.96)) },
    taps: { sofa: { x: Math.round(width * 0.3), y: Math.round(height * 0.6) }, wall: { x: Math.round(width * 0.1), y: Math.round(height * 0.2) }, floor: { x: Math.round(width * 0.7), y: Math.round(height * 0.85) } },
  };
}

/** Intersection over union of two masks (1 = identical). */
export function iou(a: Uint8Array, b: Uint8Array): number {
  let both = 0;
  let either = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] && b[i]) both++;
    if (a[i] || b[i]) either++;
  }
  return either ? both / either : 0;
}
