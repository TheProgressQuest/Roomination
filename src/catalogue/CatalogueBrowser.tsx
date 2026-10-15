import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { UnitSystem } from '../model/types';
import { formatLength } from '../model/units';
import { illustrationOf } from '../render/planIllustration';
import { CATALOGUE_DRAG_TYPE } from '../components/plan/FloorPlan';
import { CATALOGUE, CATEGORY_LABELS, searchCatalogue, type CatalogueCategory, type CatalogueItem } from './items';

/**
 * The furniture catalogue: search, browse by room, and add ready-made pieces with a click or
 * by dragging them onto the plan. Pictures are drawn on this device from the same parts as
 * the plan and the 3D view (nothing is downloaded), only when a card scrolls into view.
 */

interface Props {
  units: UnitSystem;
  /** Adds the item near the room's centre. */
  onAdd: (item: CatalogueItem) => void;
  /** Touch screens can't drag cards onto the plan; they tap instead. */
  touch: boolean;
}

const CATEGORIES = Object.keys(CATEGORY_LABELS) as CatalogueCategory[];

export default function CatalogueBrowser({ units, onAdd, touch }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CatalogueCategory | 'all'>('all');
  const searchId = useId();
  const results = useMemo(() => searchCatalogue(query, category), [query, category]);

  return (
    <div className="catalogue">
      <div className="field catalogue-search">
        <label htmlFor={searchId}>Search the catalogue</label>
        <input id={searchId} type="search" placeholder={`${CATALOGUE.length} items: sofa, toilet, hot tub…`} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="catalogue-categories" role="radiogroup" aria-label="Room">
        {(['all', ...CATEGORIES] as const).map((c) => (
          <button key={c} type="button" role="radio" aria-checked={category === c} className={category === c ? 'is-active' : ''} onClick={() => setCategory(c)}>
            {c === 'all' ? 'All' : CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>
      <p className="hint catalogue-count" role="status" aria-live="polite">
        {results.length === 0 ? 'Nothing matches. Try another word, or All rooms.' : `${results.length} ${results.length === 1 ? 'item' : 'items'}${touch ? '. Tap one to add it.' : '. Click to add, or drag onto the plan.'}`}
      </p>
      <ul className="catalogue-grid">
        {results.map((item) => (
          <li key={item.id}>
            <Card item={item} units={units} onAdd={onAdd} draggable={!touch} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Card({ item, units, onAdd, draggable }: { item: CatalogueItem; units: UnitSystem; onAdd: (item: CatalogueItem) => void; draggable: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setShown(true), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const info = shown ? details(item) : null;
  return (
    <button
      ref={ref}
      type="button"
      className="catalogue-card"
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData(CATALOGUE_DRAG_TYPE, item.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => onAdd(item)}
      aria-label={`Add ${item.name}${info ? `, ${formatLength(info.width, units)} by ${formatLength(info.depth, units)}` : ''}`}
    >
      <span className="catalogue-thumb" aria-hidden="true">
        {info?.picture ? <img src={info.picture} alt="" draggable={false} /> : null}
      </span>
      <span className="catalogue-name">{item.name}</span>
      {info && (
        <span className="catalogue-size">
          {formatLength(info.width, units)} × {formatLength(info.depth, units)}
        </span>
      )}
    </button>
  );
}

const cache = new Map<string, { width: number; depth: number; picture: string | null }>();

/** The item's size and a small top-down picture (made once per session). */
function details(item: CatalogueItem) {
  const hit = cache.get(item.id);
  if (hit) return hit;
  const t = item.make();
  const result = { width: t.width, depth: t.depth, picture: picture({ ...t, id: `catalogue-${item.id}` }) };
  cache.set(item.id, result);
  return result;
}

const W = 112;
const H = 84;

function picture(t: Parameters<typeof illustrationOf>[0]): string | null {
  if (typeof document === 'undefined') return null;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const scale = Math.min((W - 14) / t.width, (H - 14) / t.depth);
  const art = illustrationOf(t, scale, ratio);
  if (!art) return null;
  const canvas = document.createElement('canvas');
  canvas.width = W * ratio;
  canvas.height = H * ratio;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  // A soft shadow down and to the right, as on the plan.
  ctx.shadowColor = 'rgba(27,20,8,0.28)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetX = 1.5;
  ctx.shadowOffsetY = 2.5;
  ctx.drawImage(art.canvas, W / 2 - art.originX, H / 2 - art.originY, art.width, art.height);
  return canvas.toDataURL('image/png');
}
