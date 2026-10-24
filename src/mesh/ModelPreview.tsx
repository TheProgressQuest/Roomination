import { useEffect, useRef } from 'react';
import { AmbientLight, ArrowHelper, Box3, Box3Helper, Color, DirectionalLight, GridHelper, Group, HemisphereLight, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer, type Object3D } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { turnedBox, turnQuaternion } from './loadModel';
import type { MeshModel } from '../model/types';

/**
 * A small 3D preview of a model being imported: turned as chosen, standing on a floor grid,
 * with its box and an arrow showing which way is its front. Drag to look around.
 */
export function ModelPreview({ root, turn }: { root: Object3D; turn: MeshModel['turn'] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<{ renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera; controls: OrbitControls; holder: Group; frame: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      return;
    }
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new Scene();
    scene.add(new HemisphereLight(0xffffff, 0x8a8478, 1.6), new AmbientLight(0xffffff, 0.35));
    const sun = new DirectionalLight(0xffffff, 1.8);
    sun.position.set(2, 4, 3);
    scene.add(sun);
    const camera = new PerspectiveCamera(35, 1, 0.01, 100);
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    const holder = new Group();
    scene.add(holder);
    const state = { renderer, scene, camera, controls, holder, frame: 0 };
    view.current = state;
    const resize = () => {
      const w = canvas.clientWidth || 320;
      const h = canvas.clientHeight || 240;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    const tick = () => {
      controls.update();
      renderer.render(scene, camera);
      state.frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(state.frame);
      observer.disconnect();
      controls.dispose();
      // The model's own geometry and textures belong to the import (and may still be saved).
      holder.clear();
      renderer.dispose();
      view.current = null;
    };
  }, []);

  // Show the model turned as chosen, standing on the grid, centred.
  useEffect(() => {
    const state = view.current;
    if (!state) return;
    const { holder, camera, controls, scene } = state;
    holder.clear();
    for (const helper of scene.children.filter((c) => c.userData.helper)) scene.remove(helper);
    const box = turnedBox(root, turn);
    const size = box.getSize(new Vector3());
    const centre = box.getCenter(new Vector3());
    const turned = new Group();
    turned.quaternion.copy(turnQuaternion(turn));
    turned.add(root);
    // Normalised to about one unit, so tiny and huge models both fill the preview.
    const scale = 1 / Math.max(size.x, size.y, size.z, 1e-6);
    holder.scale.setScalar(scale);
    holder.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
    holder.add(turned);
    const s = new Vector3(size.x, size.y, size.z).multiplyScalar(scale);
    const outline = new Box3Helper(new Box3(new Vector3(-s.x / 2, 0, -s.z / 2), new Vector3(s.x / 2, s.y, s.z / 2)), new Color('#1f2bd6'));
    const grid = new GridHelper(2, 20, 0x9aa0ad, 0xd3d6dd);
    const front = new ArrowHelper(new Vector3(0, 0, 1), new Vector3(0, 0.01, s.z / 2), 0.35, 0x1f2bd6, 0.1, 0.07);
    for (const helper of [outline, grid, front]) {
      helper.userData.helper = true;
      scene.add(helper);
    }
    camera.position.set(1.1, 0.8 + s.y * 0.4, 1.6);
    controls.target.set(0, s.y / 2, 0);
    controls.update();
    return () => {
      turned.remove(root);
    };
  }, [root, turn.x, turn.y, turn.z]);

  return <canvas ref={canvasRef} className="model-preview" aria-label="Preview of the 3D model. Drag to look around; the arrow shows its front." />;
}
