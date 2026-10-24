import { describe, expect, it } from 'vitest';
import { footprintArea, roomFootprint } from '../model/shape';
import { parseProjectFile, serializeProject } from '../storage/projectFile';
import { classify, inferDesk } from './classify';
import { buildFromScan, initialReview, type Review } from './convert';
import { parseRoomPlan } from './roomPlan';
import { sampleToRoomPlan, type SampleObject, type SampleRoom } from './samples';
import { parseScanFile } from './scanFormat';

/**
 * SYNTHETIC fixtures only: small made-up rooms whose objects carry RoomPlan's classification
 * details (iOS 17+) and links, to check that the importer uses them, and copes when they're
 * missing, unknown or contradictory.
 */

const room = (objects: SampleObject[], sections?: SampleRoom['sections']): SampleRoom => ({
  name: 'Synthetic classified room',
  height: 250,
  walls: { corners: [[0, 0], [700, 0], [700, 500], [0, 500]] },
  openings: [{ kind: 'door', wall: 3, at: 60, width: 85, height: 205 }],
  objects,
  sections,
});

function build(r: SampleRoom, changes: Partial<Review> = {}) {
  const scan = parseRoomPlan(sampleToRoomPlan(r), 'test');
  const result = buildFromScan(scan, { ...initialReview(scan), ...changes });
  return { scan, result, project: result.project! };
}

/** The piece each scanned object became (by its order in the fixture). */
const shownAs = (r: SampleRoom) => {
  const { result } = build(r);
  return result.objects.map((o) => o.as);
};

// An L-shaped sofa: the long side along the top wall, the short side reaching forward at its left end.
const longSide: SampleObject = { category: 'sofa', x: 300, y: 50, width: 240, depth: 95, height: 85, attributes: { SofaType: 'lShaped' } };
const L_AREA = 240 * 95 + 90 * 160 - 90 * 37.5;
const shortSide = (extra: Partial<SampleObject> = {}): SampleObject => ({ category: 'sofa', x: 225, y: 140, width: 90, depth: 160, height: 85, attributes: { SofaType: 'lShapedExtension' }, parent: 0, ...extra });

describe('classification details narrow the catalogue', () => {
  it('a rectangular dining table stays rectangular, even when its size is nearer a round one', () => {
    // 120 × 112 is closest in size to the round table; the scanner says it's rectangular.
    const table = { category: 'table', x: 350, y: 250, width: 120, depth: 112, height: 75 };
    expect(shownAs(room([table]))).toEqual(['dining-round']);
    const [as] = shownAs(room([{ ...table, attributes: { TableShapeType: 'rectangular', TableType: 'dining' } }]));
    expect(['dining-4', 'dining-6', 'dining-8', 'dining-marble']).toContain(as);
    const [round] = shownAs(room([{ ...table, width: 140, depth: 80, attributes: { TableShapeType: 'circularElliptic', TableType: 'dining' } }]));
    expect(['dining-round', 'dining-oval']).toContain(round);
    const [coffee] = shownAs(room([{ ...table, height: 42, attributes: { TableShapeType: 'rectangular', TableType: 'coffee' } }]));
    expect(['coffee-table', 'coffee-table-walnut']).toContain(coffee);
  });

  it('shelves and cabinets are told apart by the scanner, not by size', () => {
    const tall = { category: 'storage', x: 100, y: 30, width: 90, depth: 40, height: 190 };
    const [shelf] = shownAs(room([{ ...tall, attributes: { StorageType: 'shelf' } }]));
    expect(['bookshelf', 'bookshelf-wide', 'low-shelf', 'office-bookcase']).toContain(shelf);
    const [cabinet] = shownAs(room([{ ...tall, attributes: { StorageType: 'cabinet' } }]));
    expect(['bookshelf', 'bookshelf-wide', 'low-shelf', 'office-bookcase']).not.toContain(cabinet);
  });

  it('armless dining chairs on four legs become dining chairs, keeping every detail', () => {
    const chair = { category: 'chair', x: 350, y: 250, width: 45, depth: 52, height: 100, attributes: { ChairType: 'dining', ChairArmType: 'missing', ChairBackType: 'existing', ChairLegType: 'four' } };
    const { result, project } = build(room([chair]));
    expect(['dining-chair', 'dining-chair-upholstered', 'dining-chair-black']).toContain(result.objects[0].as);
    expect(result.objects[0].suggestion.basis).toBe('classified');
    expect(result.objects[0].suggestion.reason).toMatch(/a dining chair, without arms, with a back, on four legs/);
    expect(project.scan!.items.find((i) => i.type === 'object')!.attributes).toEqual(chair.attributes);
    // A chair with arms isn't offered as a dining chair; a star base means a desk chair.
    expect(shownAs(room([{ ...chair, width: 75, depth: 75, attributes: { ChairArmType: 'existing' } }]))[0]).not.toMatch(/^dining-chair/);
    expect(shownAs(room([{ ...chair, attributes: { ChairLegType: 'star' } }]))).toEqual(['office-chair']);
  });

  it('contradictory details: the type wins and the disagreement is reported', () => {
    const c = classify('chair', { ChairType: 'stool', ChairArmType: 'existing' });
    expect(c.pool).toEqual(['bar-stool', 'stool']);
    expect(c.conflict).toMatch(/with arms/);
    const t = classify('table', { TableShapeType: 'lShaped', TableType: 'dining' });
    expect(t.pool).toEqual(['l-desk']);
    expect(t.conflict).toMatch(/dining/);
  });

  it('missing, “unidentified” and unknown details narrow nothing, and are kept as written', () => {
    expect(classify('sofa', {})).toMatchObject({ pool: null, basis: 'size' });
    expect(classify('table', { TableShapeType: 'unidentified', TableType: 'unidentified' }).pool).toBeNull();
    expect(classify('storage', { StorageType: 'hammock' }).pool).toBeNull();
    expect(classify('bed', { BedType: 'bunk' }).pool).toBeNull();
    const { result, project } = build(room([{ category: 'storage', x: 100, y: 30, width: 90, depth: 40, height: 190, attributes: { StorageType: 'hammock', FutureDetail: 'x' } }]));
    expect(result.objects[0].suggestion.basis).toBe('size');
    expect(project.scan!.items.find((i) => i.type === 'object')!.attributes).toEqual({ StorageType: 'hammock', FutureDetail: 'x' });
  });

  it('ignores malformed details instead of failing the import', () => {
    const json = sampleToRoomPlan(room([{ category: 'table', x: 350, y: 250, width: 120, depth: 80, height: 75 }])) as { objects: Record<string, unknown>[] };
    json.objects[0].attributes = { TableShapeType: { rectangular: {} }, 'bad key!': 'x', TableType: 42, Long: 'y'.repeat(60) };
    const scan = parseRoomPlan(json, 'test');
    expect(scan.objects[0].attributes).toEqual({ TableShapeType: 'rectangular' });
    json.objects[0].attributes = 'nonsense';
    expect(parseRoomPlan(json, 'test').objects[0].attributes).toEqual({});
  });
});

describe('desks: storage with a chair the scanner linked to it (an inference, labelled so)', () => {
  const cabinet: SampleObject = { category: 'storage', x: 350, y: 40, width: 160, depth: 70, height: 76, attributes: { StorageType: 'cabinet' } };
  const chair: SampleObject = { category: 'chair', x: 350, y: 100, width: 50, depth: 52, height: 95, rotation: 180, parent: 0, attributes: { ChairType: 'swivel' } };

  it('becomes a desk, marked as Roomination’s inference', () => {
    const { result, project } = build(room([cabinet, chair]));
    expect(result.objects[0].as).toMatch(/desk/);
    expect(result.objects[0].suggestion.basis).toBe('inferred');
    expect(result.objects[0].suggestion.reason).toMatch(/Roomination takes it for a desk/);
    const record = project.scan!.items.find((i) => i.id === result.objects[0].id)!;
    expect(record).toMatchObject({ basis: 'inferred', category: 'storage', attributes: { StorageType: 'cabinet' } });
    expect(project.scan!.items.find((i) => i.id === result.objects[1].id)!.parent).toBe(result.objects[0].id);
  });

  it('not without a linked chair, not for shelves, not in a kitchen, not at the wrong height', () => {
    expect(shownAs(room([cabinet]))[0]).not.toMatch(/desk/);
    expect(shownAs(room([{ ...cabinet, attributes: { StorageType: 'shelf' } }, chair]))[0]).not.toMatch(/desk/);
    expect(shownAs(room([{ ...cabinet, height: 200 }, chair]))[0]).not.toMatch(/desk/);
    const kitchen = room([cabinet, chair], [{ label: 'kitchen', x: 350, y: 250 }]);
    expect(shownAs(kitchen)[0]).not.toMatch(/desk/);
    const scan = parseRoomPlan(sampleToRoomPlan(room([cabinet])), 'test');
    expect(inferDesk(scan.objects[0], scan.objects, null)).toBeNull();
  });

  it('a manual choice overrides it without touching the scan evidence', () => {
    const { result } = build(room([cabinet, chair]));
    const id = result.objects[0].id;
    const { result: changed, project } = build(room([cabinet, chair]), { objects: { [id]: { as: 'sideboard' } } });
    expect(changed.objects[0].as).toBe('sideboard');
    const record = project.scan!.items.find((i) => i.id === id)!;
    expect(record).toMatchObject({ inferred: result.objects[0].as, corrections: { as: 'sideboard' }, attributes: { StorageType: 'cabinet' }, measured: { width: 160, depth: 70, height: 76 } });
  });
});

describe('L-shaped sofas: the scanner’s two linked parts become one sectional', () => {
  it('joins the explicit pair into one L, keeping both measured boxes', () => {
    const { result, project } = build(room([longSide, shortSide()]));
    expect(project.furniture).toHaveLength(1);
    const sofa = project.furniture[0];
    expect(sofa.name).toBe('Sectional sofa');
    expect(sofa.shape!.points).toHaveLength(6);
    // The L covers both boxes (240 × 95 and 90 × 160, overlapping 90 × 37.5 cm).
    expect(footprintArea(roomFootprint(sofa))).toBeCloseTo(L_AREA, -1);
    expect(sofa.width).toBeCloseTo(240, 0);
    expect(sofa.depth).toBeCloseTo(217.5, 0); // from the back (y 2.5) to the short side's front (y 220)
    expect(result.objects[1]).toMatchObject({ joinedInto: result.objects[0].id, include: true });
    const ext = project.scan!.items.find((i) => i.id === result.objects[1].id)!;
    expect(ext).toMatchObject({ joinedInto: result.objects[0].id, parent: result.objects[0].id, attributes: { SofaType: 'lShapedExtension' }, excluded: false, measured: { width: 90, depth: 160 } });
  });

  it('works whichever end the short side is at, and when the scanner turned the sofa round', () => {
    const right = build(room([longSide, shortSide({ x: 375 })])).project.furniture;
    expect(right).toHaveLength(1);
    expect(footprintArea(roomFootprint(right[0]))).toBeCloseTo(L_AREA, -1);
    // The long side's "front" recorded facing the wall: the piece is turned to face the room.
    const turned = build(room([{ ...longSide, rotation: 180 }, shortSide()])).project.furniture;
    expect(turned).toHaveLength(1);
    expect(turned[0].rotation).toBe(0);
  });

  it('never joins two sofas only because they’re close', () => {
    const { project } = build(room([longSide, shortSide({ parent: undefined })]));
    expect(project.furniture).toHaveLength(2);
    // Linked, but the second isn't classified as an extension.
    expect(build(room([longSide, shortSide({ attributes: { SofaType: 'rectangular' } })])).project.furniture).toHaveLength(2);
  });

  it('keeps a linked pair apart when the boxes don’t form an L, and says why', () => {
    const { result, project } = build(room([longSide, shortSide({ x: 300 })])); // in the middle
    expect(project.furniture).toHaveLength(2);
    expect(result.objects[1].joinProblem).toMatch(/one end/);
    expect(result.notes.some((n) => n.itemId === result.objects[1].id && /shown separately/.test(n.text))).toBe(true);
    expect(result.objects[1].as).toBe('chaise');
  });

  it('the person can keep the parts separate, or choose another piece for the sofa', () => {
    const { result } = build(room([longSide, shortSide()]));
    const [main, ext] = result.objects.map((o) => o.id);
    const apart = build(room([longSide, shortSide()]), { objects: { [ext]: { join: false } } });
    expect(apart.project.furniture).toHaveLength(2);
    expect(apart.project.scan!.items.find((i) => i.id === ext)!.corrections).toEqual({ join: false });
    expect(build(room([longSide, shortSide()]), { objects: { [main]: { as: 'sofa-4' } } }).project.furniture).toHaveLength(2);
  });
});

describe('links and records', () => {
  it('drops links to unknown objects and to itself', () => {
    const json = sampleToRoomPlan(room([longSide, shortSide()])) as { objects: Record<string, unknown>[] };
    json.objects[1].parentIdentifier = 'not-in-this-scan';
    json.objects[0].parentIdentifier = json.objects[0].identifier;
    const scan = parseRoomPlan(json, 'test');
    expect(scan.objects.map((o) => o.parentId)).toEqual([null, null]);
  });

  it('reads details and links from a Roomination scan file too', () => {
    const scan = parseScanFile(
      {
        format: 'roomination-scan',
        version: 1,
        walls: [{ id: 'w1', start: [0, 0], end: [400, 0], height: 250 }],
        floor: [[0, 0], [400, 0], [400, 300], [0, 300]],
        objects: [
          { id: 't', category: 'table', center: [200, 150], width: 120, depth: 80, height: 75, attributes: { TableShapeType: 'rectangular' } },
          { id: 'c', category: 'chair', center: [200, 220], width: 45, depth: 50, height: 90, parent: 't' },
        ],
      },
      'test',
    );
    expect(scan.objects[0].attributes).toEqual({ TableShapeType: 'rectangular' });
    expect(scan.objects[1].parentId).toBe(scan.objects[0].id);
  });

  it('keeps the scanner’s details, links and the basis through saving and opening', () => {
    const { project } = build(room([longSide, shortSide(), { category: 'table', x: 350, y: 330, width: 140, depth: 90, height: 75, attributes: { TableShapeType: 'rectangular', TableType: 'dining' } }]));
    const reopened = parseProjectFile(serializeProject(project));
    if (!reopened.ok) throw new Error(reopened.error);
    expect(reopened.project.scan!.items).toEqual(project.scan!.items);
  });

  it('opens projects imported before these details were kept', () => {
    const { project } = build(room([longSide]));
    const old = JSON.parse(serializeProject(project));
    for (const item of old.project.scan.items) {
      delete item.attributes;
      delete item.basis;
      delete item.parent;
      delete item.joinedInto;
    }
    const reopened = parseProjectFile(JSON.stringify(old));
    expect(reopened.ok).toBe(true);
    if (reopened.ok) expect(reopened.project.furniture).toHaveLength(1);
  });
});

describe('area-specific pieces', () => {
  const cabinet: SampleObject = { category: 'storage', x: 350, y: 30, width: 60, depth: 55, height: 90, attributes: { StorageType: 'cabinet' } };
  it('kitchen units only for cabinets the scan places in a kitchen', () => {
    const kitchenOnly = ['base-40', 'base-60', 'base-80', 'drawers-60', 'pantry'];
    expect(kitchenOnly).not.toContain(shownAs(room([cabinet], [{ label: 'livingRoom', x: 350, y: 250 }]))[0]);
    expect(kitchenOnly).not.toContain(shownAs(room([cabinet]))[0]);
    expect(kitchenOnly).toContain(shownAs(room([cabinet], [{ label: 'kitchen', x: 350, y: 250 }]))[0]);
  });
});
