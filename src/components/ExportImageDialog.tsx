import { useEffect, useId, useState } from 'react';
import type { Project } from '../model/types';
import type { CanvasPalette } from '../render/palette';
import { resolveQuality, type Preferences } from '../state/preferences';
import { Dialog } from './Dialog';
import { Icon } from './Icon';
import { SegmentedControl } from './SegmentedControl';

/**
 * Export an image of the design: the 2D plan (technical or presentation) or a 3D view,
 * at 1080p, 1440p or 4K where the device can manage it. Rendered in the browser; nothing is
 * uploaded. The interface (selection, handles, buttons) is never included.
 */

type ExportView = 'plan' | 'top' | 'isometric' | 'eye';

const VIEWS: { value: ExportView; label: string }[] = [
  { value: 'plan', label: '2D plan' },
  { value: 'top', label: '3D top-down' },
  { value: 'isometric', label: '3D isometric' },
  { value: 'eye', label: '3D eye level' },
];

interface ExportImageDialogProps {
  open: boolean;
  onClose: () => void;
  project: Project;
  preferences: Preferences;
  palette: CanvasPalette;
  touch: boolean;
  /** The board colour behind the plan (used unless the background is transparent). */
  boardColor: string;
}

type Status = { kind: 'idle' } | { kind: 'working' } | { kind: 'done'; message: string } | { kind: 'error'; message: string };

export function ExportImageDialog(props: ExportImageDialogProps) {
  const { project, preferences, palette, touch } = props;
  const [view, setView] = useState<ExportView>('plan');
  const [style, setStyle] = useState(preferences.planStyle);
  const [size, setSize] = useState(0);
  const [transparent, setTransparent] = useState(false);
  const [labels, setLabels] = useState(true);
  const [available, setAvailable] = useState<boolean[]>([true, true, true]);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const sizeId = useId();

  // Offer only the sizes this device can actually make (phones often cap canvas size).
  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    import('../export/imageExport').then(({ EXPORT_SIZES, canAllocate }) => {
      if (cancelled) return;
      const ok = EXPORT_SIZES.map((s) => canAllocate(s.width, s.height) && !(touch && s.width > 2560 && ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4) < 4));
      setAvailable(ok);
      setSize((current) => (ok[current] ? current : 0));
    });
    setStatus({ kind: 'idle' });
    return () => {
      cancelled = true;
    };
  }, [props.open, touch]);

  async function run() {
    setStatus({ kind: 'working' });
    const started = performance.now();
    try {
      const exporter = await import('../export/imageExport');
      const target = exporter.EXPORT_SIZES[size];
      const background = getComputedStyle(document.documentElement).getPropertyValue('--surface-sunk').trim() || '#ffffff';
      const canvas =
        view === 'plan'
          ? await exporter.renderPlanImage({
              project,
              palette,
              presentation: style === 'presentation' ? { ...preferences.presentation, editing: false, roomLabel: labels, dimensions: labels } : null,
              showMeasurementGrid: preferences.showMeasurementGrid,
              width: target.width,
              height: target.height,
              transparent,
              background: props.boardColor,
            })
          : await exporter.renderSceneImage({
              project,
              preset: view,
              width: target.width,
              height: target.height,
              transparent,
              background,
              quality: resolveQuality(preferences.view3d.quality, touch) === 'low' ? 'medium' : 'high',
              caption: labels,
            });
      const blob = await exporter.canvasToPng(canvas);
      const name = exporter.imageFileName(project, view === 'plan' ? `plan-${style}` : `3d-${view}`, target);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setStatus({ kind: 'done', message: `Saved ${name} (${target.width} × ${target.height}, ${(blob.size / 1_048_576).toFixed(1)} MB) in ${((performance.now() - started) / 1000).toFixed(1)} s.` });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'The image could not be created on this device. Try a smaller size.' });
    }
  }

  return (
    <Dialog
      open={props.open}
      title="Export image"
      onClose={props.onClose}
      footer={
        <div className="button-row">
          <button type="button" className="secondary" onClick={props.onClose}>
            Close
          </button>
          <button type="button" className="primary" onClick={() => void run()} disabled={status.kind === 'working'}>
            <Icon name="download" size={16} /> {status.kind === 'working' ? 'Creating image…' : 'Export PNG'}
          </button>
        </div>
      }
    >
      <section className="dialog-section stack">
        <SegmentedControl label="View" value={view} options={VIEWS} onChange={setView} />
        {view === 'plan' && (
          <SegmentedControl
            label="Plan style"
            value={style}
            options={[
              { value: 'technical', label: 'Technical' },
              { value: 'presentation', label: 'Presentation' },
            ]}
            onChange={setStyle}
          />
        )}
        <div className="field">
          <label htmlFor={sizeId}>Size</label>
          <select id={sizeId} value={size} onChange={(e) => setSize(Number(e.target.value))}>
            {SIZE_LABELS.map((label, i) => (
              <option key={label} value={i} disabled={!available[i]}>
                {label}
                {available[i] ? '' : ' — too large for this device'}
              </option>
            ))}
          </select>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
          <span>Transparent background</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />
          <span>Room name and dimensions</span>
        </label>
        <p className="hint">The image is created on this device and saved to your downloads. Nothing is uploaded.</p>
        <p className={`hint ${status.kind === 'error' ? 'is-warning' : ''}`} role="status" aria-live="polite">
          {status.kind === 'done' || status.kind === 'error' ? status.message : ''}
        </p>
      </section>
    </Dialog>
  );
}

const SIZE_LABELS = ['1080p (1920 × 1080)', '1440p (2560 × 1440)', '4K (3840 × 2160)'];
