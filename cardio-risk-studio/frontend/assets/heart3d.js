import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/* ------------------------------------------------------------------ *
 *  Procedural, anatomically-oriented heart (anterior view).
 *  - Viewer's left  = patient's RIGHT (RA, SVC, RCA)
 *  - Viewer's right = patient's LEFT  (LV, LAA, LAD/LCX)
 *  No third-party mesh is used. Everything is generated at runtime so the
 *  vessel centre-lines are mathematically attached to the myocardial surface.
 * ------------------------------------------------------------------ */

const VESSEL_COLORS = { LAD: '#37d5ff', LCX: '#bd83ff', RCA: '#ffd166' };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const gauss = (x, w) => Math.exp(-(x * x) / (w * w));
const adiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const DEG = Math.PI / 180;

/* ---------------- tiny JS value-noise for geometry displacement ---------------- */
function hash3(x, y, z) {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(hash3(ix, iy, iz), hash3(ix + 1, iy, iz), fx), l(hash3(ix, iy + 1, iz), hash3(ix + 1, iy + 1, iz), fx), fy),
    l(l(hash3(ix, iy, iz + 1), hash3(ix + 1, iy, iz + 1), fx), l(hash3(ix, iy + 1, iz + 1), hash3(ix + 1, iy + 1, iz + 1), fx), fy),
    fz);
}

/* ---------------- ventricular surface: P = S(angle, height) ---------------- */
const APEX_Y = -1.5, TOP_Y = 0.98;
const A_RV = 2.0;         // RV bulge centre (rad)
const A_GA = 1.02;        // anterior interventricular groove (LAD)
const A_GP = 4.42;        // posterior interventricular groove (PDA)
const T_AV = 0.80;        // atrio-ventricular groove height

const profile = t => Math.pow(t, 0.74) * Math.sqrt(Math.max(0, 1 - Math.pow(t, 5.0)));

function ventTerms(a, t) {
  const rv = gauss(adiff(a, A_RV), 0.9) * smooth(0.16, 0.6, t) * (1 - 0.6 * smooth(0.9, 1.0, t));
  const gA = gauss(adiff(a, A_GA), 0.10) * smooth(0.05, 0.28, t) * (1 - smooth(0.88, 1, t));
  const gP = gauss(adiff(a, A_GP), 0.11) * smooth(0.05, 0.28, t) * (1 - smooth(0.88, 1, t));
  const avFade = 1 - 0.92 * gauss(adiff(a, 1.55), 0.5);
  const gV = gauss(t - T_AV, 0.034) * avFade;
  return { rv, gA, gP, gV };
}
function ventSample(a, t, out = new THREE.Vector3()) {
  const ca = Math.cos(a), sa = Math.sin(a);
  const R = profile(t) * 1.26;
  const { rv, gA, gP, gV } = ventTerms(a, t);
  const rx = R * 1.0, rz = R * (0.73 + 0.10 * sa);
  const bulge = 0.24 * rv;
  const k = 1 - 0.07 * gA - 0.07 * gP - 0.055 * gV;
  const lat = 0.10 * smooth(0, 0.9, t) * ca * smooth(0.15, 0.55, t) * (1 - smooth(0.7, 1, t)); // LV lateral fullness
  out.set(((rx + lat) * ca + bulge * ca) * k - 0.05, THREE.MathUtils.lerp(APEX_Y, TOP_Y, t), (rz * sa + bulge * sa) * k);
  return out;
}
function ventFat(a, t) {
  const { gA, gP } = ventTerms(a, t);
  const fa = clamp(gauss(adiff(a, A_GA), 0.135) * smooth(0.10, 0.35, t) * 1.1, 0, 1);
  const fp = clamp(gauss(adiff(a, A_GP), 0.135) * smooth(0.10, 0.35, t) * 1.1, 0, 1);
  const fv = gauss(t - T_AV, 0.06) * 1.15 * (1 - 0.9 * gauss(adiff(a, 1.55), 0.5));
  const fm = 0.45 * gauss(adiff(a, 3.45), 0.16) * smooth(0.25, 0.75, t); // acute marginal fat band
  return clamp(Math.max(fa, fp, fv, fm), 0, 1) * (1 - smooth(0.9, 1, t));
}

/* tilt: long axis points down & to the patient's left (viewer's right) */
const TILT = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.05, 0.10, 0.46, 'XYZ'));
const T = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(TILT);
const Tv = v => v.clone().applyMatrix4(TILT);

function surfacePoint(aDeg, t, lift = 0) {
  const a = aDeg * DEG, e = 1e-3;
  const p = ventSample(a, t), pa = ventSample(a + e, t), pt = ventSample(a, t + e);
  const n = new THREE.Vector3().crossVectors(pt.clone().sub(p), pa.clone().sub(p)).normalize();
  const radial = new THREE.Vector3(p.x + 0.05, 0, p.z);
  if (n.dot(radial) < 0) n.negate();
  return Tv(p.add(n.multiplyScalar(lift)));
}

function buildVentricleGeometry() {
  const nT = 170, nA = 220;
  const pos = [], fat = [], ao = [], idx = [];
  const v = new THREE.Vector3();
  for (let i = 0; i <= nT; i++) {
    const t = i / nT;
    for (let j = 0; j < nA; j++) {
      const a = (j / nA) * Math.PI * 2;
      ventSample(a, t, v);
      pos.push(v.x, v.y, v.z);
      const { gA, gP, gV } = ventTerms(a, t);
      fat.push(ventFat(a, t));
      ao.push(clamp((gA + gP) * 0.55 + gV * 0.65, 0, 1));
    }
  }
  for (let i = 0; i < nT; i++) {
    for (let j = 0; j < nA; j++) {
      const j1 = (j + 1) % nA;
      const a = i * nA + j, b = (i + 1) * nA + j, c = i * nA + j1, d = (i + 1) * nA + j1;
      idx.push(a, c, b, c, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFat', new THREE.Float32BufferAttribute(fat, 1));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(ao, 1));
  g.setIndex(idx);
  g.applyMatrix4(TILT);
  g.computeVertexNormals();
  // flip if winding made normals inward
  const n0 = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, Math.floor(nT * 0.6) * nA + 20);
  const p0 = new THREE.Vector3().fromBufferAttribute(g.attributes.position, Math.floor(nT * 0.6) * nA + 20);
  if (n0.dot(p0.clone().sub(new THREE.Vector3(0, p0.y, 0))) < 0) {
    const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const tmp = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = tmp; }
    g.computeVertexNormals();
  }
  return g;
}

/* ---------------- generic helpers ---------------- */
function addTissueAttrs(g, fat = 0, ao = 0) {
  const n = g.attributes.position.count;
  if (!g.attributes.aFat) g.setAttribute('aFat', new THREE.Float32BufferAttribute(new Float32Array(n).fill(fat), 1));
  if (!g.attributes.aAO) g.setAttribute('aAO', new THREE.Float32BufferAttribute(new Float32Array(n).fill(ao), 1));
  return g;
}

function blobGeometry({ center, radii, rot = [0, 0, 0], noise = 0.04, seed = 1, freq = 2.2, shape = null, detail = [72, 52] }) {
  let g = new THREE.SphereGeometry(1, detail[0], detail[1]);
  g.deleteAttribute('uv'); g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = (vnoise3(v.x * freq + seed, v.y * freq + seed * 2, v.z * freq + seed * 3) - 0.5) * 2 * noise
            + (vnoise3(v.x * freq * 3.1 + seed, v.y * freq * 3.1, v.z * freq * 3.1) - 0.5) * noise * 0.7;
    v.multiplyScalar(1 + n);
    if (shape) shape(v);
    v.set(v.x * radii[0], v.y * radii[1], v.z * radii[2]);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)));
  g.translate(...center);
  g.computeVertexNormals();
  return addTissueAttrs(g);
}

function taperedTube(curve, radiusAt, tubular = 72, radial = 16) {
  const frames = curve.computeFrenetFrames(tubular, false);
  const pos = [], idx = [];
  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular, p = curve.getPointAt(u), r = radiusAt(u);
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(p.x + (N.x * c + B.x * s) * r, p.y + (N.y * c + B.y * s) * r, p.z + (N.z * c + B.z * s) * r);
    }
  }
  for (let i = 0; i < tubular; i++) for (let j = 0; j < radial; j++) {
    const j1 = (j + 1) % radial, a = i * radial + j, b = (i + 1) * radial + j, c = i * radial + j1, d = (i + 1) * radial + j1;
    idx.push(a, b, c, c, b, d);
  }
  // end caps (closed, so no see-through)
  const capStart = idx.length;
  [0, tubular].forEach(i => {
    const p = curve.getPointAt(i / tubular);
    const ci = pos.length / 3; pos.push(p.x, p.y, p.z);
    for (let j = 0; j < radial; j++) {
      const j1 = (j + 1) % radial, a = i * radial + j, c = i * radial + j1;
      if (i === 0) idx.push(ci, c, a); else idx.push(ci, a, c);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // orientation check: make sure side faces point away from the centre-line, caps point along the tube ends
  const P = g.attributes.position, tmp = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
  const tri = k => { const a = idx[k], b = idx[k + 1], c = idx[k + 2];
    tmp.fromBufferAttribute(P, a); e1.fromBufferAttribute(P, b).sub(tmp); e2.fromBufferAttribute(P, c).sub(tmp); return fn.crossVectors(e1, e2).normalize(); };
  const mid = Math.floor(tubular / 2), kSide = (mid * radial) * 6;
  const centre = curve.getPointAt(mid / tubular);
  const sideN = tri(kSide).clone(); tmp.fromBufferAttribute(P, idx[kSide]);
  if (sideN.dot(tmp.sub(centre)) < 0) { for (let k = 0; k < capStart; k += 3) { const t2 = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t2; } }
  const tan0 = curve.getTangentAt(0).negate(), tan1 = curve.getTangentAt(1);
  for (let k = capStart; k < idx.length; k += 3) {
    const want = k < capStart + radial * 3 ? tan0 : tan1;
    if (tri(k).dot(want) < 0) { const t2 = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t2; }
  }
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.ends = [
    { p: curve.getPointAt(0), t: curve.getTangentAt(0).negate(), r: radiusAt(0) },
    { p: curve.getPointAt(1), t: curve.getTangentAt(1), r: radiusAt(1) },
  ];
  return addTissueAttrs(g);
}

const mkCurve = pts => new THREE.CatmullRomCurve3(pts.map(p => (p.isVector3 ? p : new THREE.Vector3(...p))), false, 'centripetal', 0.5);
const taper = (r0, r1, k = 1) => u => THREE.MathUtils.lerp(r0, r1, Math.pow(u, k));

/* ---------------- tissue shader ---------------- */
const NOISE_GLSL = /* glsl */`
float hash31(vec3 p){ p = fract(p * 0.3183099 + vec3(.1,.2,.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash31(i),hash31(i+vec3(1,0,0)),f.x), mix(hash31(i+vec3(0,1,0)),hash31(i+vec3(1,1,0)),f.x), f.y),
             mix(mix(hash31(i+vec3(0,0,1)),hash31(i+vec3(1,0,1)),f.x), mix(hash31(i+vec3(0,1,1)),hash31(i+vec3(1,1,1)),f.x), f.y), f.z); }
float fbm(vec3 p){ float a = .5, s = 0.; for(int i=0;i<3;i++){ s += a * vnoise(p); p = p * 2.03 + vec3(1.7,9.2,3.1); a *= .5; } return s; }
vec3 perturbNormalC( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
  vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
  vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
  vec3 vN = surf_norm;
  vec3 R1 = cross( vSigmaY, vN );
  vec3 R2 = cross( vN, vSigmaX );
  float fDet = dot( vSigmaX, R1 ) * faceDirection;
  vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
  return normalize( abs( fDet ) * surf_norm - vGrad );
}`;

function tissueMaterial(o) {
  const m = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: o.roughness ?? 0.46, metalness: 0,
    clearcoat: o.clearcoat ?? 0.55, clearcoatRoughness: o.clearcoatRoughness ?? 0.28,
    sheen: 0.55, sheenRoughness: 0.45, sheenColor: new THREE.Color('#ff8f94'),
    envMapIntensity: o.env ?? 0.85,
  });
  m.userData.uniforms = {};
  m.onBeforeCompile = shader => {
    const u = {
      uBase: { value: new THREE.Color(o.base) }, uBase2: { value: new THREE.Color(o.base2) },
      uFat: { value: new THREE.Color(o.fat ?? '#dcb66f') }, uFat2: { value: new THREE.Color(o.fat2 ?? '#c8a05f') },
      uBump: { value: o.bump ?? 1.0 }, uSSS: { value: new THREE.Color(o.sss ?? '#6a0d1c') }, uMottle: { value: o.mottle ?? 1.0 },
      uFatAmt: { value: o.fatAmt ?? 1.0 },
    };
    Object.assign(shader.uniforms, u); m.userData.uniforms = u;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aFat; attribute float aAO; varying float vFat; varying float vAO; varying vec3 vObj;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFat = aFat; vAO = aAO; vObj = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vFat; varying float vAO; varying vec3 vObj;
        uniform vec3 uBase, uBase2, uFat, uFat2, uSSS; uniform float uBump, uMottle, uFatAmt;
        ${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float n1 = fbm(vObj * 2.6);
        float n2 = fbm(vObj * 8.5 + 7.0);
        float n3 = vnoise(vObj * 26.0);
        float fatMask = smoothstep(0.34, 0.66, vFat * uFatAmt + (n1 - 0.5) * 0.42 + (n2 - 0.5) * 0.22);
        vec3 muscle = mix(uBase, uBase2, smoothstep(0.2, 0.8, n1 * uMottle + (1.0 - uMottle) * 0.5));
        muscle *= 0.86 + 0.28 * n2;
        muscle = mix(muscle, muscle * vec3(1.08, 0.82, 0.86), smoothstep(0.55, 0.8, n3) * 0.35);
        float rid = 1.0 - abs(2.0 * vnoise(vObj * 7.5 + n1 * 2.5) - 1.0); rid = pow(rid, 7.0);
        float rid2 = 1.0 - abs(2.0 * vnoise(vObj * 15.0 + n2 * 3.0 + 4.0) - 1.0); rid2 = pow(rid2, 10.0);
        muscle = mix(muscle, muscle * vec3(0.50, 0.30, 0.38), clamp(rid * 0.55 + rid2 * 0.4, 0.0, 0.7));
        vec3 fatC = mix(uFat, uFat2, smoothstep(0.3, 0.8, n2)); fatC *= 0.9 + 0.2 * n3;
        diffuseColor.rgb = mix(muscle, fatC, fatMask);
        diffuseColor.rgb *= mix(1.0, 0.5, clamp(vAO, 0.0, 1.0));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.75 + 0.06, fatMask);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float h = n2 * 0.55 + n3 * 0.12 - rid * 0.25;
          float lump = n3 * 0.9 + vnoise(vObj * 52.0) * 0.4;
          h += fatMask * lump * 1.4;
          vec2 dH = vec2(dFdx(h), dFdy(h)) * uBump * 0.55;
          normal = perturbNormalC(-vViewPosition, normal, dH, faceDirection);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float fr = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 2.2);
          totalEmissiveRadiance += uSSS * fr * 1.1 * (1.0 - fatMask * 0.8) * (1.0 - clamp(vAO, 0.0, 1.0) * 0.5);
        }`);
  };
  m.customProgramCacheKey = () => 'tissue-v1';
  return m;
}

/* ====================================================================== */
export class HeartScene {
  constructor(canvas, onSelect = () => {}) {
    this.canvas = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
    if (!this.canvas) throw new Error('Heart canvas not found');
    this.onSelect = onSelect;
    this.scores = {};
    this.selected = 'LAD';
    this.hovered = null;
    this.vesselGroups = {};
    this.vesselMats = {};
    this._disposed = false;
    this._pointerStart = null;
    this._clock = new THREE.Clock();
    this._reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._lastMove = 0;

    const width = Math.max(this.canvas.clientWidth, 360);
    const height = Math.max(this.canvas.clientHeight, 320);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(31, width / height, 0.1, 80);
    this.camera.position.set(0.05, 0.3, 7.1);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!HeartScene.preserveDrawingBuffer });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // image-based lighting for believable wet-tissue reflections
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environment = this.envTex;
      if ('environmentIntensity' in this.scene) this.scene.environmentIntensity = 0.75;
      pmrem.dispose();
    } catch (e) { console.warn('Environment map unavailable', e); }

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.enableZoom = true;
    this.controls.minDistance = 3.1;
    this.controls.maxDistance = 10.5;
    this.controls.rotateSpeed = 0.62;
    this.controls.zoomSpeed = 0.72;
    this.controls.target.set(0.02, 0.42, 0);
    this.controls.update();

    this.addLights();
    this.addBackdrop();
    this.root = new THREE.Group();
    this.beat = new THREE.Group();
    this.root.add(this.beat);
    this.root.rotation.y = 0.0;
    this.scene.add(this.root);
    this.buildAnatomy();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement || this.canvas);
    this.resize();
    this.setSelectedVessel('LAD', false);
    this.animate();
  }

  addLights() {
    this.scene.add(new THREE.HemisphereLight('#cfe6ff', '#3a2230', 0.55));
    const key = new THREE.DirectionalLight('#fff1e4', 2.6); key.position.set(-3.6, 4.6, 5.4); this.scene.add(key);
    const fill = new THREE.DirectionalLight('#7fa8d8', 0.85); fill.position.set(4.6, 0.8, 3.2); this.scene.add(fill);
    const rim = new THREE.DirectionalLight('#ff7f8e', 2.2); rim.position.set(1.2, 2.6, -5.0); this.scene.add(rim);
    const rim2 = new THREE.DirectionalLight('#6fd9c8', 0.9); rim2.position.set(-4.5, -1.5, -3.0); this.scene.add(rim2);
  }

  addBackdrop() {
    const ringGroup = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: '#7198bb', transparent: true, opacity: 0.085, side: THREE.DoubleSide, depthWrite: false });
    [2.1, 2.52, 2.95].forEach((r, i) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.006, 140), ringMat.clone());
      ring.rotation.x = 0.2 + i * 0.05; ring.position.set(0.05, 0.1, -2.4 - i * 0.05); ringGroup.add(ring);
    });
    this.scene.add(ringGroup);
    this.backdrop = ringGroup;
  }

  buildAnatomy() {
        // ---------- materials ----------
    const myo = tissueMaterial({ base: '#7a2530', base2: '#a8454d', roughness: 0.5, clearcoat: 0.6, bump: 1.0, sss: '#7a1020' });
    const atr = tissueMaterial({ base: '#6d2a3a', base2: '#964a56', roughness: 0.5, clearcoat: 0.5, bump: 1.1, sss: '#6a1428', fatAmt: 0.4 });
    const art = tissueMaterial({ base: '#b4766b', base2: '#cf9a8a', roughness: 0.42, clearcoat: 0.5, bump: 0.7, sss: '#7a2a30', mottle: 0.7, fatAmt: 0.0 });
    const vein = tissueMaterial({ base: '#7a4458', base2: '#98607a', roughness: 0.46, clearcoat: 0.45, bump: 0.8, sss: '#43142a', mottle: 0.8, fatAmt: 0.0 });
    this._tissueMats = [myo, atr, art, vein];

    // ---------- ventricles ----------
    const ventricles = new THREE.Mesh(buildVentricleGeometry(), myo);
    this.beat.add(ventricles);

    // ---------- atria & appendages ----------
    const add = (geom, mat) => { const m = new THREE.Mesh(geom, mat); this.beat.add(m); return m; };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const off = (p, x, y, z) => p.clone().add(V(x, y, z));
    // anchor points (world) derived from the ventricular surface so everything stays attached after tuning
    const raC = off(surfacePoint(188, 0.80, 0), -0.02, 0.30, -0.02);       // right atrium body
    const raaC = off(surfacePoint(132, 0.885, 0), -0.02, 0.17, 0.10);      // right atrial appendage
    const laaC = off(surfacePoint(22, 0.885, 0), 0.04, 0.16, 0.06);        // left atrial appendage
    const laC = off(T(0.05, 0.95, -0.45), 0, 0.10, -0.05);                 // left atrium (posterior)
    const aoA = off(T(-0.16, 0.86, 0.02), 0, 0, 0);                        // aortic root
    const ptA = surfacePoint(104, 0.915, 0.0);                             // pulmonary trunk origin (RV outflow)

    add(blobGeometry({ center: raC.toArray(), radii: [0.40, 0.52, 0.42], rot: [0.1, 0, 0.30], noise: 0.035, seed: 3 }), atr);
    add(blobGeometry({ center: raaC.toArray(), radii: [0.38, 0.20, 0.13], rot: [0.25, -0.15, -0.55], noise: 0.07, seed: 5, freq: 3.2,
      shape: v => { v.y *= (1 - 0.40 * Math.max(0, v.x)); } }), atr);
    add(blobGeometry({ center: laC.toArray(), radii: [0.85, 0.36, 0.42], rot: [0.0, 0, 0.18], noise: 0.03, seed: 9 }), atr);
    add(blobGeometry({ center: laaC.toArray(), radii: [0.30, 0.12, 0.11], rot: [0.1, 0.4, -0.85], noise: 0.09, seed: 11, freq: 3.8,
      shape: v => { v.y *= (1 - 0.35 * Math.max(0, -v.x)); } }), atr);

    // ---------- great vessels ----------
    const aorta = [off(aoA, 0.0, -0.10, 0.0), off(aoA, 0.03, 0.40, -0.08), off(aoA, 0.13, 0.80, -0.17), off(aoA, 0.38, 1.10, -0.30), off(aoA, 0.78, 1.08, -0.44), off(aoA, 1.06, 0.74, -0.55), off(aoA, 1.10, 0.25, -0.62), off(aoA, 1.08, -0.25, -0.66)];
    this.addOpen(taperedTube(mkCurve(aorta), u => (u < 0.07 ? 0.20 - u * 0.9 : 0.152 - 0.045 * u), 120, 24), art);
    add(blobGeometry({ center: aoA.toArray(), radii: [0.235, 0.20, 0.235], noise: 0.03, seed: 21 }), art);
    const branch = (pts, r0, r1) => this.addOpen(taperedTube(mkCurve(pts), taper(r0, r1), 40, 14), art, [false, true]);
    branch([off(aoA, 0.15, 0.98, -0.24), off(aoA, 0.09, 1.22, -0.26), off(aoA, 0.03, 1.46, -0.27)], 0.080, 0.068);   // brachiocephalic
    branch([off(aoA, 0.42, 1.12, -0.31), off(aoA, 0.46, 1.32, -0.32), off(aoA, 0.48, 1.54, -0.33)], 0.058, 0.050);   // left common carotid
    branch([off(aoA, 0.74, 1.08, -0.43), off(aoA, 0.84, 1.28, -0.45), off(aoA, 0.94, 1.50, -0.47)], 0.064, 0.054);   // left subclavian

    // pulmonary trunk – anterior, passes up and to the patient's left across the front of the aorta
    const bif = off(ptA, 0.34, 0.80, -0.28);
    this.addOpen(taperedTube(mkCurve([off(ptA, -0.02, -0.26, -0.14), off(ptA, 0.03, 0.06, -0.04), off(ptA, 0.08, 0.34, -0.08), off(ptA, 0.20, 0.60, -0.18), bif]), taper(0.20, 0.17), 80, 24), art);
    this.addOpen(taperedTube(mkCurve([off(bif, -0.02, 0, 0.0), off(bif, 0.50, 0.02, -0.12), off(bif, 0.95, -0.12, -0.26)]), taper(0.12, 0.10), 50, 18), art);   // left PA
    this.addOpen(taperedTube(mkCurve([off(bif, -0.02, 0, 0.0), off(bif, -0.30, 0.0, -0.36), off(bif, -0.72, -0.02, -0.55)]), taper(0.11, 0.095), 50, 18), art);  // right PA

    // venae cavae
    this.addOpen(taperedTube(mkCurve([off(raC, 0, 0.30, 0), off(raC, -0.01, 0.85, -0.05), off(raC, -0.02, 1.35, -0.08)]), taper(0.17, 0.145), 50, 22), vein);
    this.addOpen(taperedTube(mkCurve([off(raC, 0.04, -0.30, -0.05), off(raC, -0.02, -0.70, -0.12), off(raC, -0.05, -1.05, -0.2)]), taper(0.165, 0.15), 50, 22), vein);
    // pulmonary veins (posterior – visible when rotating)
    [[0.95, 0.20], [0.85, -0.05], [-0.70, 0.22], [-0.72, -0.02]].forEach(([dx, dy]) => {
      const p0 = off(laC, dx * 0.55, dy, -0.12);
      this.addOpen(taperedTube(mkCurve([p0, off(laC, dx * 0.95, dy + 0.02, -0.30), off(laC, dx * 1.35, dy + 0.06, -0.52)]), taper(0.09, 0.08), 30, 14), vein);
    });

    // ---------- coronary arteries ----------
    const neutral = tissueMaterial({ base: '#d8a89a', base2: '#e7bfae', roughness: 0.32, clearcoat: 0.7, bump: 0.4, fatAmt: 0 });
    // left main trunk
    const lmStart = off(aoA, 0.12, 0.02, 0.14);
    const lmBif = surfacePoint(52, 0.925, 0.03);
    this.addStatic(taperedTube(mkCurve([lmStart, lmStart.clone().lerp(lmBif, 0.5).add(new THREE.Vector3(0, 0.035, 0.03)), lmBif]), taper(0.046, 0.042), 24, 12), neutral);

    const sp = (a, t, lift = 0.02) => surfacePoint(a, t, lift);
    const LAD = [
      { pts: [[52, 0.925], [57, 0.885], [60, 0.80], [61, 0.70], [61.5, 0.58], [61, 0.46], [60, 0.34], [58, 0.22], [55, 0.12], [58, 0.05]], r0: 0.058, r1: 0.018, lift: 0.028 },
      { pts: [[60, 0.78], [49, 0.73], [36, 0.67], [24, 0.60]], r0: 0.024, r1: 0.010, lift: 0.018 },
      { pts: [[61, 0.55], [48, 0.50], [35, 0.43], [24, 0.35]], r0: 0.022, r1: 0.009, lift: 0.018 },
      { pts: [[61, 0.40], [72, 0.34], [84, 0.28]], r0: 0.016, r1: 0.008, lift: 0.014 },
    ];
    const LCX = [
      { pts: [[52, 0.925], [38, 0.87], [22, 0.825], [6, 0.805], [-14, 0.795], [-34, 0.795], [-54, 0.80], [-72, 0.80]], r0: 0.054, r1: 0.018, lift: 0.032 },
      { pts: [[8, 0.805], [1, 0.72], [-6, 0.60], [-12, 0.47], [-16, 0.35]], r0: 0.024, r1: 0.010, lift: 0.018 },
      { pts: [[-34, 0.795], [-38, 0.70], [-44, 0.58], [-50, 0.46]], r0: 0.020, r1: 0.009, lift: 0.018 },
    ];
    const RCA = [
      { pts: [[100, 0.90], [114, 0.845], [130, 0.812], [148, 0.800], [168, 0.797], [190, 0.795], [212, 0.79], [234, 0.785], [250, 0.78]], r0: 0.058, r1: 0.026, lift: 0.032, root: off(aoA, -0.10, 0.0, 0.17) },
      { pts: [[250, 0.78], [252, 0.68], [253, 0.56], [254, 0.44], [254, 0.30], [252, 0.18], [248, 0.08]], r0: 0.026, r1: 0.010, lift: 0.020 },
      { pts: [[186, 0.797], [188, 0.70], [191, 0.58], [193, 0.46], [197, 0.34]], r0: 0.026, r1: 0.010, lift: 0.020 },
    ];
    this.vesselGroups.LAD = this.makeVessel('LAD', LAD);
    this.vesselGroups.LCX = this.makeVessel('LCX', LCX);
    this.vesselGroups.RCA = this.makeVessel('RCA', RCA);
    this.vesselGroups.LAD.userData.label = 'LAD';

    // epicardial fat pads (soft lumpy tissue along the right AV groove and near the apex)
    const fatMat = tissueMaterial({ base: '#e0b765', base2: '#d19f55', fat: '#e0b765', fat2: '#cf9a50', roughness: 0.4, clearcoat: 0.5, bump: 1.7, mottle: 0.6, fatAmt: 1.6 });
    const fatPad = (a, t, r, s, seed) => {
      const c = surfacePoint(a, t, -0.01);
      add(blobGeometry({ center: c.toArray(), radii: [r * s[0], r * s[1], r * s[2]], noise: 0.18, seed, freq: 3.5, detail: [28, 20] }), fatMat);
    };
    fatPad(170, 0.80, 0.11, [1.5, 1.0, 0.9], 31);
    fatPad(205, 0.79, 0.10, [1.3, 1.0, 0.9], 33);
    this._fatMat = fatMat;
  }

  /** adds a mesh to the beating group, with a dark open-lumen disc at both ends */
  addOpen(geom, mat, ends = [false, true]) {
    const mesh = new THREE.Mesh(geom, mat);
    this.beat.add(mesh);
    if (!this._lumenMat) this._lumenMat = new THREE.MeshStandardMaterial({ color: '#2a0a12', roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
    (geom.userData.ends || []).forEach((e, i) => {
      if (!ends[i]) return;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(e.r * 0.8, 28), this._lumenMat);
      disc.position.copy(e.p).addScaledVector(e.t, 0.004);
      disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), e.t);
      this.beat.add(disc);
      // raised wall rim around the lumen
      const rim = new THREE.Mesh(new THREE.TorusGeometry(e.r * 0.9, e.r * 0.13, 10, 32), mat);
      rim.position.copy(e.p); rim.quaternion.copy(disc.quaternion);
      this.beat.add(rim);
    });
    return mesh;
  }
  addStatic(geom, mat) { const m = new THREE.Mesh(geom, mat); this.beat.add(m); return m; }

  makeVessel(key, branches) {
    const group = new THREE.Group();
    group.userData.vessel = key;
    group.name = `coronary-${key}`;
    const color = new THREE.Color(VESSEL_COLORS[key]);
    this.vesselMats[key] = [];
    branches.forEach((b, index) => {
      const pts = b.pts.map(([a, t]) => surfacePoint(a, t, b.lift));
      if (b.root) pts.unshift(b.root);
      const c = mkCurve(pts);
      const radius = taper(b.r0, b.r1, 0.8);
      const coreMat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.38, metalness: 0.0, clearcoat: 0.5, clearcoatRoughness: 0.25, emissive: color, emissiveIntensity: 0.30, envMapIntensity: 0.45, toneMapped: false });
      const glowMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.FrontSide });
      const core = new THREE.Mesh(taperedTube(c, radius, 90, 14), coreMat);
      core.userData = { vessel: key, core: true };
      const glow = new THREE.Mesh(taperedTube(c, u => radius(u) * 2.1, 90, 12), glowMat);
      glow.userData = { vessel: key, glow: true };
      group.add(glow, core);
      this.vesselMats[key].push({ core: coreMat, glow: glowMat, trunk: index === 0 });
    });
    this.beat.add(group);
    this.updateVesselColor(key);
    return group;
  }

  updateVesselColor(key) {
    const mats = this.vesselMats[key];
    if (!mats) return;
    const c = new THREE.Color(VESSEL_COLORS[key] || '#7f95aa');
    mats.forEach(({ core, glow }) => { core.color.copy(c).multiplyScalar(0.8); core.emissive.copy(c); glow.color.copy(c); });
    this._refreshSelectionStyle();
  }

  updateScores(predictions) {
    if (!predictions) return;
    this.scores = predictions;
    ['LAD', 'LCX', 'RCA'].forEach(key => this.updateVesselColor(key));
  }

  _refreshSelectionStyle() {
    Object.entries(this.vesselMats).forEach(([name, mats]) => {
      const sel = name === this.selected, hov = name === this.hovered;
      const score = this.scores[name]?.score;
      const level = score == null ? 0 : clamp(Number(score), 0, 1);
      const color = new THREE.Color(VESSEL_COLORS[name] || '#7f95aa');
      mats.forEach(({ core, glow }) => {
        core.color.copy(color).multiplyScalar(sel ? 1 : 0.62);
        core.emissive.copy(color);
        core.emissiveIntensity = sel ? 1.25 : hov ? 0.5 : 0.18 + level * 0.08;
        glow.opacity = sel ? 0.7 : hov ? 0.3 : score != null ? 0.08 + level * 0.06 : 0.025;
      });
    });
  }

  setSelectedVessel(key, fireCallback = true) {
    if (key && !this.vesselGroups[key]) key = null;
    this.selected = key;
    this._refreshSelectionStyle();
    if (fireCallback) this.onSelect(key);
  }

  _pick(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(Object.values(this.vesselGroups), true);
    return hits.find(item => item.object.userData.vessel)?.object.userData.vessel ?? null;
  }

  handlePointerDown = event => { this._pointerStart = { x: event.clientX, y: event.clientY }; };
  handlePointerUp = event => {
    if (!this._pointerStart) return;
    const dx = event.clientX - this._pointerStart.x, dy = event.clientY - this._pointerStart.y;
    this._pointerStart = null;
    if (Math.hypot(dx, dy) > 5) return;
    const hit = this._pick(event);
    if (hit) this.setSelectedVessel(hit, true);
  };
  handlePointerMove = event => {
    const now = performance.now();
    if (now - this._lastMove < 60 || event.buttons) return;
    this._lastMove = now;
    const hit = this._pick(event);
    if (hit !== this.hovered) { this.hovered = hit; this._refreshSelectionStyle(); this.canvas.style.cursor = hit ? 'pointer' : ''; }
  };

  resize() {
    if (this._disposed) return;
    const rect = (this.canvas.parentElement || this.canvas).getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width)), height = Math.max(1, Math.floor(rect.height));
    this.camera.aspect = width / height;
    // keep the whole heart in frame on narrow / portrait stages
    this.camera.fov = width / height < 1 ? 31 + (1 - width / height) * 16 : 31;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  resetView() {
    this.camera.position.set(0.05, 0.3, 7.1);
    this.controls.target.set(0.02, 0.42, 0);
    this.controls.update();
  }

  animate = () => {
    if (this._disposed) return;
    this._frame = requestAnimationFrame(this.animate);
    const t = this._clock.getElapsedTime();
    if (!this._reduceMotion && !this.freezeBeat) {
      const ph = (t % 0.86) / 0.86;
      const lub = Math.exp(-Math.pow((ph - 0.07) / 0.055, 2));
      const dub = 0.55 * Math.exp(-Math.pow((ph - 0.33) / 0.07, 2));
      const s = 1 + 0.014 * (lub + dub);
      this.beat.scale.set(s, s * (1 + 0.004 * lub), s);
      const sel = this.vesselMats[this.selected];
      if (sel) { const pulse = 0.5 + 0.5 * Math.sin(t * 2.6); sel.forEach(({ glow }) => { glow.opacity = 0.24 + 0.10 * pulse; }); }
    }
    if (this.backdrop) this.backdrop.rotation.z = t * 0.01;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this._disposed = true;
    cancelAnimationFrame(this._frame);
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.controls?.dispose();
    this.scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => m.dispose());
    });
    this.envTex?.dispose();
    this.renderer?.dispose();
  }
}
