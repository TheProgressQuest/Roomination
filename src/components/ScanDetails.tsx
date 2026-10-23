import type { Project, ScanItemRecord } from '../model/types';
import { CM_PER_INCH } from '../model/units';

/**
 * For a piece, door or window that came from a room scan: what the scanner measured, kept
 * apart from what Roomination inferred and from what the person corrected. Read-only history
 * saved with the project (see ScanRecord).
 */
export function ScanDetails({ project, id }: { project: Project; id: string }) {
  const item = project.scan?.items.find((i) => i.id === id);
  if (!item) return null;
  const units = project.units;
  const len = (cm: number) => {
    const v = units === 'metric' ? cm : cm / CM_PER_INCH;
    return `${(Math.round(v * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units === 'metric' ? 'cm' : 'in'}`;
  };
  const m = item.measured;
  const corrections = Object.entries(item.corrections).filter(([key]) => key !== 'include');
  return (
    <section className="panel-section scan-history" aria-label="From the room scan">
      <h3>
        From the room scan <span className="beta-badge">Beta</span>
      </h3>
      {item.origin === 'added' ? (
        <p className="hint">You added this while reviewing the scan; it wasn’t measured.</p>
      ) : (
        <p className="hint">
          <span className="scan-tag">Scanner measured</span> {words(item.category)}
          {m ? `, ${m.depth !== undefined ? `${len(m.width)} × ${len(m.depth)}` : `${len(m.width)} wide`}, ${len(m.height)} high${m.bottom ? `, ${len(m.bottom)} off the floor` : ''}` : ''}
          {item.confidence !== 'unknown' ? ` (${item.confidence} confidence)` : ''}
        </p>
      )}
      {item.inferredName && (
        <p className="hint">
          <span className="scan-tag is-guess">Roomination’s guess</span> {item.inferredName}
        </p>
      )}
      {corrections.length > 0 && (
        <p className="hint">
          <span className="scan-tag is-assumed">You corrected</span> {corrections.map(([key, value]) => `${key === 'as' ? 'piece' : key} → ${typeof value === 'number' ? len(value) : words(String(value))}`).join(', ')}
        </p>
      )}
    </section>
  );
}

/** "washerDryer" → "Washer dryer". */
function words(value: string): string {
  const text = value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/-/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** For the Projects dialog: "Made from a room scan on 23 Oct 2026 (Apple RoomPlan JSON)". */
export function scanSummary(project: Project): string | null {
  const scan = project.scan;
  if (!scan) return null;
  const date = scan.importedAt ? new Date(scan.importedAt).toLocaleDateString(undefined, { dateStyle: 'medium' }) : null;
  const corrected = scan.items.filter((i: ScanItemRecord) => Object.keys(i.corrections).length > 0).length;
  const measured = scan.items.filter((i) => i.origin === 'scanned').length;
  return `Made from a room scan${date ? ` on ${date}` : ''}. Source: ${scan.source}. The ${measured} measured items are kept with the project${corrected ? `; you corrected ${corrected}` : ''}.`;
}
