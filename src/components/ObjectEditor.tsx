import { useId, type Dispatch, type ReactNode } from 'react';
import { describeConflict, type Conflict } from '../model/conflicts';
import { FEATURE_LABELS } from '../model/features';
import { FURNITURE_COLORS } from '../model/sample';
import type { Furniture, FurnitureCategory, FurnitureTexture, Project, RoomFeature, UnitSystem } from '../model/types';
import { cmToInput, formatLength, inputToCm, inputUnitLabel } from '../model/units';
import { wallLabel, wallSegments } from '../model/walls';
import type { EditorAction } from '../state/editor';
import { LockToggle, PlanningFields } from './FurniturePlanning';
import { Icon } from './Icon';
import { NumberField } from './NumberField';
import { SegmentedControl } from './SegmentedControl';

interface ObjectEditorProps {
  project: Project;
  selectedId: string;
  conflicts: Conflict[];
  dispatch: Dispatch<EditorAction>;
  onDelete: (id: string) => void;
}

/** Property editor for whichever object is selected (furniture or room feature). */
export function ObjectEditor(props: ObjectEditorProps) {
  const item = props.project.furniture.find((f) => f.id === props.selectedId);
  if (item) return <FurnitureEditor {...props} item={item} />;
  const feature = props.project.features.find((f) => f.id === props.selectedId);
  if (feature) return <FeatureEditor {...props} feature={feature} />;
  return null;
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------

const CATEGORY_OPTIONS: { value: FurnitureCategory; label: string }[] = [
  { value: 'furniture', label: 'Furniture' },
  { value: 'floorCovering', label: 'Rug / mat' },
  { value: 'decoration', label: 'Décor' },
];

const TEXTURE_OPTIONS: { value: FurnitureTexture; label: string }[] = [
  { value: 'plain', label: 'Plain' },
  { value: 'bordered', label: 'Border' },
  { value: 'striped', label: 'Stripes' },
  { value: 'checked', label: 'Checks' },
  { value: 'woven', label: 'Woven' },
];

function FurnitureEditor({ project, item, conflicts, dispatch, onDelete }: ObjectEditorProps & { item: Furniture }) {
  const units = project.units;
  const unit = inputUnitLabel(units);
  const length = (cm: number) => cmToInput(cm, units);
  const toCm = (value: number) => inputToCm(value, units);
  const change = (changes: Partial<Furniture>, mergeKey?: string) =>
    dispatch({ type: 'furniture/update', id: item.id, changes, mergeKey });

  return (
    <div className="object-editor">
      <Section>
        <NameField key={`${item.id}:${item.name}`} value={item.name} onCommit={(name) => change({ name })} />
        <LockToggle item={item} dispatch={dispatch} />
        <SegmentedControl label="Layer" value={item.category} options={CATEGORY_OPTIONS} onChange={(category) => change({ category })} />
        {item.category === 'floorCovering' && <p className="hint">Rugs and mats sit underneath furniture and never count as overlapping.</p>}
      </Section>

      <Section title="Size">
        <div className="field-grid">
          <NumberField label="Width" suffix={unit} min={0} value={length(item.width)} onCommit={(v) => change({ width: toCm(v) })} />
          <NumberField label="Depth" suffix={unit} min={0} value={length(item.depth)} onCommit={(v) => change({ depth: toCm(v) })} />
          <NumberField label="Height" suffix={unit} min={0} value={length(item.height)} onCommit={(v) => change({ height: toCm(v) })} />
        </div>
      </Section>

      <Section title="Position" hint={item.locked ? 'Locked. Unlock the piece to move or turn it.' : 'Centre of the piece, measured from the room’s top-left corner.'}>
        <div className="field-grid two">
          <NumberField label="From left" suffix={unit} value={length(item.x)} onCommit={(v) => change({ x: toCm(v) })} disabled={item.locked} />
          <NumberField label="From top" suffix={unit} value={length(item.y)} onCommit={(v) => change({ y: toCm(v) })} disabled={item.locked} />
        </div>
      </Section>

      <Section title="Rotation">
        <RotationField rotation={item.rotation} onChange={(rotation) => change({ rotation })} disabled={item.locked} />
      </Section>

      <Section title="Colour">
        <ColorPicker value={item.color} onChange={(color, live) => change({ color }, live ? `color:${item.id}` : undefined)} />
      </Section>

      {item.category === 'floorCovering' && (
        <Section title="Texture">
          <SegmentedControl label="Texture" hideLabel value={item.texture} options={TEXTURE_OPTIONS} onChange={(texture) => change({ texture })} />
        </Section>
      )}

      {item.category !== 'floorCovering' && <PlanningFields key={item.id} project={project} item={item} dispatch={dispatch} />}

      <ConflictList objectId={item.id} project={project} conflicts={conflicts} dispatch={dispatch} />

      <Section>
        <button type="button" className="danger" onClick={() => onDelete(item.id)}>
          <Icon name="trash" /> <span className="truncate">Delete {item.name}</span>
        </button>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Room features
// ---------------------------------------------------------------------------

/** Chooses which wall a feature sits on. Walls too short for it are listed but disabled. */
function WallPicker({ project, value, featureWidth, onChange }: { project: Project; value: string; featureWidth: number; onChange: (wallId: string) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>Wall</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {wallSegments(project.room).map((wall) => (
          <option key={wall.id} value={wall.id} disabled={wall.length < featureWidth}>
            {wallLabel(project.room, wall.id)} · {formatLength(wall.length, project.units)}
          </option>
        ))}
      </select>
    </div>
  );
}

function FeatureEditor({ project, feature, conflicts, dispatch, onDelete }: ObjectEditorProps & { feature: RoomFeature }) {
  const units: UnitSystem = project.units;
  const unit = inputUnitLabel(units);
  const length = (cm: number) => cmToInput(cm, units);
  const toCm = (value: number) => inputToCm(value, units);
  const change = (changes: Partial<RoomFeature>) => dispatch({ type: 'feature/update', id: feature.id, changes });
  const lengthField = (label: string, field: 'width' | 'depth' | 'height' | 'elevation' | 'clearance') => (
    <NumberField
      label={label}
      suffix={unit}
      min={0}
      value={length(feature[field])}
      onCommit={(v) => {
        const cm = toCm(v);
        // Lights are round: keep both footprint dimensions equal.
        change(field === 'width' && feature.kind === 'light' ? { width: cm, depth: cm } : { [field]: cm });
      }}
    />
  );
  const p = feature.placement;

  return (
    <div className="object-editor">
      <Section>
        <p className="kind-badge">
          <Icon name={feature.kind} size={14} /> {FEATURE_LABELS[feature.kind]}
        </p>
        <NameField key={`${feature.id}:${feature.name}`} value={feature.name} onCommit={(name) => change({ name })} />
      </Section>

      {feature.kind === 'door' && (
        <Section title="Door">
          <SegmentedControl
            label="Style"
            value={feature.doorType ?? 'hinged'}
            options={[
              { value: 'hinged', label: 'Hinged' },
              { value: 'double', label: 'Double' },
              { value: 'sliding', label: 'Sliding' },
            ]}
            onChange={(doorType) => change({ doorType })}
          />
          {feature.doorType !== 'sliding' && (
            <SegmentedControl
              label="Opens"
              value={feature.swing ?? 'in'}
              options={[
                { value: 'in', label: 'Into room' },
                { value: 'out', label: 'Outwards' },
              ]}
              onChange={(swing) => change({ swing })}
            />
          )}
          {feature.doorType === 'hinged' && (
            <SegmentedControl
              label="Hinge side (facing the door from inside)"
              value={feature.hinge ?? 'left'}
              options={[
                { value: 'left', label: 'Left' },
                { value: 'right', label: 'Right' },
              ]}
              onChange={(hinge) => change({ hinge })}
            />
          )}
          <div className="field-grid two">
            {lengthField('Width', 'width')}
            {lengthField('Height', 'height')}
          </div>
          {(feature.doorType === 'sliding' || feature.swing === 'out') && (
            <div className="field-grid two">{lengthField('Walkway to keep clear', 'clearance')}</div>
          )}
        </Section>
      )}

      {feature.kind === 'window' && (
        <Section title="Window">
          <div className="field-grid">
            {lengthField('Width', 'width')}
            {lengthField('Height', 'height')}
            {lengthField('Sill height', 'elevation')}
          </div>
        </Section>
      )}

      {feature.kind === 'vent' && (
        <Section title="Vent">
          <SegmentedControl
            label="Mounted on"
            value={feature.ventMount ?? 'floor'}
            options={[
              { value: 'wall', label: 'Wall' },
              { value: 'floor', label: 'Floor' },
              { value: 'ceiling', label: 'Ceiling' },
            ]}
            onChange={(ventMount) => change({ ventMount })}
          />
          <div className="field-grid">
            {lengthField('Width', 'width')}
            {feature.ventMount === 'wall' ? lengthField('Height above floor', 'elevation') : lengthField('Depth', 'depth')}
            {feature.ventMount !== 'ceiling' && lengthField('Clearance', 'clearance')}
          </div>
          {feature.ventMount === 'ceiling' && <p className="hint">Ceiling vents aren’t blocked by floor furniture, so no clearance is checked.</p>}
        </Section>
      )}

      {(feature.kind === 'outlet' || feature.kind === 'switch') && (
        <Section title={feature.kind === 'outlet' ? 'Outlet' : 'Switch'}>
          {feature.kind === 'outlet' && (
            <SegmentedControl
              label="Type"
              value={feature.outletType ?? 'standard'}
              options={[
                { value: 'standard', label: 'Standard' },
                { value: 'usb', label: 'USB' },
                { value: 'gfci', label: 'GFCI' },
                { value: 'highVoltage', label: '240 V' },
              ]}
              onChange={(outletType) => change({ outletType })}
            />
          )}
          <div className="field-grid two">
            {lengthField('Height above floor', 'elevation')}
            {lengthField('Access space', 'clearance')}
          </div>
          <p className="hint">Only furniture tall enough to reach the {feature.kind === 'outlet' ? 'outlet' : 'switch'} counts as blocking it.</p>
        </Section>
      )}

      {feature.kind === 'light' && (
        <Section title="Ceiling light">
          <SegmentedControl
            label="Fixture"
            value={feature.lightType ?? 'pendant'}
            options={[
              { value: 'pendant', label: 'Pendant' },
              { value: 'flush', label: 'Flush' },
              { value: 'recessed', label: 'Recessed' },
              { value: 'chandelier', label: 'Chandelier' },
            ]}
            onChange={(lightType) => change({ lightType })}
          />
          <div className="field-grid two">{lengthField('Diameter', 'width')}</div>
        </Section>
      )}

      {feature.kind === 'radiator' && (
        <Section title="Radiator">
          <div className="field-grid">
            {lengthField('Width', 'width')}
            {lengthField('Depth', 'depth')}
            {lengthField('Height', 'height')}
          </div>
          <div className="field-grid two">{lengthField('Clearance in front', 'clearance')}</div>
        </Section>
      )}

      {feature.kind === 'column' && (
        <Section title="Column">
          <SegmentedControl
            label="Shape"
            value={feature.shape ?? 'square'}
            options={[
              { value: 'square', label: 'Square' },
              { value: 'round', label: 'Round' },
            ]}
            onChange={(shape) => change({ shape })}
          />
          <div className="field-grid">
            {lengthField(feature.shape === 'round' ? 'Diameter' : 'Width', 'width')}
            {feature.shape !== 'round' && lengthField('Depth', 'depth')}
            {lengthField('Clearance', 'clearance')}
          </div>
        </Section>
      )}

      <Section title="Position">
        {p.type === 'wall' ? (
          <>
            <WallPicker project={project} value={p.wallId} featureWidth={feature.width} onChange={(wallId) => change({ placement: { ...p, wallId } })} />
            <div className="field-grid two">
              <NumberField
                label="Centre from the wall’s start"
                suffix={unit}
                value={length(p.offset)}
                onCommit={(v) => change({ placement: { ...p, offset: toCm(v) } })}
              />
            </div>
            <p className="hint">Drag it on the plan to slide it along the wall or move it to another wall.</p>
          </>
        ) : (
          <>
            <div className="field-grid two">
              <NumberField label="From left" suffix={unit} value={length(p.x)} onCommit={(v) => change({ placement: { ...p, x: toCm(v) } })} />
              <NumberField label="From top" suffix={unit} value={length(p.y)} onCommit={(v) => change({ placement: { ...p, y: toCm(v) } })} />
            </div>
            {feature.kind !== 'light' && !(feature.kind === 'column' && feature.shape === 'round') && (
              <RotationField rotation={p.rotation} onChange={(rotation) => change({ placement: { ...p, rotation } })} />
            )}
          </>
        )}
      </Section>

      <ConflictList objectId={feature.id} project={project} conflicts={conflicts} dispatch={dispatch} />

      <Section>
        <button type="button" className="danger" onClick={() => onDelete(feature.id)}>
          <Icon name="trash" /> <span className="truncate">Delete {feature.name}</span>
        </button>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overlaps
// ---------------------------------------------------------------------------

/** Lists this object's overlaps, each with its own "allow" decision. */
export function ConflictList({ objectId, project, conflicts, dispatch }: { objectId: string; project: Project; conflicts: Conflict[]; dispatch: Dispatch<EditorAction> }) {
  const mine = conflicts.filter((c) => c.itemId === objectId || c.otherId === objectId);
  if (mine.length === 0) return null;
  return (
    <Section title="Overlaps">
      <ul className="conflict-list">
        {mine.map((conflict) => (
          <li key={conflict.key} className={conflict.accepted ? 'is-accepted' : 'is-warning'}>
            <p className="conflict-message">
              <Icon name={conflict.accepted ? 'check' : 'warning'} size={16} />
              <span>{describeConflict(conflict, project, objectId)}</span>
            </p>
            <p className="hint">{conflictCaveat(conflict, project)}</p>
            {conflict.accepted ? (
              <div className="conflict-actions">
                <span className="accepted-badge">Overlap allowed by you</span>
                <button type="button" className="link-button" onClick={() => dispatch({ type: 'overlap/revoke', key: conflict.key })}>
                  Undo allow
                </button>
              </div>
            ) : (
              <button type="button" className="secondary small" onClick={() => dispatch({ type: 'overlap/accept', keys: [conflict.key] })}>
                Allow overlap for this item
              </button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** A reminder of why the overlap matters. Allowing it never means it's safe. */
export function conflictCaveat(conflict: Conflict, project: Project): string {
  if (conflict.otherKind === 'furniture') {
    return 'Solid pieces can’t share space. Allow this only if it reflects reality — like a stool tucked under a counter.';
  }
  if (conflict.otherKind === 'stairs') {
    return 'Stairs need clear space to walk. Allowing this doesn’t make it safe, and Roomination doesn’t check building codes.';
  }
  if (conflict.otherKind === 'wall') return 'Walls are solid. The drawing may need adjusting.';
  const feature = project.features.find((f) => f.id === conflict.otherId);
  switch (feature?.kind) {
    case 'vent':
      return 'Covering a vent can reduce airflow, heating and cooling. Allowing the overlap doesn’t make it safe.';
    case 'door':
      return 'The door may not open fully or the doorway may be hard to pass through.';
    case 'outlet':
    case 'switch':
      return 'It may be hard to reach. Keep cords and plugs accessible.';
    case 'radiator':
      return 'Furniture close to a radiator can block heat and may get hot. Check the manufacturer’s guidance.';
    default:
      return 'This space was marked to keep clear.';
  }
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

export function Section({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <section className="panel-section">
      {title && <h3>{title}</h3>}
      {hint && <p className="hint section-hint">{hint}</p>}
      <div className="stack">{children}</div>
    </section>
  );
}

export function NameField({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>Name</label>
      <input
        id={id}
        type="text"
        defaultValue={value}
        maxLength={60}
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </div>
  );
}

export function RotationField({ rotation, onChange, disabled }: { rotation: number; onChange: (rotation: number) => void; disabled?: boolean }) {
  return (
    <div className="rotation-row">
      <NumberField label="Angle" suffix="°" value={Math.round(rotation * 10) / 10} onCommit={onChange} disabled={disabled} />
      <div className="button-row tight">
        <button type="button" className="icon-button" aria-label="Rotate 90° anticlockwise" onClick={() => onChange(rotation - 90)} disabled={disabled}>
          <Icon name="rotateLeft" />
        </button>
        <button type="button" className="icon-button" aria-label="Rotate 90° clockwise" onClick={() => onChange(rotation + 90)} disabled={disabled}>
          <Icon name="rotateRight" />
        </button>
      </div>
    </div>
  );
}

/** Preset swatches plus a free colour picker. `live` marks continuous picker drags. */
export function ColorPicker({ value, onChange, label = 'Colour' }: { value: string; onChange: (color: string, live: boolean) => void; label?: string }) {
  const id = useId();
  return (
    <div className="swatch-row" role="radiogroup" aria-label={label}>
      {FURNITURE_COLORS.map(({ name, value: color }) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={name}
          title={name}
          className={`swatch ${value === color ? 'is-active' : ''}`}
          style={{ background: color }}
          onClick={() => onChange(color, false)}
        />
      ))}
      <label className="swatch custom-swatch" htmlFor={id} title="Custom colour" style={{ background: value }}>
        <span className="visually-hidden">Custom colour</span>
        <input id={id} type="color" value={value.length === 7 ? value : '#e9a178'} onChange={(e) => onChange(e.target.value, true)} />
      </label>
    </div>
  );
}
