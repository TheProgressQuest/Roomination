import { useEffect, useId, useRef, useState, type Dispatch } from 'react';
import { NumberField } from '../components/NumberField';
import { SegmentedControl } from '../components/SegmentedControl';
import type { CameraApi, PhotoOverlay } from '../components/view3d/View3D';
import { featureFrame, toRoom } from '../model/features';
import { createId } from '../model/sample';
import type { CameraPose, CameraView, Project } from '../model/types';
import { cmToInput, inputToCm, inputUnitLabel } from '../model/units';
import type { EditorAction } from '../state/editor';
import { getAsset } from '../storage/assets';

/**
 * Lining the 3D camera up with a photo, by hand: the photo is laid over the view (which takes
 * the photo's shape) and the person moves, turns and tilts the camera and sets the lens until
 * the walls, floor and furniture edges line up. Views can be saved with the project.
 *
 * This is visual matching, not calibration: one ordinary photo doesn't say exactly where the
 * camera was, so the result is as close as the person makes it.
 */

/** Vertical field of view (degrees) for a 35 mm-equivalent focal length and photo shape. */
export function fovFromFocalLength(mm: number, aspect: number): number {
  // 35 mm equivalents are defined on the diagonal (43.27 mm) of a full-frame sensor.
  const height = 43.27 / Math.sqrt(1 + aspect * aspect);
  return (2 * Math.atan(height / 2 / mm) * 180) / Math.PI;
}

/** A starting point: just inside the first door, at eye height, looking into the room. */
export function doorwayPose(project: Project, fov: number): CameraPose | null {
  const door = project.features.find((f) => f.kind === 'door');
  if (!door) return null;
  const frame = featureFrame(door, project.room);
  const at = toRoom(frame, { x: 0, y: 30 });
  return { x: Math.round(at.x), y: Math.round(at.y), height: 150, yaw: (((frame.angle + 180) % 360) + 360) % 360, pitch: -10, roll: 0, fov: Math.round(fov * 10) / 10 };
}

const LENSES = [
  { mm: 13, label: '0.5×' },
  { mm: 24, label: '1×' },
  { mm: 48, label: '2×' },
];

interface Props {
  project: Project;
  photoId: string | null;
  photoAspect: number;
  camera: CameraApi | null;
  dispatch: Dispatch<EditorAction>;
  onOverlay: (overlay: PhotoOverlay | null) => void;
}

export function CameraMatch({ project, photoId, photoAspect, camera, dispatch, onOverlay }: Props) {
  const units = project.units;
  const unit = inputUnitLabel(units);
  const [pose, setPose] = useState<CameraPose | null>(null);
  const [opacity, setOpacity] = useState(0.5);
  const [compare, setCompare] = useState<NonNullable<PhotoOverlay['compare']>>('blend');
  const [split, setSplit] = useState(0.5);
  const [url, setUrl] = useState<string | null>(null);
  const [name, setName] = useState('');
  const nameId = useId();
  const views = project.cameraViews ?? [];

  // The photo, as an image the overlay can show.
  useEffect(() => {
    let revoke: string | null = null;
    setUrl(null);
    if (!photoId) return;
    void getAsset(photoId).then((a) => {
      if (!a) return;
      revoke = URL.createObjectURL(a.blob);
      setUrl(revoke);
    });
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [photoId]);

  // Start from where the camera is now (or the doorway, if it's outside the room).
  const started = useRef(false);
  useEffect(() => {
    if (!camera || started.current) return;
    started.current = true;
    const current = camera.pose();
    const inside = current.height < project.room.height && current.height > 0;
    const startPose = inside ? current : (doorwayPose(project, fovFromFocalLength(24, photoAspect)) ?? current);
    setPose(startPose);
  }, [camera]);

  useEffect(() => {
    if (pose) camera?.setManual(pose);
  }, [pose, camera]);
  useEffect(() => onOverlay(url ? { url, aspect: photoAspect, opacity, compare, split } : null), [url, photoAspect, opacity, compare, split]);
  // Leaving camera matching hands the camera back to orbiting and removes the overlay.
  useEffect(
    () => () => {
      camera?.setManual(null);
      onOverlay(null);
    },
    [camera],
  );

  if (!pose) return <p className="hint">Open the 3D view to line the camera up.</p>;
  const set = (changes: Partial<CameraPose>) => setPose((p) => (p ? { ...p, ...changes } : p));
  const angle = (label: string, key: 'yaw' | 'pitch' | 'roll' | 'fov', min: number, max: number, step = 0.5) => (
    <label className="range-label field">
      <span className="field-label">
        {label} {pose[key].toFixed(1)}°
      </span>
      <input type="range" min={min} max={max} step={step} value={pose[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} />
    </label>
  );

  return (
    <div className="stack camera-match">
      <p className="hint">The photo is laid over the 3D view. Move and turn the camera until the room’s corners, floor edges and furniture line up. This matches by eye; a single photo can’t say exactly where it was taken.</p>
      <SegmentedControl
        label="Compare"
        value={compare}
        options={[
          { value: 'blend', label: 'Overlay' },
          { value: 'wipe', label: 'Side by side' },
          { value: 'difference', label: 'Differences' },
        ]}
        onChange={setCompare}
      />
      {compare === 'blend' && (
        <label className="range-label field">
          <span className="field-label">Photo see-through {Math.round(opacity * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
        </label>
      )}
      {compare === 'wipe' && (
        <label className="range-label field">
          <span className="field-label">Divider (photo on the left) {Math.round(split * 100)}%</span>
          <input type="range" min={0} max={1} step={0.01} value={split} onChange={(e) => setSplit(Number(e.target.value))} />
        </label>
      )}
      {compare === 'difference' && (
        <p className="hint">Where the photo and the 3D view agree, the picture goes dark. Bright outlines are edges that don’t line up (move the camera, or correct the object’s size or place); bright areas are colours that differ (correct the material). Shadows and reflections differ too, so judge by eye: this doesn’t decide anything for you.</p>
      )}
      <div className="field">
        <span className="field-label">Lens (iPhone Pro, 35 mm equivalent)</span>
        <div className="button-row tight">
          {LENSES.map((l) => (
            <button key={l.mm} type="button" className="secondary small" onClick={() => set({ fov: Math.round(fovFromFocalLength(l.mm, photoAspect) * 10) / 10 })}>
              {l.label} ({l.mm} mm)
            </button>
          ))}
        </div>
      </div>
      {angle('Field of view', 'fov', 15, 110)}
      <div className="field-grid">
        <NumberField label="From left" suffix={unit} value={cmToInput(pose.x, units)} onCommit={(v) => set({ x: inputToCm(v, units) })} />
        <NumberField label="From top" suffix={unit} value={cmToInput(pose.y, units)} onCommit={(v) => set({ y: inputToCm(v, units) })} />
        <NumberField label="Eye height" suffix={unit} value={cmToInput(pose.height, units)} onCommit={(v) => set({ height: inputToCm(v, units) })} />
      </div>
      {angle('Turn', 'yaw', 0, 360)}
      {angle('Tilt', 'pitch', -60, 60)}
      {angle('Roll', 'roll', -20, 20, 0.25)}
      <div className="button-row tight">
        <button type="button" className="secondary small" onClick={() => camera && setPose(camera.pose())}>
          Reset to the view before
        </button>
        {project.features.some((f) => f.kind === 'door') && (
          <button type="button" className="secondary small" onClick={() => setPose(doorwayPose(project, pose.fov))}>
            Start at the door
          </button>
        )}
      </div>

      <div className="field">
        <label htmlFor={nameId}>Save this view as</label>
        <div className="match-save">
          <input id={nameId} type="text" maxLength={60} placeholder="View from the door" value={name} onChange={(e) => setName(e.target.value)} />
          <button
            type="button"
            className="primary small"
            onClick={() => {
              const view: CameraView = { id: createId(), name: name.trim() || `View ${views.length + 1}`, pose, ...(photoId ? { photoAssetId: photoId } : {}) };
              dispatch({ type: 'views/set', views: [...views, view] });
              setName('');
            }}
          >
            Save view
          </button>
        </div>
      </div>
      {views.length > 0 && (
        <ul className="match-views">
          {views.map((v) => (
            <li key={v.id}>
              <span>{v.name}</span>
              <span className="button-row tight">
                <button type="button" className="secondary small" onClick={() => setPose(v.pose)}>
                  Go to view
                </button>
                <button type="button" className="link-button" onClick={() => dispatch({ type: 'views/set', views: views.filter((x) => x.id !== v.id) })}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
