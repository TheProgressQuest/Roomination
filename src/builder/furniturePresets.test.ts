import { describe, expect, it } from 'vitest';
import { componentExtent, placeComponents } from '../model/components';
import { shapeTemplate } from '../model/shape';
import { componentParts } from '../render/furnitureParts';
import { recomputeComponents } from './componentGeometry';
import { PRESETS, buildPreset, upholster } from './furniturePresets';

describe('furniture presets', () => {
  for (const { id, label } of PRESETS) {
    it(`${label}: builds editable components that stay inside the footprint and its height`, () => {
      const piece = buildPreset(id);
      expect(piece.components.length).toBeGreaterThan(1);
      // Every computed component got an outline.
      for (const c of piece.components) if (['edge', 'footprint', 'curved'].includes(c.shape)) expect(c.outline?.length ?? 0, `${c.name} has an outline`).toBeGreaterThanOrEqual(3);
      const ext = componentExtent(piece);
      expect(ext.overflow, 'nothing reaches outside the footprint or below the floor').toEqual([]);
      expect(ext.top).toBeLessThanOrEqual(piece.height + 0.5);
      expect(ext.top).toBeGreaterThan(piece.height * 0.85);
      // Recomputing again changes nothing (stable).
      const again = recomputeComponents(piece);
      expect(again.failed).toEqual([]);
      expect(again.components).toEqual(piece.components);
      // Stored values are tidy, so saving and reloading never changes them.
      for (const c of piece.components) {
        expect(c.rotation).toBeGreaterThanOrEqual(0);
        expect(c.rotation).toBeLessThan(360);
        for (const v of [c.x, c.y, c.z, c.width, c.depth, c.height]) expect(Math.round(v * 100) / 100).toBe(v);
      }
      // And they render as parts.
      expect(componentParts(piece.components).length).toBe(placeComponents(piece.components).length);
    });
  }

  it('the angled-back loveseat has two back sections, mitred to meet, and one deep seat cushion', () => {
    const piece = buildPreset('angledLoveseat');
    const backs = piece.components.filter((c) => c.type === 'backrest');
    expect(backs).toHaveLength(2);
    expect(backs.map((b) => [b.edges!.miterStart, b.edges!.miterEnd])).toEqual([
      [true, true],
      [true, true],
    ]);
    const seats = piece.components.filter((c) => c.name.startsWith('Seat cushion'));
    expect(seats).toHaveLength(1);
    expect(seats[0].depth).toBeGreaterThan(50);
    // Rounded upholstery edges.
    expect(seats[0].radius).toBeGreaterThan(5);
  });

  it('reshapes when the footprint is measured differently (no sizes are fixed in the preset)', () => {
    const piece = buildPreset('angledLoveseat');
    const wider = { ...piece.shape!, points: piece.shape!.points.map((p) => ({ x: p.x * 1.2, y: p.y })) };
    const { components } = recomputeComponents({ ...piece, shape: wider, width: piece.width * 1.2 });
    const seat = components.find((c) => c.name === 'Seat cushion')!;
    const before = piece.components.find((c) => c.name === 'Seat cushion')!;
    expect(seat.width).toBeGreaterThan(before.width * 1.15);
  });

  it('upholsters any drawn outline, including curved ones', () => {
    const shape = shapeTemplate('curvedSofa');
    const piece = { width: 220, depth: 90, shape };
    const components = upholster(piece, {
      backEdges: [0],
      armEdges: [1, 3],
      legHeight: 6,
      deckHeight: 36,
      seatThickness: 12,
      backHeight: 78,
      armHeight: 60,
      backThickness: 15,
      armThickness: 15,
      backCushionDepth: 0,
      seatCushions: 3,
      splitAlong: 2,
      pillows: 2,
      softness: 4,
    });
    const { components: built, failed } = recomputeComponents({ ...piece, components });
    expect(failed).toEqual([]);
    expect(built.filter((c) => c.name.startsWith('Seat cushion'))).toHaveLength(3);
  });
});
