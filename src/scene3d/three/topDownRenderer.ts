import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  NeutralToneMapping,
  OrthographicCamera,
  PCFSoftShadowMap,
  SRGBColorSpace,
  Scene,
  WebGLRenderer,
} from 'three';
import type { Furniture } from '../../model/types';
import { CM_PER_SCENE_UNIT, buildFurniture } from '../model';
import { FurnitureLayer } from './furnitureLayer';
import { FurnitureMaterials } from './furnitureMaterials';

/**
 * Top-down renders of single pieces for the 2D presentation plan, made with the same parts,
 * geometry, materials and light as the 3D view, from straight above with an orthographic
 * camera. Lighting comes from the upper left (as in the 3D view and the plan's shadows), and
 * the piece shadows itself, so cushions show their creases and pillows their depth.
 *
 * One WebGL context is shared by every render. If WebGL isn't available the plan keeps its
 * Canvas 2D illustrations: this module is optional, and loaded only when used.
 */

type Item = Pick<Furniture, 'id' | 'name' | 'kind' | 'category' | 'width' | 'depth' | 'height' | 'color' | 'appearance' | 'shape' | 'components'>;

const m = (cm: number) => cm / CM_PER_SCENE_UNIT;
/** Largest render, in device pixels per side (very large pieces at 4K export are scaled). */
const MAX_SIDE = 2048;

export class TopDownRenderer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 50);
  private readonly materials = new FurnitureMaterials('high');
  private readonly layer: FurnitureLayer;
  private readonly sun = new DirectionalLight(0xfff6ea, 2.1);
  private readonly fill = new DirectionalLight(0xe8eefc, 0.3);
  private readonly hemisphere = new HemisphereLight(0xfbf8f2, 0xcbbfae, 1.45);
  private readonly ambient = new AmbientLight(0xffffff, 0.28);

  /** Throws if WebGL isn't available. */
  constructor() {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    this.layer = new FurnitureLayer(this.materials, () => {});
    this.layer.setDetail('high');
    this.layer.setContactShadows(false);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 5;
    this.sun.shadow.intensity = 0.55;
    this.scene.add(this.hemisphere, this.ambient, this.sun, this.sun.target, this.fill, this.fill.target, this.layer.group);
  }

  /**
   * The piece seen from straight above at `pxPerCm` CSS pixels per cm and `pixelRatio`, centred,
   * front at the bottom, on a transparent background; null if it can't be drawn.
   */
  render(item: Item, pxPerCm: number, pixelRatio: number, margin: number): HTMLCanvasElement | null {
    const cssW = item.width * pxPerCm + margin * 2;
    const cssH = item.depth * pxPerCm + margin * 2;
    let scale = pixelRatio;
    if (Math.max(cssW, cssH) * scale > MAX_SIDE) scale = MAX_SIDE / Math.max(cssW, cssH);
    const w = Math.max(1, Math.ceil(cssW * scale));
    const h = Math.max(1, Math.ceil(cssH * scale));
    const [piece] = buildFurniture([{ ...item, x: 0, y: 0, rotation: 0, texture: 'plain', locked: false, preferences: [] } as Furniture]);
    this.layer.build([piece]);
    // The camera frames the piece plus the margin, looking straight down with the front at the bottom.
    const halfW = m(cssW / pxPerCm) / 2;
    const halfD = m(cssH / pxPerCm) / 2;
    this.camera.left = -halfW;
    this.camera.right = halfW;
    this.camera.top = halfD;
    this.camera.bottom = -halfD;
    const top = m(item.height) + 1;
    this.camera.position.set(0, top + 1, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.camera.near = 0.01;
    this.camera.far = top + 3;
    this.camera.updateProjectionMatrix();
    // Key light high up and to the upper left of the plan (−x, −y), as in the 3D view.
    const reach = Math.max(halfW, halfD, m(item.height)) * 2 + 1;
    this.sun.position.set(-reach * 0.55, reach * 1.5, -reach * 0.75);
    this.sun.target.position.set(0, 0, 0);
    this.fill.position.set(reach, reach, reach);
    const shadowCam = this.sun.shadow.camera;
    const span = Math.max(halfW, halfD, m(item.height)) * 1.6;
    shadowCam.left = -span;
    shadowCam.right = span;
    shadowCam.top = span;
    shadowCam.bottom = -span;
    shadowCam.near = 0.01;
    shadowCam.far = reach * 4;
    shadowCam.updateProjectionMatrix();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.renderer.render(this.scene, this.camera);
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(this.renderer.domElement, 0, 0);
    return out;
  }

  dispose() {
    this.layer.dispose();
    this.materials.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
