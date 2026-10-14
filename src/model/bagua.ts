import { featureFrame, toRoom } from './features';
import { boundingBox, type Polygon } from './polygon';
import type { FengShuiSettings, Point, Project, RoomFeature } from './types';
import { outlinePolygon } from './walls';

/**
 * The Bagua map: an optional, interpretive overlay from Feng Shui. Two traditions are kept
 * apart, because they place the areas differently:
 *
 *   - Entrance (Western / BTB): a 3 × 3 grid over the room, its front row along the wall with
 *     the main entrance.
 *   - Compass (classical): eight directions around the room's centre. This needs the room's
 *     real orientation, which only the person can give (it's never guessed from the screen,
 *     and no device sensors or location are used).
 *
 * Nothing here is a claim about luck, health or fortune: these are traditional associations,
 * shown for people who like to use them.
 */

export interface BaguaArea {
  id: string;
  /** Short name, e.g. "Wealth & prosperity". */
  label: string;
  /** Trigram or direction, e.g. "Xun" or "SE · Xun". */
  tag: string;
  /** One-sentence educational explanation (traditional association). */
  explanation: string;
  polygon: Polygon;
  /** Where to put the label. */
  centre: Point;
}

export interface BaguaMap {
  method: FengShuiSettings['method'];
  areas: BaguaArea[];
  /** The room outline: areas are drawn clipped to it. */
  room: Polygon;
}

/** Each area's traditional theme. */
const THEMES = {
  wealth: { label: 'Wealth & prosperity', trigram: 'Xun', explanation: 'Traditionally linked with abundance and gratitude; often kept tidy and lively.' },
  fame: { label: 'Fame & reputation', trigram: 'Li', explanation: 'Traditionally linked with how you are seen and your aims; often given good light.' },
  love: { label: 'Love & relationships', trigram: 'Kun', explanation: 'Traditionally linked with partnership and care; pairs of objects are a common choice.' },
  family: { label: 'Family & community', trigram: 'Zhen', explanation: 'Traditionally linked with family, roots and new growth.' },
  centre: { label: 'Centre', trigram: 'Tai Qi', explanation: 'The middle of the room: traditionally kept open, which also helps people move around.' },
  children: { label: 'Children & creativity', trigram: 'Dui', explanation: 'Traditionally linked with projects, play and completion.' },
  knowledge: { label: 'Knowledge & self-cultivation', trigram: 'Gen', explanation: 'Traditionally linked with learning and reflection; a common spot for books or a quiet seat.' },
  career: { label: 'Career & life path', trigram: 'Kan', explanation: 'Traditionally linked with work and direction; usually where the entrance is.' },
  helpers: { label: 'Helpful people & travel', trigram: 'Qian', explanation: 'Traditionally linked with mentors, friends and journeys.' },
} as const;

type Theme = keyof typeof THEMES;

/** The entrance grid, as seen standing in the doorway looking in: back row first, left to right. */
const ENTRANCE_GRID: Theme[][] = [
  ['wealth', 'fame', 'love'],
  ['family', 'centre', 'children'],
  ['knowledge', 'career', 'helpers'],
];

/** The eight directions, clockwise from north, with their traditional areas. */
const DIRECTIONS: { name: string; bearing: number; theme: Theme }[] = [
  { name: 'N', bearing: 0, theme: 'career' },
  { name: 'NE', bearing: 45, theme: 'knowledge' },
  { name: 'E', bearing: 90, theme: 'family' },
  { name: 'SE', bearing: 135, theme: 'wealth' },
  { name: 'S', bearing: 180, theme: 'fame' },
  { name: 'SW', bearing: 225, theme: 'love' },
  { name: 'W', bearing: 270, theme: 'children' },
  { name: 'NW', bearing: 315, theme: 'helpers' },
];

const area = (id: string, theme: Theme, tag: string, polygon: Polygon, centre: Point): BaguaArea => ({
  id,
  label: THEMES[theme].label,
  tag,
  explanation: THEMES[theme].explanation,
  polygon,
  centre,
});

/** The entrance door: the chosen one, or the first door. */
export function baguaEntrance(project: Project): RoomFeature | null {
  const doors = project.features.filter((f) => f.kind === 'door');
  return doors.find((d) => d.id === project.fengShui?.entranceId) ?? doors[0] ?? null;
}

/**
 * The Bagua map for the room, or a plain reason it can't be drawn (no entrance door, or no
 * north bearing for the compass method).
 */
export function baguaMap(project: Project): BaguaMap | string {
  const settings = project.fengShui;
  const room = outlinePolygon(project.room);
  if (settings?.method === 'compass') {
    if (settings.northBearing === null) return 'Enter which way north is (a compass bearing) to use the compass method. Roomination never guesses it.';
    return { method: 'compass', areas: compassAreas(room, settings.northBearing), room };
  }
  const door = baguaEntrance(project);
  if (!door) return 'Add a door to use the entrance method: the grid lines up with the main entrance.';
  return { method: 'entrance', areas: entranceAreas(project, room, door), room };
}

function entranceAreas(project: Project, room: Polygon, door: RoomFeature): BaguaArea[] {
  // Work in the door's frame: x along the entrance wall, y into the room.
  const frame = featureFrame(door, project.room);
  const rad = (frame.angle * Math.PI) / 180;
  const toLocal = (p: Point) => {
    const dx = p.x - frame.x;
    const dy = p.y - frame.y;
    return { x: dx * Math.cos(rad) + dy * Math.sin(rad), y: -dx * Math.sin(rad) + dy * Math.cos(rad) };
  };
  const box = boundingBox(room.map(toLocal));
  const w = (box.maxX - box.minX) / 3;
  const d = (box.maxY - box.minY) / 3;
  const areas: BaguaArea[] = [];
  ENTRANCE_GRID.forEach((row, r) => {
    // Row 0 is the back (far from the door); row 2 runs along the entrance wall.
    const y0 = box.maxY - (r + 1) * d;
    row.forEach((theme, c) => {
      // Looking into the room (+y), the person's left is +x.
      const x0 = box.maxX - (c + 1) * w;
      const local = [
        { x: x0, y: y0 },
        { x: x0 + w, y: y0 },
        { x: x0 + w, y: y0 + d },
        { x: x0, y: y0 + d },
      ];
      areas.push(area(theme, theme, THEMES[theme].trigram, local.map((p) => toRoom(frame, p)), toRoom(frame, { x: x0 + w / 2, y: y0 + d / 2 })));
    });
  });
  return areas;
}

function compassAreas(room: Polygon, northBearing: number): BaguaArea[] {
  const box = boundingBox(room);
  const centre = centroid(room);
  const reach = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
  // A compass bearing B points (B − northBearing)° clockwise from the plan's "up".
  const dir = (bearing: number) => {
    const t = ((bearing - northBearing) * Math.PI) / 180;
    return { x: Math.sin(t), y: -Math.cos(t) };
  };
  const at = (bearing: number, r: number) => ({ x: centre.x + dir(bearing).x * r, y: centre.y + dir(bearing).y * r });
  const inner = Math.min(box.maxX - box.minX, box.maxY - box.minY) / 6;
  const areas = DIRECTIONS.map((d) => {
    const steps = 4;
    const outer = Array.from({ length: steps + 1 }, (_, i) => at(d.bearing - 22.5 + (45 * i) / steps, reach));
    const innerArc = Array.from({ length: steps + 1 }, (_, i) => at(d.bearing + 22.5 - (45 * i) / steps, inner));
    return area(d.theme, d.theme, `${d.name} · ${THEMES[d.theme].trigram}`, [...outer, ...innerArc], at(d.bearing, inner + (Math.min(box.maxX - box.minX, box.maxY - box.minY) / 2 - inner) * 0.6));
  });
  const circle = Array.from({ length: 24 }, (_, i) => at(i * 15, inner));
  areas.push(area('centre', 'centre', THEMES.centre.trigram, circle, centre));
  return areas;
}

/** The centre of an outline's area. */
function centroid(poly: Polygon): Point {
  let a = 0;
  let x = 0;
  let y = 0;
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    x += (p.x + q.x) * cross;
    y += (p.y + q.y) * cross;
  });
  if (Math.abs(a) < 1e-9) return poly[0] ?? { x: 0, y: 0 };
  return { x: x / (3 * a), y: y / (3 * a) };
}

/** The compass direction (N, NE, …) of the plan's "up", for showing next to the bearing input. */
export function upDirection(northBearing: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round((((northBearing % 360) + 360) % 360) / 45) % 8];
}
