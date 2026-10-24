import { useId, useMemo, type Dispatch } from 'react';
import type { FloorPreset, Project } from '../model/types';
import { FLOOR_PRESET_COLORS, FLOOR_PRESET_LABELS, floorTexture } from '../render/textures';
import type { EditorAction } from '../state/editor';
import type { BoardStyle, Preferences } from '../state/preferences';
import { SegmentedControl } from './SegmentedControl';

interface AppearanceProps {
  project: Project;
  dispatch: Dispatch<EditorAction>;
  preferences: Preferences;
  onPreferences: (changes: Partial<Preferences>) => void;
}

const FLOOR_PRESETS: FloorPreset[] = ['plain', 'hardwood', 'lightOak', 'darkWalnut', 'tile', 'concrete', 'carpet'];

const BOARD_STYLES: { value: BoardStyle; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'dots', label: 'Dots' },
  { value: 'squares', label: 'Squares' },
  { value: 'graph', label: 'Graph paper' },
  { value: 'drafting', label: 'Drafting' },
];

/**
 * Floor and wall colour settings belong to the project (saved, undoable, exported).
 * Board and grid settings are this device's display preferences.
 * Neither ever changes any measurement.
 */
export function FloorSettings({ project, dispatch }: Pick<AppearanceProps, 'project' | 'dispatch'>) {
  const floor = project.room.floor;
  const set = (changes: Partial<typeof floor>, mergeKey?: string) => dispatch({ type: 'floor/set', floor: changes, mergeKey });

  return (
    <div className="stack">
      <div className="floor-grid" role="radiogroup" aria-label="Floor surface">
        {FLOOR_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            role="radio"
            aria-checked={floor.preset === preset}
            className={`floor-option ${floor.preset === preset ? 'is-active' : ''}`}
            onClick={() => set({ preset, color: FLOOR_PRESET_COLORS[preset] })}
          >
            <FloorSwatch preset={preset} />
            <span className="floor-label">{FLOOR_PRESET_LABELS[preset]}</span>
          </button>
        ))}
      </div>
      <ColorField label="Floor colour" value={floor.color} onChange={(color) => set({ color }, 'floor.color')} />
      <ColorField label="Wall colour (3D)" value={project.room.wallColor} onChange={(color) => dispatch({ type: 'room/setWallColor', color, mergeKey: 'room.wallColor' })} />
      <TrimSettings project={project} dispatch={dispatch} />
      {floor.preset !== 'plain' && (
        <>
          <RangeField label="Pattern size" min={0.5} max={2.5} step={0.1} value={floor.scale} format={(v) => `${v.toFixed(1)}×`} onChange={(scale) => set({ scale }, 'floor.scale')} />
          <RangeField label="Pattern angle" min={0} max={180} step={15} value={floor.angle % 180} format={(v) => `${v}°`} onChange={(angle) => set({ angle }, 'floor.angle')} />
          <RangeField label="Texture strength" min={0} max={1} step={0.05} value={floor.intensity} format={(v) => `${Math.round(v * 100)}%`} onChange={(intensity) => set({ intensity }, 'floor.intensity')} />
        </>
      )}
    </div>
  );
}

export function BoardSettings({ preferences, onPreferences }: Pick<AppearanceProps, 'preferences' | 'onPreferences'>) {
  const board = preferences.board;
  const setBoard = (changes: Partial<typeof board>) => onPreferences({ board: { ...board, ...changes } });

  return (
    <div className="stack">
      <SegmentedControl label="Board style" value={board.style} options={BOARD_STYLES} onChange={(style) => setBoard({ style, color: null })} />
      <div className="color-row">
        <ColorField label="Board colour" value={board.color ?? '#eef1f6'} onChange={(color) => setBoard({ color })} />
        {board.color && (
          <button type="button" className="link-button" onClick={() => setBoard({ color: null })}>
            Use theme colour
          </button>
        )}
      </div>
      <Toggle label="Show board pattern" checked={board.showGrid} onChange={(showGrid) => setBoard({ showGrid })} />
      {board.showGrid && board.style !== 'solid' && (
        <>
          <RangeField label="Pattern spacing" min={8} max={48} step={2} value={board.spacing} format={(v) => `${v}px`} onChange={(spacing) => setBoard({ spacing })} />
          <RangeField label="Pattern opacity" min={0.1} max={1} step={0.05} value={board.opacity} format={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => setBoard({ opacity })} />
        </>
      )}
      <Toggle label="Measurement grid on the floor" checked={preferences.showMeasurementGrid} onChange={(showMeasurementGrid) => onPreferences({ showMeasurementGrid })} />
      <Toggle label="Show clearance zones" checked={preferences.showClearances} onChange={(showClearances) => onPreferences({ showClearances })} />
    </div>
  );
}

/** A tiny preview of each floor, rendered from the same generator as the plan. */
/** Optional wall trim in 3D: baseboards, door and window casing, crown moulding. */
function TrimSettings({ project, dispatch }: Pick<AppearanceProps, 'project' | 'dispatch'>) {
  const trim = project.room.trim ?? { color: '#f7f5f0' };
  const set = (changes: Partial<NonNullable<Project['room']['trim']>>, mergeKey?: string) => dispatch({ type: 'room/setTrim', trim: { ...trim, ...changes }, mergeKey });
  return (
    <div className="stack trim-settings">
      <span className="field-label">Trim (3D)</span>
      <Toggle label="Baseboards" checked={!!trim.baseboard} onChange={(on) => set({ baseboard: on ? { height: 10, depth: 1.5 } : undefined })} />
      {trim.baseboard && <RangeField label="Baseboard height" min={4} max={25} step={1} value={trim.baseboard.height} format={(v) => `${v} cm`} onChange={(height) => set({ baseboard: { ...trim.baseboard!, height } }, 'trim.baseboard')} />}
      <Toggle label="Door and window casing" checked={!!trim.casing} onChange={(on) => set({ casing: on ? { width: 7, depth: 1.5 } : undefined })} />
      {trim.casing && <RangeField label="Casing width" min={3} max={20} step={0.5} value={trim.casing.width} format={(v) => `${v} cm`} onChange={(width) => set({ casing: { ...trim.casing!, width } }, 'trim.casing')} />}
      <Toggle label="Crown moulding" checked={!!trim.crown} onChange={(on) => set({ crown: on ? { height: 8, depth: 6 } : undefined })} />
      {trim.crown && <RangeField label="Crown height" min={3} max={25} step={1} value={trim.crown.height} format={(v) => `${v} cm`} onChange={(height) => set({ crown: { ...trim.crown!, height } }, 'trim.crown')} />}
      {(trim.baseboard || trim.casing || trim.crown) && <ColorField label="Trim colour" value={trim.color} onChange={(color) => set({ color }, 'trim.color')} />}
    </div>
  );
}

function FloorSwatch({ preset }: { preset: FloorPreset }) {
  const url = useMemo(() => {
    const tile = floorTexture({ preset, color: FLOOR_PRESET_COLORS[preset], scale: 0.6, angle: 0, intensity: 0.6 });
    return tile ? tile.image.toDataURL() : null;
  }, [preset]);
  return (
    <span
      className="floor-swatch"
      aria-hidden="true"
      style={{ backgroundColor: FLOOR_PRESET_COLORS[preset], backgroundImage: url ? `url(${url})` : undefined, backgroundSize: '64px auto' }}
    />
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (color: string) => void }) {
  const id = useId();
  return (
    <div className="inline-field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function RangeField(props: { label: string; min: number; max: number; step: number; value: number; format: (v: number) => string; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <div className="range-field">
      <div className="range-label">
        <label htmlFor={id}>{props.label}</label>
        <output htmlFor={id}>{props.format(props.value)}</output>
      </div>
      <input id={id} type="range" min={props.min} max={props.max} step={props.step} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
