import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
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
  WebGLRenderer,
  type Material,
  type Texture,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { pointInPolygon, signedArea2, type Polygon } from '../../model/polygon';
import type { Point } from '../../model/types';
import { floorTexture } from '../../render/textures';
import type { CameraPreset, WallMode } from '../../state/preferences';
import { CM_PER_SCENE_UNIT, toScene, type Block, type Cylinder, type OpeningMaterial, type FloorHole, type RoomModel, type SceneFurniture, type SceneWall } from '../model';
import type { ViewerStats } from '../diagnostics';
import { faceShapes } from '../wallFaces';

/**
 * Draws a SceneModel with Three.js. Everything here is presentation: the project is
 * never read or changed directly, and every object can be rebuilt from the model.
 *
 * Rendering happens only on demand (camera moved, model changed, canvas resized), so an
 * idle 3D view costs nothing. Call `dispose()` to free every GPU resource.
 */

export interface ViewerOptions {
  shadows: boolean;
  reducedMotion: boolean;
  /** Touch devices get smaller shadow maps. */
  touch: boolean;
  /** The camera angle to start from once the first model arrives. */
  initialPreset: CameraPreset;
  onSelect: (id: string | null) => void;
  onContextLost: () => void;
}


/** Drawing-buffer budget: keeps memory sensible on large, high-density screens. */
const MAX_BUFFER_PIXELS = 4_000_000;
const MAX_PIXEL_RATIO = 2;
const TRANSITION_MS = 450;
/** Scenes with more parts than this skip shadows on touch devices. */
const TOUCH_SHADOW_PART_LIMIT = 400;
const HIGHLIGHT = new Color('#d9643a');

const m = (cm: number) => cm / CM_PER_SCENE_UNIT;

export class RoomViewer {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(45, 1, 0.05, 400);
  private readonly controls: OrbitControls;
  private readonly sun = new DirectionalLight(0xffffff, 1.7);
  private readonly hemisphere = new HemisphereLight(0xffffff, 0xd8cbb8, 1.4);
  private readonly ambient = new AmbientLight(0xffffff, 0.35);
  private readonly unitBox = new BoxGeometry(1, 1, 1);
  private readonly unitCylinder = new CylinderGeometry(0.5, 0.5, 1, 24);
  private readonly resizeObserver: ResizeObserver;
  private readonly raycaster = new Raycaster();
  private readonly options: ViewerOptions;

  /** Walls, floor, stairs and fixtures: rebuilt (and disposed) whenever the room changes. */
  private roomContent = new Group();
  private roomMaterials: MaterialSet | null = null;
  /** One material for every piece of furniture (colours are per instance), kept for the viewer's lifetime. */
  private readonly furnitureMaterial = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  private wallGroups: { group: Group; outer: boolean; outward: Point; centre: Point }[] = [];
  private furnitureMesh: InstancedMesh | null = null;
  /** Instance index → furniture id, and each piece's instance range and base colours. */
  private instanceOwner: string[] = [];
  private pieces = new Map<string, { start: number; count: number; colors: Color[]; footprint: SceneFurniture }>();
  private furniturePartCount = 0;
  private outline: LineSegments | null = null;
  private room: RoomModel | null = null;
  /** Whether shadows are currently drawn (null until the first room arrives). */
  private shadowsOn: boolean | null = null;
  private selectedId: string | null = null;
  private wallMode: WallMode = 'dollhouse';
  private shadows: boolean;

  private frameRequest = 0;
  private transition: { frame: number } | null = null;
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
    // Throws if WebGL isn't available; the caller shows a fallback message.
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'default' });
    this.renderer.outputColorSpace = SRGBColorSpace;
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
    this.scene.add(this.hemisphere, this.ambient, this.sun, this.sun.target, this.roomContent);

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
    this.requestRender();
  }

  /** Replaces the furniture only (moving or recolouring a piece leaves the room untouched). */
  setFurniture(furniture: SceneFurniture[]) {
    const started = performance.now();
    this.clearFurniture();
    this.buildFurniture(furniture);
    this.applySelection();
    this.updateShadows();
    this.furnitureBuildMs = performance.now() - started;
    this.requestRender();
  }

  setSelection(id: string | null) {
    this.selectedId = id;
    this.applySelection();
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

  stats(): ViewerStats {
    const info = this.renderer.info;
    return {
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

  /** Where a piece's centre appears on screen (CSS px relative to the canvas), or null. */
  pointOnScreen(id: string): { x: number; y: number } | null {
    const piece = this.pieces.get(id);
    return piece ? this.projectPoint(piece.footprint, piece.footprint.height / 2) : null;
  }

  /** Where a plan point (cm) at a height (cm) appears on screen, in CSS px relative to the canvas. */
  projectPoint(p: Point, height = 0): { x: number; y: number } {
    const s = toScene(p, height);
    const v = new Vector3(s.x, s.y, s.z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height };
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
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.controls.removeEventListener('change', this.onControlsChange);
    this.controls.removeEventListener('start', this.cancelTransition);
    this.controls.dispose();
    this.clearRoom();
    this.clearFurniture();
    this.furnitureMaterial.dispose();
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
    const materials = new MaterialSet(room.wallColor);
    this.roomMaterials = materials;

    // Floor, with holes where stairs go down.
    const floor = new Mesh(floorGeometry(room.floor, room.floorHoles.map((h) => h.points), room.floorStyle), materials.floor(room.floorStyle));
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.roomContent.add(floor);
    if (room.floorHoles.length > 0) {
      const shaft = new Mesh(shaftGeometry(room.floorHoles), materials.shaft);
      shaft.receiveShadow = true;
      this.roomContent.add(shaft);
    }

    // Walls: one group per wall so the dollhouse view can hide it with everything set into it.
    this.wallGroups = room.walls.map((wall) => {
      const group = new Group();
      group.name = `wall:${wall.wallId}`;
      const mesh = new Mesh(wallGeometry(wall), materials.wall);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.blocksSelection = true;
      group.add(mesh);
      const byMaterial = new Map<OpeningMaterial | 'fixture', Block[]>();
      for (const { material, block } of wall.openings) byMaterial.set(material, [...(byMaterial.get(material) ?? []), block]);
      if (wall.fixtures.length > 0) byMaterial.set('fixture', wall.fixtures);
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

  /** Every part of every piece in one instanced mesh (one draw call). */
  private buildFurniture(furniture: SceneFurniture[]) {
    this.instanceOwner = [];
    this.pieces.clear();
    this.furniturePartCount = furniture.reduce((sum, f) => sum + f.parts.length, 0);
    if (this.furniturePartCount === 0) return;
    const mesh = new InstancedMesh(this.unitBox, this.furnitureMaterial, this.furniturePartCount);
    let index = 0;
    for (const piece of furniture) {
      const colors: Color[] = [];
      piece.parts.forEach((part) => {
        mesh.setMatrixAt(index + colors.length, blockMatrix(part));
        const color = new Color(part.color);
        mesh.setColorAt(index + colors.length, color);
        colors.push(color);
        this.instanceOwner.push(piece.id);
      });
      this.pieces.set(piece.id, { start: index, count: colors.length, colors, footprint: piece });
      index += colors.length;
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.name = 'furniture';
    this.furnitureMesh = mesh;
    this.scene.add(mesh);
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

  private clearFurniture() {
    this.cancelOutline();
    if (!this.furnitureMesh) return;
    this.scene.remove(this.furnitureMesh);
    this.furnitureMesh.dispose();
    this.furnitureMesh = null;
  }

  private applySelection() {
    const mesh = this.furnitureMesh;
    if (!mesh) return;
    for (const [id, piece] of this.pieces) {
      const selected = id === this.selectedId;
      piece.colors.forEach((color, i) => mesh.setColorAt(piece.start + i, selected ? color.clone().lerp(HIGHLIGHT, 0.35) : color));
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this.cancelOutline();
    const piece = this.selectedId ? this.pieces.get(this.selectedId) : undefined;
    if (!piece) return;
    const f = piece.footprint;
    const edges = new EdgesGeometry(this.unitBox);
    const outline = new LineSegments(edges, new LineBasicMaterial({ color: HIGHLIGHT, depthTest: false, transparent: true, opacity: 0.9 }));
    outline.renderOrder = 10;
    outline.applyMatrix4(blockMatrix({ ...f, z: 0, height: Math.max(f.height, 1), width: f.width + 2, depth: f.depth + 2, color: '' }));
    this.outline = outline;
    this.scene.add(outline);
  }

  private cancelOutline() {
    if (!this.outline) return;
    this.scene.remove(this.outline);
    this.outline.geometry.dispose();
    (this.outline.material as Material).dispose();
    this.outline = null;
  }

  /** Points the sun at the room and turns shadows on or off (limited on touch devices). */
  private updateShadows() {
    const room = this.room;
    if (!room) return;
    const enabled = this.shadows && !(this.options.touch && this.furniturePartCount > TOUCH_SHADOW_PART_LIMIT);
    const { minX, minY, maxX, maxY } = room.bounds;
    const centre = toScene({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
    const radius = m(Math.hypot(maxX - minX, maxY - minY) / 2) + 0.5;
    // Light from above and slightly in front-left, like a window on a bright day.
    this.sun.position.set(centre.x - radius * 0.6, radius * 2 + m(room.ceilingHeight), centre.z + radius * 0.9);
    this.sun.target.position.set(centre.x, 0, centre.z);
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
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
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
      this.renderer.render(this.scene, this.camera);
      this.framesRendered++;
    });
  }

  private resize() {
    const canvas = this.renderer.domElement;
    const parent = canvas.parentElement;
    if (!parent) return;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO, Math.sqrt(MAX_BUFFER_PIXELS / (width * height)));
    this.renderer.setPixelRatio(Math.max(1, ratio));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  /** Dollhouse: hide outer walls between the camera and the room (purely visual). */
  private updateWallVisibility() {
    const eye = { x: this.camera.position.x * CM_PER_SCENE_UNIT, y: this.camera.position.z * CM_PER_SCENE_UNIT };
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
    const targets: Object3D[] = [];
    if (this.furnitureMesh) targets.push(this.furnitureMesh);
    for (const wall of this.wallGroups) if (wall.group.visible) targets.push(...wall.group.children.filter((c) => c.userData.blocksSelection));
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    const id = hit && hit.object === this.furnitureMesh && hit.instanceId !== undefined ? this.instanceOwner[hit.instanceId] : null;
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
  readonly fixture = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  private readonly openings: Record<OpeningMaterial | 'fixture', MeshStandardMaterial>;
  private floorMaterial: MeshStandardMaterial | null = null;
  private texture: Texture | null = null;

  constructor(wallColor: string) {
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

  floor(style: RoomModel['floorStyle']): MeshStandardMaterial {
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
    this.floorMaterial = new MeshStandardMaterial({ color: tile ? 0xffffff : style.color, map: this.texture, roughness: style.preset === 'tile' ? 0.55 : 0.85 });
    return this.floorMaterial;
  }

  dispose() {
    for (const material of [this.wall, this.shaft, this.stairs, this.fixture, ...Object.values(this.openings), this.floorMaterial]) material?.dispose();
    this.texture?.dispose();
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const UP = new Vector3(0, 1, 0);

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
  return sink.geometry();
}

/** The floor polygon (with holes), facing up, with texture coordinates in real centimetres. */
function floorGeometry(outline: Polygon, holes: Polygon[], style: RoomModel['floorStyle']): BufferGeometry {
  const all = [outline, ...holes];
  const flat = all.flat();
  const triangles = ShapeUtils.triangulateShape(
    outline.map((p) => new Vector2(p.x, p.y)),
    holes.map((h) => h.map((p) => new Vector2(p.x, p.y))),
  );
  const tile = floorTexture(style);
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
