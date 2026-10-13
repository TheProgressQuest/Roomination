import { Suspense, lazy, useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from 'react';
import { FeatureButtons, FurnitureButtons, StairButtons, StructureButtons, type FurniturePreset } from './components/AddCatalog';
import { DrawingBar } from './components/DrawingBar';
import { ConflictBanner } from './components/ConflictBanner';
import { Dialog } from './components/Dialog';
import { Header, type SaveStatus } from './components/Header';
import { Icon } from './components/Icon';
import { FloorPlan } from './components/plan/FloorPlan';
import { OptimizerDialog } from './components/OptimizerDialog';
import { PreviewBar } from './components/PreviewBar';
import { ProjectsDialog } from './components/ProjectsDialog';
import { PropertiesPanel } from './components/PropertiesPanel';
import { SelectionBar } from './components/SelectionBar';
import { SelectionEditor } from './components/StructureEditors';
import { Toast } from './components/Toast';
import { ToolsPanel } from './components/ToolsPanel';
import { View3DBoundary } from './components/view3d/View3DBoundary';
import { findConflicts } from './model/conflicts';
import { withPoses } from './optimizer/search';
import { allowedPlacement, findFreeWallSpot } from './model/features';
import { createEmptyProject, createFeature, createFurniture, createId, createSampleProject, createStaircase } from './model/sample';
import type { FeatureKind, Placement, Point, Project, RoomFeature, SavedLayout } from './model/types';
import { DEFAULT_WALL_THICKNESS, findSegment, outlineSegments, roomBounds, wallLabel } from './model/walls';
import { CM_PER_INCH } from './model/units';
import { canvasPalette, luminance } from './render/palette';
import { canRedo, canUndo, createEditorState, editorReducer, type EditorAction } from './state/editor';
import { objectId, type Selection, type ToolMode } from './state/selection';
import { useOptimizer } from './state/useOptimizer';
import { useMediaQuery, usePreferences, useResolvedTheme, type BoardPreferences, type ResolvedTheme } from './state/preferences';
import { MAX_IMPORT_BYTES, parseProjectFile, serializeProject } from './storage/projectFile';
import {
  deleteProject,
  getActiveProjectId,
  listProjects,
  loadProject,
  newProjectId,
  saveProject,
  setActiveProjectId,
  uniqueProjectName,
  type ProjectSummary,
} from './storage/projectStore';

const AUTOSAVE_DELAY_MS = 400;

/** The 3D view (and Three.js) only downloads the first time someone opens it. */
const View3D = lazy(() => import('./components/view3d/View3D'));

export function App() {
  const [state, dispatch] = useReducer(editorReducer, null, () => createEditorState(createSampleProject()));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [selection, setSelection] = useState<Selection>(null);
  const [mode, setMode] = useState<ToolMode>('select');
  /** Which view of the same project is showing. The plan is always the one you edit in. */
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [draft, setDraftState] = useState<Point[]>([]);
  /**
   * The drawing in progress. Taps can arrive faster than React re-renders (especially on
   * phones), so every update builds on this ref rather than on the last render's value —
   * otherwise a quick second tap could overwrite the first.
   */
  const draftRef = useRef<Point[]>([]);
  const setDraft = useCallback((next: Point[] | ((current: Point[]) => Point[])) => {
    draftRef.current = typeof next === 'function' ? next(draftRef.current) : next;
    setDraftState(draftRef.current);
  }, []);
  const [preferences, updatePreferences] = usePreferences();
  const theme = useResolvedTheme(preferences.theme);

  // Layout: desktop keeps three panels; tablets and phones edit in a modal.
  const isDesktop = useMediaQuery('(min-width: 1100px)');
  const isTablet = useMediaQuery('(min-width: 768px)') && !isDesktop;
  const isTouch = useMediaQuery('(pointer: coarse)');
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [optimizerOpen, setOptimizerOpen] = useState(false);
  const optimizer = useOptimizer();
  /** A layout shown on the plan without changing the project (non-destructive preview). */
  const [preview, setPreview] = useState<{ title: string; positions: SavedLayout['positions'] } | null>(null);
  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [importMessage, setImportMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const project = state.present;
  const conflicts = useMemo(() => findConflicts(project), [project]);
  const selectedId = objectId(selection);
  const selectedFurniture = project.furniture.find((f) => f.id === selectedId) ?? null;
  const selectedFeature = project.features.find((f) => f.id === selectedId) ?? null;
  const selectedStair = project.stairs.find((s) => s.id === selectedId) ?? null;
  const selectedName = selectionName(selection, project);

  // ---------------------------------------------------------------------------
  // Loading and saving
  // ---------------------------------------------------------------------------

  const switchTo = useCallback((id: string, next: Project) => {
    dispatch({ type: 'project/replace', project: next, resetHistory: true });
    setActiveId(id);
    setActiveProjectId(id);
    setSelection(null);
    setMode('select');
    setDraft([]);
    setPreview(null);
    setOptimizerOpen(false);
    // Results belong to the project they were made for.
    optimizer.reset();
  }, [setDraft, optimizer.reset]);

  // Restore the last project from this device. First-time visitors get the sample room.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const remembered = getActiveProjectId();
        const candidates = [remembered, ...(await listProjects()).filter((p) => p.readable).map((p) => p.id)];
        for (const id of candidates) {
          if (!id) continue;
          const saved = await loadProject(id);
          if (saved) {
            if (!cancelled) switchTo(id, saved);
            return;
          }
        }
        if (!cancelled) switchTo(newProjectId(), createSampleProject());
      } catch {
        if (!cancelled) {
          setSaveStatus('error');
          switchTo(newProjectId(), createSampleProject());
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [switchTo]);

  // Autosave shortly after every change.
  useEffect(() => {
    if (!activeId) return;
    setSaveStatus('saving');
    const timer = window.setTimeout(() => {
      saveProject(activeId, project)
        .then(() => setSaveStatus('saved'))
        .catch(() => setSaveStatus('error'));
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [project, activeId]);

  const refreshProjectList = useCallback(async () => setProjectList(await listProjects()), []);
  useEffect(() => {
    if (projectsOpen) void refreshProjectList();
  }, [projectsOpen, refreshProjectList]);

  /** Saves the open project immediately (before switching away from it). */
  async function flush() {
    if (activeId) await saveProject(activeId, project);
  }

  /** Saves `next` as a brand-new project (with a non-clashing name) and opens it. */
  async function startProject(next: Project): Promise<string> {
    await flush();
    const names = (await listProjects()).map((p) => p.name);
    const named = { ...next, name: uniqueProjectName(next.name, names) };
    const id = newProjectId();
    await saveProject(id, named);
    switchTo(id, named);
    await refreshProjectList();
    return named.name;
  }

  async function openProject(id: string) {
    await flush();
    const loaded = await loadProject(id);
    if (loaded) switchTo(id, loaded);
    setProjectsOpen(false);
  }

  async function removeProject(id: string) {
    await deleteProject(id);
    if (id === activeId) {
      const remaining = (await listProjects()).filter((p) => p.readable);
      const next = remaining[0] ? await loadProject(remaining[0].id) : null;
      if (remaining[0] && next) switchTo(remaining[0].id, next);
      else {
        const fresh = newProjectId();
        const empty = createEmptyProject();
        await saveProject(fresh, empty);
        switchTo(fresh, empty);
      }
    }
    await refreshProjectList();
  }

  function exportProject() {
    const blob = new Blob([serializeProject(project)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.name.replace(/[^\w\- ]+/g, '').trim() || 'room'}.roomination.json`;
    link.click();
    // Give the browser a moment to start the download before releasing the file.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importProject(file: File) {
    if (file.size > MAX_IMPORT_BYTES) {
      setImportMessage({ kind: 'error', text: 'That file is too large to be a Roomination project.' });
      return;
    }
    const result = parseProjectFile(await file.text());
    if (!result.ok) {
      setImportMessage({ kind: 'error', text: result.error });
      return;
    }
    const name = await startProject(result.project);
    setImportMessage({ kind: 'success', text: `Imported “${name}” as a new project.` });
  }

  // ---------------------------------------------------------------------------
  // Editing
  // ---------------------------------------------------------------------------

  const select = useCallback((next: Selection) => setSelection(next), []);

  function openEditor(id: string) {
    setSelection({ kind: 'object', id });
    if (!isDesktop) setEditorOpen(true);
  }

  function deleteObject(id: string) {
    const type = project.features.some((f) => f.id === id) ? 'feature/delete' : project.stairs.some((s) => s.id === id) ? 'stairs/delete' : 'furniture/delete';
    dispatch({ type, id });
    setSelection(null);
    setEditorOpen(false);
  }

  /**
   * Deletes whatever is selected (Delete key / selection bar), including walls and corners.
   * If a wall deletion is refused (a door is on it), the wall stays selected so the user
   * can see what to move; successful deletions are deselected automatically.
   */
  function deleteSelection() {
    if (!selection) return;
    if (selection.kind === 'object') deleteObject(selection.id);
    else if (selection.kind === 'wall') dispatch({ type: 'walls/delete', wallId: selection.id, newPartitionId: createId() });
    else dispatch({ type: 'walls/removeNode', nodeId: selection.id });
  }

  function addFurniture(preset: FurniturePreset) {
    // Cascade new pieces slightly so several quick adds don't hide under each other.
    const cascade = (project.furniture.length % 5) * 15;
    const centre = roomCentre(project);
    const furniture = createFurniture({ ...preset, x: centre.x + cascade, y: centre.y + cascade });
    dispatch({ type: 'furniture/add', furniture });
    setSelection({ kind: 'object', id: furniture.id });
    setAddOpen(false);
  }

  function addStairs(shape: 'straight' | 'L' | 'U' | 'custom') {
    const stair =
      shape === 'custom'
        ? createStaircase('straight', roomCentre(project), {
            sections: [
              { id: createId(), kind: 'flight', length: 150, width: 90, steps: 6, turn: 'straight' },
              { id: createId(), kind: 'landing', length: 90, width: 90, steps: 0, turn: 'straight' },
              { id: createId(), kind: 'flight', length: 150, width: 90, steps: 6, turn: 'straight' },
            ],
          })
        : createStaircase(shape, roomCentre(project));
    dispatch({ type: 'stairs/add', stair });
    setSelection({ kind: 'object', id: stair.id });
    setAddOpen(false);
  }

  // ---------------------------------------------------------------------------
  // Drawing walls
  // ---------------------------------------------------------------------------

  function startDrawing(next: 'drawRoom' | 'drawWall') {
    setView('2d');
    setMode(next);
    setDraft([]);
    setSelection(null);
    setEditorOpen(false);
  }

  function cancelDrawing() {
    setMode('select');
    setDraft([]);
  }

  /**
   * Turns the drawn points into walls. The change is checked first with the same rules
   * the editor uses, so an invalid drawing keeps the draft (and explains why) instead
   * of throwing the user's points away.
   */
  function finishDrawing() {
    const thickness = project.room.outline[0]?.thickness ?? DEFAULT_WALL_THICKNESS;
    const nodes = draftRef.current.map((p) => ({ id: createId(), x: p.x, y: p.y, thickness: mode === 'drawWall' ? 10 : thickness }));
    const needed = mode === 'drawRoom' ? 3 : 2;
    if (nodes.length < needed) {
      dispatch({ type: 'notice/show', message: mode === 'drawRoom' ? 'Place at least three corners to make a room.' : 'Place at least two points to make a wall.' });
      return;
    }
    const action: EditorAction =
      mode === 'drawRoom' ? { type: 'walls/replaceOutline', nodes } : { type: 'walls/addPartition', partition: { id: createId(), nodes } };
    const result = editorReducer(state, action);
    if (result.present === state.present) {
      dispatch({ type: 'notice/show', message: result.notice?.message ?? 'Those walls aren’t valid.' });
      return;
    }
    dispatch(action);
    setMode('select');
    setDraft([]);
    if (action.type === 'walls/addPartition') setSelection({ kind: 'wall', id: nodes[0].id });
  }

  function openOptimizer() {
    if (mode !== 'select') cancelDrawing();
    setPreview(null);
    setEditorOpen(false);
    setOptimizerOpen(true);
  }

  /** The project as shown while previewing a layout (never saved), with its own conflict marks. */
  const previewProject = useMemo(() => (preview ? withPoses(project, new Map(preview.positions.map((p) => [p.id, p]))) : null), [preview, project]);
  const previewConflicts = useMemo(() => (previewProject ? findConflicts(previewProject) : null), [previewProject]);

  /** Applies a layout as one undoable step, after checking the editor would accept it. */
  function applyLayout(title: string, positions: SavedLayout['positions']) {
    const action: EditorAction = { type: 'layout/apply', positions };
    const result = editorReducer(state, action);
    if (result.notice !== state.notice && result.notice) {
      dispatch(action); // refused: shows the reason (e.g. a piece is now locked)
      return;
    }
    if (result.present === state.present) {
      dispatch({ type: 'notice/show', message: `${title} matches your current layout, so nothing changed.` });
    } else {
      dispatch(action);
      dispatch({ type: 'notice/show', message: `Applied ${title}. Press Undo to go back to your previous layout.` });
    }
    setPreview(null);
    setOptimizerOpen(false);
  }

  /** A point placed on the plan. Tapping the first corner again closes the room. */
  function addDraftPoint(point: Point) {
    const current = draftRef.current;
    const closesRoom = mode === 'drawRoom' && current.length >= 3 && Math.hypot(point.x - current[0].x, point.y - current[0].y) < 1e-6;
    const last = current[current.length - 1];
    if (closesRoom) finishDrawing();
    else if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 1) setDraft((d) => [...d, point]);
  }

  /** Keyboard/touch-precise entry: adds a wall of exact length and angle from the last point. */
  function addDraftWall(lengthCm: number, angleDeg: number) {
    const last = draftRef.current[draftRef.current.length - 1];
    if (!last || !(lengthCm > 0)) return;
    const rad = (angleDeg * Math.PI) / 180;
    setDraft((d) => [...d, { x: Math.round((last.x + Math.cos(rad) * lengthCm) * 1000) / 1000, y: Math.round((last.y + Math.sin(rad) * lengthCm) * 1000) / 1000 }]);
  }

  function addFeature(kind: FeatureKind) {
    const placement = defaultPlacement(kind, project);
    if (!placement) {
      dispatch({ type: 'notice/show', message: 'There’s no free stretch of wall left for that. Move a door or window first.' });
      return;
    }
    const feature = createFeature(kind, placement, project.room);
    dispatch({ type: 'feature/add', feature });
    setSelection({ kind: 'object', id: feature.id });
    setAddOpen(false);
  }

  function rotateSelected(direction: 1 | -1) {
    if (selectedFurniture) {
      dispatch({ type: 'furniture/update', id: selectedFurniture.id, changes: { rotation: selectedFurniture.rotation + 90 * direction } });
    } else if (selectedStair) {
      dispatch({ type: 'stairs/update', id: selectedStair.id, changes: { rotation: selectedStair.rotation + 90 * direction } });
    } else if (selectedFeature?.placement.type === 'free') {
      const p = selectedFeature.placement;
      dispatch({ type: 'feature/update', id: selectedFeature.id, changes: { placement: { ...p, rotation: p.rotation + 90 * direction } } });
    }
  }

  // Forget a selection whose object, wall or corner no longer exists (e.g. after undo).
  useEffect(() => {
    if (selection && selectedName === null) setSelection(null);
  }, [selection, selectedName]);

  // Close the modal editor if its object disappears (e.g. undo) or the layout becomes desktop.
  useEffect(() => {
    if (editorOpen && (!selectedName || isDesktop)) setEditorOpen(false);
  }, [editorOpen, selectedName, isDesktop]);

  // Keyboard shortcuts (ignored while typing in a field or while a dialog is open).
  // Re-subscribed each render so the handler always sees the latest state.
  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  function onKeyDown(e: KeyboardEvent) {
    if (isTypingTarget(e.target) || document.querySelector('dialog[open]')) return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    // While previewing a suggestion the plan is read-only: Escape returns to the real layout.
    if (preview) {
      if (key === 'escape') setPreview(null);
      return;
    }

    if (mode !== 'select') {
      if (key === 'escape') cancelDrawing();
      else if (key === 'enter') finishDrawing();
      else if (key === 'backspace' || (mod && key === 'z')) {
        e.preventDefault();
        setDraft((d) => d.slice(0, -1));
      }
      return;
    }

    if (mod && key === 'z') {
      e.preventDefault();
      dispatch({ type: e.shiftKey ? 'history/redo' : 'history/undo' });
      return;
    }
    if (mod && key === 'y') {
      e.preventDefault();
      dispatch({ type: 'history/redo' });
      return;
    }
    if (mod || !selection) return;

    if (key === 'escape') {
      setSelection(null);
    } else if (key === 'delete' || key === 'backspace') {
      e.preventDefault();
      deleteSelection();
    } else if (key === 'r') {
      rotateSelected(e.shiftKey ? -1 : 1);
    } else if (key === 'enter' && !isDesktop && !(e.target instanceof HTMLButtonElement)) {
      setEditorOpen(true);
    } else if (key.startsWith('arrow')) {
      e.preventDefault();
      // Metric nudges 1 cm (Shift: 10 cm); imperial nudges 1 in (Shift: 1 ft).
      const step = project.units === 'metric' ? (e.shiftKey ? 10 : 1) : (e.shiftKey ? 12 : 1) * CM_PER_INCH;
      const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
      const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
      nudge(dx, dy);
    }
  }

  function nudge(dx: number, dy: number) {
    if (selection?.kind === 'corner') {
      const corner = [...project.room.outline, ...project.room.partitions.flatMap((p) => p.nodes)].find((n) => n.id === selection.id);
      if (corner) dispatch({ type: 'walls/moveNode', nodeId: corner.id, to: { x: corner.x + dx, y: corner.y + dy } });
      return;
    }
    if (selectedStair) {
      dispatch({ type: 'stairs/update', id: selectedStair.id, changes: { x: selectedStair.x + dx, y: selectedStair.y + dy } });
      return;
    }
    if (selectedFurniture) {
      dispatch({ type: 'furniture/update', id: selectedFurniture.id, changes: { x: selectedFurniture.x + dx, y: selectedFurniture.y + dy } });
      return;
    }
    if (!selectedFeature) return;
    const p = selectedFeature.placement;
    // Along a wall, move by the part of the arrow's direction that runs along the wall, so the
    // feature goes the way the arrow points on screen (outer walls run clockwise, so the bottom
    // and left walls run "backwards").
    const wall = p.type === 'wall' ? findSegment(project.room, p.wallId) : null;
    const along = wall ? dx * Math.cos((wall.angle * Math.PI) / 180) + dy * Math.sin((wall.angle * Math.PI) / 180) : 0;
    const placement: Placement = p.type === 'wall' ? { ...p, offset: p.offset + along } : { ...p, x: p.x + dx, y: p.y + dy };
    dispatch({ type: 'feature/update', id: selectedFeature.id, changes: { placement } });
  }

  // ---------------------------------------------------------------------------
  // Appearance
  // ---------------------------------------------------------------------------

  const board = useMemo(() => boardAppearance(preferences.board, theme), [preferences.board, theme]);
  const palette = useMemo(() => canvasPalette(theme, board.isDark, project.room.floor.color), [theme, board.isDark, project.room.floor.color]);

  const editorProps = { project, conflicts, dispatch, onDelete: deleteObject, onSelect: select };
  const roomBox = roomBounds(project.room);
  const showTools = isDesktop || !toolsCollapsed || !isTablet;

  return (
    <div className={`app ${isDesktop ? 'is-desktop' : isTablet ? 'is-tablet' : 'is-phone'}`}>
      <Header
        projectName={project.name}
        saveStatus={saveStatus}
        canUndo={canUndo(state) && !preview}
        canRedo={canRedo(state) && !preview}
        theme={preferences.theme}
        onUndo={() => dispatch({ type: 'history/undo' })}
        onRedo={() => dispatch({ type: 'history/redo' })}
        onOpenProjects={() => {
          setImportMessage(null);
          setProjectsOpen(true);
        }}
        onTheme={(value) => updatePreferences({ theme: value })}
        onOptimize={openOptimizer}
      />

      {activeId ? (
        <main className={`workspace ${isTablet && toolsCollapsed ? 'tools-collapsed' : ''}`}>
          {showTools ? (
            <ToolsPanel
              project={project}
              selection={selection}
              conflicts={conflicts}
              dispatch={dispatch}
              preferences={preferences}
              onPreferences={updatePreferences}
              onAddFurniture={addFurniture}
              onAddFeature={addFeature}
              onAddStairs={addStairs}
              onStartDrawing={startDrawing}
              onSelect={select}
              onCollapse={isTablet ? () => setToolsCollapsed(true) : undefined}
              inert={preview !== null}
            />
          ) : (
            <div className="tools-rail">
              <button type="button" className="icon-button" onClick={() => setToolsCollapsed(false)} aria-label="Show tools panel">
                <Icon name="panelLeft" />
              </button>
              <button type="button" className="icon-button" onClick={() => setAddOpen(true)} aria-label="Add an item">
                <Icon name="plus" />
              </button>
            </div>
          )}

          <div className="canvas-column">
            <div className="segmented view-switch" role="radiogroup" aria-label="View">
              {(['2d', '3d'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={view === value}
                  className={view === value ? 'is-active' : ''}
                  onClick={() => {
                    if (value === '3d' && mode !== 'select') cancelDrawing();
                    setView(value);
                  }}
                >
                  <Icon name={value === '2d' ? 'floorPlan' : 'cube'} size={16} />
                  {value === '2d' ? '2D Plan' : '3D View'}
                </button>
              ))}
            </div>
            {preview && (
              <PreviewBar
                title={preview.title}
                onApply={() => applyLayout(preview.title, preview.positions)}
                onBack={() => {
                  setPreview(null);
                  setOptimizerOpen(true);
                }}
                onExit={() => setPreview(null)}
              />
            )}
            {mode !== 'select' && (
              <DrawingBar
                mode={mode}
                draft={draft}
                units={project.units}
                snap={preferences.snap}
                onSnap={(snap) => updatePreferences({ snap })}
                onStartAt={(point) => setDraft([point])}
                onAddWall={addDraftWall}
                onUndoPoint={() => setDraft((d) => d.slice(0, -1))}
                onFinish={finishDrawing}
                onCancel={cancelDrawing}
                compact={!isTablet && !isDesktop}
              />
            )}
            {view === '3d' ? (
              <View3DBoundary onExit={() => setView('2d')}>
                <Suspense fallback={<section className="canvas-panel view3d-loading" aria-label="3D view" aria-busy="true">Loading the 3D view…</section>}>
                  <View3D
                    project={previewProject ?? project}
                    selectedId={selectedId}
                    theme={theme}
                    preferences={preferences.view3d}
                    touch={isTouch}
                    onPreferences={(changes) => updatePreferences({ view3d: { ...preferences.view3d, ...changes } })}
                    onSelect={(id) => setSelection(id ? { kind: 'object', id } : null)}
                    onExit={() => setView('2d')}
                  />
                </Suspense>
              </View3DBoundary>
            ) : (
              <section
                className="canvas-panel"
                aria-label="Floor plan"
                style={
                  {
                    ...board.style,
                    // Phones size the plan to the room's shape (plus room for labels).
                    '--room-aspect': `${roomBox.maxX - roomBox.minX + 90} / ${roomBox.maxY - roomBox.minY + 90}`,
                  } as CSSProperties
                }
              >
                <FloorPlan
                  project={previewProject ?? project}
                  readOnly={previewProject !== null}
                  conflicts={previewConflicts ?? conflicts}
                  selection={selection}
                  palette={palette}
                  showMeasurementGrid={preferences.showMeasurementGrid}
                  showClearances={preferences.showClearances}
                  mode={mode}
                  draft={draft}
                  snap={preferences.snap}
                  touch={isTouch}
                  onSelect={select}
                  onOpenEditor={openEditor}
                  onChangeFurniture={(id, changes) => dispatch({ type: 'furniture/update', id, changes })}
                  onChangeFeature={(id, changes) => dispatch({ type: 'feature/update', id, changes })}
                  onChangeStair={(id, changes) => dispatch({ type: 'stairs/update', id, changes })}
                  onMoveCorner={(nodeId, to) => dispatch({ type: 'walls/moveNode', nodeId, to })}
                  onDraftPoint={addDraftPoint}
                />
              </section>
            )}
            {!isDesktop && mode === 'select' && !preview && (
              <SelectionBar
                selectedName={selectedName}
                canRotate={selectedFurniture !== null || selectedStair !== null || selectedFeature?.placement.type === 'free'}
                onEdit={() => setEditorOpen(true)}
                onRotate={() => rotateSelected(1)}
                onDelete={deleteSelection}
                onAdd={() => setAddOpen(true)}
                onOptimize={openOptimizer}
              />
            )}
          </div>

          {isDesktop && (
            <PropertiesPanel {...editorProps} selection={selection} inert={preview !== null} />
          )}
        </main>
      ) : (
        <main className="loading" aria-busy="true">
          Unpacking your room…
        </main>
      )}

      <Dialog open={editorOpen && selection !== null} title={selectedName ? `Edit ${selectedName}` : 'Edit'} onClose={() => setEditorOpen(false)} className="editor-dialog">
        {selection && <SelectionEditor {...editorProps} selection={selection} />}
      </Dialog>

      <Dialog open={addOpen} title="Add to the room" onClose={() => setAddOpen(false)}>
        <section className="dialog-section">
          <h3>Walls</h3>
          <StructureButtons
            onDraw={(next) => {
              setAddOpen(false);
              startDrawing(next);
            }}
          />
        </section>
        <section className="dialog-section">
          <h3>Stairs</h3>
          <StairButtons onAdd={addStairs} />
        </section>
        <section className="dialog-section">
          <h3>Room features</h3>
          <FeatureButtons onAdd={addFeature} />
        </section>
        <section className="dialog-section">
          <FurnitureButtons onAdd={addFurniture} />
        </section>
      </Dialog>

      {activeId && (
        <ProjectsDialog
          open={projectsOpen}
          onClose={() => setProjectsOpen(false)}
          activeId={activeId}
          activeName={project.name}
          projects={projectList}
          importMessage={importMessage}
          onOpenProject={(id) => void openProject(id)}
          onRename={(name) => dispatch({ type: 'project/rename', name })}
          onNew={(kind) => void startProject(kind === 'sample' ? createSampleProject() : createEmptyProject())}
          onDuplicate={() => void startProject({ ...project, name: `${project.name} (copy)` })}
          onExport={exportProject}
          onImport={(file) => void importProject(file)}
          onDelete={(id) => void removeProject(id)}
        />
      )}

      <OptimizerDialog
        open={optimizerOpen}
        onClose={() => setOptimizerOpen(false)}
        project={project}
        dispatch={dispatch}
        run={optimizer.state}
        onStart={(ids) => optimizer.start(project, ids)}
        onCancel={optimizer.cancel}
        onPreview={(title, positions) => {
          setSelection(null);
          setPreview({ title, positions });
          setOptimizerOpen(false);
        }}
        onApply={applyLayout}
      />

      <ConflictBanner
        prompt={state.prompt}
        project={project}
        onRevert={() => dispatch({ type: 'conflict/revert' })}
        onAllow={() => state.prompt && dispatch({ type: 'overlap/accept', keys: state.prompt.conflicts.map((c) => c.key) })}
        onDismiss={() => dispatch({ type: 'conflict/dismiss' })}
      />
      <Toast notice={state.notice} />
    </div>
  );
}

/** Middle of the room's bounding box. (Placement rules move things inside concave rooms.) */
function roomCentre(project: Project): Point {
  const box = roomBounds(project.room);
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

/** What to call the current selection in titles and the selection bar. */
function selectionName(selection: Selection, project: Project): string | null {
  if (!selection) return null;
  if (selection.kind === 'wall') return findSegment(project.room, selection.id) ? wallLabel(project.room, selection.id) : null;
  if (selection.kind === 'corner') return [...project.room.outline, ...project.room.partitions.flatMap((p) => p.nodes)].some((n) => n.id === selection.id) ? 'Corner' : null;
  const object = [...project.furniture, ...project.features, ...project.stairs].find((o) => o.id === selection.id);
  return object?.name ?? null;
}

/**
 * Where a newly added feature goes: openings find a free stretch of wall; others start
 * central. For rectangles the preferred walls match the original layout (doors on the
 * bottom wall, windows on the top) — outer walls run clockwise from the top.
 */
function defaultPlacement(kind: FeatureKind, project: Project): Placement | null {
  const { room, features } = project;
  const sameKind = features.filter((f) => f.kind === kind).length;
  const probe = { kind, ventMount: 'floor' } as Pick<RoomFeature, 'kind' | 'ventMount'>;
  if (allowedPlacement(probe) === 'free') {
    const cascade = (sameKind % 5) * 20;
    const centre = roomCentre(project);
    return { type: 'free', x: centre.x + cascade, y: centre.y - 60 + cascade, rotation: 0 };
  }
  const preferredIndex: Record<string, number> = { door: 2, window: 0, outlet: 3, switch: 1, radiator: 0 };
  const index = preferredIndex[kind] ?? 0;
  if (kind === 'door' || kind === 'window') {
    return findFreeWallSpot(features, room, kind === 'door' ? 80 : 120, index);
  }
  const wall = outlineSegments(room)[index % room.outline.length];
  return { type: 'wall', wallId: wall.id, offset: Math.min(wall.length - 10, wall.length / 2 + (sameKind % 5) * 25) };
}

/** CSS for the board around the room. Purely decorative — measured in screen pixels. */
function boardAppearance(board: BoardPreferences, theme: ResolvedTheme): { style: CSSProperties; isDark: boolean } {
  const fallback = board.style === 'drafting' ? '#20343f' : theme === 'dark' ? '#221e1b' : '#f5ecdf';
  const color = board.color ?? fallback;
  const isDark = luminance(color) < 0.2;
  const ink = isDark ? '255, 255, 255' : '122, 106, 92';
  const alpha = (strength: number) => `rgba(${ink}, ${(board.opacity * strength).toFixed(3)})`;
  const s = board.spacing;
  const style: CSSProperties = { backgroundColor: color };

  if (board.showGrid) {
    switch (board.style) {
      case 'dots':
        style.backgroundImage = `radial-gradient(${alpha(0.5)} 1px, transparent 1.5px)`;
        style.backgroundSize = `${s}px ${s}px`;
        break;
      case 'squares':
        style.backgroundImage = `linear-gradient(${alpha(0.3)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(0.3)} 1px, transparent 1px)`;
        style.backgroundSize = `${s}px ${s}px`;
        break;
      case 'graph':
      case 'drafting': {
        const minor = alpha(0.18);
        const major = alpha(0.4);
        style.backgroundImage = [
          `linear-gradient(${major} 1px, transparent 1px)`,
          `linear-gradient(90deg, ${major} 1px, transparent 1px)`,
          `linear-gradient(${minor} 1px, transparent 1px)`,
          `linear-gradient(90deg, ${minor} 1px, transparent 1px)`,
        ].join(', ');
        style.backgroundSize = `${s * 5}px ${s * 5}px, ${s * 5}px ${s * 5}px, ${s}px ${s}px, ${s}px ${s}px`;
        break;
      }
      case 'solid':
        break;
    }
  }
  return { style, isDark };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
