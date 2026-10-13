import { useCallback, useEffect, useMemo, useReducer, useState, type CSSProperties } from 'react';
import { FeatureButtons, FurnitureButtons, type FurniturePreset } from './components/AddCatalog';
import { ConflictBanner } from './components/ConflictBanner';
import { Dialog } from './components/Dialog';
import { Header, type SaveStatus } from './components/Header';
import { Icon } from './components/Icon';
import { ObjectEditor } from './components/ObjectEditor';
import { FloorPlan } from './components/plan/FloorPlan';
import { ProjectsDialog } from './components/ProjectsDialog';
import { PropertiesPanel } from './components/PropertiesPanel';
import { SelectionBar } from './components/SelectionBar';
import { Toast } from './components/Toast';
import { ToolsPanel } from './components/ToolsPanel';
import { findConflicts } from './model/conflicts';
import { allowedPlacement, findFreeWallSpot, wallLength } from './model/features';
import { createEmptyProject, createFeature, createFurniture, createSampleProject } from './model/sample';
import type { FeatureKind, Placement, Project, RoomFeature, Wall } from './model/types';
import { CM_PER_INCH } from './model/units';
import { canvasPalette, luminance } from './render/palette';
import { canRedo, canUndo, createEditorState, editorReducer } from './state/editor';
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

export function App() {
  const [state, dispatch] = useReducer(editorReducer, null, () => createEditorState(createSampleProject()));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preferences, updatePreferences] = usePreferences();
  const theme = useResolvedTheme(preferences.theme);

  // Layout: desktop keeps three panels; tablets and phones edit in a modal.
  const isDesktop = useMediaQuery('(min-width: 1100px)');
  const isTablet = useMediaQuery('(min-width: 768px)') && !isDesktop;
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [importMessage, setImportMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const project = state.present;
  const conflicts = useMemo(() => findConflicts(project), [project]);
  const selectedFurniture = project.furniture.find((f) => f.id === selectedId) ?? null;
  const selectedFeature = project.features.find((f) => f.id === selectedId) ?? null;
  const selectedName = selectedFurniture?.name ?? selectedFeature?.name ?? null;

  // ---------------------------------------------------------------------------
  // Loading and saving
  // ---------------------------------------------------------------------------

  const switchTo = useCallback((id: string, next: Project) => {
    dispatch({ type: 'project/replace', project: next, resetHistory: true });
    setActiveId(id);
    setActiveProjectId(id);
    setSelectedId(null);
  }, []);

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

  const select = useCallback((id: string | null) => setSelectedId(id), []);

  function openEditor(id: string) {
    setSelectedId(id);
    if (!isDesktop) setEditorOpen(true);
  }

  function deleteObject(id: string) {
    const isFeature = project.features.some((f) => f.id === id);
    dispatch({ type: isFeature ? 'feature/delete' : 'furniture/delete', id });
    setSelectedId(null);
    setEditorOpen(false);
  }

  function addFurniture(preset: FurniturePreset) {
    // Cascade new pieces slightly so several quick adds don't hide under each other.
    const cascade = (project.furniture.length % 5) * 15;
    const furniture = createFurniture({ ...preset, x: project.room.width / 2 + cascade, y: project.room.length / 2 + cascade });
    dispatch({ type: 'furniture/add', furniture });
    setSelectedId(furniture.id);
    setAddOpen(false);
  }

  function addFeature(kind: FeatureKind) {
    const placement = defaultPlacement(kind, project);
    if (!placement) {
      dispatch({ type: 'notice/show', message: 'There’s no free stretch of wall left for that. Move a door or window first.' });
      return;
    }
    const feature = createFeature(kind, placement, project.room);
    dispatch({ type: 'feature/add', feature });
    setSelectedId(feature.id);
    setAddOpen(false);
  }

  function rotateSelected(direction: 1 | -1) {
    if (selectedFurniture) {
      dispatch({ type: 'furniture/update', id: selectedFurniture.id, changes: { rotation: selectedFurniture.rotation + 90 * direction } });
    } else if (selectedFeature?.placement.type === 'free') {
      const p = selectedFeature.placement;
      dispatch({ type: 'feature/update', id: selectedFeature.id, changes: { placement: { ...p, rotation: p.rotation + 90 * direction } } });
    }
  }

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
    if (mod || !selectedId) return;

    if (key === 'escape') {
      setSelectedId(null);
    } else if (key === 'delete' || key === 'backspace') {
      e.preventDefault();
      deleteObject(selectedId);
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
    if (selectedFurniture) {
      dispatch({ type: 'furniture/update', id: selectedFurniture.id, changes: { x: selectedFurniture.x + dx, y: selectedFurniture.y + dy } });
      return;
    }
    if (!selectedFeature) return;
    const p = selectedFeature.placement;
    const placement: Placement =
      p.type === 'wall'
        ? { ...p, offset: p.offset + (p.wall === 'top' || p.wall === 'bottom' ? dx : dy) }
        : { ...p, x: p.x + dx, y: p.y + dy };
    dispatch({ type: 'feature/update', id: selectedFeature.id, changes: { placement } });
  }

  // ---------------------------------------------------------------------------
  // Appearance
  // ---------------------------------------------------------------------------

  const board = useMemo(() => boardAppearance(preferences.board, theme), [preferences.board, theme]);
  const palette = useMemo(() => canvasPalette(theme, board.isDark, project.room.floor.color), [theme, board.isDark, project.room.floor.color]);

  const editorProps = { project, conflicts, dispatch, onDelete: deleteObject };
  const showTools = isDesktop || !toolsCollapsed || !isTablet;

  return (
    <div className={`app ${isDesktop ? 'is-desktop' : isTablet ? 'is-tablet' : 'is-phone'}`}>
      <Header
        projectName={project.name}
        saveStatus={saveStatus}
        canUndo={canUndo(state)}
        canRedo={canRedo(state)}
        theme={preferences.theme}
        onUndo={() => dispatch({ type: 'history/undo' })}
        onRedo={() => dispatch({ type: 'history/redo' })}
        onOpenProjects={() => {
          setImportMessage(null);
          setProjectsOpen(true);
        }}
        onTheme={(value) => updatePreferences({ theme: value })}
      />

      {activeId ? (
        <main className={`workspace ${isTablet && toolsCollapsed ? 'tools-collapsed' : ''}`}>
          {showTools ? (
            <ToolsPanel
              project={project}
              selectedId={selectedId}
              conflicts={conflicts}
              dispatch={dispatch}
              preferences={preferences}
              onPreferences={updatePreferences}
              onAddFurniture={addFurniture}
              onAddFeature={addFeature}
              onSelect={select}
              onCollapse={isTablet ? () => setToolsCollapsed(true) : undefined}
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
            <section
              className="canvas-panel"
              aria-label="Floor plan"
              style={
                {
                  ...board.style,
                  // Phones size the plan to the room's shape (plus room for labels).
                  '--room-aspect': `${project.room.width + 90} / ${project.room.length + 90}`,
                } as CSSProperties
              }
            >
              <FloorPlan
                project={project}
                conflicts={conflicts}
                selectedId={selectedId}
                palette={palette}
                showMeasurementGrid={preferences.showMeasurementGrid}
                showClearances={preferences.showClearances}
                onSelect={select}
                onOpenEditor={openEditor}
                onChangeFurniture={(id, changes) => dispatch({ type: 'furniture/update', id, changes })}
                onChangeFeature={(id, changes) => dispatch({ type: 'feature/update', id, changes })}
              />
            </section>
            {!isDesktop && (
              <SelectionBar
                selectedName={selectedName}
                canRotate={selectedFurniture !== null || selectedFeature?.placement.type === 'free'}
                onEdit={() => setEditorOpen(true)}
                onRotate={() => rotateSelected(1)}
                onDelete={() => selectedId && deleteObject(selectedId)}
                onAdd={() => setAddOpen(true)}
              />
            )}
          </div>

          {isDesktop && (
            <PropertiesPanel project={project} selectedId={selectedId} conflicts={conflicts} dispatch={dispatch} onDelete={deleteObject} onSelect={select} />
          )}
        </main>
      ) : (
        <main className="loading" aria-busy="true">
          Unpacking your room…
        </main>
      )}

      <Dialog open={editorOpen && selectedId !== null} title={selectedName ? `Edit ${selectedName}` : 'Edit'} onClose={() => setEditorOpen(false)} className="editor-dialog">
        {selectedId && <ObjectEditor {...editorProps} selectedId={selectedId} />}
      </Dialog>

      <Dialog open={addOpen} title="Add to the room" onClose={() => setAddOpen(false)}>
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

/** Where a newly added feature goes: openings find a free stretch of wall; others start central. */
function defaultPlacement(kind: FeatureKind, project: Project): Placement | null {
  const { room, features } = project;
  const sameKind = features.filter((f) => f.kind === kind).length;
  const probe = { kind, ventMount: 'floor' } as Pick<RoomFeature, 'kind' | 'ventMount'>;
  if (allowedPlacement(probe) === 'free') {
    const cascade = (sameKind % 5) * 20;
    return { type: 'free', x: room.width / 2 + cascade, y: room.length / 2 - 60 + cascade, rotation: 0 };
  }
  const preferred: Record<string, Wall> = { door: 'bottom', window: 'top', outlet: 'left', switch: 'right', radiator: 'top' };
  const wall = preferred[kind] ?? 'top';
  if (kind === 'door' || kind === 'window') {
    return findFreeWallSpot(features, room, kind === 'door' ? 80 : 120, wall);
  }
  const len = wallLength(wall, room);
  return { type: 'wall', wall, offset: Math.min(len - 10, len / 2 + (sameKind % 5) * 25) };
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
