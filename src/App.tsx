import { useEffect, useReducer, useState } from 'react';
import { FloorPlan } from './components/FloorPlan';
import { Header, type SaveStatus } from './components/Header';
import { PropertiesPanel } from './components/PropertiesPanel';
import { Toast } from './components/Toast';
import { FURNITURE_PRESETS, ToolsPanel } from './components/ToolsPanel';
import { createEmptyProject, createFurniture, createSampleProject } from './model/sample';
import type { Furniture } from './model/types';
import { CM_PER_INCH } from './model/units';
import { canRedo, canUndo, createEditorState, editorReducer } from './state/editor';
import { loadCurrentProject, saveCurrentProject } from './storage/projectStore';

const AUTOSAVE_DELAY_MS = 400;

export function App() {
  const [state, dispatch] = useReducer(editorReducer, null, () => createEditorState(createSampleProject()));
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const project = state.present;
  const selectedItem = project.furniture.find((f) => f.id === selectedId) ?? null;

  // Restore the last session from this device. First-time visitors get the sample room.
  useEffect(() => {
    let cancelled = false;
    loadCurrentProject()
      .then((saved) => {
        if (!cancelled && saved) dispatch({ type: 'project/replace', project: saved, resetHistory: true });
      })
      .catch(() => {
        if (!cancelled) setSaveStatus('error');
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Autosave shortly after every change.
  useEffect(() => {
    if (!loaded) return;
    setSaveStatus('saving');
    const timer = window.setTimeout(() => {
      saveCurrentProject(project)
        .then(() => setSaveStatus('saved'))
        .catch(() => setSaveStatus('error'));
    }, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [project, loaded]);

  const updateFurniture = (id: string, changes: Partial<Furniture>) =>
    dispatch({ type: 'furniture/update', id, changes });

  function deleteSelected() {
    if (!selectedItem) return;
    dispatch({ type: 'furniture/delete', id: selectedItem.id });
    setSelectedId(null);
  }

  function addPreset(preset: (typeof FURNITURE_PRESETS)[number]) {
    // Cascade new pieces slightly so several quick adds don't hide under each other.
    const cascade = (project.furniture.length % 5) * 15;
    const furniture = createFurniture({
      ...preset,
      x: project.room.width / 2 + cascade,
      y: project.room.length / 2 + cascade,
    });
    dispatch({ type: 'furniture/add', furniture });
    setSelectedId(furniture.id);
  }

  // Keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
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
      if (mod || !selectedItem) return;

      if (key === 'escape') {
        setSelectedId(null);
      } else if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        dispatch({ type: 'furniture/delete', id: selectedItem.id });
        setSelectedId(null);
      } else if (key === 'r') {
        updateFurniture(selectedItem.id, { rotation: selectedItem.rotation + (e.shiftKey ? -90 : 90) });
      } else if (key.startsWith('arrow')) {
        e.preventDefault();
        // Metric nudges 1 cm (Shift: 10 cm); imperial nudges 1 in (Shift: 1 ft).
        const step = project.units === 'metric' ? (e.shiftKey ? 10 : 1) : (e.shiftKey ? 12 : 1) * CM_PER_INCH;
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        updateFurniture(selectedItem.id, { x: selectedItem.x + dx, y: selectedItem.y + dy });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div className="app">
      <Header
        projectName={project.name}
        saveStatus={saveStatus}
        canUndo={canUndo(state)}
        canRedo={canRedo(state)}
        onUndo={() => dispatch({ type: 'history/undo' })}
        onRedo={() => dispatch({ type: 'history/redo' })}
        onRename={(name) => dispatch({ type: 'project/rename', name })}
      />

      {loaded ? (
        <main className="workspace">
          <ToolsPanel
            project={project}
            selectedId={selectedId}
            onResizeRoom={(room) => dispatch({ type: 'room/resize', room })}
            onSetUnits={(units) => dispatch({ type: 'units/set', units })}
            onAddPreset={addPreset}
            onSelect={setSelectedId}
            onLoadSample={() => {
              dispatch({ type: 'project/replace', project: createSampleProject() });
              setSelectedId(null);
            }}
            onNewRoom={() => {
              dispatch({ type: 'project/replace', project: createEmptyProject() });
              setSelectedId(null);
            }}
          />
          <section
            className="canvas-panel"
            aria-label="Floor plan"
            // Phones size the plan to the room's shape (plus room for labels) instead of a fixed height.
            style={{ '--room-aspect': `${project.room.width + 80} / ${project.room.length + 80}` } as React.CSSProperties}
          >
            <FloorPlan
              project={project}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onChangeFurniture={updateFurniture}
            />
          </section>
          <PropertiesPanel
            item={selectedItem}
            units={project.units}
            onChange={(changes) => selectedItem && updateFurniture(selectedItem.id, changes)}
            onDelete={deleteSelected}
          />
        </main>
      ) : (
        <main className="loading" aria-busy="true">
          Unpacking your room…
        </main>
      )}

      <Toast notice={state.notice} />
    </div>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}
