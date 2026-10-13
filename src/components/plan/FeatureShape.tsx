import { useState, type ReactNode } from 'react';
import { Circle, Group, Line, Rect, Text } from 'react-konva';
import type Konva from 'konva';
import { doorLeaves, localZones, type Frame } from '../../model/features';
import { arcPoints } from '../../model/polygon';
import type { RoomFeature } from '../../model/types';
import type { CanvasPalette } from '../../render/palette';
import { FONT_FAMILY } from './RoomShell';
import { interactionEvents, type ConflictStatus, type InteractionProps } from './shared';
import { flatPx } from './viewport';

interface FeatureShapeProps extends InteractionProps {
  feature: RoomFeature;
  /** Screen position and rotation of the feature's local frame. */
  frame: Frame;
  scale: number;
  wallPx: number;
  selected: boolean;
  status: ConflictStatus;
  showClearance: boolean;
  palette: CanvasPalette;
  onTransformEnd: (node: Konva.Node) => void;
}

/**
 * Draws one architectural feature in its local frame: x runs along the wall (or the
 * feature's own axis) and y points into the room. The wall itself occupies
 * y ∈ [−wallPx, 0] in this frame.
 */
export function FeatureShape(props: FeatureShapeProps) {
  const { feature, frame, scale, wallPx, selected, status, palette } = props;
  const [hovered, setHovered] = useState(false);
  const s = scale;
  const w = feature.width * s;
  const d = feature.depth * s;
  const highlight = status === 'warning' ? palette.warning : selected || hovered ? palette.selection : null;

  const showZones = props.showClearance || selected || status !== undefined;
  const zones = showZones ? localZones(feature).filter((zone) => zone.type === 'clearance') : [];

  const symbol = drawSymbol(feature, s, w, d, wallPx, palette, highlight);

  return (
    <Group
      ref={props.registerNode}
      name="object"
      x={frame.x}
      y={frame.y}
      rotation={frame.angle}
      {...interactionEvents(props, setHovered)}
      onTransformEnd={(e) => props.onTransformEnd(e.currentTarget)}
    >
      {zones.map((zone, i) => (
        <Line
          key={i}
          points={flatPx(zone.polygon, s)}
          closed
          fill={status === 'warning' ? palette.warningFill : palette.clearanceFill}
          stroke={status === 'warning' ? palette.warning : palette.clearanceStroke}
          strokeWidth={1}
          dash={[4, 4]}
          listening={false}
        />
      ))}
      {symbol.shapes}
      {/* Generous invisible hit area so small symbols are easy to grab, especially by touch. */}
      <Rect {...symbol.hit} fill="transparent" />
      {selected && <Rect {...pad(symbol.hit, 3)} stroke={palette.selection} strokeWidth={1.5} dash={[4, 4]} cornerRadius={4} listening={false} />}
    </Group>
  );
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function pad(box: Box, by: number): Box {
  return { x: box.x - by, y: box.y - by, width: box.width + by * 2, height: box.height + by * 2 };
}

/** A box centred on x = 0, at least `min` px in each direction, for touch-friendly hit areas. */
function hitBox(x0: number, y0: number, x1: number, y1: number, min = 22): Box {
  const width = Math.max(x1 - x0, min);
  const height = Math.max(y1 - y0, min);
  return { x: (x0 + x1) / 2 - width / 2, y: (y0 + y1) / 2 - height / 2, width, height };
}

function drawSymbol(
  feature: RoomFeature,
  s: number,
  w: number,
  d: number,
  wallPx: number,
  palette: CanvasPalette,
  highlight: string | null,
): { shapes: ReactNode; hit: Box } {
  const line = highlight ?? palette.feature;
  const lineWidth = highlight ? 2 : 1.5;

  switch (feature.kind) {
    case 'door': {
      const leaves = doorLeaves(feature);
      const jambs = (
        <>
          <Line points={[-w / 2, -wallPx, -w / 2, 0]} stroke={palette.wall} strokeWidth={2} listening={false} />
          <Line points={[w / 2, -wallPx, w / 2, 0]} stroke={palette.wall} strokeWidth={2} listening={false} />
        </>
      );
      if (feature.doorType === 'sliding') {
        return {
          shapes: (
            <>
              {jambs}
              <Rect x={-w / 2} y={-wallPx * 0.75} width={w * 0.58} height={wallPx * 0.3} fill={palette.featureFill} stroke={line} strokeWidth={1} listening={false} />
              <Rect x={-w * 0.08} y={-wallPx * 0.45} width={w * 0.58} height={wallPx * 0.3} fill={palette.featureFill} stroke={line} strokeWidth={1} listening={false} />
            </>
          ),
          hit: hitBox(-w / 2, -wallPx, w / 2, 8),
        };
      }
      const swingDepth = feature.swing === 'out' ? -w : w;
      return {
        shapes: (
          <>
            {jambs}
            {leaves.map((leaf, i) => {
              const r = leaf.radius * s;
              const hx = leaf.hinge.x * s;
              const open = (leaf.openDeg * Math.PI) / 180;
              const arc = arcPoints(hx, 0, r, leaf.openDeg, leaf.closedDeg, 16);
              return (
                <Group key={i} listening={false}>
                  {/* The door leaf, shown fully open, and the path its edge sweeps. */}
                  <Line points={[hx, 0, hx + r * Math.cos(open), r * Math.sin(open)]} stroke={line} strokeWidth={lineWidth + 0.5} lineCap="round" />
                  <Line points={arc.flatMap((p) => [p.x, p.y])} stroke={line} strokeWidth={1} dash={[5, 4]} />
                </Group>
              );
            })}
          </>
        ),
        hit: hitBox(-w / 2, Math.min(-wallPx, swingDepth * 0.35), w / 2, Math.max(8, swingDepth * 0.35)),
      };
    }

    case 'window':
      return {
        shapes: (
          <Group listening={false}>
            <Rect x={-w / 2} y={-wallPx} width={w} height={wallPx} fill={palette.windowGlass} stroke={line} strokeWidth={lineWidth} />
            <Line points={[-w / 2, -wallPx / 2, w / 2, -wallPx / 2]} stroke={palette.featureInk} strokeWidth={1} />
          </Group>
        ),
        hit: hitBox(-w / 2, -wallPx, w / 2, 8),
      };

    case 'outlet':
    case 'switch': {
      const r = Math.max(6, (feature.width * s) / 2);
      const label = feature.kind === 'switch' ? 'S' : OUTLET_MARKS[feature.outletType ?? 'standard'];
      return {
        shapes: (
          <Group y={r + 2} listening={false}>
            <Circle radius={r} fill={palette.featureFill} stroke={line} strokeWidth={lineWidth} />
            {label ? (
              <Text text={label} fontSize={r * 1.1} fontStyle="700" fontFamily={FONT_FAMILY} fill={palette.featureInk} width={r * 2} offsetX={r} offsetY={r * 0.5} align="center" />
            ) : (
              <>
                <Line points={[-r * 0.35, -r * 0.45, -r * 0.35, r * 0.45]} stroke={palette.featureInk} strokeWidth={1.5} />
                <Line points={[r * 0.35, -r * 0.45, r * 0.35, r * 0.45]} stroke={palette.featureInk} strokeWidth={1.5} />
              </>
            )}
          </Group>
        ),
        hit: hitBox(-r, 0, r, r * 2 + 2),
      };
    }

    case 'vent': {
      if (feature.ventMount === 'wall') {
        const depth = Math.max(4, d);
        return {
          shapes: (
            <Group listening={false}>
              <Rect x={-w / 2} y={0} width={w} height={depth} fill={palette.featureFill} stroke={line} strokeWidth={lineWidth} />
              {slats(-w / 2, 0, w, depth, palette.featureInk)}
            </Group>
          ),
          hit: hitBox(-w / 2, 0, w / 2, depth),
        };
      }
      const ceiling = feature.ventMount === 'ceiling';
      return {
        shapes: (
          <Group listening={false} opacity={ceiling ? 0.8 : 1}>
            <Rect
              x={-w / 2}
              y={-d / 2}
              width={w}
              height={d}
              fill={ceiling ? undefined : palette.featureFill}
              stroke={ceiling ? (highlight ?? palette.ceiling) : line}
              strokeWidth={lineWidth}
              dash={ceiling ? [4, 3] : undefined}
            />
            {ceiling ? (
              <>
                <Line points={[-w / 2, -d / 2, w / 2, d / 2]} stroke={palette.ceiling} strokeWidth={1} />
                <Line points={[w / 2, -d / 2, -w / 2, d / 2]} stroke={palette.ceiling} strokeWidth={1} />
              </>
            ) : (
              slats(-w / 2, -d / 2, w, d, palette.featureInk)
            )}
          </Group>
        ),
        // Ceiling items hang above furniture: only their centre is grabbable, so they
        // never steal clicks meant for the furniture underneath.
        hit: ceiling ? hitBox(-4, -4, 4, 4) : hitBox(-w / 2, -d / 2, w / 2, d / 2),
      };
    }

    case 'radiator':
      return {
        shapes: (
          <Group listening={false}>
            <Rect x={-w / 2} y={0} width={w} height={d} fill={palette.featureFill} stroke={line} strokeWidth={lineWidth} cornerRadius={2} />
            {slats(-w / 2, 0, w, d, palette.featureInk, 5 * s)}
          </Group>
        ),
        hit: hitBox(-w / 2, 0, w / 2, d),
      };

    case 'column': {
      const round = feature.shape === 'round';
      return {
        shapes: round ? (
          <Circle radius={w / 2} fill={palette.wall} stroke={highlight ?? palette.wall} strokeWidth={highlight ? 2.5 : 1} listening={false} />
        ) : (
          <Rect x={-w / 2} y={-d / 2} width={w} height={d} fill={palette.wall} stroke={highlight ?? palette.wall} strokeWidth={highlight ? 2.5 : 1} listening={false} />
        ),
        hit: hitBox(-w / 2, -(round ? w : d) / 2, w / 2, (round ? w : d) / 2),
      };
    }

    case 'light': {
      const r = Math.max(8, w / 2);
      const color = highlight ?? palette.ceiling;
      return {
        shapes: (
          // Ceiling items are translucent and dashed so they read as "above" the furniture.
          <Group listening={false} opacity={0.85}>
            <Circle radius={r} fill={palette.ceiling} opacity={0.12} />
            <Circle radius={r} stroke={color} strokeWidth={lineWidth} dash={[4, 3]} />
            {lightSymbol(feature.lightType ?? 'pendant', r, color)}
          </Group>
        ),
        hit: hitBox(-4, -4, 4, 4),
      };
    }
  }
}

const OUTLET_MARKS: Record<NonNullable<RoomFeature['outletType']>, string | null> = {
  standard: null,
  usb: 'U',
  gfci: 'G',
  highVoltage: '⚡',
};

/** Parallel grille lines inside the box x0..x0+w, y0..y0+h. */
function slats(x0: number, y0: number, w: number, h: number, stroke: string, spacing = 5): ReactNode {
  const lines: ReactNode[] = [];
  const step = Math.max(spacing, 3);
  for (let x = step; x < w - 1; x += step) {
    lines.push(<Line key={x} points={[x0 + x, y0 + 1.5, x0 + x, y0 + h - 1.5]} stroke={stroke} strokeWidth={0.75} opacity={0.6} />);
  }
  return <>{lines}</>;
}

function lightSymbol(type: NonNullable<RoomFeature['lightType']>, r: number, color: string): ReactNode {
  switch (type) {
    case 'pendant':
      return (
        <>
          <Line points={[-r * 0.6, 0, r * 0.6, 0]} stroke={color} strokeWidth={1.25} />
          <Line points={[0, -r * 0.6, 0, r * 0.6]} stroke={color} strokeWidth={1.25} />
        </>
      );
    case 'flush':
      return <Circle radius={r * 0.4} fill={color} opacity={0.5} />;
    case 'recessed':
      return <Circle radius={r * 0.5} stroke={color} strokeWidth={1.25} />;
    case 'chandelier':
      return (
        <>
          {Array.from({ length: 6 }, (_, i) => {
            const a = (i / 6) * Math.PI * 2;
            return <Circle key={i} x={Math.cos(a) * r * 0.55} y={Math.sin(a) * r * 0.55} radius={Math.max(1.5, r * 0.13)} fill={color} />;
          })}
        </>
      );
  }
}
