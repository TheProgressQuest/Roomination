import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CubeCamera,
  PMREMGenerator,
  WebGLCubeRenderTarget,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  BackSide,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
  SpotLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NeutralToneMapping,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  ShapeUtils,
  Spherical,
  Vector2,
  Vector3,
  Texture,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { pointInPolygon, signedArea2, type Polygon } from '../../model/polygon';
import type { CameraPose, PhotoTexture, Point } from '../../model/types';
import { floorTexture } from '../../render/textures';
import { lightHex } from '../../render/lightColour';
import { loadAssetImage } from '../../storage/assets';
import type { CameraPreset, WallMode } from '../../state/preferences';
import { CM_PER_SCENE_UNIT, toScene, type Block, type Cylinder, type OpeningMaterial, type FloorHole, type RoomModel, type SceneFurniture, type SceneWall } from '../model';
import type { ViewerStats } from '../diagnostics';
import { faceShapes } from '../wallFaces';
import { FurnitureLayer } from './furnitureLayer';
import { FurnitureMaterials } from './furnitureMaterials';

/**
 * Draws a SceneModel with Three.js. Everything here is presentation: the project is
 * never read or changed directly, and every object can be rebuilt from the model.
 *
 * Rendering happens only on demand (camera moved, model changed, canvas resized), so an
 * idle 3D view costs nothing. Call `dispose()` to free every GPU resource.
 */

/**
 * Rendering quality. Low: no shadow maps (soft contact shadows only), plain materials,
 * simpler shapes. Medium: soft shadows and material textures. High: sharper, larger shadow
 * maps, finer rounding and curves, more detailed textures at a higher resolution.
 */
export type RenderQuality = 'low' | 'medium' | 'high';

export interface ViewerOptions {
  shadows: boolean;
  quality: RenderQuality;
  reducedMotion: boolean;
  /** Touch devices get smaller shadow maps. */
  touch: boolean;
  /** The camera angle to start from once the first model arrives. */
  initialPreset: CameraPreset;
  onSelect: (id: string | null) => void;
  onContextLost: () => void;
}


/** Scales a fitting's candela to sit alongside the room's (non-physical) daylight levels. */
const LIGHT_SCALE = 0.032;
/** Inside a room under its ceiling, daylight is dimmer and the room's own lights matter more. */
const INDOOR_DAYLIGHT = 0.3;

/** Drawing-buffer budget per quality: keeps memory sensible on large, high-density screens. */
const MAX_BUFFER_PIXELS: Record<RenderQuality, number> = { low: 2_000_000, medium: 4_000_000, high: 6_000_000 };
const MAX_PIXEL_RATIO: Record<RenderQuality, number> = { low: 1.25, medium: 2, high: 2 };
const TRANSITION_MS = 450;
/** Scenes with more parts than this skip shadows on touch devices. */
const TOUCH_SHADOW_PART_LIMIT = 400;

const m = (cm: number) => cm / CM_PER_SCENE_UNIT;

export class RoomViewer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 0.05, 400);
  private readonly controls: OrbitControls;
  // Soft architectural daylight: a warm-white sky dome, a gentle bounce from the floor, and a
  // key light from the upper left (the same direction as the 2D presentation's shadows).
  // Close to neutral, so colours matched from a corrected photo aren't warmed again in 3D: a
  // barely warm sun, a barely cool fill, and a grey (not brown) bounce from below.
  private readonly sun = new DirectionalLight(0xfffaf3, 1.9);
  private readonly fill = new DirectionalLight(0xeef1f8, 0.35);
  private readonly hemisphere = new HemisphereLight(0xf8f8f6, 0xc6c4c0, 1.55);
  private readonly ambient = new AmbientLight(0xffffff, 0.3);
  private readonly unitBox = new BoxGeometry(1, 1, 1);
  private readonly unitCylinder = new CylinderGeometry(0.5, 0.5, 1, 24);
  private readonly resizeObserver: ResizeObserver;
  private readonly raycaster = new Raycaster();
  private readonly options: ViewerOptions;

  /** Walls, floor, stairs and fixtures: rebuilt (and disposed) whenever the room changes. */
  private roomContent = new Group();
  private roomMaterials: MaterialSet | null = null;
  private readonly furnitureMaterials = new FurnitureMaterials();
  /** Every piece of furniture: batched parts, plus extruded drawn and photo-textured pieces. */
  private readonly furniture = new FurnitureLayer(this.furnitureMaterials, () => this.requestRender());
  private lastFurniture: SceneFurniture[] = [];
  private quality: RenderQuality;
  private wallGroups: { group: Group; outer: boolean; outward: Point; centre: Point }[] = [];
  private room: RoomModel | null = null;
  /** Whether shadows are currently drawn (null until the first room arrives). */
  private shadowsOn: boolean | null = null;
  private wallMode: WallMode = 'dollhouse';
  /** The ceiling: drawn at the measured height, shown only when the camera is inside the room below it. */
  private ceiling: Mesh | null = null;
  private ceilingOn = true;
  /** Light from fittings and ceiling lights (no shadows; how many depends on quality). */
  private readonly fixtureLights = new Group();
  private shadows: boolean;

  private frameRequest = 0;
  private transition: { frame: number } | null = null;
  /** CPU time of the last frame and of the last reflection update, ms (diagnostics). */
  private lastFrameMs = 0;
  private reflectionMs = 0;
  /** A soft, generic room environment for glossy surfaces (Medium and High quality). */
  private environment: { texture: Texture; dispose(): void } | null = null;
  /** What the mirrors reflect (High quality): the room, captured from the first mirror. */
  private mirrorCapture: { camera: CubeCamera; target: WebGLCubeRenderTarget } | null = null;
  /** The orbiting camera, kept while a manual camera is in use. */
  private orbitBefore: { position: Vector3; target: Vector3; fov: number } | null = null;
  private roomBuildMs = 0;
  private furnitureBuildMs = 0;
  private framesRendered = 0;
  /** The pointer that might become a tap; cleared as soon as it turns into a drag, pinch or pan. */
  private tap: { id: number; x: number; y: number; time: number } | null = null;
  private readonly activePointers = new Set<number>();
  private disposed = false;

  constructor(container: HTMLElement, options: ViewerOptions) {
    this.options = options;
    this.shadows = options.shadows;
    this.quality = options.quality;
    this.furnitureMaterials.setQuality(options.quality);
    this.furniture.setDetail(options.quality);
    // Throws if WebGL isn't available; the caller shows a fallback message.
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'default', alpha: true });
    this.renderer.outputColorSpace = SRGBColorSpace;
    // Neutral tone mapping keeps the person's chosen colours true while softening highlights.
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = PCFShadowMap;
    const canvas = this.renderer.domElement;
    canvas.className = 'room-3d-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', '3D view of the room. Drag to orbit, scroll or pinch to zoom.');
    container.appendChild(canvas);

    this.camera.position.set(6, 6, 6);
    this.controls = new OrbitControls(this.camera, canvas);
    // No inertia: the view stops exactly when the finger or mouse does.
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.zoomToCursor = true;
    this.controls.addEventListener('change', this.onControlsChange);
    this.controls.addEventListener('start', this.cancelTransition);

    this.sun.castShadow = true;
    this.scene.add(this.hemisphere, this.ambient, this.sun, this.sun.target, this.fill, this.fill.target, this.roomContent, this.furniture.group);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Replaces the walls, floor, stairs and fixtures. The camera stays where it is. */
  setRoom(room: RoomModel) {
    const started = performance.now();
    const first = this.room === null;
    this.room = room;
    this.clearRoom();
    this.buildRoom(room);
    this.updateShadows();
    this.updateWallVisibility();
    this.roomBuildMs = performance.now() - started;
    if (first) this.setPreset(this.options.initialPreset, false);
    this.updateLights();
    this.updateReflections();
    this.requestRender();
  }

  /** Replaces the furniture only (moving or recolouring a piece leaves the room untouched). */
  setFurniture(furniture: SceneFurniture[]) {
    const started = performance.now();
    this.lastFurniture = furniture;
    this.furniture.build(furniture);
    this.updateShadows();
    this.furnitureBuildMs = performance.now() - started;
    this.updateLights();
    this.updateReflections();
    this.requestRender();
  }

  setSelection(id: string | null) {
    this.furniture.setSelection(id);
    this.requestRender();
  }

  /** Whether the ceiling may be shown (it still hides itself whenever the camera is outside or above). */
  setCeiling(on: boolean) {
    this.ceilingOn = on;
    this.updateWallVisibility();
    this.requestRender();
  }

  setWallMode(mode: WallMode) {
    this.wallMode = mode;
    this.updateWallVisibility();
    this.requestRender();
  }

  setShadows(on: boolean) {
    this.shadows = on;
    this.updateShadows();
    this.requestRender();
  }

  /** Changes rendering quality: materials, shape detail, shadow maps and resolution. */
  setQuality(quality: RenderQuality) {
    if (quality === this.quality) return;
    this.quality = quality;
    this.furnitureMaterials.setQuality(quality);
    queueMicrotask(() => {
      this.updateLights();
      this.updateReflections();
      this.requestRender();
    });
    this.furniture.setDetail(quality);
    if (this.room) {
      // Room materials use the same quality-dependent floor and wall detail.
      this.clearRoom();
      this.buildRoom(this.room);
      this.updateWallVisibility();
    }
    this.furniture.build(this.lastFurniture);
    this.shadowsOn = null;
    this.updateShadows();
    this.resize();
  }

  setBackground(color: string) {
    this.scene.background = new Color(color);
    this.requestRender();
  }

  /** Moves the camera to a preset view, smoothly unless reduced motion is on (or `animate` is false). */
  setPreset(preset: CameraPreset, animate = true) {
    if (!this.room) return;
    const { position, target } = this.presetPose(preset, this.room);
    if (!animate || this.options.reducedMotion) {
      this.cancelTransition();
      this.controls.target.copy(target);
      this.camera.position.copy(position);
      this.controls.update();
      this.requestRender();
      return;
    }
    this.animateTo(position, target);
  }

  /** Zooms in (factor < 1) or out (factor > 1) towards the current target: for buttons and keys. */
  zoom(factor: number) {
    this.cancelTransition();
    const offset = this.camera.position.clone().sub(this.controls.target).multiplyScalar(factor);
    const length = Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, offset.length()));
    this.camera.position.copy(this.controls.target).add(offset.setLength(length));
    this.controls.update();
  }

  /**
   * True when the browser draws 3D without a graphics card (software rendering, as on some
   * virtual machines and CI). Automatic quality picks Low there.
   */
  isSoftwareRendering(): boolean {
    const gl = this.renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
    return /swiftshader|llvmpipe|softpipe|software|basic render/.test(name);
  }

  /** Resolves once photo textures have finished loading (or after `timeoutMs`). */
  async whenReady(timeoutMs = 4000): Promise<void> {
    const started = performance.now();
    while (this.furniture.pendingPhotos > 0 && performance.now() - started < timeoutMs) await new Promise((r) => setTimeout(r, 50));
  }

  /** The largest image (width, height) this device's graphics can render in one pass. */
  maxImageSize(): number {
    const gl = this.renderer.getContext();
    const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    return Math.min(this.renderer.capabilities.maxTextureSize, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number, viewport[0], viewport[1]);
  }

  /**
   * Renders the room at `width` × `height` from a preset camera into a new 2D canvas, then
   * puts the live view back exactly as it was. Throws if the size is beyond the device.
   */
  renderImage(width: number, height: number, options: { preset: CameraPreset; transparent: boolean; background: string }): HTMLCanvasElement {
    if (!this.room) throw new Error('Nothing to render yet.');
    const max = this.maxImageSize();
    if (width > max || height > max) throw new Error(`This device can render images up to ${max} pixels wide.`);
    const size = this.renderer.getSize(new Vector2());
    const ratio = this.renderer.getPixelRatio();
    const saved = { position: this.camera.position.clone(), target: this.controls.target.clone(), aspect: this.camera.aspect, background: this.scene.background };
    try {
      this.cancelTransition();
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      const pose = this.presetPose(options.preset, this.room);
      this.camera.position.copy(pose.position);
      this.controls.target.copy(pose.target);
      this.camera.lookAt(pose.target);
      this.updateWallVisibility();
      this.scene.background = options.transparent ? null : new Color(options.background);
      this.renderer.setClearColor(0x000000, options.transparent ? 0 : 1);
      this.renderer.render(this.scene, this.camera);
      // Copy straight away, in the same task: the WebGL buffer isn't kept after the frame.
      const out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      out.getContext('2d')!.drawImage(this.renderer.domElement, 0, 0, width, height);
      return out;
    } finally {
      this.renderer.setPixelRatio(ratio);
      this.renderer.setSize(size.x, size.y, false);
      this.camera.aspect = saved.aspect;
      this.camera.updateProjectionMatrix();
      this.camera.position.copy(saved.position);
      this.controls.target.copy(saved.target);
      this.controls.update();
      this.scene.background = saved.background;
      this.renderer.setClearColor(0x000000, 0);
      this.updateWallVisibility();
      this.requestRender();
    }
  }

  stats(): ViewerStats {
    const info = this.renderer.info;
    return {
      frameMs: Math.round(this.lastFrameMs * 10) / 10,
      reflectionMs: Math.round(this.reflectionMs * 10) / 10,
      buildMs: this.roomBuildMs + this.furnitureBuildMs,
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      framesRendered: this.framesRendered,
      pixelRatio: this.renderer.getPixelRatio(),
      animating: this.transition !== null,
    };
  }

  /**
   * Light from fittings (lamps, wall lights, vanity bars) and ceiling lights, by quality:
   *  - Low: none (their shades still glow);
   *  - Medium: up to 4 lights; High: up to 8. None casts shadows (that would cost a shadow
   *    map per light per frame).
   * Lumens become candela (÷ 4π for light all round), scaled to sit with the room's daylight.
   */
  private updateLights() {
    for (const light of [...this.fixtureLights.children]) {
      this.fixtureLights.remove(light);
      (light as PointLight).dispose?.();
    }
    if (!this.fixtureLights.parent) this.scene.add(this.fixtureLights);
    const limit = this.quality === 'low' ? 0 : this.quality === 'medium' ? 4 : 8;
    const sources = [...(this.lastFurniture ?? []).flatMap((f) => (f.light ? [f.light] : [])), ...(this.room?.lights ?? [])].slice(0, limit);
    for (const source of sources) {
      const colour = new Color(lightHex(source.kelvin));
      const candela = (source.lumens / (4 * Math.PI)) * LIGHT_SCALE;
      const at = toScene({ x: source.x, y: source.y }, source.z);
      if (source.direction === 'all') {
        const light = new PointLight(colour, candela, 8, 2);
        light.position.set(at.x, at.y, at.z);
        this.fixtureLights.add(light);
      } else {
        // A cone of light down (or up), soft-edged; a spot concentrates the same light.
        const light = new SpotLight(colour, candela * 2, 8, Math.PI / 3, 0.7, 2);
        light.position.set(at.x, at.y, at.z);
        light.target.position.set(at.x, source.direction === 'down' ? 0 : at.y + 5, at.z);
        this.fixtureLights.add(light, light.target);
      }
    }
  }

  /**
   * Reflections, by quality:
   *  - Low: none (plain lighting, as before).
   *  - Medium and High: a soft generic room environment, so glossy ceramics, chrome and tiles
   *    pick up believable highlights (one pre-filter when first needed, nothing per frame).
   *  - High: mirrors reflect the actual room, captured once from the first mirror whenever
   *    the room or furniture changes (six extra renders at rebuild time, not per frame). The
   *    reflection's perspective is approximate: it's a capture from one point.
   */
  private updateReflections() {
    const started = performance.now();
    if (this.quality === 'low') {
      this.scene.environment = null;
    } else {
      if (!this.environment) {
        const pmrem = new PMREMGenerator(this.renderer);
        const target = pmrem.fromScene(new RoomEnvironment(), 0.04);
        pmrem.dispose();
        this.environment = { texture: target.texture, dispose: () => target.dispose() };
      }
      this.scene.environment = this.environment.texture;
      this.scene.environmentIntensity = 0.3;
    }
    this.reflectionMs = performance.now() - started;
    // The mirror capture waits for a quiet moment, so a burst of edits pays for it once.
    window.clearTimeout(this.mirrorTimer);
    this.mirrorTimer = window.setTimeout(() => this.captureMirrors(), 200);
  }

  private mirrorTimer = 0;

  private captureMirrors() {
    if (this.disposed) return;
    const started = performance.now();
    const mirrors: Mesh[] = [];
    this.furniture.group.traverse((o) => {
      if ((o as Mesh).isMesh && o.name === 'furniture:mirror') mirrors.push(o as Mesh);
    });
    const piece = (this.lastFurniture ?? []).find((f) => f.parts.some((p) => p.surface === 'mirror'));
    if (this.quality === 'high' && mirrors.length > 0 && piece) {
      if (!this.mirrorCapture) {
        const target = new WebGLCubeRenderTarget(256);
        this.mirrorCapture = { camera: new CubeCamera(0.05, 60, target), target };
      }
      // Just in front of the mirror, at its middle height, facing out of it.
      const turn = (piece.rotation * Math.PI) / 180;
      const front = 12;
      const at = toScene({ x: piece.x - Math.sin(turn) * front, y: piece.y + Math.cos(turn) * front }, piece.elevation + piece.height / 2);
      const { camera, target } = this.mirrorCapture;
      camera.position.set(at.x, at.y, at.z);
      // The mirror sees the whole room, whatever the main camera hides (dollhouse walls, ceiling).
      const hidden = [...this.wallGroups.map((w) => w.group), ...(this.ceiling ? [this.ceiling] : [])].filter((o) => !o.visible);
      for (const o of hidden) o.visible = true;
      for (const m of mirrors) m.visible = false;
      camera.update(this.renderer, this.scene);
      for (const o of hidden) o.visible = false;
      // The mirror's material keeps a pre-filtered copy of its reflection: refresh it.
      target.texture.needsPMREMUpdate = true;
      for (const m of mirrors) {
        m.visible = true;
        for (const material of [m.material].flat() as MeshStandardMaterial[]) {
          material.envMap = target.texture;
          material.metalness = 1;
          material.roughness = 0.02;
          material.needsUpdate = true;
        }
      }
      this.requestRender();
    }
    this.reflectionMs = performance.now() - started;
  }

  /** Where a piece's centre appears on screen (CSS px relative to the canvas), or null. */
  pointOnScreen(id: string): { x: number; y: number } | null {
    const piece = this.furniture.footprintOf(id);
    return piece ? this.projectPoint(piece, piece.elevation + piece.height / 2) : null;
  }

  /** Where a plan point (cm) at a height (cm) appears on screen, in CSS px relative to the canvas. */
  projectPoint(p: Point, height = 0): { x: number; y: number } {
    const s = toScene(p, height);
    const v = new Vector3(s.x, s.y, s.z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height };
  }

  /**
   * Manual camera (Match My Room): placed and aimed by numbers, to line the view up with a
   * photo. Orbiting is paused while it's on; null hands the camera back to orbiting, where it was.
   */
  setManualCamera(pose: CameraPose | null) {
    this.cancelTransition();
    if (!pose) {
      if (!this.orbitBefore) return;
      this.camera.fov = this.orbitBefore.fov;
      this.camera.up.set(0, 1, 0);
      this.camera.position.copy(this.orbitBefore.position);
      this.controls.target.copy(this.orbitBefore.target);
      this.camera.updateProjectionMatrix();
      this.controls.enabled = true;
      this.controls.update();
      this.orbitBefore = null;
      this.requestRender();
      return;
    }
    this.orbitBefore ??= { position: this.camera.position.clone(), target: this.controls.target.clone(), fov: this.camera.fov };
    this.controls.enabled = false;
    const yaw = (pose.yaw * Math.PI) / 180;
    const pitch = (pose.pitch * Math.PI) / 180;
    const eye = toScene({ x: pose.x, y: pose.y }, pose.height);
    // Turn 0 looks towards the top of the plan (−y); positive turns clockwise, as on the plan.
    const direction = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camera.position.clone().add(direction));
    this.camera.rotateZ((-pose.roll * Math.PI) / 180);
    this.camera.fov = Math.min(120, Math.max(10, pose.fov));
    this.camera.updateProjectionMatrix();
    this.updateWallVisibility();
    this.requestRender();
  }

  /** Where the camera is and where it looks, as a manual-camera pose. */
  cameraPose(): CameraPose {
    const direction = new Vector3();
    this.camera.getWorldDirection(direction);
    const p = this.camera.position;
    const r = (v: number) => Math.round(v * 10) / 10;
    return {
      x: r(p.x * CM_PER_SCENE_UNIT),
      y: r(p.z * CM_PER_SCENE_UNIT),
      height: r(p.y * CM_PER_SCENE_UNIT),
      yaw: r((((Math.atan2(direction.x, -direction.z) * 180) / Math.PI) % 360 + 360) % 360),
      pitch: r((Math.asin(Math.max(-1, Math.min(1, direction.y))) * 180) / Math.PI),
      roll: 0,
      fov: r(this.camera.fov),
    };
  }

  /** The camera's plan position and height, in cm (for tests and diagnostics). */
  cameraPosition(): Point & { height: number } {
    const p = this.camera.position;
    return { x: p.x * CM_PER_SCENE_UNIT, y: p.z * CM_PER_SCENE_UNIT, height: p.y * CM_PER_SCENE_UNIT };
  }

  /** Which walls are currently shown (for tests and diagnostics). */
  visibleWalls(): number {
    return this.wallGroups.filter((w) => w.group.visible).length;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frameRequest);
    this.cancelTransition();
    this.resizeObserver.disconnect();
    window.clearTimeout(this.mirrorTimer);
    this.environment?.dispose();
    this.mirrorCapture?.target.dispose();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.controls.removeEventListener('change', this.onControlsChange);
    this.controls.removeEventListener('start', this.cancelTransition);
    this.controls.dispose();
    this.clearRoom();
    this.furniture.dispose();
    this.furnitureMaterials.dispose();
    this.unitBox.dispose();
    this.unitCylinder.dispose();
    this.sun.shadow.map?.dispose();
    this.renderer.dispose();
    // Hand the GPU context back to the browser straight away rather than waiting for GC.
    this.renderer.forceContextLoss();
    canvas.remove();
  }

  // ---------------------------------------------------------------------------
  // Building the scene
  // ---------------------------------------------------------------------------

  private buildRoom(room: RoomModel) {
    const materials = new MaterialSet(room.wallColor, () => this.requestRender());
    this.roomMaterials = materials;

    // Floor, with holes where stairs go down.
    const floor = new Mesh(floorGeometry(room.floor, room.floorHoles.map((h) => h.points), room.floorStyle), materials.floor(room.floorStyle));
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.roomContent.add(floor);

    // The ceiling at the measured height, seen from below (it hides itself from outside views).
    const ceiling = new Mesh(floorGeometry(room.floor, [], { ...room.floorStyle, preset: 'plain', photo: undefined }), materials.ceiling);
    ceiling.position.y = m(room.ceilingHeight);
    ceiling.receiveShadow = true;
    ceiling.name = 'ceiling';
    ceiling.userData.blocksSelection = true;
    this.ceiling = ceiling;
    this.roomContent.add(ceiling);
    if (room.floorHoles.length > 0) {
      const shaft = new Mesh(shaftGeometry(room.floorHoles), materials.shaft);
      shaft.receiveShadow = true;
      this.roomContent.add(shaft);
    }

    // Walls: one group per wall so the dollhouse view can hide it with everything set into it.
    this.wallGroups = room.walls.map((wall) => {
      const group = new Group();
      group.name = `wall:${wall.wallId}`;
      const mesh = new Mesh(wallGeometry(wall), materials.wallLook(wall.color, wall.texture));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.blocksSelection = true;
      group.add(mesh);
      const byMaterial = new Map<OpeningMaterial | 'fixture', Block[]>();
      for (const { material, block } of wall.openings) byMaterial.set(material, [...(byMaterial.get(material) ?? []), block]);
      if (wall.fixtures.length > 0) byMaterial.set('fixture', wall.fixtures);
      if (wall.outer) {
        // Soft darkening where the wall meets the floor (and the ceiling, which shows only from inside).
        const [p0, p1, , p3] = wall.footprint;
        const inward = { x: -wall.outward.x, y: -wall.outward.y };
        for (const [height, flip] of [[0.2, false], [room.ceilingHeight - 0.2, true]] as const) {
          const strip = edgeShade(p0, p1, inward, height, flip, materials.edgeShade);
          if (flip) strip.userData.ceiling = true;
          group.add(strip);
        }
        // Beyond a doorway: a dim surface, so it reads as the next room rather than blank background.
        const thickness = Math.hypot(p3.x - p0.x, p3.y - p0.y);
        for (const hole of wall.holes.filter((h) => h.bottom < 1)) {
          const mid = (hole.start + hole.end) / 2;
          const along = { x: wall.origin.x + wall.direction.x * mid, y: wall.origin.y + wall.direction.y * mid };
          const at = toScene({ x: along.x + wall.outward.x * (thickness + 60), y: along.y + wall.outward.y * (thickness + 60) }, hole.top / 2);
          const backdrop = new Mesh(new PlaneGeometry(m(hole.end - hole.start + 80), m(hole.top + 20)), materials.beyond);
          backdrop.position.set(at.x, at.y, at.z);
          backdrop.lookAt(at.x - wall.outward.x, at.y, at.z - wall.outward.y);
          backdrop.name = 'beyond-doorway';
          group.add(backdrop);
        }
      }
      if (wall.trim.length > 0) {
        const trim = new Mesh(mergedBlocks(this.unitBox, wall.trim), materials.trim(wall.trim[0].color));
        trim.castShadow = true;
        trim.receiveShadow = true;
        trim.name = 'trim';
        group.add(trim);
      }
      for (const [material, blocks] of byMaterial) {
        const mesh = new Mesh(mergedBlocks(this.unitBox, blocks), materials.opening(material));
        mesh.castShadow = material !== 'glass';
        mesh.receiveShadow = material !== 'glass';
        group.add(mesh);
      }
      this.roomContent.add(group);
      return { group, outer: wall.outer, outward: wall.outward, centre: wall.centre };
    });

    // Stairs and free-standing fixtures, instanced. Nothing on the ceiling casts a shadow:
    // there's no ceiling drawn, so the shadow would look like it came from nowhere.
    const stairBlocks = room.stairs.flatMap((s) => [...s.steps, ...s.landings]);
    if (stairBlocks.length > 0) this.roomContent.add(instanced(this.unitBox, stairBlocks, materials.stairs, true));
    for (const [shapes, castShadow] of [
      [room.fixtures.floor, true],
      [room.fixtures.ceiling, false],
    ] as const) {
      if (shapes.blocks.length > 0) this.roomContent.add(instanced(this.unitBox, shapes.blocks, materials.fixture, castShadow));
      if (shapes.cylinders.length > 0) this.roomContent.add(instanced(this.unitCylinder, shapes.cylinders, materials.fixture, castShadow));
    }
  }

  private clearRoom() {
    this.roomContent.traverse((object) => {
      // The shared unit shapes outlive individual rooms.
      if (object instanceof Mesh && object.geometry !== this.unitBox && object.geometry !== this.unitCylinder) object.geometry.dispose();
      if (object instanceof InstancedMesh) object.dispose();
    });
    this.roomMaterials?.dispose();
    this.roomMaterials = null;
    this.scene.remove(this.roomContent);
    this.roomContent = new Group();
    this.scene.add(this.roomContent);
    this.wallGroups = [];
  }

  /** Points the sun at the room and turns shadows on or off (limited on touch devices). */
  private updateShadows() {
    const room = this.room;
    if (!room) return;
    const enabled = this.shadows && this.quality !== 'low' && !(this.options.touch && this.furniture.partCount > TOUCH_SHADOW_PART_LIMIT);
    // Soft contact shadows cost almost nothing: on whenever shadows are, at every quality.
    this.furniture.setContactShadows(this.shadows);
    const { minX, minY, maxX, maxY } = room.bounds;
    const centre = toScene({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
    const radius = m(Math.hypot(maxX - minX, maxY - minY) / 2) + 0.5;
    // Light from high up and to the upper left of the plan, like the reference drawings: shadows
    // fall softly down and to the right. A weak, shadowless fill from the opposite side lifts
    // the dark sides of furniture.
    this.sun.position.set(centre.x - radius * 0.55, radius * 2.2 + m(room.ceilingHeight), centre.z - radius * 0.75);
    this.sun.target.position.set(centre.x, 0, centre.z);
    this.fill.position.set(centre.x + radius, radius * 1.2, centre.z + radius);
    this.fill.target.position.set(centre.x, 0, centre.z);
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -radius;
    shadowCamera.right = radius;
    shadowCamera.top = radius;
    shadowCamera.bottom = -radius;
    shadowCamera.near = 0.1;
    shadowCamera.far = radius * 6 + m(room.ceilingHeight) + 10;
    shadowCamera.updateProjectionMatrix();
    const size = this.options.touch ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      this.sun.shadow.mapSize.set(size, size);
    }
    // Soft, light architectural shadows: a wide PCF filter for blurred edges, and only partly
    // dark so the floor and furniture never turn black. (Variance shadow maps were softer but
    // stalled some GPUs on first use, so they aren't used.)
    this.renderer.shadowMap.type = PCFShadowMap;
    this.sun.shadow.bias = -0.0003;
    // Offsetting along the surface normal prevents "shadow acne" stripes on faces turned away from the light.
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = this.quality === 'high' ? 6 : 4;
    this.sun.shadow.intensity = 0.6;
    if (enabled !== this.shadowsOn) {
      this.shadowsOn = enabled;
      this.renderer.shadowMap.enabled = enabled;
      this.sun.castShadow = enabled;
      // Turning shadows on or off needs every material's shader recompiled.
      this.scene.traverse((o) => {
        if (o instanceof Mesh && o.material instanceof MeshStandardMaterial) o.material.needsUpdate = true;
      });
    }
    // Zoom limits follow the room's size.
    this.controls.minDistance = 0.4;
    this.controls.maxDistance = radius * 5 + 5;
  }

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------

  private presetPose(preset: CameraPreset, room: RoomModel): { position: Vector3; target: Vector3 } {
    const { minX, minY, maxX, maxY } = room.bounds;
    const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const height = room.ceilingHeight;
    if (preset === 'eye') {
      // Standing inside the room near its front (the plan's bottom edge) at eye height, looking
      // across it. In L- and U-shaped rooms the middle of the front may be outside, so step back
      // towards the centre until the spot is on the floor.
      const eyeHeight = Math.min(160, height - 10);
      const standing = [0.12, 0.2, 0.3, 0.4, 0.5]
        .map((t) => ({ x: centre.x, y: maxY - (maxY - minY) * t }))
        .concat(room.floor.map((corner) => ({ x: (corner.x * 3 + centre.x) / 4, y: (corner.y * 3 + centre.y) / 4 })))
        .find((p) => pointInPolygon(p, room.floor)) ?? centre;
      const eye = toScene(standing, eyeHeight);
      // Looking almost level, as a person standing in the room would.
      const target = toScene(centre, eyeHeight * 0.8);
      return { position: new Vector3(eye.x, eye.y, eye.z), target: new Vector3(target.x, target.y, target.z) };
    }
    const target = toScene(centre, preset === 'top' ? 0 : height * 0.3);
    const radius = m(Math.hypot(maxX - minX, maxY - minY, height) / 2);
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const distance = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * (preset === 'top' ? 0.92 : 1.02);
    // Top-down looks straight down with the plan's top edge at the top of the screen.
    const spherical = preset === 'top' ? new Spherical(distance, 0.0001, 0) : new Spherical(distance, (55 * Math.PI) / 180, Math.PI / 4);
    const offset = new Vector3().setFromSpherical(spherical);
    return { position: new Vector3(target.x, target.y, target.z).add(offset), target: new Vector3(target.x, target.y, target.z) };
  }

  /** Smoothly moves the camera; any touch or drag interrupts it immediately. */
  private animateTo(position: Vector3, target: Vector3) {
    this.cancelTransition();
    const fromPosition = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    // Interpolate around the target (not through it), so the camera swings rather than dives.
    const fromOffset = new Spherical().setFromVector3(fromPosition.clone().sub(fromTarget));
    const toOffset = new Spherical().setFromVector3(position.clone().sub(target));
    let deltaTheta = toOffset.theta - fromOffset.theta;
    if (deltaTheta > Math.PI) deltaTheta -= 2 * Math.PI;
    if (deltaTheta < -Math.PI) deltaTheta += 2 * Math.PI;
    const started = performance.now();
    const step = () => {
      const t = Math.min(1, (performance.now() - started) / TRANSITION_MS);
      const k = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      const s = new Spherical(
        fromOffset.radius + (toOffset.radius - fromOffset.radius) * k,
        fromOffset.phi + (toOffset.phi - fromOffset.phi) * k,
        fromOffset.theta + deltaTheta * k,
      );
      this.controls.target.lerpVectors(fromTarget, target, k);
      this.camera.position.copy(this.controls.target).add(new Vector3().setFromSpherical(s));
      this.controls.update();
      if (t < 1) this.transition = { frame: requestAnimationFrame(step) };
      else this.transition = null;
    };
    this.transition = { frame: requestAnimationFrame(step) };
  }

  private cancelTransition = () => {
    if (this.transition) cancelAnimationFrame(this.transition.frame);
    this.transition = null;
  };

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private onControlsChange = () => {
    this.updateWallVisibility();
    this.requestRender();
  };

  private requestRender() {
    if (this.frameRequest || this.disposed) return;
    this.frameRequest = requestAnimationFrame(() => {
      this.frameRequest = 0;
      const started = performance.now();
      this.renderer.render(this.scene, this.camera);
      this.lastFrameMs = performance.now() - started;
      this.framesRendered++;
    });
  }

  private resize() {
    const canvas = this.renderer.domElement;
    const parent = canvas.parentElement;
    if (!parent) return;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO[this.quality], Math.sqrt(MAX_BUFFER_PIXELS[this.quality] / (width * height)));
    this.renderer.setPixelRatio(Math.max(1, ratio));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /** Dollhouse: hide outer walls between the camera and the room (purely visual). */
  private updateWallVisibility() {
    const eye = { x: this.camera.position.x * CM_PER_SCENE_UNIT, y: this.camera.position.z * CM_PER_SCENE_UNIT };
    if (this.ceiling && this.room) {
      // Only from inside the room and below the ceiling (eye level, a matched photo view);
      // never in top-down, isometric or dollhouse views, where it would hide the room.
      const height = this.camera.position.y * CM_PER_SCENE_UNIT;
      this.ceiling.visible = this.ceilingOn && height < this.room.ceilingHeight - 2 && pointInPolygon(eye, this.room.floor);
      // The shade along the ceiling's edges shows only with the ceiling.
      for (const wall of this.wallGroups) for (const child of wall.group.children) if (child.userData.ceiling) child.visible = this.ceiling.visible;
      const daylight = this.ceiling.visible ? INDOOR_DAYLIGHT : 1;
      this.sun.intensity = 1.9 * daylight;
      this.hemisphere.intensity = 1.55 * daylight;
      this.ambient.intensity = 0.3 * daylight;
    }
    const lookingDown = this.camera.position.clone().sub(this.controls.target).normalize().y > 0.97;
    for (const wall of this.wallGroups) {
      if (this.wallMode === 'all' || !wall.outer || lookingDown) {
        wall.group.visible = true;
        continue;
      }
      const toEye = { x: eye.x - wall.centre.x, y: eye.y - wall.centre.y };
      const length = Math.hypot(toEye.x, toEye.y) || 1;
      // Hide walls whose outside faces the camera.
      wall.group.visible = (wall.outward.x * toEye.x + wall.outward.y * toEye.y) / length < 0.2;
    }
  }

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  private onPointerDown = (e: PointerEvent) => {
    this.activePointers.add(e.pointerId);
    // Only a lone primary press can be a tap: a second finger means pinch or pan, and the
    // right mouse button pans.
    this.tap = this.activePointers.size === 1 && e.isPrimary && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY, time: performance.now() } : null;
  };

  private onPointerCancel = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    this.tap = null;
  };

  /** A tap or click (not a drag) selects the furniture under the pointer, or clears the selection. */
  private onPointerUp = (e: PointerEvent) => {
    this.activePointers.delete(e.pointerId);
    const down = this.tap;
    this.tap = null;
    if (!down || down.id !== e.pointerId || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.time > 600) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const pointer = new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(pointer, this.camera);
    const targets: Object3D[] = this.furniture.hitTargets();
    for (const wall of this.wallGroups) if (wall.group.visible) targets.push(...wall.group.children.filter((c) => c.userData.blocksSelection));
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    const id = hit ? this.furniture.ownerOf(hit) : null;
    this.options.onSelect(id ?? null);
  };

  private onContextLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(this.frameRequest);
    this.frameRequest = 0;
    this.options.onContextLost();
  };
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/** All materials for one model, so they can be disposed together. */
class MaterialSet {
  readonly wall: MeshStandardMaterial;
  readonly shaft: MeshStandardMaterial;
  readonly stairs = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 });
  readonly ceiling = new MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.95, side: BackSide });
  /** What a doorway looks onto: a dim, neutral surface (the next room isn't modelled). */
  readonly beyond = new MeshStandardMaterial({ color: 0x5b5e63, roughness: 1 });
  /** Soft contact darkening along the floor and ceiling edges. */
  readonly edgeShade = new MeshBasicMaterial({ map: edgeShadeTexture(), color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false });
  private trimMaterial: MeshStandardMaterial | null = null;

  /** Painted trim (satin, like woodwork). */
  trim(color: string): MeshStandardMaterial {
    this.trimMaterial ??= new MeshStandardMaterial({ color, roughness: 0.45 });
    return this.trimMaterial;
  }
  readonly fixture = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  private readonly openings: Record<OpeningMaterial | 'fixture', MeshStandardMaterial>;
  private floorMaterial: MeshStandardMaterial | null = null;
  private texture: Texture | null = null;

  /** Walls with their own colour or photo texture (Match My Room), by look. */
  private readonly looks = new Map<string, MeshStandardMaterial>();
  private readonly photos: Texture[] = [];
  private disposed = false;

  constructor(
    wallColor: string,
    private readonly onChange: () => void = () => {},
  ) {
    this.wall = new MeshStandardMaterial({ color: wallColor, roughness: 0.92 });
    this.shaft = new MeshStandardMaterial({ color: wallColor, roughness: 0.95, side: DoubleSide });
    this.openings = {
      frame: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
      door: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }),
      glass: new MeshStandardMaterial({ color: 0xbcd7e6, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false }),
      fixture: new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
    };
  }

  opening(material: OpeningMaterial | 'fixture') {
    return this.openings[material];
  }

  /** A wall's material: the shared one, or its own colour and photo texture. */
  wallLook(color: string, texture?: PhotoTexture): MeshStandardMaterial {
    if (!texture && color.toLowerCase() === `#${this.wall.color.getHexString()}`) return this.wall;
    const key = `${color}|${texture?.assetId ?? ''}|${texture?.widthCm ?? ''}|${texture?.heightCm ?? ''}|${texture?.roughness ?? ''}`;
    const hit = this.looks.get(key);
    if (hit) return hit;
    const material = new MeshStandardMaterial({ color, roughness: texture?.roughness ?? 0.92 });
    this.looks.set(key, material);
    if (texture) this.applyPhoto(material, texture);
    return material;
  }

  /** Loads a photo texture from this device's storage and shows it once ready (UVs are in metres). */
  private applyPhoto(material: MeshStandardMaterial, texture: PhotoTexture) {
    void loadAssetImage(texture.assetId).then((image) => {
      if (!image || this.disposed) return;
      const map = new Texture(image);
      map.wrapS = map.wrapT = RepeatWrapping;
      map.colorSpace = SRGBColorSpace;
      map.anisotropy = 4;
      map.repeat.set(100 / texture.widthCm, 100 / texture.heightCm);
      map.needsUpdate = true;
      this.photos.push(map);
      material.map = map;
      material.color.set('#ffffff');
      material.needsUpdate = true;
      this.onChange();
    });
  }

  floor(style: RoomModel['floorStyle']): MeshStandardMaterial {
    if (style.photo) {
      // A photo of the real floor, repeating at its real size (floor UVs are in metres for photos).
      this.floorMaterial = new MeshStandardMaterial({ color: style.color, roughness: style.photo.roughness ?? 0.6 });
      this.applyPhoto(this.floorMaterial, style.photo);
      return this.floorMaterial;
    }
    const tile = floorTexture(style);
    if (tile) {
      // The 2D plan's own procedural tile, so 3D floors match the plan exactly.
      const texture = new CanvasTexture(tile.image);
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      texture.colorSpace = SRGBColorSpace;
      texture.flipY = false;
      texture.anisotropy = 4;
      this.texture = texture;
    }
    this.floorMaterial = new MeshStandardMaterial({ color: tile ? 0xffffff : style.color, map: this.texture, roughness: style.preset === 'tile' ? 0.42 : 0.85 });
    return this.floorMaterial;
  }

  dispose() {
    this.disposed = true;
    for (const material of [this.wall, this.shaft, this.stairs, this.fixture, this.ceiling, this.trimMaterial, this.beyond, ...Object.values(this.openings), this.floorMaterial, ...this.looks.values()]) material?.dispose();
    this.texture?.dispose();
    for (const photo of this.photos) photo.dispose();
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const UP = new Vector3(0, 1, 0);

/** A soft strip of shade along a wall's room-side edge, on the floor (or under the ceiling). */
function edgeShade(a: Point, b: Point, inward: Point, height: number, ceiling: boolean, material: MeshBasicMaterial): Mesh {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const depth = 28;
  const mid = { x: (a.x + b.x) / 2 + inward.x * (depth / 2), y: (a.y + b.y) / 2 + inward.y * (depth / 2) };
  const plane = new Mesh(new PlaneGeometry(m(length), m(depth)), material);
  const at = toScene(mid, height);
  plane.position.set(at.x, at.y, at.z);
  // Lie flat, then turn so the dark edge (the texture's top) is against the wall.
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  plane.rotation.set(ceiling ? Math.PI / 2 : -Math.PI / 2, 0, 0);
  plane.rotateOnWorldAxis(UP, -angle);
  if (ceiling) plane.rotateOnWorldAxis(UP, Math.PI);
  plane.renderOrder = -1;
  plane.name = 'edge-shade';
  return plane;
}

let edgeTexture: CanvasTexture | null = null;

/** Dark along one long edge, fading to nothing (shared by every strip). */
function edgeShadeTexture(): CanvasTexture {
  if (edgeTexture) return edgeTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 64);
  edgeTexture = new CanvasTexture(canvas);
  return edgeTexture;
}

/** Position, turn and size a unit shape to fill a block (or cylinder). */
function blockMatrix(b: Block | Cylinder): Matrix4 {
  const isBlock = 'width' in b;
  const width = isBlock ? b.width : b.radius * 2;
  const depth = isBlock ? b.depth : b.radius * 2;
  const rotation = isBlock ? b.rotation : 0;
  const centre = toScene(b, b.z + b.height / 2);
  // Plan rotations are clockwise on screen (y down); around Three's y axis that's negative.
  const turn = new Quaternion().setFromAxisAngle(UP, (-rotation * Math.PI) / 180);
  return new Matrix4().compose(new Vector3(centre.x, centre.y, centre.z), turn, new Vector3(m(width), m(Math.max(b.height, 0.01)), m(depth)));
}

function instanced(geometry: BufferGeometry, items: (Block | Cylinder)[], material: MeshStandardMaterial, castShadow: boolean): InstancedMesh {
  const mesh = new InstancedMesh(geometry, material, items.length);
  items.forEach((item, i) => {
    mesh.setMatrixAt(i, blockMatrix(item));
    mesh.setColorAt(i, new Color(item.color));
  });
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

/** Many blocks merged into one geometry (one draw call per wall and material). */
function mergedBlocks(unit: BoxGeometry, blocks: Block[]): BufferGeometry {
  const pieces = blocks.map((b) => unit.clone().applyMatrix4(blockMatrix(b)));
  const merged = mergeGeometries(pieces, false) ?? new BufferGeometry();
  for (const piece of pieces) piece.dispose();
  // The colour comes from the material; a vertex colour attribute isn't needed.
  return merged;
}

/** Collects triangles, turning each one to face `towards` (flat shading, so no shared vertices). */
class TriangleSink {
  readonly positions: number[] = [];

  add(a: Vector3, b: Vector3, c: Vector3, towards: Vector3) {
    const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    const [p, q, r] = normal.dot(towards) >= 0 ? [a, b, c] : [a, c, b];
    this.positions.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, towards: Vector3) {
    this.add(a, b, c, towards);
    this.add(a, c, d, towards);
  }

  geometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.computeVertexNormals();
    return geometry;
  }
}

const v3 = (p: Point, height: number) => {
  const s = toScene(p, height);
  return new Vector3(s.x, s.y, s.z);
};

/** The walls of a stairwell going down through the floor, facing into the hole. */
function shaftGeometry(holes: FloorHole[]): BufferGeometry {
  const sink = new TriangleSink();
  for (const { points: hole, depth } of holes) {
    const centre = hole.reduce((c, p) => ({ x: c.x + p.x / hole.length, y: c.y + p.y / hole.length }), { x: 0, y: 0 });
    hole.forEach((a, i) => {
      const b = hole[(i + 1) % hole.length];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const inward = new Vector3(centre.x - mid.x, 0, centre.y - mid.y);
      sink.quad(v3(a, 0), v3(b, 0), v3(b, -depth), v3(a, -depth), inward);
    });
  }
  return sink.geometry();
}

/**
 * One solid wall with its door and window openings cut out. Each face is a single
 * polygon with holes, so there are no seams where a wall meets the parts above and
 * below an opening.
 */
function wallGeometry(wall: SceneWall): BufferGeometry {
  const sink = new TriangleSink();
  const [p0, p1, p2, p3] = wall.footprint;
  const d = wall.direction;
  const along = (p: Point) => (p.x - wall.origin.x) * d.x + (p.y - wall.origin.y) * d.y;
  // A point on face A (p0 → p1) or face B (p3 → p2) at distance `s` along the wall.
  const onFace = (base: Point, s: number): Point => {
    const k = s - along(base);
    return { x: base.x + d.x * k, y: base.y + d.y * k };
  };
  const faceA = (s: number) => onFace(p0, s);
  const faceB = (s: number) => onFace(p3, s);
  const towardsA = new Vector3(p0.x - p3.x, 0, p0.y - p3.y);
  const towardsB = towardsA.clone().negate();
  const height = wall.height;
  const start = Math.min(along(p0), along(p3));
  const end = Math.max(along(p1), along(p2));
  const holes = wall.holes
    .map((h) => ({ start: Math.max(h.start, start), end: Math.min(h.end, end), bottom: Math.max(0, h.bottom), top: Math.min(height, h.top) }))
    .filter((h) => h.end - h.start > 0.01 && h.top - h.bottom > 0.01)
    .sort((a, b) => a.start - b.start);

  // Both large faces.
  for (const [base, toFace, towards] of [
    [p0, faceA, towardsA],
    [p3, faceB, towardsB],
  ] as const) {
    const faceEnd = along(base === p0 ? p1 : p2);
    for (const shape of faceShapes(along(base), faceEnd, height, holes)) {
      const points = [...shape.contour, ...shape.holes.flat()];
      const triangles = ShapeUtils.triangulateShape(
        shape.contour.map(([u, v]) => new Vector2(u, v)),
        shape.holes.map((hole) => hole.map(([u, v]) => new Vector2(u, v))),
      );
      for (const [i, j, k] of triangles) {
        const [a, b, c] = [points[i], points[j], points[k]].map(([u, v]) => v3(toFace(u), v));
        sink.add(a, b, c, towards);
      }
    }
  }

  // Inside each opening: the sides, the underside of the head and the top of the sill.
  const up = new Vector3(0, 1, 0);
  const along3 = new Vector3(d.x, 0, d.y);
  for (const h of holes) {
    sink.quad(v3(faceA(h.start), h.bottom), v3(faceB(h.start), h.bottom), v3(faceB(h.start), h.top), v3(faceA(h.start), h.top), along3);
    sink.quad(v3(faceA(h.end), h.bottom), v3(faceB(h.end), h.bottom), v3(faceB(h.end), h.top), v3(faceA(h.end), h.top), along3.clone().negate());
    if (h.top < height) sink.quad(v3(faceA(h.start), h.top), v3(faceA(h.end), h.top), v3(faceB(h.end), h.top), v3(faceB(h.start), h.top), up.clone().negate());
    if (h.bottom > 0) sink.quad(v3(faceA(h.start), h.bottom), v3(faceA(h.end), h.bottom), v3(faceB(h.end), h.bottom), v3(faceB(h.start), h.bottom), up);
  }

  // The top, split wherever an opening reaches the ceiling. The ends keep their mitered corners.
  let cursor: number | null = null;
  const topPiece = (from: number | null, to: number | null) => {
    const corners = [from === null ? p0 : faceA(from), to === null ? p1 : faceA(to), to === null ? p2 : faceB(to), from === null ? p3 : faceB(from)];
    sink.quad(v3(corners[0], height), v3(corners[1], height), v3(corners[2], height), v3(corners[3], height), up);
  };
  for (const h of holes.filter((h) => h.top >= height - 0.01)) {
    topPiece(cursor, h.start);
    cursor = h.end;
  }
  topPiece(cursor, null);

  // Free ends of interior walls (outer walls join their neighbours, so their ends are hidden).
  if (!wall.outer) {
    sink.quad(v3(p0, 0), v3(p3, 0), v3(p3, height), v3(p0, height), along3.clone().negate());
    sink.quad(v3(p1, 0), v3(p2, 0), v3(p2, height), v3(p1, height), along3);
  }
  const geometry = sink.geometry();
  // Texture coordinates in metres: along the wall and up it, so photo textures keep their real size.
  const pos = geometry.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) * d.x + pos.getZ(i) * d.y;
    uv[i * 2 + 1] = pos.getY(i);
  }
  geometry.setAttribute('uv', new BufferAttribute(uv, 2));
  return geometry;
}

/** The floor polygon (with holes), facing up, with texture coordinates in real centimetres. */
function floorGeometry(outline: Polygon, holes: Polygon[], style: RoomModel['floorStyle']): BufferGeometry {
  const all = [outline, ...holes];
  const flat = all.flat();
  const triangles = ShapeUtils.triangulateShape(
    outline.map((p) => new Vector2(p.x, p.y)),
    holes.map((h) => h.map((p) => new Vector2(p.x, p.y))),
  );
  // Photo floors repeat by metres (the texture's own repeat sets its real size); patterns by tile.
  const tile = style.photo ? { widthCm: 100, heightCm: 100 } : floorTexture(style);
  // Same mapping as the plan: the pattern is anchored at the room origin and rotated by `angle`.
  const rad = (-style.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const [i, j, k] of triangles) {
    const tri = [flat[i], flat[j], flat[k]];
    // A clockwise-on-screen triangle faces down in Three's coordinates; flip those to face up.
    for (const p of signedArea2(tri) > 0 ? [tri[0], tri[2], tri[1]] : tri) {
      const s = toScene(p);
      positions.push(s.x, 0, s.z);
      if (tile) uvs.push((p.x * cos - p.y * sin) / tile.widthCm, (p.x * sin + p.y * cos) / tile.heightCm);
      else uvs.push(0, 0);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.computeVertexNormals();
  return geometry;
}
