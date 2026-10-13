import { useEffect, useState } from 'react';
import { loadAssetImage } from '../storage/assets';

/** The stored photo with this id, once loaded (null while loading, if missing, or with no id). */
export function useAssetImage(id: string | undefined): HTMLImageElement | null {
  const [image, setImage] = useState<{ id: string; image: HTMLImageElement | null } | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    loadAssetImage(id).then((loaded) => !cancelled && setImage({ id, image: loaded }));
    return () => {
      cancelled = true;
    };
  }, [id]);
  return id && image?.id === id ? image.image : null;
}
