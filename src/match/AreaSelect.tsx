import { useCallback, useEffect, useRef, useState } from 'react';
import { SegmentedControl } from '../components/SegmentedControl';
import { AREA_MODEL, ENGINE_BYTES, megabytes } from '../photo/areaSelectModel';
import { AreaSelectError, cancelAreaSelect, embedPhoto, isAreaModelDownloaded, isAreaModelLoaded, loadAreaModel, removeAreaModel, segmentPhoto, unsupportedReason } from '../photo/areaSelectClient';
import type { RGBAImage } from '../photo/imageOps';
import { bestCandidate, type Candidate, type PromptPoint } from '../photo/sam';
import { beginHeavyWork, clearStops, endHeavyWork, STOPS_TO_DISABLE, unexplainedStops } from '../photo/areaSelectGuard';

/**
 * "Select an area" in Match my room → Pick colour: tap an object or surface in a photo, an
 * on-device model (MobileSAM) outlines it, and its typical colour is offered. Optional: nothing
 * is downloaded until the person turns it on, and tapping a point works as before without it.
 */

const ENABLED_KEY = 'roomination.areaSelect';
const readEnabled = () => {
  try {
    return localStorage.getItem(ENABLED_KEY) === 'on';
  } catch {
    return false;
  }
};
const writeEnabled = (on: boolean) => {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, 'on');
    else localStorage.removeItem(ENABLED_KEY);
  } catch {
    /* storage blocked: it just isn't remembered */
  }
};

export type AreaStatus = 'off' | 'loading' | 'reading' | 'ready' | 'working';

export interface AreaSelectState {
  status: AreaStatus;
  /** Download progress, 0–1, while loading. */
  progress: number;
  error: string | null;
  points: PromptPoint[];
  candidates: Candidate[];
  index: number;
  /** The selected area, or null. */
  mask: Uint8Array | null;
  /** Whether taps add to the area (or leave a part out). */
  include: boolean;
  timings: { readMs: number | null; selectMs: number | null; loadMs: number | null; fromCache: boolean | null };
}

const MESSAGES: Record<string, string> = {
  download: 'The model couldn’t be downloaded. Check the connection and try again, or tap a point instead.',
  integrity: 'The downloaded model wasn’t the expected file, so it wasn’t used. Try again later, or tap a point instead.',
  memory: 'This device ran out of memory reading the photo. Close other tabs or apps and try again, or tap a point instead.',
};

export function useAreaSelect(image: RGBAImage | null, photoKey: string | null, active: boolean) {
  const [enabled, setEnabled] = useState(readEnabled);
  /** Times the page ended while the model was loading or reading a photo (see areaSelectGuard). */
  const [stops, setStops] = useState(() => (readEnabled() ? unexplainedStops() : 0));
  const [state, setState] = useState<AreaSelectState>({ status: 'off', progress: 0, error: null, points: [], candidates: [], index: 0, mask: null, include: true, timings: { readMs: null, selectMs: null, loadMs: null, fromCache: null } });
  /** Bumped on every photo change or cancel, so late replies are ignored. */
  const generation = useRef(0);
  const readKey = useRef<string | null>(null);
  const reading = useRef<Promise<void> | null>(null);
  /** After a cancel, or a stop, the model isn't loaded again by itself (only when the person asks). */
  const held = useRef(stops > 0);
  const patch = (change: Partial<AreaSelectState>) => setState((s) => ({ ...s, ...change }));

  const fail = useCallback((error: unknown, back: AreaStatus) => {
    // Cancelled (by the person, or by closing the panel): back to where it was, without a message.
    if (error instanceof AreaSelectError && error.kind === 'cancelled') {
      patch({ status: back });
      return;
    }
    const kind = error instanceof AreaSelectError ? error.kind : 'other';
    patch({ status: back, error: MESSAGES[kind] ?? (error instanceof Error ? `Area selection stopped: ${error.message}` : 'Area selection stopped.') });
  }, []);

  /** Reads the photo once it's loaded (the slow step), so the first tap answers quickly. */
  const read = useCallback((): Promise<void> => {
    if (!image || !photoKey) return Promise.resolve();
    if (readKey.current === photoKey && reading.current) return reading.current;
    const gen = generation.current;
    readKey.current = photoKey;
    patch({ status: 'reading', error: null });
    beginHeavyWork();
    reading.current = embedPhoto(photoKey, image).then(
      (ms) => {
        endHeavyWork();
        clearStops();
        if (gen !== generation.current) return;
        setState((s) => ({ ...s, status: 'ready', timings: { ...s.timings, readMs: ms } }));
      },
      (error) => {
        endHeavyWork();
        readKey.current = null;
        reading.current = null;
        if (gen === generation.current) {
          // The worker stopped (crashed, or out of memory): back to "Turn on", never retried by itself.
          if (!isAreaModelLoaded()) held.current = true;
          fail(error, isAreaModelLoaded() ? 'ready' : 'off');
        }
        throw error;
      },
    );
    return reading.current;
  }, [image, photoKey, fail]);

  const load = useCallback(async () => {
    held.current = false;
    const gen = generation.current;
    patch({ status: 'loading', progress: 0, error: null });
    beginHeavyWork();
    try {
      const { fromCache, ms } = await loadAreaModel((loaded, total) => gen === generation.current && patch({ progress: loaded / total })).finally(endHeavyWork);
      if (gen !== generation.current) return;
      setState((s) => ({ ...s, status: 'ready', timings: { ...s.timings, loadMs: ms, fromCache } }));
      writeEnabled(true);
      setEnabled(true);
    } catch (error) {
      if (gen === generation.current) fail(error, 'off');
    }
  }, [fail]);

  // Closing Match my room frees the model's memory; it's kept in the browser, so it's back in a moment.
  useEffect(() => () => cancelAreaSelect(), []);
  // A new photo: start again, and read it if the model is ready.
  useEffect(() => {
    generation.current++;
    readKey.current = null;
    reading.current = null;
    setState((s) => ({ ...s, points: [], candidates: [], index: 0, mask: null, error: null, status: isAreaModelLoaded() ? 'ready' : 'off' }));
  }, [photoKey]);
  // Turned on before (model kept in this browser): load it again when the tool is opened.
  useEffect(() => {
    if (active && enabled && !held.current && !isAreaModelLoaded() && state.status === 'off' && !state.error) void load();
  }, [active, enabled, state.status, state.error, load]);
  useEffect(() => {
    if (active && state.status === 'ready' && isAreaModelLoaded() && image && photoKey && readKey.current !== photoKey) read().catch(() => undefined);
  }, [active, state.status, image, photoKey, read]);

  const select = useCallback(
    async (points: PromptPoint[]) => {
      if (!image || !photoKey) return;
      const gen = generation.current;
      setState((s) => ({ ...s, points, status: 'working', error: null }));
      try {
        if (!isAreaModelLoaded()) {
          readKey.current = null;
          reading.current = null;
          beginHeavyWork();
          await loadAreaModel(() => undefined).finally(endHeavyWork);
        }
        await read();
        if (!points.length) {
          if (gen === generation.current) patch({ status: 'ready', candidates: [], mask: null });
          return;
        }
        const { candidates, ms } = await segmentPhoto(photoKey, points, image.width, image.height);
        if (gen !== generation.current) return;
        const index = candidates.length ? bestCandidate(candidates) : 0;
        setState((s) => ({ ...s, status: 'ready', candidates, index, mask: candidates[index]?.mask ?? null, timings: { ...s.timings, selectMs: ms }, error: candidates.length ? null : 'Nothing was found there. Tap the middle of the object or surface.' }));
      } catch (error) {
        if (gen === generation.current) fail(error, 'ready');
      }
    },
    [image, photoKey, read, fail],
  );

  const actions = {
    enabled,
    /** The page stopped during loading or reading before (0 = never). */
    stops,
    /** Stopped often enough that it's off on this device until the person insists. */
    disabledHere: stops >= STOPS_TO_DISABLE,
    tryAnyway: () => {
      clearStops();
      setStops(0);
      void load();
    },
    unsupported: unsupportedReason(),
    load,
    tap: (p: { x: number; y: number }) => {
      if (state.status === 'off' || state.status === 'loading') return;
      void select([...state.points, { x: p.x, y: p.y, include: state.points.length === 0 ? true : state.include }]);
    },
    undoTap: () => void select(state.points.slice(0, -1)),
    reset: () => {
      setState((s) => ({ ...s, points: [], candidates: [], index: 0, mask: null, error: null, include: true }));
    },
    setInclude: (include: boolean) => patch({ include }),
    step: (by: 1 | -1) => setState((s) => {
      const index = Math.min(s.candidates.length - 1, Math.max(0, s.index + by));
      return { ...s, index, mask: s.candidates[index]?.mask ?? s.mask };
    }),
    cancel: () => {
      held.current = true;
      generation.current++;
      readKey.current = null;
      reading.current = null;
      cancelAreaSelect();
      setState((s) => ({ ...s, status: 'off', progress: 0, points: [], candidates: [], mask: null, error: null }));
    },
    turnOff: async () => {
      generation.current++;
      readKey.current = null;
      reading.current = null;
      await removeAreaModel();
      writeEnabled(false);
      setEnabled(false);
      setState((s) => ({ ...s, status: 'off', progress: 0, points: [], candidates: [], mask: null, error: null }));
    },
  };
  return { ...state, ...actions };
}

export type AreaSelect = ReturnType<typeof useAreaSelect>;

/** The controls under the photo while "Select an area" is chosen. */
export function AreaSelectPanel({ area }: { area: AreaSelect }) {
  const [kept, setKept] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void isAreaModelDownloaded().then((v) => live && setKept(v));
    return () => {
      live = false;
    };
  }, [area.status]);

  if (area.unsupported) {
    return (
      <p className="hint" role="status">
        {area.unsupported} Tap a point instead: it works in every browser.
      </p>
    );
  }
  if (area.status === 'off' && area.disabledHere) {
    return (
      <div className="area-intro stack">
        <p className="hint" role="status">
          Area selection stopped this page {area.stops} times on this device before it finished (most likely the device ran short of memory), so it’s turned off here. Tapping a point works as usual, and the rest of Roomination isn’t affected.
        </p>
        <div className="button-row">
          <button type="button" className="secondary small" onClick={area.tryAnyway}>
            Try anyway
          </button>
        </div>
      </div>
    );
  }
  if (area.status === 'off') {
    return (
      <div className="area-intro stack">
        <p className="hint">
          Tap a sofa, a wall or a floor and an on-device AI model outlines it, then measures its typical colour, leaving out shine, deep shadows and cushions of other colours. It runs on this device: the photo never leaves it.
        </p>
        <p className="hint">
          {kept
            ? 'The model is already kept in this browser.'
            : `The first time, it downloads ${megabytes(AREA_MODEL.encoder.bytes + AREA_MODEL.decoder.bytes)} (the model) and up to ${megabytes(ENGINE_BYTES)} (the engine, shared with Smart remove), from this website only. They’re kept in this browser.`}
        </p>
        {area.stops > 0 && !area.error && (
          <p className="hint" role="status">
            Last time, the page stopped while area selection was starting or reading a photo (most likely the device ran short of memory), so it didn’t start by itself. Close other tabs or apps first, or tap a point instead.
          </p>
        )}
        {area.error && (
          <p className="form-error" role="alert">
            {area.error}
          </p>
        )}
        <div className="button-row">
          <button type="button" className="primary small" onClick={() => void area.load()}>
            {kept ? 'Turn on' : area.error ? 'Try again' : 'Download and turn on'}
          </button>
        </div>
      </div>
    );
  }
  if (area.status === 'loading') {
    return (
      <div className="stack" role="status">
        <p className="hint">Downloading the model… {Math.round(area.progress * 100)}%</p>
        <progress max={1} value={area.progress} aria-label="Model download" />
        <div className="button-row">
          <button type="button" className="secondary small" onClick={area.cancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }
  const busy = area.status === 'reading' || area.status === 'working';
  return (
    <div className="stack area-controls">
      <p className="hint" role="status" aria-live="polite">
        {area.status === 'reading'
          ? 'Reading this photo… (a few seconds, once per photo)'
          : area.status === 'working'
            ? 'Finding the area…'
            : area.mask
              ? 'Shaded: the selected area. Tap again to add to it, or choose Leave out and tap what shouldn’t be in it.'
              : 'Tap the middle of the object or surface.'}
      </p>
      {area.timings.readMs !== null && (
        <p className="hint area-timing">
          Photo read in {(area.timings.readMs / 1000).toFixed(1)} s{area.timings.selectMs !== null ? `; last selection ${(area.timings.selectMs / 1000).toFixed(1)} s` : ''}.
        </p>
      )}
      {area.error && (
        <p className="form-error" role="alert">
          {area.error}
        </p>
      )}
      {area.points.length > 0 && (
        <SegmentedControl
          label="Taps"
          value={area.include ? 'add' : 'out'}
          options={[
            { value: 'add', label: 'Add to area' },
            { value: 'out', label: 'Leave out' },
          ]}
          onChange={(v) => area.setInclude(v === 'add')}
        />
      )}
      <div className="button-row tight">
        {area.candidates.length > 1 && (
          <>
            <button type="button" className="secondary small" disabled={busy || area.index === 0} onClick={() => area.step(-1)}>
              Smaller area
            </button>
            <button type="button" className="secondary small" disabled={busy || area.index >= area.candidates.length - 1} onClick={() => area.step(1)}>
              Larger area
            </button>
          </>
        )}
        {area.points.length > 0 && (
          <button type="button" className="secondary small" disabled={busy} onClick={area.undoTap}>
            Undo last tap
          </button>
        )}
        {busy && (
          <button type="button" className="secondary small" onClick={area.cancel}>
            Cancel
          </button>
        )}
      </div>
      <button type="button" className="link-button" onClick={() => void area.turnOff()}>
        Turn off and delete the downloaded model
      </button>
    </div>
  );
}
