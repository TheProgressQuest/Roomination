import { useEffect, useState } from 'react';
import type { Notice } from '../state/editor';

const VISIBLE_MS = 4500;

/** Briefly explains why a change was refused (e.g. furniture wouldn't fit). */
export function Toast({ notice }: { notice: Notice | null }) {
  const [hiddenId, setHiddenId] = useState<number | null>(null);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setHiddenId(notice.id), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const visible = notice !== null && notice.id !== hiddenId;

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {visible && (
        <div className="toast" key={notice.id}>
          <span aria-hidden="true">📏</span> {notice.message}
        </div>
      )}
    </div>
  );
}
