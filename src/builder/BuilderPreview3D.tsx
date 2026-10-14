import { useEffect, useRef, useState } from 'react';
import type { Furniture, Project } from '../model/types';
import { DEFAULT_FLOOR, DEFAULT_WALL_COLOR } from '../model/sample';
import { buildFurniture, buildRoomModel } from '../scene3d/model';
import { RoomViewer } from '../scene3d/three/RoomViewer';

/**
 * A live 3D look at the piece being built, alone on a small stage of floor. Loaded only
 * when the person asks for it (it brings Three.js); uses the same renderer as the 3D view.
 */

interface Props {
  piece: Pick<Furniture, 'name' | 'kind' | 'category' | 'width' | 'depth' | 'height' | 'color' | 'appearance' | 'shape' | 'components'>;
  quality: 'low' | 'medium' | 'high';
  touch: boolean;
}

const MARGIN = 70;

export default function BuilderPreview3D({ piece, quality, touch }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<RoomViewer | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!host.current) return;
    try {
      viewer.current = new RoomViewer(host.current, {
        shadows: quality !== 'low',
        quality,
        reducedMotion: true,
        touch,
        initialPreset: 'isometric',
        onSelect: () => {},
        onContextLost: () => setFailed(true),
      });
    } catch {
      setFailed(true);
    }
    return () => {
      viewer.current?.dispose();
      viewer.current = null;
    };
  }, [quality, touch]);

  // A stage just bigger than the piece, with walls only a couple of centimetres high (a border).
  const span = Math.max(piece.width, piece.depth) + MARGIN * 2;
  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    const half = span / 2;
    const stage: Pick<Project, 'room' | 'features' | 'stairs'> = {
      room: {
        outline: [
          { id: 'a', x: 0, y: 0, thickness: 2 },
          { id: 'b', x: span, y: 0, thickness: 2 },
          { id: 'c', x: span, y: span, thickness: 2 },
          { id: 'd', x: 0, y: span, thickness: 2 },
        ],
        partitions: [],
        height: 2,
        floor: { ...DEFAULT_FLOOR, preset: 'lightOak', color: '#d9c3a0' },
        wallColor: DEFAULT_WALL_COLOR,
      },
      features: [],
      stairs: [],
    };
    v.setRoom(buildRoomModel(stage));
    v.setFurniture(buildFurniture([{ ...piece, id: 'preview', x: half, y: half, rotation: 0, texture: 'plain', locked: false, preferences: [] } as Furniture]));
  }, [piece, span]);

  if (failed) return <p className="hint">The 3D preview isn’t available on this device. The 2D views show the same components.</p>;
  return <div ref={host} className="fb-preview3d" aria-label={`3D preview of ${piece.name}. Drag to turn it.`} role="img" />;
}
