import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CameraPose, Project } from '../../model/types';
import { formatLength } from '../../model/units';
import type {} from '../../scene3d/diagnostics';
import { buildFurniture, buildRoomModel } from '../../scene3d/model';
import { RoomViewer } from '../../scene3d/three/RoomViewer';
import { resolveQuality, type CameraPreset, type QualityPreference, type ResolvedTheme, type View3DPreferences, type WallMode } from '../../state/preferences';
import { Icon } from '../Icon';

/**
 * The 3D view. Loaded on demand (it pulls in Three.js), shows the same project as the plan,
 * and only ever reports selections back — all editing still happens through the 2D editor.
 */

export interface View3DProps {
  project: Project;
  selectedId: string | null;
  theme: ResolvedTheme;
  preferences: View3DPreferences;
  touch: boolean;
  onPreferences: (changes: Partial<View3DPreferences>) => void;
  onSelect: (id: string | null) => void;
  onExit: () => void;
  /** Match My Room: whether its panel is open, the toggle, and the panel itself (shown beside the view). */
  matchOpen?: boolean;
  onToggleMatch?: () => void;
  sidePanel?: ReactNode;
  /** A photo laid over the view for lining the camera up (the view takes the photo's shape). */
  overlay?: PhotoOverlay | null;
  /** Lets Match My Room place the camera by hand. */
  onCameraApi?: (api: CameraApi | null) => void;
}

export interface PhotoOverlay {
  url: string;
  /** Width ÷ height of the photo. */
  aspect: number;
  /** 0–1. */
  opacity: number;
}

export interface CameraApi {
  pose(): CameraPose;
  setManual(pose: CameraPose | null): void;
}

const CAMERA_OPTIONS: { value: CameraPreset; label: string }[] = [
  { value: 'isometric', label: 'Isometric' },
  { value: 'top', label: 'Top-down' },
  { value: 'eye', label: 'Eye level' },
];

const WALL_OPTIONS: { value: WallMode; label: string }[] = [
  { value: 'all', label: 'Show all walls' },
  { value: 'dollhouse', label: 'Dollhouse view' },
];

type Status = 'ready' | 'unsupported' | 'lost';

const QUALITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High' } as const;


export default function View3D(props: View3DProps) {
  const { project, selectedId, theme, preferences, touch, onPreferences, onSelect, onExit, matchOpen, onToggleMatch, sidePanel, overlay } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<RoomViewer | null>(null);
  const [status, setStatus] = useState<Status>('ready');
  /** Bumped to rebuild the viewer after the graphics context was lost. */
  const [attempt, setAttempt] = useState(0);
  const reducedMotion = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  // Callbacks change identity on every render; the viewer always calls the latest ones.
  const latest = useRef({ onSelect, onCameraApi: props.onCameraApi });
  latest.current = { onSelect, onCameraApi: props.onCameraApi };

  // Rebuild only what changed: furniture moves far more often than walls.
  const { room, furniture, features, stairs } = project;
  const roomModel = useMemo(() => buildRoomModel({ room, features, stairs }), [room, features, stairs]);
  const furnitureModel = useMemo(() => buildFurniture(furniture), [furniture]);

  // Create the viewer once (and again after a lost context); free everything on the way out.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let viewer: RoomViewer;
    try {
      viewer = new RoomViewer(container, {
        shadows: preferences.shadows,
        quality: resolveQuality(preferences.quality, touch),
        reducedMotion,
        touch,
        initialPreset: preferences.camera,
        onSelect: (id) => latest.current.onSelect(id),
        onContextLost: () => setStatus('lost'),
      });
    } catch {
      setStatus('unsupported');
      return;
    }
    viewerRef.current = viewer;
    const softwareRendering = viewer.isSoftwareRendering();
    // Decide before anything is built, so a software renderer never starts on a heavy setting.
    if (softwareRendering && preferences.quality === 'auto') viewer.setQuality('low');
    setSoftware(softwareRendering);
    window.__roomination3D = {
      stats: () => viewer.stats(),
      pointOnScreen: (id) => viewer.pointOnScreen(id),
      projectPoint: (p, height) => viewer.projectPoint(p, height),
      visibleWalls: () => viewer.visibleWalls(),
      cameraPosition: () => viewer.cameraPosition(),
    };
    setStatus('ready');
    latest.current.onCameraApi?.({ pose: () => viewer.cameraPose(), setManual: (pose) => viewer.setManualCamera(pose) });
    return () => {
      latest.current.onCameraApi?.(null);
      viewer.dispose();
      viewerRef.current = null;
      delete window.__roomination3D;
    };
    // Preferences are applied by the effects below; only a retry recreates the viewer.
  }, [attempt]);

  useEffect(() => viewerRef.current?.setRoom(roomModel), [roomModel, attempt]);
  useEffect(() => viewerRef.current?.setFurniture(furnitureModel), [furnitureModel, attempt]);
  useEffect(() => viewerRef.current?.setSelection(selectedId), [selectedId, furnitureModel, attempt]);
  useEffect(() => viewerRef.current?.setWallMode(preferences.wallMode), [preferences.wallMode, attempt]);
  useEffect(() => viewerRef.current?.setShadows(preferences.shadows), [preferences.shadows, attempt]);
  // Automatic quality also takes the graphics hardware into account (software rendering → Low).
  const [software, setSoftware] = useState(false);
  const quality = preferences.quality === 'auto' && software ? 'low' : resolveQuality(preferences.quality, touch);
  useEffect(() => viewerRef.current?.setQuality(quality), [quality, attempt]);
  useEffect(() => {
    // Read the colour a frame later: the app applies a theme change after this component's effects run.
    const frame = requestAnimationFrame(() => {
      const background = getComputedStyle(document.documentElement).getPropertyValue('--surface-sunk').trim();
      if (background) viewerRef.current?.setBackground(background);
    });
    return () => cancelAnimationFrame(frame);
  }, [theme, attempt]);

  const selected = project.furniture.find((f) => f.id === selectedId) ?? null;

  // While lining up with a photo, the view is sized to the photo's exact shape (fitted to the space).
  const bodyRef = useRef<HTMLDivElement>(null);
  const [space, setSpace] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setSpace({ width: body.clientWidth, height: body.clientHeight }));
    observer.observe(body);
    return () => observer.disconnect();
  }, []);
  const panelWidth = space ? space.width - (sidePanel ? (bodyRef.current?.querySelector('.match-panel')?.clientWidth ?? 0) + 10 : 0) : 0;
  const fitted =
    overlay && space && panelWidth > 0
      ? (() => {
          const height = Math.min(space.height, panelWidth / overlay.aspect);
          return { width: height * overlay.aspect, height };
        })()
      : null;

  function choosePreset(preset: CameraPreset) {
    onPreferences({ camera: preset });
    viewerRef.current?.setPreset(preset);
  }

  return (
    <div className={`view3d${sidePanel ? ' has-side-panel' : ''}`}>
      <div className="view3d-toolbar" role="toolbar" aria-label="3D view options">
        <div className="segmented" role="radiogroup" aria-label="Camera">
          {CAMERA_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={preferences.camera === option.value}
              className={preferences.camera === option.value ? 'is-active' : ''}
              onClick={() => choosePreset(option.value)}
              disabled={status !== 'ready'}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="segmented" role="radiogroup" aria-label="Walls">
          {WALL_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={preferences.wallMode === option.value}
              className={preferences.wallMode === option.value ? 'is-active' : ''}
              onClick={() => onPreferences({ wallMode: option.value })}
              disabled={status !== 'ready'}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="chip-toggle">
          <input type="checkbox" checked={preferences.shadows} onChange={(e) => onPreferences({ shadows: e.target.checked })} disabled={status !== 'ready'} />
          <span>Shadows</span>
        </label>
        {onToggleMatch && (
          <button type="button" className={`secondary small${matchOpen ? ' is-active' : ''}`} aria-pressed={!!matchOpen} onClick={onToggleMatch}>
            <Icon name="palette" size={16} /> Match my room
          </button>
        )}
        <label className="view3d-select">
          <span>Quality</span>
          <select value={preferences.quality} onChange={(e) => onPreferences({ quality: e.target.value as QualityPreference })} disabled={status !== 'ready'}>
            <option value="auto">Auto ({QUALITY_LABELS[software ? 'low' : resolveQuality('auto', touch)]})</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
      </div>

      <div className="view3d-body" ref={bodyRef}>
      <section className={`canvas-panel view3d-panel${overlay ? ' is-matching' : ''}`} aria-label="3D view" style={fitted ? { width: fitted.width, height: fitted.height } : undefined}>
        <div ref={containerRef} key={attempt} className="view3d-canvas" />
        {overlay && <img className="view3d-overlay" src={overlay.url} alt="" style={{ opacity: overlay.opacity }} />}

        {/* While lining up with a photo, nothing covers it (the camera is placed by the panel). */}
        {status === 'ready' && !overlay && (
          <>
            {selected && (
              <div className="view3d-selected" role="status">
                <strong>{selected.name}</strong>
                <span>
                  {formatLength(selected.width, project.units)} × {formatLength(selected.depth, project.units)} × {formatLength(selected.height, project.units)} high
                </span>
              </div>
            )}
            <div className="view3d-camera-buttons">
              <button type="button" className="icon-button" aria-label="Zoom in" title="Zoom in" onClick={() => viewerRef.current?.zoom(0.8)}>
                <Icon name="plus" />
              </button>
              <button type="button" className="icon-button" aria-label="Zoom out" title="Zoom out" onClick={() => viewerRef.current?.zoom(1.25)}>
                <Icon name="minus" />
              </button>
              <button type="button" className="icon-button" aria-label="Fit room in view" title="Fit room in view" onClick={() => viewerRef.current?.setPreset(preferences.camera)}>
                <Icon name="fit" />
              </button>
            </div>
            {!preferences.hintSeen && (
              <div className="view3d-hint">
                <p>{touch ? 'Drag to orbit · Pinch to zoom · Two fingers to pan · Tap furniture to select' : 'Drag to orbit · Scroll to zoom · Right-drag to pan · Click furniture to select'}</p>
                <button type="button" className="secondary small" onClick={() => onPreferences({ hintSeen: true })}>
                  Got it
                </button>
              </div>
            )}
          </>
        )}

        {status !== 'ready' && (
          <div className="view3d-message" role="alert">
            <Icon name="warning" />
            {status === 'unsupported' ? (
              <p>
                3D view needs WebGL, which this browser or device doesn’t have turned on. Your plan is unaffected — everything still works in 2D.
              </p>
            ) : (
              <p>The 3D view stopped because the device needed its graphics memory back. Your plan is unaffected.</p>
            )}
            <div className="button-row">
              {status === 'lost' && (
                <button type="button" className="primary" onClick={() => setAttempt((n) => n + 1)}>
                  Restart 3D view
                </button>
              )}
              <button type="button" className="secondary" onClick={onExit}>
                Back to 2D plan
              </button>
            </div>
          </div>
        )}
      </section>
        {sidePanel}
      </div>
    </div>
  );
}
