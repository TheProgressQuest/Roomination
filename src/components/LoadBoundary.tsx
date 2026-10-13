import { Component, type ReactNode } from 'react';
import { Dialog } from './Dialog';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Keeps a failure in an on-demand tool (e.g. its code couldn't be downloaded because the
 * site was updated or the device is offline) inside that tool: the person gets an
 * explanation, and the plan keeps working.
 */
export class LoadBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Dialog
        open
        title={this.props.title}
        onClose={this.props.onClose}
        footer={
          <div className="button-row">
            <button type="button" className="primary" onClick={() => window.location.reload()}>
              Reload page
            </button>
            <button type="button" className="secondary" onClick={this.props.onClose}>
              Close
            </button>
          </div>
        }
      >
        <p role="alert">This tool couldn’t be opened. If you’re offline or Roomination was just updated, reloading the page usually fixes it. Your plan is unaffected.</p>
      </Dialog>
    );
  }
}
