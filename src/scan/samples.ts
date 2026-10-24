/**
 * SYNTHETIC room scans in Apple RoomPlan's JSON format, for trying the importer without an
 * iPhone and for tests. They're generated from simple descriptions here; nothing in them comes
 * from a real room or a real scan.
 *
 * They follow RoomPlan's Codable output: metres, +Y up, column-major 4×4 transforms centred
 * on each element, enum values as one-key objects. Each sample sits in its own "scan world"
 * (turned and offset like a real capture, with the floor below the phone's starting height),
 * so importing it exercises the same conversion a real scan does.
 */

export interface SampleWall {
  /** Plan corners in cm; consecutive pairs (and last → first) are walls. */
  corners: [number, number][];
  /** Walls (by index) the scan "missed". */
  missing?: number[];
  /** cm by which wall ends stop short of their corners (scanner imprecision). */
  shortfall?: number;
}

export interface SampleOpening {
  kind: 'door' | 'window' | 'opening';
  wall: number;
  /** Centre, cm from the wall's first corner. */
  at: number;
  width: number;
  height: number;
  bottom?: number;
  confidence?: 'high' | 'medium' | 'low';
}

export interface SampleObject {
  category: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  height: number;
  /** Clockwise degrees; 0 = front facing down the plan. */
  rotation?: number;
  bottom?: number;
  confidence?: 'high' | 'medium' | 'low';
  /** RoomPlan's classification details (iOS 17+), e.g. { SofaType: 'lShaped' }. */
  attributes?: Record<string, string>;
  /** Index (in `objects`) of the object the scanner links this one to. */
  parent?: number;
}

export interface SampleRoom {
  name: string;
  height: number;
  walls: SampleWall;
  openings: SampleOpening[];
  objects: SampleObject[];
  sections?: { label: string; x: number; y: number }[];
  /** How the scan's world is turned relative to the plan (degrees) and offset (m). */
  world?: { turn: number; dx: number; dz: number; floorY: number };
  /** Leave out RoomPlan's floor outline (older scans, iOS 16). */
  noFloor?: boolean;
}

type Vec3 = [number, number, number];

/** A deterministic UUID-shaped id, so the same sample always gives the same ids. */
function uuid(seed: string): string {
  let h = 2166136261;
  const hex: string[] = [];
  for (let i = 0; i < 32; i++) {
    for (const ch of `${seed}:${i}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    hex.push(((h >>> 0) % 16).toString(16).toUpperCase());
  }
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** Column-major 4×4 from axes and a centre. */
const matrix = (x: Vec3, y: Vec3, z: Vec3, t: Vec3) => [...x, 0, ...y, 0, ...z, 0, ...t, 1].map((v) => Math.round(v * 1e6) / 1e6 || 0);

export function sampleToRoomPlan(room: SampleRoom): Record<string, unknown> {
  const world = room.world ?? { turn: 0, dx: 0, dz: 0, floorY: -1.2 };
  const r = (world.turn * Math.PI) / 180;
  // Plan cm → scan-world metres (X, Z), turned and offset.
  const toWorld = (x: number, y: number): [number, number] => {
    const X = x / 100;
    const Z = y / 100;
    return [X * Math.cos(r) - Z * Math.sin(r) + world.dx, X * Math.sin(r) + Z * Math.cos(r) + world.dz];
  };
  const dirWorld = (dx: number, dy: number): [number, number] => [dx * Math.cos(r) - dy * Math.sin(r), dx * Math.sin(r) + dy * Math.cos(r)];
  const h = room.height / 100;
  const confidence = (c = 'high') => ({ [c]: {} });

  const corners = room.walls.corners;
  const walls: Record<string, unknown>[] = [];
  const wallIds: string[] = [];
  corners.forEach((p, i) => {
    const q = corners[(i + 1) % corners.length];
    const id = uuid(`${room.name}-wall-${i}`);
    wallIds.push(id);
    if (room.walls.missing?.includes(i)) return;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const [ux, uz] = dirWorld((q[0] - p[0]) / len, (q[1] - p[1]) / len);
    const [cx, cz] = toWorld((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    const width = (len - 2 * (room.walls.shortfall ?? 0)) / 100;
    walls.push({
      identifier: id,
      parentIdentifier: null,
      category: { wall: {} },
      confidence: confidence(),
      transform: matrix([ux, 0, uz], [0, 1, 0], [-uz, 0, ux], [cx, world.floorY + h / 2, cz]),
      dimensions: [width, h, 0],
      polygonCorners: [],
      completedEdges: [],
      curve: null,
      story: 0,
    });
  });

  const surfaces = { door: [] as unknown[], window: [] as unknown[], opening: [] as unknown[] };
  room.openings.forEach((o, i) => {
    const p = corners[o.wall];
    const q = corners[(o.wall + 1) % corners.length];
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const t = o.at / len;
    const [ux, uz] = dirWorld((q[0] - p[0]) / len, (q[1] - p[1]) / len);
    const [cx, cz] = toWorld(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t);
    const bottom = (o.bottom ?? (o.kind === 'window' ? 90 : 0)) / 100;
    surfaces[o.kind].push({
      identifier: uuid(`${room.name}-${o.kind}-${i}`),
      parentIdentifier: wallIds[o.wall],
      category: o.kind === 'door' ? { door: { isOpen: false } } : { [o.kind]: {} },
      confidence: confidence(o.confidence),
      transform: matrix([ux, 0, uz], [0, 1, 0], [-uz, 0, ux], [cx, world.floorY + bottom + o.height / 200, cz]),
      dimensions: [o.width / 100, o.height / 100, 0],
      polygonCorners: [],
      completedEdges: [],
      curve: null,
      story: 0,
    });
  });

  const objects = room.objects.map((o, i) => {
    const rot = ((o.rotation ?? 0) * Math.PI) / 180;
    // Front (+z) in the plan is (−sin θ, cos θ); width axis (+x) is (cos θ, sin θ).
    const [fx, fz] = dirWorld(-Math.sin(rot), Math.cos(rot));
    const [ax, az] = dirWorld(Math.cos(rot), Math.sin(rot));
    const [cx, cz] = toWorld(o.x, o.y);
    const bottom = (o.bottom ?? 0) / 100;
    return {
      identifier: uuid(`${room.name}-object-${i}`),
      parentIdentifier: o.parent === undefined ? null : uuid(`${room.name}-object-${o.parent}`),
      category: { [o.category]: {} },
      confidence: confidence(o.confidence),
      transform: matrix([ax, 0, az], [0, 1, 0], [fx, 0, fz], [cx, world.floorY + bottom + o.height / 200, cz]),
      dimensions: [o.width / 100, o.height / 100, o.depth / 100],
      attributes: o.attributes ?? {},
      story: 0,
    };
  });

  const floors = room.noFloor
    ? []
    : [
        {
          identifier: uuid(`${room.name}-floor`),
          parentIdentifier: null,
          category: { floor: {} },
          confidence: confidence(),
          transform: matrix([1, 0, 0], [0, 1, 0], [0, 0, 1], [0, world.floorY, 0]),
          dimensions: [0, 0, 0],
          polygonCorners: corners.map(([x, y]) => {
            const [X, Z] = toWorld(x, y);
            return [Math.round(X * 1e6) / 1e6, 0, Math.round(Z * 1e6) / 1e6];
          }),
          completedEdges: [],
          curve: null,
          story: 0,
        },
      ];

  return {
    identifier: uuid(`${room.name}-room`),
    story: 0,
    version: 2,
    walls,
    doors: surfaces.door,
    windows: surfaces.window,
    openings: surfaces.opening,
    floors,
    objects,
    sections: (room.sections ?? []).map((s) => {
      const [X, Z] = toWorld(s.x, s.y);
      return { label: { [s.label]: {} }, center: [X, world.floorY, Z], story: 0 };
    }),
  };
}

// ---------------------------------------------------------------------------
// The samples offered in the app
// ---------------------------------------------------------------------------

export const SAMPLE_BEDROOM: SampleRoom = {
  name: 'Sample bedroom (synthetic)',
  height: 250,
  world: { turn: 0, dx: -1.7, dz: 2.3, floorY: -1.25 },
  walls: { corners: [[0, 0], [420, 0], [420, 360], [0, 360]] },
  openings: [
    { kind: 'door', wall: 2, at: 330, width: 82, height: 204 },
    { kind: 'window', wall: 0, at: 210, width: 140, height: 120, bottom: 95 },
  ],
  objects: [
    { category: 'bed', x: 210, y: 112, width: 160, depth: 205, height: 55, rotation: 0, confidence: 'high' },
    { category: 'storage', x: 100, y: 28, width: 45, depth: 40, height: 50, rotation: 0, confidence: 'medium' },
    { category: 'storage', x: 320, y: 28, width: 45, depth: 40, height: 50, rotation: 0, confidence: 'medium' },
    { category: 'storage', x: 393, y: 250, width: 100, depth: 55, height: 210, rotation: 270, confidence: 'high' },
    { category: 'chair', x: 300, y: 300, width: 50, depth: 52, height: 85, rotation: 45, confidence: 'low' },
  ],
  sections: [{ label: 'bedroom', x: 210, y: 180 }],
};

export const SAMPLE_LIVING: SampleRoom = {
  name: 'Sample L-shaped living room (synthetic)',
  height: 260,
  world: { turn: 90, dx: 0.4, dz: -3.1, floorY: -1.4 },
  walls: { corners: [[0, 0], [620, 0], [620, 300], [380, 300], [380, 520], [0, 520]] },
  openings: [
    { kind: 'door', wall: 5, at: 420, width: 90, height: 210 },
    { kind: 'window', wall: 0, at: 180, width: 160, height: 140, bottom: 80 },
    { kind: 'window', wall: 1, at: 150, width: 120, height: 140, bottom: 80, confidence: 'medium' },
    { kind: 'opening', wall: 3, at: 120, width: 110, height: 215 },
  ],
  objects: [
    { category: 'sofa', x: 190, y: 330, width: 220, depth: 95, height: 85, rotation: 180, confidence: 'high' },
    { category: 'table', x: 190, y: 220, width: 110, depth: 60, height: 42, rotation: 0, confidence: 'high' },
    { category: 'storage', x: 190, y: 22, width: 180, depth: 42, height: 50, rotation: 0, confidence: 'medium' },
    { category: 'television', x: 190, y: 12, width: 123, depth: 8, height: 71, rotation: 0, bottom: 52, confidence: 'high' },
    { category: 'storage', x: 18, y: 330, width: 90, depth: 35, height: 190, rotation: 90, confidence: 'high' },
    { category: 'chair', x: 330, y: 160, width: 78, depth: 80, height: 88, rotation: 225, confidence: 'medium' },
    { category: 'table', x: 520, y: 150, width: 160, depth: 90, height: 75, rotation: 0, confidence: 'high' },
    { category: 'chair', x: 480, y: 78, width: 46, depth: 52, height: 88, rotation: 0, confidence: 'high' },
    { category: 'chair', x: 560, y: 78, width: 46, depth: 52, height: 88, rotation: 0, confidence: 'high' },
    { category: 'chair', x: 480, y: 222, width: 46, depth: 52, height: 88, rotation: 180, confidence: 'high' },
    { category: 'chair', x: 560, y: 222, width: 46, depth: 52, height: 88, rotation: 180, confidence: 'low' },
  ],
  sections: [{ label: 'livingRoom', x: 190, y: 260 }, { label: 'diningRoom', x: 500, y: 150 }],
};

export const SAMPLE_STUDIO: SampleRoom = {
  name: 'Sample angled studio (synthetic)',
  height: 255,
  // Scanned at an angle, with wall ends stopping a little short of the corners.
  world: { turn: 23, dx: 1.1, dz: 0.6, floorY: -1.31 },
  walls: { corners: [[0, 0], [560, 0], [560, 410], [0, 410]], shortfall: 2.5 },
  openings: [
    { kind: 'door', wall: 3, at: 330, width: 85, height: 206 },
    { kind: 'window', wall: 1, at: 205, width: 180, height: 150, bottom: 75 },
    { kind: 'window', wall: 0, at: 120, width: 90, height: 120, bottom: 100, confidence: 'low' },
  ],
  objects: [
    { category: 'sink', x: 330, y: 30, width: 80, depth: 60, height: 90, rotation: 0, confidence: 'high' },
    { category: 'stove', x: 250, y: 30, width: 60, depth: 60, height: 90, rotation: 0, confidence: 'high' },
    { category: 'dishwasher', x: 410, y: 30, width: 60, depth: 60, height: 90, rotation: 0, confidence: 'medium' },
    { category: 'refrigerator', x: 175, y: 33, width: 70, depth: 66, height: 185, rotation: 0, confidence: 'high' },
    { category: 'storage', x: 500, y: 30, width: 60, depth: 60, height: 90, rotation: 0, confidence: 'low' },
    { category: 'table', x: 300, y: 200, width: 120, depth: 80, height: 75, rotation: 0, confidence: 'high' },
    { category: 'bed', x: 460, y: 300, width: 140, depth: 200, height: 50, rotation: 270, confidence: 'high' },
    { category: 'sofa', x: 110, y: 300, width: 180, depth: 85, height: 80, rotation: 90, confidence: 'medium' },
    { category: 'washerDryer', x: 30, y: 200, width: 60, depth: 60, height: 85, rotation: 90, confidence: 'medium' },
  ],
  sections: [{ label: 'kitchen', x: 330, y: 60 }, { label: 'bedroom', x: 460, y: 300 }, { label: 'livingRoom', x: 150, y: 280 }],
};

/** A small bathroom as RoomPlan typically reports one: a basin above its vanity, a wall cabinet. */
export const SAMPLE_BATHROOM: SampleRoom = {
  name: 'Sample bathroom (synthetic)',
  height: 244,
  world: { turn: 8, dx: 0.6, dz: -1.4, floorY: -1.28 },
  walls: { corners: [[0, 0], [250, 0], [250, 230], [0, 230]], shortfall: 1.5 },
  openings: [{ kind: 'door', wall: 2, at: 200, width: 76, height: 203 }],
  objects: [
    { category: 'storage', x: 60, y: 27, width: 80, depth: 52, height: 82, rotation: 0, confidence: 'low' },
    { category: 'sink', x: 60, y: 24, width: 50, depth: 40, height: 6, bottom: 80, rotation: 0, confidence: 'low' },
    { category: 'toilet', x: 150, y: 35, width: 40, depth: 68, height: 76, rotation: 0, confidence: 'low' },
    { category: 'bathtub', x: 212, y: 152, width: 152, depth: 76, height: 55, rotation: 270, confidence: 'medium' },
    { category: 'storage', x: 150, y: 11, width: 60, depth: 22, height: 66, bottom: 140, rotation: 0, confidence: 'low' },
  ],
  sections: [{ label: 'bathroom', x: 125, y: 115 }],
};

export const SAMPLES = [SAMPLE_BEDROOM, SAMPLE_LIVING, SAMPLE_STUDIO, SAMPLE_BATHROOM];
