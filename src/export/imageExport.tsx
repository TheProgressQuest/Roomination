import Konva from 'konva';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { FloorPlan } from '../components/plan/FloorPlan';
import { DEFAULT_SNAP } from '../model/snapping';
import type { Project } from '../model/types';
import { formatLength } from '../model/units';
import { asRectangle, roomArea } from '../model/walls';
import type { CanvasPalette } from '../render/palette';
import { setTextureResolution, PX_PER_CM } from '../render/textures';
import type { CameraPreset, PresentationPreferences } from '../state/preferences';

/**
 * High-resolution PNG export, rendered locally in the browser (nothing is uploaded).
 *
 * - 2D: the plan is drawn again off-screen at a higher pixel ratio, so lines, text,
 *   illustrations and floor textures are redrawn sharp rather than enlarged. No selection,
 *   handles or interface is included.
 * - 3D: a temporary viewer renders the room at the export size from a preset camera, then
 *   frees its graphics memory.
 */

export interface ExportSize {
  label: string;
  width: number;
  height: number;
}

export const EXPORT_SIZES: ExportSize[] = [
  { label: '1080p (1920 × 1080)', width: 1920, height: 1080 },
  { label: '1440p (2560 × 1440)', width: 2560, height: 1440 },
  { label: '4K (3840 × 2160)', width: 3840, height: 2160 },
];

/** CSS width the 2D plan is laid out at before being scaled up (keeps text proportions sensible). */
const LAYOUT_WIDTH = 1600;

/** Whether this browser can allocate a canvas of this size (Safari on phones caps canvas area). */
export function canAllocate(width: number, height: number): boolean {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.fillRect(width - 1, height - 1, 1, 1);
    const ok = ctx.getImageData(width - 1, height - 1, 1, 1).data[3] === 255;
    canvas.width = canvas.height = 0;
    return ok;
  } catch {
    return false;
  }
}

export interface PlanExportOptions {
  project: Project;
  palette: CanvasPalette;
  /** Presentation settings, or null for the technical plan. */
  presentation: PresentationPreferences | null;
  showMeasurementGrid: boolean;
  width: number;
  height: number;
  transparent: boolean;
  background: string;
}

export async function renderPlanImage(o: PlanExportOptions): Promise<HTMLCanvasElement> {
  const ratio = o.width / LAYOUT_WIDTH;
  const cssHeight = Math.round(o.height / ratio);
  const host = document.createElement('div');
  // Off-screen but laid out (so the plan can measure itself), and never seen or announced.
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-${LAYOUT_WIDTH + 100}px;top:0;width:${LAYOUT_WIDTH}px;height:${cssHeight}px;pointer-events:none;`;
  const inner = document.createElement('div');
  inner.style.cssText = 'position:relative;width:100%;height:100%;';
  host.appendChild(inner);
  document.body.appendChild(host);
  const savedRatio = Konva.pixelRatio;
  Konva.pixelRatio = ratio;
  // Floor and rug textures at a resolution that stays crisp at this size.
  setTextureResolution(Math.min(8, Math.max(PX_PER_CM, Math.ceil(ratio * 3))));
  const root = createRoot(inner);
  try {
    flushSync(() =>
      root.render(
        <FloorPlan
          project={o.project}
          conflicts={[]}
          selection={null}
          palette={o.palette}
          showMeasurementGrid={o.showMeasurementGrid}
          showClearances={false}
          presentation={o.presentation}
          mode="select"
          draft={[]}
          snap={DEFAULT_SNAP}
          touch={false}
          readOnly
          onSelect={() => {}}
          onOpenEditor={() => {}}
          onChangeFurniture={() => {}}
          onChangeFeature={() => {}}
          onChangeStair={() => {}}
          onMoveCorner={() => {}}
          onDraftPoint={() => {}}
        />,
      ),
    );
    const stage = await waitFor(() => Konva.stages.find((s) => inner.contains(s.container())) ?? null, 3000);
    // Let photos and the first draw settle.
    await delay(400);
    await nextFrames(2);
    stage.batchDraw();
    const plan = stage.toCanvas({ pixelRatio: ratio });
    const out = document.createElement('canvas');
    out.width = o.width;
    out.height = o.height;
    const ctx = out.getContext('2d')!;
    if (!o.transparent) {
      ctx.fillStyle = o.background;
      ctx.fillRect(0, 0, o.width, o.height);
    }
    ctx.drawImage(plan, 0, 0, o.width, o.height);
    return out;
  } finally {
    root.unmount();
    host.remove();
    Konva.pixelRatio = savedRatio;
    setTextureResolution(PX_PER_CM);
  }
}

export interface SceneExportOptions {
  project: Project;
  preset: CameraPreset;
  width: number;
  height: number;
  transparent: boolean;
  background: string;
  quality: 'low' | 'medium' | 'high';
  /** Write the room's name and size in the corner. */
  caption: boolean;
}

export async function renderSceneImage(o: SceneExportOptions): Promise<HTMLCanvasElement> {
  const [{ RoomViewer }, { buildFurniture, buildRoomModel }] = await Promise.all([import('../scene3d/three/RoomViewer'), import('../scene3d/model')]);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-2000px;top:0;width:640px;height:360px;pointer-events:none;';
  document.body.appendChild(host);
  let viewer: InstanceType<typeof RoomViewer> | null = null;
  try {
    viewer = new RoomViewer(host, {
      shadows: true,
      quality: o.quality,
      reducedMotion: true,
      touch: false,
      initialPreset: o.preset,
      onSelect: () => {},
      onContextLost: () => {},
    });
    viewer.setRoom(buildRoomModel(o.project));
    viewer.setFurniture(buildFurniture(o.project.furniture));
    await viewer.whenReady();
    const image = viewer.renderImage(o.width, o.height, { preset: o.preset, transparent: o.transparent, background: o.background });
    if (o.caption) drawCaption(image, o.project);
    return image;
  } finally {
    viewer?.dispose();
    host.remove();
  }
}

/** The room's name and size in the lower-left corner, like a drawing's title block. */
function drawCaption(canvas: HTMLCanvasElement, project: Project) {
  const ctx = canvas.getContext('2d')!;
  const scale = canvas.width / 1600;
  const rect = asRectangle(project.room);
  const size = rect ? `${formatLength(rect.width, project.units)} × ${formatLength(rect.length, project.units)}` : `${(roomArea(project.room) / 10_000).toFixed(1)} m²`;
  const pad = 28 * scale;
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(30,26,22,0.82)';
  ctx.shadowColor = 'rgba(255,255,255,0.8)';
  ctx.shadowBlur = 6 * scale;
  ctx.font = `700 ${20 * scale}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText(project.name.toUpperCase(), pad, canvas.height - pad - 24 * scale);
  ctx.font = `400 ${17 * scale}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.fillText(size, pad, canvas.height - pad);
  ctx.restore();
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be created.'))), 'image/png'));
}

/** A tidy file name from the project name. */
export function imageFileName(project: Project, view: string, size: ExportSize): string {
  const base = project.name.trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'room';
  return `${base}-${view}-${size.height}p.png`;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextFrames(n: number) {
  return new Promise<void>((resolve) => {
    const step = (left: number) => (left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1)));
    step(n);
  });
}

async function waitFor<T>(get: () => T | null, timeoutMs: number): Promise<T> {
  const started = performance.now();
  for (;;) {
    const value = get();
    if (value) return value;
    if (performance.now() - started > timeoutMs) throw new Error('The plan could not be drawn for export.');
    await nextFrames(1);
  }
}
