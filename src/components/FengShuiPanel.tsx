import { useId, type Dispatch } from 'react';
import { baguaEntrance, baguaMap, upDirection } from '../model/bagua';
import { DEFAULT_FENG_SHUI } from '../model/furnitureKinds';
import type { FengShuiSettings, Project } from '../model/types';
import type { EditorAction } from '../state/editor';
import { NumberField } from './NumberField';
import { SegmentedControl } from './SegmentedControl';

/**
 * Optional Feng Shui / Harmony settings: the switch, the main entrance, and the Bagua map
 * (which tradition, the room's real north bearing, and whether to show it on the plan).
 */
export function FengShuiPanel({ project, dispatch }: { project: Project; dispatch: Dispatch<EditorAction> }) {
  const settings: FengShuiSettings = { ...DEFAULT_FENG_SHUI, ...project.fengShui };
  const set = (changes: Partial<FengShuiSettings>) => dispatch({ type: 'fengShui/settings', changes });
  const doors = project.features.filter((f) => f.kind === 'door');
  const entrance = baguaEntrance(project);
  const map = settings.enabled ? baguaMap({ ...project, fengShui: settings }) : null;
  const entranceId = useId();

  return (
    <div className="stack feng-shui-panel">
      <label className="toggle">
        <input type="checkbox" checked={settings.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>Use Feng Shui (optional)</span>
      </label>
      <p className="hint">
        An interpretive design tradition. When it’s on, the optimizer also weighs a few of its arrangement ideas, measured from the plan: a commanding position for
        the bed, desk or main seat, a clear entrance, balance, and open walking space. It makes no claims about luck, health or wealth, and it never overrides the
        hard rules.
      </p>

      {settings.enabled && (
        <>
          {doors.length > 1 && (
            <div className="field">
              <label htmlFor={entranceId}>Main entrance</label>
              <select id={entranceId} value={entrance?.id ?? ''} onChange={(e) => set({ entranceId: e.target.value || null })}>
                {doors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {doors.length === 0 && <p className="hint">Add a door: the commanding position and the entrance Bagua both use the main entrance.</p>}

          <label className="toggle">
            <input type="checkbox" checked={settings.showBagua} onChange={(e) => set({ showBagua: e.target.checked })} />
            <span>Show the Bagua map on the plan</span>
          </label>
          <SegmentedControl
            label="Bagua tradition"
            value={settings.method}
            options={[
              { value: 'entrance', label: 'Entrance (Western)' },
              { value: 'compass', label: 'Compass (classical)' },
            ]}
            onChange={(method) => set({ method })}
          />
          {settings.method === 'entrance' ? (
            <p className="hint">The grid lines up with the main entrance: the entrance wall is the front row (Knowledge, Career, Helpful people).</p>
          ) : (
            <>
              <NumberField
                label="Top of the plan faces (compass bearing)"
                suffix="°"
                min={0}
                value={settings.northBearing ?? 0}
                onCommit={(v) => set({ northBearing: v })}
              />
              <div className="button-row tight" role="group" aria-label="Quick bearings">
                {(['North', 'East', 'South', 'West'] as const).map((name, i) => (
                  <button key={name} type="button" className="secondary small" aria-pressed={settings.northBearing === i * 90} onClick={() => set({ northBearing: i * 90 })}>
                    Top is {name.toLowerCase()}
                  </button>
                ))}
              </div>
              <p className="hint">
                {settings.northBearing === null
                  ? 'Type the compass bearing that the top of the plan faces: 0 is north, 90 east, 180 south, 270 west. Use a compass or a map. '
                  : `The top of the plan faces ${upDirection(settings.northBearing)} (${Math.round(settings.northBearing)}°). `}
                Roomination never guesses it from the screen and never reads your location or device sensors.
              </p>
            </>
          )}
          {typeof map === 'string' && <p className="hint is-warning">{map}</p>}
          {map && typeof map !== 'string' && (
            <details className="bagua-legend">
              <summary>What the Bagua areas mean</summary>
              <dl>
                {map.areas.map((a) => (
                  <div key={a.id}>
                    <dt>
                      {a.label} <span className="hint">({a.tag})</span>
                    </dt>
                    <dd>{a.explanation}</dd>
                  </div>
                ))}
              </dl>
              <p className="hint">These are traditional associations, shown for interest and inspiration. The map never blocks selecting or moving furniture.</p>
            </details>
          )}
        </>
      )}
    </div>
  );
}
