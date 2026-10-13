import { useCallback, useEffect, useState } from 'react';
import { listLibraryRecords, type LibraryItem } from '../../storage/library';

/** Everything showing the library refreshes when it changes (save, duplicate, delete). */
const listeners = new Set<() => void>();
export function libraryChanged() {
  for (const listener of listeners) listener();
}

export function useLibrary(): { items: LibraryItem[]; loading: boolean; error: string | null } {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    listLibraryRecords()
      .then((list) => {
        setItems(list);
        setError(null);
      })
      .catch(() => setError('The furniture library couldn’t be read. Browser storage may be blocked.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    load();
    listeners.add(load);
    return () => {
      listeners.delete(load);
    };
  }, [load]);
  return { items, loading, error };
}
