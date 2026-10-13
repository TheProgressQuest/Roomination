import { useEffect, useState } from 'react';
import { deleteAssets, storageUsage, unusedAssets, type StorageUsage } from '../storage/assets';

/**
 * How much of this browser's storage Roomination uses, and a clean-up for photos nothing
 * uses any more. Nothing is deleted without the person confirming the exact count first.
 */
export function StorageSection() {
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [unused, setUnused] = useState<{ id: string; bytes: number }[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = () =>
    storageUsage()
      .then(setUsage)
      .catch(() => setMessage('Storage information isn’t available in this browser.'));
  useEffect(() => {
    void refresh();
  }, []);

  async function findUnused() {
    setMessage(null);
    const list = await unusedAssets();
    setUnused(list);
    if (list.length === 0) setMessage('Every stored photo is used by a project or the furniture library.');
  }

  async function removeUnused() {
    if (!unused) return;
    await deleteAssets(unused.map((a) => a.id));
    setMessage(`Removed ${unused.length} unused photo${unused.length === 1 ? '' : 's'}.`);
    setUnused(null);
    void refresh();
  }

  return (
    <section className="dialog-section">
      <h3>Photos & storage</h3>
      {usage && (
        <p className="hint">
          {usage.photoCount} photo{usage.photoCount === 1 ? '' : 's'} stored ({mb(usage.photoBytes)})
          {usage.used !== null && usage.quota !== null && ` · this site uses about ${mb(usage.used)} of ${mb(usage.quota)} available`}. Everything is stored in this browser only.
        </p>
      )}
      {unused && unused.length > 0 ? (
        <div className="confirm-delete" role="group" aria-label="Confirm removing unused photos">
          <p>
            Remove {unused.length} photo{unused.length === 1 ? '' : 's'} ({mb(unused.reduce((s, a) => s + a.bytes, 0))}) that no project or library item uses? This can’t be undone.
          </p>
          <div className="button-row">
            <button type="button" className="danger compact" onClick={() => void removeUnused()}>
              Remove unused photos
            </button>
            <button type="button" className="secondary" onClick={() => setUnused(null)}>
              Keep them
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="secondary" onClick={() => void findUnused()}>
          Find unused photos
        </button>
      )}
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

function mb(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
