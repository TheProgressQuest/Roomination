import { deflateSync, strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { roomArea, outlineSegments } from '../model/walls';
import { parseProjectFile, serializeProject } from '../storage/projectFile';
import { buildFromScan, initialReview, traceOutline, wallSkew, type Review } from './convert';
import { readScanFile } from './readScan';
import { parseRoomPlan } from './roomPlan';
import { SAMPLE_BATHROOM, SAMPLE_BEDROOM, SAMPLE_LIVING, SAMPLE_STUDIO, sampleToRoomPlan, type SampleRoom } from './samples';
import { parseScanFile } from './scanFormat';
import type { ScanData } from './types';
import { crc32, listZip } from './zip';

/** Documented tolerance: imported lengths match the source to within 1 mm (values are stored to 0.1 cm). */
const TOLERANCE = 0.1;

function scanOf(room: SampleRoom): ScanData {
  return parseRoomPlan(sampleToRoomPlan(room), 'test');
}

function build(room: SampleRoom, changes: Partial<Review> = {}) {
  const scan = scanOf(room);
  return { scan, result: buildFromScan(scan, { ...initialReview(scan), ...changes }) };
}

function sortedLengths(lengths: number[]) {
  return [...lengths].sort((a, b) => a - b);
}

function sampleLengths(room: SampleRoom) {
  const c = room.walls.corners;
  return sortedLengths(c.map((p, i) => Math.hypot(c[(i + 1) % c.length][0] - p[0], c[(i + 1) % c.length][1] - p[1])));
}

describe('RoomPlan JSON reading', () => {
  it('reads walls, openings and objects in centimetres, measured from the floor', () => {
    const scan = scanOf(SAMPLE_BEDROOM);
    expect(scan.walls).toHaveLength(4);
    expect(scan.walls.map((w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y))).toEqual([420, 360, 420, 360].map((v) => expect.closeTo(v, 3)));
    expect(scan.walls.every((w) => Math.abs(w.height - 250) < 0.01)).toBe(true);
    const window = scan.openings.find((o) => o.kind === 'window')!;
    expect(window.bottom).toBeCloseTo(95, 3);
    expect(window.width).toBeCloseTo(140, 3);
    const bed = scan.objects.find((o) => o.category === 'bed')!;
    expect([bed.width, bed.depth, bed.height]).toEqual([expect.closeTo(160, 3), expect.closeTo(205, 3), expect.closeTo(55, 3)]);
    expect(scan.objects.find((o) => o.category === 'chair')!.confidence).toBe('low');
    expect(scan.sections.map((s) => s.label)).toEqual(['bedroom']);
    expect(scan.name).toBe('Bedroom');
  });

  it('keeps left and right the right way round (no mirror image)', () => {
    // An L-shaped room's notch must stay in the same corner.
    const { result } = build(SAMPLE_LIVING, { straighten: false, quarterTurns: 3 });
    const p = result.project!;
    const outline = p.room.outline.map((n) => [Math.round(n.x), Math.round(n.y)]);
    // Turned back by the scan world's 90°, the outline is the original L (shifted to the origin).
    expect(outline).toEqual(expect.arrayContaining([[0, 0], [620, 0], [620, 300], [380, 300], [380, 520], [0, 520]]));
  });

  it('reads stable ids: the same scan always gives the same ids', () => {
    const a = buildFromScan(scanOf(SAMPLE_STUDIO), initialReview(scanOf(SAMPLE_STUDIO))).project!;
    const b = buildFromScan(scanOf(SAMPLE_STUDIO), initialReview(scanOf(SAMPLE_STUDIO))).project!;
    expect(a.room.outline.map((n) => n.id)).toEqual(b.room.outline.map((n) => n.id));
    expect(a.furniture.map((f) => f.id)).toEqual(b.furniture.map((f) => f.id));
    expect(a.room.outline[0].id).toMatch(/^scan-wall-[0-9a-f-]+$/);
  });

  it('accepts matrices written as four columns and plain-string enums', () => {
    const json = sampleToRoomPlan(SAMPLE_BEDROOM) as { walls: { transform: number[]; category: unknown; confidence: unknown }[] };
    for (const w of json.walls) {
      const m = w.transform;
      (w as { transform: unknown }).transform = [m.slice(0, 4), m.slice(4, 8), m.slice(8, 12), m.slice(12, 16)];
      w.category = 'wall';
      w.confidence = 'medium';
    }
    const scan = parseRoomPlan(json, 'test');
    expect(scan.walls).toHaveLength(4);
    expect(scan.walls[0].confidence).toBe('medium');
  });

  it('skips broken elements with a note instead of failing or dropping them silently', () => {
    const json = sampleToRoomPlan(SAMPLE_BEDROOM) as Record<string, unknown[]>;
    (json.objects[0] as Record<string, unknown>).transform = [1, 2, 3];
    (json.objects[1] as Record<string, unknown>).dimensions = [Number.NaN, 1, 1];
    (json.windows[0] as Record<string, unknown>).transform = Array(16).fill(5); // scaled, not a rotation
    const scan = parseRoomPlan(json, 'test');
    expect(scan.objects).toHaveLength(SAMPLE_BEDROOM.objects.length - 2);
    expect(scan.notes.join(' ')).toMatch(/2 objects had missing or invalid measurements/);
    expect(scan.notes.join(' ')).toMatch(/1 door or window had missing or invalid measurements/);
  });

  it('refuses files without walls and absurd sizes', () => {
    expect(() => parseRoomPlan({ walls: [], doors: [] }, 't')).toThrow(/doesn’t contain any walls/);
    const json = sampleToRoomPlan(SAMPLE_BEDROOM) as Record<string, unknown>;
    json.walls = Array(1001).fill((json.walls as unknown[])[0]);
    expect(() => parseRoomPlan(json, 't')).toThrow(/too many walls/);
  });
});

describe('building a project from a scan', () => {
  for (const room of [SAMPLE_BEDROOM, SAMPLE_LIVING, SAMPLE_STUDIO]) {
    it(`${room.name}: wall lengths match the measurements within ${TOLERANCE} cm and the project is valid`, () => {
      const { result } = build(room);
      expect(result.problem).toBeNull();
      const p = result.project!;
      const lengths = sortedLengths(outlineSegments(p.room).map((s) => s.length));
      sampleLengths(room).forEach((len, i) => expect(Math.abs(lengths[i] - len)).toBeLessThanOrEqual(TOLERANCE));
      expect(p.room.height).toBe(room.height);
      // Re-reading the saved project gives the same thing back.
      const again = parseProjectFile(serializeProject(p));
      expect(again.ok).toBe(true);
      // Every opening and object is accounted for: placed, or listed with a reason.
      expect(result.openings).toHaveLength(room.openings.length);
      expect(result.objects).toHaveLength(room.objects.length);
      for (const o of result.objects) if (o.include && !o.problem) expect(p.furniture.some((f) => f.id === o.id) || p.stairs.some((s) => s.id === o.id)).toBe(true);
    });
  }

  it('keeps every measured size: furniture and openings exactly as scanned', () => {
    const { result } = build(SAMPLE_BEDROOM);
    const p = result.project!;
    const bed = p.furniture.find((f) => f.kind === 'bed')!;
    expect([bed.width, bed.depth, bed.height]).toEqual([160, 205, 55]);
    const door = p.features.find((f) => f.kind === 'door')!;
    expect([door.width, door.height, door.elevation]).toEqual([82, 204, 0]);
    const window = p.features.find((f) => f.kind === 'window')!;
    expect([window.width, window.height, window.elevation]).toEqual([140, 120, 95]);
    // The window is in the middle of its 420 cm wall.
    expect(window.placement.type === 'wall' && window.placement.offset).toBeCloseTo(210, 0);
  });

  it('suggests catalogue pieces by size and labels them as Roomination’s guess', () => {
    const { result } = build(SAMPLE_BEDROOM);
    const bed = result.objects.find((o) => o.category === 'bed')!;
    expect(bed.as).toBe('bed-queen'); // 160 × 205, as measured
    expect(bed.suggestion.reason).toMatch(/Closest catalogue bed/);
    const storage = result.objects.filter((o) => o.category === 'storage').map((o) => o.as);
    expect(storage).toEqual(['bedside', 'bedside', 'wardrobe-2']);
  });

  it('uses the scan’s room labels (sections): a sink in the kitchen is a kitchen sink', () => {
    const { result } = build(SAMPLE_STUDIO);
    const sink = result.objects.find((o) => o.category === 'sink')!;
    expect(sink.section).toBe('kitchen');
    expect(['sink-60', 'sink-double']).toContain(sink.as);
    const fixtures = result.project!.furniture.filter((f) => f.kind === 'fixture');
    expect(fixtures.length).toBeGreaterThanOrEqual(5);
  });

  it('prefers pieces that suit the area the scan labelled, unless the size says otherwise', () => {
    const { result } = build(SAMPLE_LIVING);
    const tables = result.objects.filter((o) => o.category === 'table');
    expect(tables.map((t) => t.section)).toEqual(['livingRoom', 'diningRoom']);
    expect(tables[0].as).toMatch(/^coffee-table/);
    expect(tables[1].as).toMatch(/^dining-/);
    // A desk-sized table in a living room is still a desk.
    const desk = { ...SAMPLE_LIVING, objects: [{ category: 'table', x: 200, y: 250, width: 160, depth: 80, height: 75 }] };
    expect(build(desk).result.objects[0].as).toBe('desk-160');
  });

  it('places things standing on other furniture (a TV on its unit) at their measured height, without a collision', async () => {
    const { result } = build(SAMPLE_LIVING);
    const tv = result.objects.find((o) => o.category === 'television')!;
    expect(tv.include).toBe(true);
    expect(result.notes.some((n) => n.itemId === tv.id && /standing on other furniture/.test(n.text))).toBe(true);
    const p = result.project!;
    expect(p.furniture.find((f) => f.id === tv.id)!.elevation).toBe(52);
    const { findConflicts } = await import('../model/conflicts');
    expect(findConflicts(p).filter((c) => c.itemId === tv.id || c.otherId === tv.id)).toEqual([]);
  });

  it('straightens an angled scan without changing its shape', () => {
    const { scan, result } = build(SAMPLE_STUDIO);
    expect(Math.abs(wallSkew(scan.walls))).toBeCloseTo(23, 1);
    const p = result.project!;
    // Lined up with the grid: every wall runs across or down.
    for (const s of outlineSegments(p.room)) expect(Math.min(Math.abs(s.start.x - s.end.x), Math.abs(s.start.y - s.end.y))).toBeLessThan(0.3);
    expect(roomArea(p.room)).toBeCloseTo(560 * 410, -2);
    // Not straightened: same lengths, same area, just at an angle.
    const tilted = buildFromScan(scan, { ...initialReview(scan), straighten: false }).project!;
    expect(roomArea(tilted.room)).toBeCloseTo(roomArea(p.room), -1);
  });

  it('joins wall ends that stop short of the corner where the walls’ lines cross', () => {
    const traced = traceOutline(scanOf(SAMPLE_STUDIO).walls);
    expect(traced.loop?.points).toHaveLength(4);
    expect(traced.maxShift).toBeCloseTo(2.5, 1);
    expect(traced.gaps).toBe(0);
  });

  it('turns by quarter turns on request, keeping the furniture with the room', () => {
    const { scan } = build(SAMPLE_BEDROOM);
    const a = buildFromScan(scan, initialReview(scan)).project!;
    const b = buildFromScan(scan, { ...initialReview(scan), quarterTurns: 1 }).project!;
    const bounds = (p: typeof a) => {
      const xs = p.room.outline.map((n) => n.x);
      const ys = p.room.outline.map((n) => n.y);
      return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    };
    expect(bounds(a)).toEqual([420, 360]);
    expect(bounds(b)).toEqual([360, 420]);
    const bedA = a.furniture.find((f) => f.kind === 'bed')!;
    const bedB = b.furniture.find((f) => f.kind === 'bed')!;
    expect((bedB.rotation - bedA.rotation + 360) % 360).toBeCloseTo(90, 0);
  });

  it('closes a gap left by a missed wall, and says so', () => {
    const { result } = build({ ...SAMPLE_BEDROOM, walls: { ...SAMPLE_BEDROOM.walls, missing: [1] } });
    expect(result.problem).toBeNull();
    expect(result.walls.filter((w) => w.added)).toHaveLength(1);
    expect(result.walls.find((w) => w.added)!.length).toBeCloseTo(360, 0);
    expect(result.notes.some((n) => n.level === 'check' && /missed part of a wall/.test(n.text))).toBe(true);
  });

  it('falls back to the scanned floor outline when walls don’t join', () => {
    const scan = scanOf(SAMPLE_BEDROOM);
    const broken: ScanData = { ...scan, walls: scan.walls.slice(0, 1) };
    const result = buildFromScan(broken, initialReview(broken));
    expect(result.outlineFrom).toBe('floor');
    expect(result.project).not.toBeNull();
    expect(roomArea(result.project!.room)).toBeCloseTo(420 * 360, -1);
  });

  it('doesn’t add the walls along a floor outline again as interior walls', () => {
    const scan = scanOf(SAMPLE_BEDROOM);
    // Two walls along the outline and a third from their shared corner into the room: three
    // walls meeting at one corner (as at a stair wall) make the scan fall back to its floor.
    const [w1, w2] = scan.walls;
    const corner = [w1.a, w1.b].find((p) => [w2.a, w2.b].some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 1))!;
    const xs = scan.floor!.map((p) => p.x);
    const ys = scan.floor!.map((p) => p.y);
    const mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    const inside = { ...w1, id: 'stub', a: corner, b: mid };
    const broken: ScanData = { ...scan, walls: [w1, w2, inside] };
    const result = buildFromScan(broken, initialReview(broken));
    expect(result.outlineFrom).toBe('floor');
    expect(result.project!.room.partitions.map((p) => p.id)).toEqual(['stub-interior']);
  });

  it('explains when nothing makes a room', () => {
    const scan = scanOf({ ...SAMPLE_BEDROOM, noFloor: true });
    const broken: ScanData = { ...scan, walls: scan.walls.slice(0, 1) };
    const result = buildFromScan(broken, initialReview(broken));
    expect(result.project).toBeNull();
    expect(result.problem).toMatch(/don’t join up/);
  });

  it('notes missing doors and windows, and lets you add them', () => {
    const scan = scanOf({ ...SAMPLE_BEDROOM, openings: [] });
    const plain = buildFromScan(scan, initialReview(scan));
    expect(plain.notes.some((n) => /found no doors or windows/.test(n.text))).toBe(true);
    const added = buildFromScan(scan, { ...initialReview(scan), addedOpenings: [{ id: 'added-door', kind: 'door', wall: 2, offset: 100, width: 80, height: 205, bottom: 0 }] });
    expect(added.project!.features.map((f) => f.id)).toEqual(['added-door']);
  });

  it('turns RoomPlan openings into doorways with no door', () => {
    const { result } = build(SAMPLE_LIVING);
    const doorway = result.project!.features.find((f) => f.doorType === 'opening')!;
    expect(doorway.name).toBe('Doorway');
    expect(doorway.width).toBe(110);
  });

  it('applies corrections without touching the measurements', () => {
    const { scan } = build(SAMPLE_BEDROOM);
    const bed = scan.objects.find((o) => o.category === 'bed')!;
    const chair = scan.objects.find((o) => o.category === 'chair')!;
    const result = buildFromScan(scan, {
      ...initialReview(scan),
      ceiling: 260,
      objects: { [bed.id]: { width: 180, as: 'bed-king' }, [chair.id]: { include: false } },
    });
    const p = result.project!;
    expect(p.room.height).toBe(260);
    expect(p.furniture.find((f) => f.id === bed.id)!.width).toBe(180);
    expect(p.furniture.some((f) => f.id === chair.id)).toBe(false);
    // The scan still says what was measured.
    expect(bed.width).toBeCloseTo(160, 3);
    expect(result.objects.find((o) => o.id === bed.id)!.measured!.width).toBeCloseTo(160, 3);
  });

  it('lets a wall length be corrected, and refuses impossible ones with a reason', () => {
    const { scan, result } = build(SAMPLE_BEDROOM);
    const first = result.walls[0];
    const longer = buildFromScan(scan, { ...initialReview(scan), wallLengths: { [first.id]: first.length + 20 } });
    expect(longer.walls[0].length).toBeCloseTo(first.length + 20, 1);
    const tooShort = buildFromScan(scan, { ...initialReview(scan), wallLengths: { [first.id]: 2 } });
    expect(tooShort.notes.some((n) => n.level === 'check' && /at least 10 cm/.test(n.text))).toBe(true);
  });

  it('hangs things that are on walls at their measured height, and saves it', () => {
    const room: SampleRoom = { ...SAMPLE_BEDROOM, objects: [...SAMPLE_BEDROOM.objects, { category: 'storage', x: 300, y: 340, width: 80, depth: 30, height: 70, bottom: 150 }] };
    const { result } = build(room);
    const shelf = result.objects[result.objects.length - 1];
    expect(shelf.include).toBe(true);
    expect(result.notes.some((n) => n.itemId === shelf.id && /150 cm above the floor/.test(n.text))).toBe(true);
    const again = parseProjectFile(serializeProject(result.project!));
    expect(again.ok && again.project.furniture.find((f) => f.id === shelf.id)!.elevation).toBe(150);
  });

  it('turns unknown categories and stairs into boxes and staircases', () => {
    const room: SampleRoom = { ...SAMPLE_LIVING, objects: [{ category: 'piano', x: 100, y: 100, width: 150, depth: 60, height: 120 }, { category: 'stairs', x: 500, y: 150, width: 90, depth: 250, height: 260 }] };
    const { result } = build(room);
    expect(result.objects[0].as).toBe('box');
    expect(result.objects[0].name).toBe('Scanned piano');
    expect(result.project!.stairs).toHaveLength(1);
    expect(result.project!.stairs[0].sections[0]).toMatchObject({ length: 250, width: 90, steps: 10 });
  });

  it('reports overlapping openings instead of losing one silently', () => {
    const room: SampleRoom = { ...SAMPLE_BEDROOM, openings: [{ kind: 'window', wall: 0, at: 200, width: 120, height: 100 }, { kind: 'window', wall: 0, at: 260, width: 120, height: 100 }] };
    const { result } = build(room);
    expect(result.openings.filter((o) => o.problem)).toHaveLength(1);
    expect(result.notes.some((n) => /overlaps/.test(n.text))).toBe(true);
  });

  it('works with the optimizer, which leaves scanned fixtures where they are', async () => {
    const { optimize } = await import('../optimizer/optimize');
    const { DEFAULT_OPTIMIZER } = await import('../model/furnitureKinds');
    const p = build(SAMPLE_STUDIO).result.project!;
    const result = optimize({ project: p, settings: { ...DEFAULT_OPTIMIZER, effort: 'quick', seed: 1 }, movableIds: p.furniture.map((f) => f.id) });
    expect(result.suggestions.length).toBeGreaterThan(0);
    for (const s of result.suggestions) {
      for (const f of p.furniture.filter((x) => x.kind === 'fixture')) {
        const moved = s.positions.find((q) => q.id === f.id);
        if (moved) expect([moved.x, moved.y]).toEqual([f.x, f.y]);
      }
    }
  });
});

describe('Roomination scan files', () => {
  const file = {
    format: 'roomination-scan',
    version: 1,
    units: 'cm',
    name: 'Study',
    walls: [
      { id: 'w1', start: [0, 0], end: [300, 0], height: 240 },
      { id: 'w2', start: [300, 0], end: [300, 280], height: 240 },
      { id: 'w3', start: [300, 280], end: [0, 280], height: 240 },
      { id: 'w4', start: [0, 280], end: [0, 0], height: 240 },
    ],
    openings: [{ id: 'd1', kind: 'door', wallId: 'w3', center: [80, 280], width: 80, height: 200 }],
    objects: [{ id: 'o1', category: 'table', center: [150, 60], width: 140, depth: 70, height: 74, confidence: 'high' }],
  };

  it('imports a hand-written scan file exactly', () => {
    const scan = parseScanFile(file);
    const p = buildFromScan(scan, initialReview(scan)).project!;
    expect(p.name).toBe('Study');
    expect(sortedLengths(outlineSegments(p.room).map((s) => s.length))).toEqual([280, 280, 300, 300]);
    expect(p.features[0]).toMatchObject({ kind: 'door', width: 80, height: 200 });
    expect(p.furniture[0]).toMatchObject({ x: 150, y: 60, width: 140, depth: 70, height: 74 });
  });

  it('refuses other units and bad values with a reason', () => {
    expect(() => parseScanFile({ ...file, units: 'm' })).toThrow(/centimetres/);
    expect(() => parseScanFile({ ...file, version: 2 })).toThrow(/newer version/);
    expect(() => parseScanFile({ ...file, walls: [{ start: [0, 0], end: ['a', 1], height: 1 }] })).toThrow(/invalid position/);
  });
});

describe('opening scan files', () => {
  const json = (data: unknown, name = 'scan.json') => new File([JSON.stringify(data)], name, { type: 'application/json' });

  it('opens RoomPlan JSON and Roomination scan files', async () => {
    const result = await readScanFile(json(sampleToRoomPlan(SAMPLE_BEDROOM)), 'Room.json');
    expect(result.ok && result.choices[0].scan.walls.length).toBe(4);
  });

  it('explains invalid JSON, projects, manifests and unrelated files', async () => {
    const bad = await readScanFile(new File(['{"walls": [1, 2'], 'x.json'));
    expect(!bad.ok && bad.error).toMatch(/isn’t valid JSON/);
    const project = await readScanFile(json({ schemaVersion: 7, room: {} }));
    expect(!project.ok && project.error).toMatch(/Roomination project/);
    const manifest = await readScanFile(json({ format: 'house-capture/5', rooms: [] }));
    expect(!manifest.ok && manifest.error).toMatch(/manifest/);
    const other = await readScanFile(json({ hello: 'world' }));
    expect(!other.ok && other.error).toMatch(/isn’t a room scan/);
    const empty = await readScanFile(new File([], 'empty.json'));
    expect(!empty.ok && empty.error).toMatch(/empty/);
  });

  it('refuses oversized JSON before reading it', async () => {
    const big = new File([new Uint8Array(26 * 1024 * 1024)], 'big.json');
    const result = await readScanFile(big);
    expect(!result.ok && result.error).toMatch(/too large/);
  });

  /** A 3D Model Anything-style room export: geometry plus photos, mesh, depth and a world map. */
  function houseCaptureZip(extra: Record<string, Uint8Array> = {}) {
    const fill = (n: number, v: number) => new Uint8Array(n).fill(v);
    return zipSync(
      {
        '2026-01-02 10.00.00/manifest.json': strToU8(JSON.stringify({ format: 'house-capture/5', rooms: [{ index: 0 }] })),
        '2026-01-02 10.00.00/rooms/room-0.json': strToU8(JSON.stringify(sampleToRoomPlan(SAMPLE_LIVING))),
        '2026-01-02 10.00.00/rooms/room-0-data.json': strToU8('{"raw": true}'),
        '2026-01-02 10.00.00/photos/0001.jpg': fill(5000, 0xd8),
        '2026-01-02 10.00.00/photos/0002.jpg': fill(5000, 0xd9),
        '2026-01-02 10.00.00/depth/00001.f16z': fill(3000, 1),
        '2026-01-02 10.00.00/mesh/room-0.ply': fill(4000, 2),
        '2026-01-02 10.00.00/worldmap.arworldmap': fill(2000, 3),
        ...extra,
      },
      { mtime: new Date('2026-01-02T00:00:00Z') },
    );
  }

  /** A Blob that records which byte ranges are read. */
  function tracked(data: Uint8Array) {
    const blob = new Blob([new Uint8Array(data)]);
    const reads: [number, number][] = [];
    const wrapper = {
      size: blob.size,
      type: 'application/zip',
      slice(start?: number, end?: number) {
        reads.push([start ?? 0, end ?? blob.size]);
        return blob.slice(start, end);
      },
      text: () => blob.text(),
      arrayBuffer: () => blob.arrayBuffer(),
    } as unknown as Blob;
    return { blob: wrapper, reads };
  }

  it('reads a 3D Model Anything room ZIP without opening its photos, mesh, depth or world map', async () => {
    const zip = houseCaptureZip();
    const { blob, reads } = tracked(zip);
    const result = await readScanFile(blob);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].label).toBe('Room 0');
    expect(result.choices[0].scan.format).toBe('house-capture');
    expect(result.choices[0].scan.walls).toHaveLength(6);
    expect(result.skipped).toBe('2 photos, 1 depth frame, 1 3D model, an AR world map and 1 raw capture file');
    // None of the private payloads were read, not even partly.
    const entries = await listZip(new Blob([new Uint8Array(zip)]));
    for (const e of entries.filter((x) => /\.(jpg|f16z|ply|arworldmap)$|-data\.json$/.test(x.name))) {
      const start = e.offset;
      const end = e.offset + 30 + e.name.length + e.compressedSize;
      expect(reads.some(([a, b]) => a < end && b > start), e.name).toBe(false);
    }
  });

  it('refuses damaged and fake ZIPs with a reason', async () => {
    const zip = houseCaptureZip();
    const cut = await readScanFile(new Blob([zip.slice(0, zip.length - 30)]));
    expect(!cut.ok && cut.error).toMatch(/damaged/);
    const junk = new Uint8Array(200).fill(7);
    junk.set([0x50, 0x4b, 0x03, 0x04]);
    const fake = await readScanFile(new Blob([junk]));
    expect(!fake.ok && fake.error).toMatch(/damaged/);
    const noScan = await readScanFile(new Blob([zipSync({ 'notes.txt': strToU8('hello') })]));
    expect(!noScan.ok && noScan.error).toMatch(/doesn’t contain a room scan/);
  });

  it('detects a corrupted entry by its checksum', async () => {
    const zip = houseCaptureZip();
    const entries = await listZip(new Blob([new Uint8Array(zip)]));
    const room = entries.find((e) => e.name.endsWith('room-0.json'))!;
    const broken = new Uint8Array(zip);
    const dataStart = room.offset + 30 + new TextEncoder().encode(room.name).length;
    broken[dataStart + 10] ^= 0xff;
    const result = await readScanFile(new Blob([broken]));
    expect(!result.ok && result.error).toMatch(/damaged|No room/);
  });

  it('stops a ZIP bomb that lies about its size', async () => {
    // 40 MB of spaces compresses to a few kilobytes; the archive then claims it's only 2 kB.
    const huge = new Uint8Array(40 * 1024 * 1024).fill(0x20);
    const zip = zipSync({ 'rooms/room-0.json': huge });
    const entries = await listZip(new Blob([new Uint8Array(zip)]));
    const e = entries[0];
    // Find the central directory entry and rewrite its declared size.
    const view = new DataView(zip.buffer);
    for (let i = zip.length - 22; i > 0; i--) {
      if (view.getUint32(i, true) === 0x02014b50 && view.getUint32(i + 42, true) === e.offset) {
        view.setUint32(i + 24, 2048, true);
        break;
      }
    }
    const result = await readScanFile(new Blob([zip]));
    expect(!result.ok && result.error).toMatch(/ZIP bomb/);
  });

  it('refuses an entry whose declared size is too large, without decompressing it', async () => {
    const zip = zipSync({ 'rooms/room-0.json': deflateSync(new Uint8Array(10)) });
    const view = new DataView(zip.buffer);
    for (let i = zip.length - 22; i > 0; i--) {
      if (view.getUint32(i, true) === 0x02014b50) {
        view.setUint32(i + 24, 900 * 1024 * 1024, true);
        break;
      }
    }
    const result = await readScanFile(new Blob([zip]));
    expect(!result.ok && result.error).toMatch(/too large/);
  });

  it('computes standard CRC-32 checksums', () => {
    expect(crc32(strToU8('123456789'))).toBe(0xcbf43926);
  });
});

describe('the scan record kept with the project', () => {
  it('keeps measurements, the transformation and the person’s corrections through save and re-import', () => {
    const { scan } = build(SAMPLE_STUDIO);
    const bed = scan.objects.find((o) => o.category === 'bed')!;
    const door = scan.openings.find((o) => o.kind === 'door')!;
    const review: Review = {
      ...initialReview(scan),
      quarterTurns: 1,
      ceiling: 250,
      objects: { [bed.id]: { width: 150, as: 'bed-wood' } },
      openings: { [door.id]: { kind: 'opening' } },
    };
    const built = buildFromScan(scan, review, 1_760_000_000_000).project!;
    const again = parseProjectFile(serializeProject(built));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    const record = again.project.scan!;
    expect(record).toEqual(built.scan);
    expect(record.importedAt).toBe(1_760_000_000_000);
    expect(record.source).toBe('test');
    // How measured coordinates became the plan's.
    expect(record.transform.straightened).toBe(true);
    expect(record.transform.quarterTurns).toBe(1);
    expect(Math.abs(record.transform.rotation)).toBeCloseTo(Math.abs(-wallSkew(scan.walls) + 90), 3);
    expect(record.ceiling).toEqual({ measured: 255, corrected: 250 });
    // The bed: measured, inferred and corrected, each kept apart.
    const b = record.items.find((i) => i.id === bed.id)!;
    expect(b).toMatchObject({ type: 'object', origin: 'scanned', category: 'bed', measured: { width: 140, depth: 200, height: 50, bottom: 0 }, inferred: 'bed-double', inferredName: 'Double bed', corrections: { width: 150, as: 'bed-wood' }, excluded: false });
    expect(again.project.furniture.find((f) => f.id === bed.id)!.width).toBe(150);
    const d = record.items.find((i) => i.id === door.id)!;
    expect(d).toMatchObject({ category: 'door', measured: { width: 85, height: 206, bottom: 0 }, corrections: { kind: 'opening' } });
    // Every wall is listed with its measured length.
    expect(record.items.filter((i) => i.type === 'wall')).toHaveLength(4);
    expect(record.items.filter((i) => i.type === 'wall').every((w) => w.origin === 'scanned' && w.measured!.width > 0)).toBe(true);
    expect(record.notes.some((n) => n.level === 'assumed' && /thickness/.test(n.text))).toBe(true);
  });

  it('labels reconstructed walls and things the person added', () => {
    const scan = scanOf({ ...SAMPLE_BEDROOM, walls: { ...SAMPLE_BEDROOM.walls, missing: [1] } });
    const p = buildFromScan(scan, { ...initialReview(scan), addedPieces: [{ id: 'mine', category: 'table', as: 'box', width: 60, depth: 60, height: 70 }] }).project!;
    const gap = p.scan!.items.filter((i) => i.origin === 'reconstructed');
    expect(gap).toHaveLength(1);
    expect(gap[0].measured).toBeNull();
    expect(p.scan!.items.find((i) => i.id === 'mine')).toMatchObject({ origin: 'added', measured: null });
  });

  it('keeps a raised object’s measured height in the record, with no corrections', () => {
    const p = build(SAMPLE_LIVING).result.project!;
    const tv = p.scan!.items.find((i) => i.category === 'television')!;
    expect(tv).toMatchObject({ excluded: false, corrections: {}, measured: { bottom: 52 } });
  });

  it('drops a damaged scan record without losing the project', () => {
    const p = build(SAMPLE_BEDROOM).result.project!;
    const text = serializeProject({ ...p, scan: { ...p.scan!, transform: { rotation: 'x' } } as never });
    const again = parseProjectFile(text);
    expect(again.ok).toBe(true);
    expect(again.ok && again.project.scan).toBeUndefined();
  });
});

describe('scanning apps', () => {
  /** RoomSheet's "Export Package…" ZIP, laid out as its developer documents it. */
  function roomSheetPackage(folder = 'Bedroom 2026-10-23/') {
    const bytes = (n: number, v: number) => new Uint8Array(n).fill(v);
    return zipSync({
      [`${folder}captured-room.json`]: strToU8(JSON.stringify(sampleToRoomPlan(SAMPLE_BEDROOM))),
      [`${folder}model-edits.json`]: strToU8('{"edits": []}'),
      [`${folder}metadata.json`]: strToU8(JSON.stringify({ created: '2026-10-23T10:00:00Z', device: 'iPhone18,1', files: [] })),
      [`${folder}room-parametric.usdz`]: bytes(3000, 1),
      [`${folder}room-mesh.usdz`]: bytes(3000, 2),
      [`${folder}plan.pdf`]: bytes(500, 3),
      [`${folder}plan.png`]: bytes(500, 4),
      [`${folder}plan.svg`]: strToU8('<svg/>'),
      [`${folder}plan.csv`]: strToU8('wall,length'),
      [`${folder}room.sh3d`]: bytes(800, 5),
      [`${folder}photos/0001.jpg`]: bytes(2000, 6),
    });
  }

  it('reads a RoomSheet package’s captured-room.json without opening its metadata, edits, models or photos', async () => {
    const zip = roomSheetPackage();
    const blob = new Blob([new Uint8Array(zip)]);
    const reads: [number, number][] = [];
    const tracked = { size: blob.size, type: 'application/zip', slice: (a?: number, b?: number) => (reads.push([a ?? 0, b ?? blob.size]), blob.slice(a, b)) } as unknown as Blob;
    const result = await readScanFile(tracked);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.choices).toHaveLength(1);
    const scan = result.choices[0].scan;
    expect(scan.source).toMatch(/^RoomSheet package/);
    expect(scan.walls).toHaveLength(4);
    expect(scan.notes.join(' ')).toMatch(/Edits made in RoomSheet aren’t included/);
    expect(result.skipped).toBe('1 photo, 2 3D models, 5 floor-plan exports and the scanning app’s metadata and edits');
    const entries = await listZip(blob);
    for (const e of entries.filter((x) => !x.name.endsWith('captured-room.json'))) {
      const start = e.offset;
      const end = e.offset + 30 + new TextEncoder().encode(e.name).length + e.compressedSize;
      expect(reads.some(([a, b]) => a < end && b > start), e.name).toBe(false);
    }
    // And it builds the same room as the plain RoomPlan JSON.
    const p = buildFromScan(scan, initialReview(scan)).project!;
    expect(sortedLengths(outlineSegments(p.room).map((x) => x.length))).toEqual([360, 360, 420, 420]);
  });

  it('reads captured-room.json on its own, or at the top of a ZIP', async () => {
    const alone = await readScanFile(new File([JSON.stringify(sampleToRoomPlan(SAMPLE_LIVING))], 'captured-room.json'), 'captured-room.json');
    expect(alone.ok && alone.choices[0].scan.walls.length).toBe(6);
    const top = await readScanFile(new Blob([new Uint8Array(roomSheetPackage(''))]));
    expect(top.ok && top.choices[0].scan.source).toMatch(/RoomSheet/);
  });

  it('describes an unrecognised file’s structure without any of its values', async () => {
    const secret = { rooms: [{ name: 'Hari’s bedroom', size: [3.217, 4.05], owner: 'hello@example.com', items: [{ id: '3F2A9C1B-0000', kind: 'bed' }] }], version: 9 };
    const result = await readScanFile(new File([JSON.stringify(secret)], 'other.json'), 'other.json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const shape = result.shape!;
    expect(shape).toContain('rooms: list(1), first item:');
    expect(shape).toContain('name: text');
    expect(shape).toContain('size: list(2) of numbers');
    expect(shape).toContain('version: number');
    for (const value of ['Hari', '3.217', '4.05', 'example.com', '3F2A9C1B', 'bed']) expect(shape).not.toContain(value);
  });

  it('shows a raised sink (a basin on a unit) as a unit from the floor, labelled as assumed', () => {
    const bathroom: SampleRoom = {
      ...SAMPLE_BEDROOM,
      sections: [{ label: 'bathroom', x: 210, y: 180 }],
      objects: [
        { category: 'sink', x: 200, y: 25, width: 60, depth: 45, height: 15, bottom: 70 },
        { category: 'storage', x: 320, y: 15, width: 60, depth: 15, height: 70, bottom: 120 },
      ],
    };
    const { result } = build(bathroom);
    const [sink, cabinet] = result.objects;
    expect(sink.include).toBe(true);
    expect(sink.height).toBe(85);
    expect(sink.as).toMatch(/^vanity-/);
    expect(sink.measured!.height).toBeCloseTo(15, 3);
    expect(result.notes.some((n) => n.level === 'assumed' && n.itemId === sink.id && /basin/.test(n.text))).toBe(true);
    expect(cabinet.include).toBe(true);
    expect(cabinet.elevation).toBe(120);
    expect(result.project!.scan!.items.find((i) => i.id === sink.id)).toMatchObject({ measured: { height: 15, bottom: 70 }, corrections: {}, excluded: false });
  });

  it('explains RoomSheet’s index file (scan.json) instead of a generic refusal', async () => {
    const index = { nameLetter: 'A', capturedAt: 'x', referencePhotoCount: 0, origin: 'x', firstExportedAt: 'x', scanRecordSchemaVersion: 1, displayName: 'x', id: 'x' };
    const result = await readScanFile(new File([JSON.stringify(index)], 'scan.json'), 'scan.json');
    expect(!result.ok && result.error).toMatch(/index file.*captured-room\.json/);
  });
});

describe('a typical bathroom scan', () => {
  it('shows the basin and its cabinet as one vanity, hangs the wall cabinet at its height, and has no false collisions', async () => {
    const { result } = build(SAMPLE_BATHROOM);
    const [cabinet, basin, toilet, , wallCabinet] = result.objects;
    expect(cabinet.as).toMatch(/^vanity-/);
    expect(cabinet.suggestion.reason).toMatch(/one vanity/);
    expect([cabinet.width, cabinet.depth, cabinet.height]).toEqual([80, 52, 82]);
    expect(basin.include).toBe(false);
    expect(result.notes.some((n) => n.itemId === basin.id && n.level === 'assumed')).toBe(true);
    expect(toilet.as).toBe('toilet');
    expect(wallCabinet).toMatchObject({ include: true, elevation: 140 });
    expect(wallCabinet.as).toBe('wall-cabinet-bath');
    const p = result.project!;
    const { findConflicts } = await import('../model/conflicts');
    expect(findConflicts(p).filter((c) => c.otherKind === 'furniture')).toEqual([]);
    // The basin is still in the record, measured, and leaving it out isn't counted as a correction.
    expect(p.scan!.items.find((i) => i.id === basin.id)).toMatchObject({ excluded: true, corrections: {}, measured: { bottom: 80 } });
  });
});
