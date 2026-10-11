import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SCORE_COLORS = [
  new THREE.Color('#48d9bd'),
  new THREE.Color('#f0bf6d'),
  new THREE.Color('#ff7183'),
];

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
function scoreColor(score) {
  const s = clamp(Number(score ?? 0), 0, 1);
  if (s < 0.5) return SCORE_COLORS[0].clone().lerp(SCORE_COLORS[1], s * 2);
  return SCORE_COLORS[1].clone().lerp(SCORE_COLORS[2], (s - 0.5) * 2);
}
function curve(points) {
  return new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'centripetal', 0.42);
}

function buildHeartGeometry() {
  const rings = 90;
  const segments = 112;
  const positions = [];
  const colors = [];
  const indices = [];
  const deep = new THREE.Color('#713044');
  const mid = new THREE.Color('#a84959');
  const light = new THREE.Color('#cf7b83');

  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    const rawSin = Math.max(0, Math.sin(Math.PI * t));
    const radius = Math.pow(rawSin, 0.53) * (0.83 + 0.19 * t) + 0.58 * Math.pow(smoothstep(0.58, 1, t), 2);
    const y = -1.44 + 2.66 * t;
    for (let j = 0; j <= segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const asym = 1 + 0.085 * Math.sin(a + 0.9) * Math.sin(Math.PI * t) + 0.035 * Math.cos(3 * a - t * 4);
      const x = Math.cos(a) * radius * asym + 0.08 * t + 0.04 * Math.sin(t * Math.PI);
      const anterior = Math.max(0, Math.sin(a));
      const frontBulge = 0.13 * Math.exp(-Math.pow((t - 0.43) / 0.28, 2)) * anterior;
      const z = Math.sin(a) * radius * 0.66 * (0.92 + 0.13 * Math.cos(a)) + frontBulge;
      positions.push(x, y, z);
      const frontLit = (0.5 + 0.5 * Math.sin(a)) * 0.16;
      const vertical = clamp(t * 0.73 + frontLit, 0, 1);
      const c = vertical < 0.7 ? deep.clone().lerp(mid, vertical / 0.7) : mid.clone().lerp(light, (vertical - 0.7) / 0.3);
      colors.push(c.r, c.g, c.b);
    }
  }

  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j;
      const b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

function addSurfaceDetail(root, material) {
  // Subtle myocardial contour ridges. They are visual cues, not a segmentation map.
  const ridgeMaterial = new THREE.MeshStandardMaterial({ color: '#6d2c40', roughness: 0.63, metalness: 0.02, transparent: true, opacity: 0.3 });
  const paths = [
    [[-0.67, 0.30, 0.48], [-0.54, 0.07, 0.61], [-0.40, -0.19, 0.67], [-0.25, -0.44, 0.68]],
    [[0.46, 0.35, 0.55], [0.52, 0.08, 0.61], [0.36, -0.20, 0.69], [0.16, -0.47, 0.66]],
  ];
  paths.forEach(points => {
    const geom = new THREE.TubeGeometry(curve(points), 46, 0.018, 7, false);
    const mesh = new THREE.Mesh(geom, ridgeMaterial);
    mesh.renderOrder = 2;
    root.add(mesh);
  });
}

export class HeartScene {
  constructor(canvas, onSelect = () => {}) {
    this.canvas = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
    if (!this.canvas) throw new Error('Heart canvas not found');
    this.onSelect = onSelect;
    this.scores = {};
    this.selected = 'LAD';
    this.vesselGroups = {};
    this._disposed = false;
    this._pointerStart = null;

    const width = Math.max(this.canvas.clientWidth, 360);
    const height = Math.max(this.canvas.clientHeight, 320);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(33, width / height, 0.1, 80);
    this.camera.position.set(0.06, 0.02, 6.9);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.enablePan = false;
    this.controls.minDistance = 4.25;
    this.controls.maxDistance = 10.5;
    this.controls.rotateSpeed = 0.64;
    this.controls.zoomSpeed = 0.72;
    this.controls.target.set(0.02, -0.06, 0);
    this.controls.update();

    this.scene.add(new THREE.HemisphereLight('#d9f4ff', '#312033', 1.7));
    const key = new THREE.DirectionalLight('#fff0e6', 2.55);
    key.position.set(-3.7, 4.2, 5.1);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight('#749dce', 1.45);
    fill.position.set(4, 1.2, 3.5);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight('#f36f87', 1.8);
    rim.position.set(0.3, 2.4, -4.5);
    this.scene.add(rim);
    const soft = new THREE.PointLight('#49dfc3', 0.7, 9);
    soft.position.set(-2.5, -1.2, 2.2);
    this.scene.add(soft);

    this.addBackdrop();
    this.root = new THREE.Group();
    this.root.rotation.z = -0.095;
    this.root.rotation.y = 0.03;
    this.scene.add(this.root);
    this.buildAnatomy();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement || this.canvas);
    this.resize();
    this.setSelectedVessel('LAD', false);
    this.animate();
  }

  addBackdrop() {
    const ringGroup = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: '#7198bb', transparent: true, opacity: 0.095, side: THREE.DoubleSide, depthWrite: false });
    [1.72, 2.08, 2.45].forEach((r, i) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.006, 120), ringMat.clone());
      ring.rotation.x = 0.2 + i * 0.05;
      ring.position.set(0.05, -0.04, -1.88 - i * 0.05);
      ringGroup.add(ring);
    });
    this.scene.add(ringGroup);

    const starPositions = [];
    for (let i = 0; i < 120; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 2.15 + Math.random() * 2.0;
      starPositions.push(Math.cos(angle) * radius, (Math.random() - 0.5) * 4.8, -1.8 - Math.random() * 0.7);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: '#7fa6c7', size: 0.018, transparent: true, opacity: 0.42, sizeAttenuation: true }));
    this.scene.add(stars);
  }

  buildAnatomy() {
    const myocardium = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.025, clearcoat: 0.32, clearcoatRoughness: 0.48 });
    const body = new THREE.Mesh(buildHeartGeometry(), myocardium);
    body.castShadow = true;
    body.receiveShadow = true;
    this.root.add(body);
    addSurfaceDetail(this.root, myocardium);

    // Great vessels: an anatomical-style schematic, intentionally not a patient-specific scan.
    const aortaMat = new THREE.MeshPhysicalMaterial({ color: '#b75d6f', roughness: 0.33, metalness: 0.04, clearcoat: 0.4 });
    const veinMat = new THREE.MeshPhysicalMaterial({ color: '#557db7', roughness: 0.35, metalness: 0.03, clearcoat: 0.3 });
    const pulmonaryMat = new THREE.MeshPhysicalMaterial({ color: '#617fae', roughness: 0.34, metalness: 0.03, clearcoat: 0.3 });
    this.addStaticTube([[0.02,0.57,0.19],[0.08,0.86,0.17],[0.06,1.13,0.12],[0.00,1.40,0.04],[-0.30,1.53,-0.02],[-0.62,1.48,-0.01],[-0.74,1.25,0.07]], 0.155, aortaMat, 66);
    this.addStaticTube([[0.38,0.48,-0.02],[0.42,0.85,-0.04],[0.43,1.20,-0.10],[0.42,1.48,-0.12]], 0.105, veinMat, 52);
    this.addStaticTube([[0.38,-0.55,-0.06],[0.40,-0.25,-0.07],[0.41,0.09,-0.08],[0.42,0.40,-0.03]], 0.088, veinMat, 42);
    this.addStaticTube([[-0.02,0.62,0.13],[-0.20,0.85,0.16],[-0.46,1.04,0.12],[-0.68,1.13,0.05]], 0.115, pulmonaryMat, 52);
    this.addStaticTube([[-0.23,0.84,0.13],[-0.38,1.03,0.09],[-0.40,1.23,0.02]], 0.075, pulmonaryMat, 32);

    // Left main coronary trunk is neutral; the three scored branches are colored from model outputs.
    const neutral = new THREE.MeshPhysicalMaterial({ color: '#d9b1a9', roughness: 0.28, metalness: 0.04, clearcoat: 0.5 });
    this.addStaticTube([[0.055,0.55,0.725],[-0.015,0.58,0.77],[-0.11,0.51,0.80]], 0.048, neutral, 28);

    this.vesselGroups.LAD = this.makeVessel('LAD', [
      [[-0.09,0.51,0.815],[-0.075,0.31,0.86],[-0.105,0.05,0.86],[-0.11,-0.23,0.79],[-0.15,-0.52,0.70],[-0.19,-0.86,0.52],[-0.22,-1.16,0.32]],
      [[-0.105,0.03,0.858],[0.01,-0.11,0.78],[0.105,-0.25,0.72]],
      [[-0.14,-0.38,0.74],[-0.31,-0.53,0.66],[-0.39,-0.75,0.51]],
      [[-0.18,-0.69,0.62],[-0.04,-0.82,0.56],[0.015,-0.99,0.40]],
    ], 0.026);
    this.vesselGroups.LCX = this.makeVessel('LCX', [
      [[-0.10,0.51,0.82],[-0.31,0.54,0.82],[-0.53,0.44,0.77],[-0.71,0.27,0.64],[-0.70,0.08,0.62],[-0.56,-0.09,0.67]],
      [[-0.49,0.42,0.78],[-0.48,0.57,0.74],[-0.36,0.64,0.66]],
      [[-0.65,0.18,0.65],[-0.49,0.08,0.69],[-0.37,-0.05,0.70]],
    ], 0.024);
    this.vesselGroups.RCA = this.makeVessel('RCA', [
      [[0.11,0.49,0.81],[0.34,0.47,0.78],[0.58,0.32,0.69],[0.68,0.11,0.58],[0.65,-0.12,0.58],[0.48,-0.34,0.67],[0.25,-0.57,0.60]],
      [[0.60,0.22,0.65],[0.73,0.18,0.54],[0.80,0.01,0.44]],
      [[0.48,-0.34,0.67],[0.41,-0.53,0.55],[0.24,-0.68,0.46]],
    ], 0.024);

    // Small vessel origins make clickable branch points feel connected to the great vessels.
    ['LAD','LCX','RCA'].forEach(key => {
      const group = this.vesselGroups[key];
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.052, 18, 18), new THREE.MeshStandardMaterial({ color: '#f3c8ba', roughness: 0.29, metalness: 0.02 }));
      const first = group.children.find(o => o.userData.vessel === key && o.userData.core);
      if (first) {
        const pt = first.userData.origin;
        if (pt) marker.position.copy(pt);
      }
      marker.userData.vessel = key;
      marker.userData.core = true;
      group.add(marker);
    });
  }

  addStaticTube(points, radius, material, tubularSegments = 48) {
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve(points), tubularSegments, radius, 12, false), material);
    mesh.castShadow = true;
    this.root.add(mesh);
    return mesh;
  }

  makeVessel(key, paths, radius) {
    const group = new THREE.Group();
    group.userData.vessel = key;
    group.name = `coronary-${key}`;
    const color = scoreColor(0.35);
    paths.forEach((points, index) => {
      const c = curve(points);
      const r = index === 0 ? radius : radius * 0.67;
      const glowMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.20, depthWrite: false, side: THREE.DoubleSide });
      const coreMaterial = new THREE.MeshPhysicalMaterial({ color, roughness: 0.24, metalness: 0.09, clearcoat: 0.68, clearcoatRoughness: 0.19, emissive: color, emissiveIntensity: 0.11 });
      const glow = new THREE.Mesh(new THREE.TubeGeometry(c, 64, r * 2.15, 10, false), glowMaterial);
      glow.userData.vessel = key;
      glow.userData.glow = true;
      const core = new THREE.Mesh(new THREE.TubeGeometry(c, 64, r, 10, false), coreMaterial);
      core.userData.vessel = key;
      core.userData.core = true;
      core.userData.origin = c.getPoint(0);
      core.castShadow = true;
      group.add(glow, core);
    });
    this.root.add(group);
    this.updateVesselColor(key, null);
    return group;
  }

  updateVesselColor(key, score) {
    const group = this.vesselGroups[key];
    if (!group) return;
    const c = score == null ? new THREE.Color('#7f95aa') : scoreColor(score);
    group.traverse(obj => {
      if (!obj.isMesh) return;
      if (obj.material && obj.material.color && (obj.userData.core || obj.userData.glow)) {
        obj.material.color.copy(c);
        if (obj.material.emissive) obj.material.emissive.copy(c);
        if (obj.userData.glow) obj.material.opacity = score == null ? 0.08 : 0.20;
      }
    });
  }

  updateScores(predictions) {
    if (!predictions) return;
    this.scores = predictions;
    ['LAD','LCX','RCA'].forEach(key => this.updateVesselColor(key, predictions[key]?.score ?? null));
  }

  setSelectedVessel(key, fireCallback = true) {
    if (key && !this.vesselGroups[key]) key = null;
    this.selected = key;
    Object.entries(this.vesselGroups).forEach(([name, group]) => {
      const selected = name === key;
      group.scale.setScalar(selected ? 1.06 : 1.0);
      group.traverse(obj => {
        if (obj.material?.emissiveIntensity !== undefined && obj.userData.core) {
          obj.material.emissiveIntensity = selected ? 0.21 : 0.11;
        }
        if (obj.userData.glow && obj.material) obj.material.opacity = selected ? 0.29 : (this.scores[name] ? 0.19 : 0.12);
      });
    });
    if (fireCallback) this.onSelect(key);
  }

  handlePointerDown = (event) => {
    this._pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
  };

  handlePointerUp = (event) => {
    if (!this._pointerStart) return;
    const dx = event.clientX - this._pointerStart.x;
    const dy = event.clientY - this._pointerStart.y;
    this._pointerStart = null;
    if (Math.hypot(dx, dy) > 5) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(Object.values(this.vesselGroups), true);
    const hit = hits.find(item => item.object.userData.vessel);
    if (hit) this.setSelectedVessel(hit.object.userData.vessel, true);
  };

  resize() {
    if (this._disposed) return;
    const rect = (this.canvas.parentElement || this.canvas).getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  resetView() {
    this.camera.position.set(0.06, 0.02, 6.9);
    this.controls.target.set(0.02, -0.06, 0);
    this.controls.update();
  }

  animate = () => {
    if (this._disposed) return;
    this._frame = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this._disposed = true;
    cancelAnimationFrame(this._frame);
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.controls?.dispose();
    this.scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => m.dispose());
    });
    this.renderer?.dispose();
  }
}
