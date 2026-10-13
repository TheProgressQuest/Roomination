import { Component, type ReactNode } from 'react';
import { Icon } from '../Icon';

interface Props {
  onExit: () => void;
  children: ReactNode;
}

/**
 * Keeps a 3D failure inside the 3D panel: if the 3D code can't be downloaded (offline, or
 * the site was updated while this tab was open) or something goes wrong while drawing,
 * the user sees an explanation and the rest of the app keeps working.
 */
export class View3DBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="canvas-panel view3d-panel" aria-label="3D view">
        <div className="view3d-message" role="alert">
          <Icon name="warning" />
          <p>The 3D view couldn’t be opened. If you’re offline or Roomination was just updated, reloading the page usually fixes it. Your plan is unaffected.</p>
          <div className="button-row">
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              Reload page
            </button>
            <button type="button" className="secondary" onClick={this.props.onExit}>
              Back to 2D plan
            </button>
          </div>
        </div>
      </section>
    );
  }
}
