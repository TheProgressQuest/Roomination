import { FEATURE_LABELS } from '../model/features';
import type { FeatureKind, Furniture } from '../model/types';
import { Icon } from './Icon';

export type FurniturePreset = Pick<Furniture, 'name' | 'category' | 'width' | 'depth' | 'height' | 'color' | 'texture'>;

const preset = (
  name: string,
  width: number,
  depth: number,
  height: number,
  color: string,
  category: Furniture['category'] = 'furniture',
  texture: Furniture['texture'] = 'plain',
): FurniturePreset => ({ name, width, depth, height, color, category, texture });

/** Quick-add shapes, in cm. All are rectangles; sizes are typical real-world ones. */
export const PRESET_GROUPS: { title: string; presets: FurniturePreset[] }[] = [
  {
    title: 'Furniture',
    presets: [
      preset('Rectangle', 80, 50, 75, '#c9a77c'),
      preset('Sofa', 200, 90, 85, '#e2d9c8'),
      preset('Armchair', 80, 80, 90, '#a3b094'),
      preset('Bed', 160, 200, 50, '#d8cfc0'),
      preset('Table', 120, 80, 75, '#c9a77c'),
      preset('Desk', 120, 60, 75, '#b38b62'),
      preset('Chair', 50, 50, 90, '#9a7a5a'),
      preset('Bookshelf', 100, 35, 180, '#c9a77c'),
      preset('Wardrobe', 120, 60, 200, '#ece6da'),
      preset('TV console', 160, 40, 55, '#7a5a43'),
    ],
  },
  {
    title: 'Rugs & mats',
    presets: [
      preset('Rug', 200, 140, 1, '#d9cdb8', 'floorCovering', 'bordered'),
      preset('Runner', 240, 80, 1, '#c98a6b', 'floorCovering', 'striped'),
      preset('Mat', 90, 60, 1, '#e8dcc6', 'floorCovering', 'woven'),
    ],
  },
  {
    title: 'Décor',
    presets: [preset('Plant', 45, 45, 120, '#7f9c6a', 'decoration'), preset('Floor lamp', 40, 40, 160, '#f3ead8', 'decoration')],
  },
];

export const FEATURE_KINDS: FeatureKind[] = ['door', 'window', 'vent', 'outlet', 'switch', 'light', 'radiator', 'column'];

export function FeatureButtons({ onAdd }: { onAdd: (kind: FeatureKind) => void }) {
  return (
    <div className="preset-grid">
      {FEATURE_KINDS.map((kind) => (
        <button key={kind} type="button" className="preset feature-preset" onClick={() => onAdd(kind)}>
          <Icon name={kind} size={16} />
          <span className="preset-label">{FEATURE_LABELS[kind]}</span>
        </button>
      ))}
    </div>
  );
}

/** Tools that create walls: redraw the room's outline, or add a freestanding interior wall. */
export function StructureButtons({ onDraw }: { onDraw: (mode: 'drawRoom' | 'drawWall') => void }) {
  return (
    <div className="preset-grid">
      <button type="button" className="preset feature-preset" onClick={() => onDraw('drawRoom')}>
        <Icon name="drawRoom" size={16} />
        <span className="preset-label">Draw room shape</span>
      </button>
      <button type="button" className="preset feature-preset" onClick={() => onDraw('drawWall')}>
        <Icon name="drawWall" size={16} />
        <span className="preset-label">Interior wall</span>
      </button>
    </div>
  );
}

export function StairButtons({ onAdd }: { onAdd: (shape: 'straight' | 'L' | 'U' | 'custom') => void }) {
  const shapes = [
    { value: 'straight', label: 'Straight' },
    { value: 'L', label: 'L-shaped' },
    { value: 'U', label: 'U-shaped' },
    { value: 'custom', label: 'Custom' },
  ] as const;
  return (
    <div className="preset-grid">
      {shapes.map((shape) => (
        <button key={shape.value} type="button" className="preset feature-preset" onClick={() => onAdd(shape.value)}>
          <Icon name="stairs" size={16} />
          <span className="preset-label">{shape.label} stairs</span>
        </button>
      ))}
    </div>
  );
}

export function FurnitureButtons({ onAdd }: { onAdd: (preset: FurniturePreset) => void }) {
  return (
    <>
      {PRESET_GROUPS.map((group) => (
        <div key={group.title} className="preset-group">
          <h3>{group.title}</h3>
          <div className="preset-grid">
            {group.presets.map((p) => (
              <button key={p.name} type="button" className="preset" onClick={() => onAdd(p)}>
                <span className={`preset-swatch ${p.category === 'floorCovering' ? 'is-rug' : ''}`} style={{ background: p.color }} aria-hidden="true" />
                <span className="preset-label">{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
