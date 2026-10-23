import { componentId } from '../model/components';
import type { ComponentShape, ComponentType, FurnitureComponent, MaterialKind, SeamStyle, SurfaceFinish, UpholsteryPattern } from '../model/types';

/**
 * A small vocabulary for describing catalogue items as components. Positions are in the
 * piece's frame: x across (left −, right +), y front-to-back with the FRONT at +y, z up from
 * the floor (all cm). `at(x, y, z)` is the component's centre in plan and its bottom height.
 */

export interface PartOptions {
  material?: MaterialKind;
  color?: string;
  finish?: SurfaceFinish;
  radius?: number;
  edge?: 'square' | 'rounded' | 'bevel';
  seams?: SeamStyle;
  taper?: number;
  tilt?: number;
  rotation?: number;
  parent?: string;
  roughness?: number;
  pattern?: UpholsteryPattern;
}

export class Kit {
  readonly list: FurnitureComponent[] = [];

  private add(type: ComponentType, shape: ComponentShape, name: string, x: number, y: number, z: number, w: number, d: number, h: number, o: PartOptions): string {
    const id = componentId(this.list);
    const c: FurnitureComponent = { id, name, type, shape, x: r(x), y: r(y), z: r(z), width: r(w), depth: r(d), height: r(h), rotation: r(((o.rotation ?? 0) % 360 + 360) % 360) };
    if (o.parent) c.parentId = o.parent;
    if (o.material) c.material = o.material;
    if (o.color) c.color = o.color;
    if (o.pattern) c.pattern = o.pattern;
    if (o.finish) c.finish = o.finish;
    if (o.radius !== undefined) c.radius = o.radius;
    if (o.edge) c.edgeStyle = o.edge;
    if (o.seams) c.seams = o.seams;
    if (o.taper !== undefined) c.taper = o.taper;
    if (o.tilt) c.tilt = o.tilt;
    if (o.roughness !== undefined) c.roughness = o.roughness;
    this.list.push(c);
    return id;
  }

  /** A box from its centre in plan and bottom height. */
  box(type: ComponentType, name: string, x: number, y: number, z: number, w: number, d: number, h: number, o: PartOptions = {}) {
    return this.add(type, 'box', name, x, y, z, w, d, h, o);
  }

  /** A box from its extents (x0..x1, y0..y1, z0..z1). */
  span(type: ComponentType, name: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, o: PartOptions = {}) {
    return this.add(type, 'box', name, (x0 + x1) / 2, (y0 + y1) / 2, z0, x1 - x0, y1 - y0, z1 - z0, o);
  }

  cyl(type: ComponentType, name: string, x: number, y: number, z: number, w: number, d: number, h: number, o: PartOptions = {}) {
    return this.add(type, 'cylinder', name, x, y, z, w, d, h, o);
  }

  soft(type: ComponentType, name: string, x: number, y: number, z: number, w: number, d: number, h: number, o: PartOptions = {}) {
    return this.add(type, 'ellipsoid', name, x, y, z, w, d, h, o);
  }

  curved(type: ComponentType, name: string, x: number, y: number, z: number, chord: number, thickness: number, h: number, sweep: number, o: PartOptions = {}) {
    const id = this.add(type, 'curved', name, x, y, z, chord, thickness, h, o);
    this.list[this.list.length - 1].sweep = sweep;
    return id;
  }

  group(name: string, x = 0, y = 0, z = 0, o: PartOptions = {}) {
    return this.add('group', 'box', name, x, y, z, 1, 1, 1, o);
  }

  /** Four legs inset from the corners of a w × d footprint. */
  legs(w: number, d: number, h: number, size: number, inset: number, o: PartOptions = {}, round = true) {
    const g = this.group('Legs');
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const x = sx * (w / 2 - inset - size / 2);
        const y = sy * (d / 2 - inset - size / 2);
        if (round) this.cyl('leg', 'Leg', x, y, 0, size, size, h, { ...o, parent: g });
        else this.box('leg', 'Leg', x, y, 0, size, size, h, { ...o, parent: g });
      }
    }
    return g;
  }

  /** A row of `count` equal doors or drawer fronts across a cabinet's front face, each with a handle. */
  fronts(kind: 'door' | 'drawer', w: number, d: number, z0: number, z1: number, count: number, o: PartOptions & { handle?: 'bar' | 'knob' | 'none'; handleColor?: string; shaker?: boolean } = {}) {
    const gap = 0.4;
    const fw = (w - gap * (count + 1)) / count;
    // Fronts sit 2.5 cm behind the footprint's front edge, so their handles stay inside it.
    const fy = d / 2 - 3.4;
    for (let i = 0; i < count; i++) {
      const x = -w / 2 + gap + fw / 2 + i * (fw + gap);
      const id = this.box(kind, kind === 'door' ? 'Door' : 'Drawer', x, fy - (o.shaker ? 0.5 : 0), z0, fw, o.shaker ? 0.8 : 1.8, z1 - z0, { radius: 0.3, ...o });
      if (o.shaker) {
        // A shaker front: a flat frame (stiles and rails) around the recessed panel.
        const rail = Math.min(6, fw * 0.17, (z1 - z0) * 0.2);
        const frame = { ...o, parent: id, radius: 0.25 };
        this.box(kind, 'Stile', -fw / 2 + rail / 2, 0.5, 0, rail, 1.8, z1 - z0, frame);
        this.box(kind, 'Stile', fw / 2 - rail / 2, 0.5, 0, rail, 1.8, z1 - z0, frame);
        this.box(kind, 'Rail', 0, 0.5, 0, fw - rail * 2, 1.8, rail, frame);
        this.box(kind, 'Rail', 0, 0.5, z1 - z0 - rail, fw - rail * 2, 1.8, rail, frame);
      }
      if (o.handle === 'none') continue;
      const handleColor = o.handleColor ?? '#b08d57';
      // Handles sit on the front face (proud of a shaker frame, which stands out from its panel).
      const hy = o.shaker ? 1.4 : 0.9;
      if (o.handle === 'knob') this.cyl('detail', 'Knob', count > 1 && kind === 'door' ? (i % 2 ? -fw / 2 + 4 : fw / 2 - 4) : 0, hy, (z1 - z0) * (kind === 'door' ? 0.55 : 0.5), 2.4, 1.5, 2.4, { parent: id, material: 'metal', color: handleColor });
      else if (kind === 'door') this.box('detail', 'Handle', count > 1 ? (i % 2 ? -fw / 2 + 3 : fw / 2 - 3) : fw / 2 - 3, hy, (z1 - z0) * 0.55, 1.2, 1.4, Math.min(16, (z1 - z0) * 0.4), { parent: id, material: 'metal', color: handleColor, radius: 0.5 });
      else this.box('detail', 'Handle', 0, hy, (z1 - z0) * 0.6, Math.min(16, fw * 0.4), 1.4, 1.2, { parent: id, material: 'metal', color: handleColor, radius: 0.5 });
    }
  }
}

// `|| 0` turns −0 into 0, so saved data reads back identically.
const r = (v: number) => Math.round(v * 100) / 100 || 0;
