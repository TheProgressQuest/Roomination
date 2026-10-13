import { describe, expect, it } from 'vitest';
import { createEditorState, editorReducer } from '../state/editor';
import { findConflicts } from './conflicts';
import { clampFurnitureToRoom } from './placement';
import { createEmptyProject, createFeature, createFurniture, createStaircase } from './sample';
import type { Project, WallNode } from './types';
import { wallBodies } from './wallGeometry';

/**
 * Guards against the app becoming sluggish on big plans: a 40-wall room with 150 pieces
 * of furniture, 30 features and 5 staircases. Budgets are generous (CI machines vary);
 * the measured times are printed for reference.
 */
function bigProject(): Project {
  // A 12 m × 8 m room whose top wall is a zig-zag of 37 short walls (40 walls in total).
  const outline: WallNode[] = [];
  for (let i = 0; i <= 36; i++) outline.push({ id: `t${i}`, x: (i * 1200) / 36, y: i % 2 === 0 ? 0 : 30, thickness: 12 });
  outline.push({ id: 'r', x: 1200, y: 800, thickness: 12 }, { id: 'b', x: 0, y: 800, thickness: 12 });
  const project = createEmptyProject({ outline, partitions: [], height: 260, floor: { preset: 'plain', color: '#ffffff', scale: 1, angle: 0, intensity: 0.5 } });
  const furniture = Array.from({ length: 150 }, (_, i) =>
    createFurniture({ x: 60 + (i % 15) * 75, y: 120 + Math.floor(i / 15) * 65, width: 60, depth: 50, rotation: (i * 15) % 360 }),
  );
  const features = Array.from({ length: 30 }, (_, i) => createFeature('vent', { type: 'free', x: 50 + i * 38, y: 760, rotation: 0 }, project.room));
  const stairs = Array.from({ length: 5 }, (_, i) => createStaircase('L', { x: 150 + i * 220, y: 500 }));
  return { ...project, furniture, features, stairs };
}

function time(run: () => void, repeat = 1): number {
  const start = performance.now();
  for (let i = 0; i < repeat; i++) run();
  return (performance.now() - start) / repeat;
}

describe('performance on a large plan', () => {
  const project = bigProject();

  it('checks every overlap quickly', () => {
    const ms = time(() => findConflicts(project), 5);
    console.info(`findConflicts (150 items, 30 features, 5 stairs, 40 walls): ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(150);
  });

  it('checks a single dragged piece in well under a frame', () => {
    const ms = time(() => findConflicts(project, project.furniture[70].id), 20);
    console.info(`findConflicts for one dragged piece: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(16);
  });

  it('keeps a dragged piece inside a 40-wall room in well under a frame', () => {
    const item = project.furniture[70];
    const ms = time(() => clampFurnitureToRoom({ ...item, x: item.x + 3000 }, project.room, item), 50);
    console.info(`clampFurnitureToRoom while dragging: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(8);
  });

  it('commits an edit (validation + conflicts + history) quickly', () => {
    const state = createEditorState(project);
    const ms = time(() => editorReducer(state, { type: 'furniture/update', id: project.furniture[3].id, changes: { x: 100 } }), 5);
    console.info(`reducer commit: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(300);
  });

  it('computes all wall shapes quickly', () => {
    const ms = time(() => wallBodies(project.room, project.features), 20);
    console.info(`wallBodies: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(10);
  });
});
