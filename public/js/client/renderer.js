// 3D 장면: 하늘 · 지형 청크 · 소품(청크별 병합) · 물/용암 · 마을 · 카메라 · 조명/그림자
import * as THREE from '../../vendor/three.module.min.js';
import { heightAt, colorAt, PROPS, BUILDINGS, LAVA, WAYPOINTS, ARENAS, CAMPS } from '../shared/world.js';
import { WORLD_R } from '../shared/constants.js';
import { hash2 } from '../shared/noise.js';

export { THREE };
const CHUNK = 40, STEP = 2;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
const lin = (r, g, b) => new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
const hex = (h) => new THREE.Color(h);

// 여러 도형을 색과 함께 하나의 지오메트리로 합침
export function merge(parts) {
  let n = 0;
  const geos = parts.map((p) => { const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()); g.applyMatrix4(p.m); n += g.attributes.position.count; return g; });
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  geos.forEach((g, i) => {
    const c = parts[i].c, cnt = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    for (let k = 0; k < cnt; k++) { col[(o + k) * 3] = c.r; col[(o + k) * 3 + 1] = c.g; col[(o + k) * 3 + 2] = c.b; }
    o += cnt;
    g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
export function mat4(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _s.set(sx, sy, sz); _p.set(x, y, z);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

// 공용 기본 도형 (재사용)
export const G = {
  box: new THREE.BoxGeometry(1, 1, 1), cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6), cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  cyl12: new THREE.CylinderGeometry(0.5, 0.5, 1, 12), cone7: new THREE.ConeGeometry(0.5, 1, 7), cone4: new THREE.ConeGeometry(0.5, 1, 4), cone8: new THREE.ConeGeometry(0.5, 1, 8),
  ico: new THREE.IcosahedronGeometry(0.5, 0), ico1: new THREE.IcosahedronGeometry(0.5, 1), dodec: new THREE.DodecahedronGeometry(0.5, 0), oct: new THREE.OctahedronGeometry(0.5, 0),
  sph: new THREE.SphereGeometry(0.5, 12, 8), sph16: new THREE.SphereGeometry(0.5, 16, 12), halfSph: new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  tor: new THREE.TorusGeometry(0.5, 0.08, 6, 16),
};

// ---------- 소품 모양 ----------
function propParts(p) {
  const out = [];
  const add = (geo, c, x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) => out.push({ geo, c, m: mat4(x, y, z, ry, sx, sy, sz, rx, rz) });
  const s = p.s, v = hash2(7, Math.floor(p.x * 3), Math.floor(p.z * 3));
  const tint = (c, k = 0.12) => c.clone().multiplyScalar(1 - k + v * k * 2);
  switch (p.t) {
    case 'tree': {
      const g = p.zone === 'forest' ? lin(52, 128, 52) : p.zone === 'lake' ? lin(80, 150, 70) : lin(88, 160, 60);
      add(G.cyl6, lin(110, 78, 50), 0, 1.1 * s, 0, 0.4 * s, 2.2 * s, 0.4 * s);
      add(G.ico, tint(g), 0, 2.9 * s, 0, 2.6 * s, 2.2 * s, 2.6 * s, v * 3);
      add(G.ico, tint(g, 0.2), 0.5 * s, 3.6 * s, 0.2 * s, 1.6 * s, 1.5 * s, 1.6 * s, v * 5);
      break;
    }
    case 'pine': {
      const g = tint(lin(44, 104, 66));
      add(G.cyl6, lin(96, 70, 46), 0, 0.8 * s, 0, 0.3 * s, 1.6 * s, 0.3 * s);
      add(G.cone7, g, 0, 2.2 * s, 0, 2.8 * s, 2.4 * s, 2.8 * s, v);
      add(G.cone7, g, 0, 3.4 * s, 0, 2.1 * s, 2.0 * s, 2.1 * s, v * 2);
      add(G.cone7, g, 0, 4.4 * s, 0, 1.3 * s, 1.6 * s, 1.3 * s, v * 3);
      break;
    }
    case 'bush': add(G.ico, tint(p.zone === 'forest' ? lin(50, 115, 50) : lin(80, 150, 60)), 0, 0.35 * s, 0, 1.5 * s, 1 * s, 1.4 * s, v * 6); break;
    case 'rock': {
      const c = p.zone === 'canyon' ? lin(170, 110, 80) : p.zone === 'waste' ? lin(64, 56, 56) : lin(140, 140, 136);
      add(G.dodec, tint(c), 0, 0.45 * s, 0, 1.8 * s, 1.2 * s, 1.5 * s, v * 6);
      break;
    }
    case 'pillar': add(G.cyl6, tint(lin(176, 104, 72)), 0, 3 * s, 0, 2.6 * s, 6.5 * s, 2.6 * s, v); add(G.cyl6, lin(196, 130, 92), 0, 6.3 * s, 0, 2.8 * s, 0.3 * s, 2.8 * s, v); break;
    case 'deadtree': {
      const c = p.zone === 'waste' ? lin(46, 38, 36) : lin(110, 86, 64);
      add(G.cyl6, c, 0, 1.4 * s, 0, 0.3 * s, 2.8 * s, 0.3 * s);
      add(G.cyl6, c, 0.4 * s, 2.3 * s, 0, 0.16 * s, 1.3 * s, 0.16 * s, 0, 0, -0.8);
      add(G.cyl6, c, -0.3 * s, 2.0 * s, 0.2 * s, 0.14 * s, 1.0 * s, 0.14 * s, 0, 0.5, 0.7);
      break;
    }
    case 'crystal': add(G.oct, lin(120, 230, 240), 0, 0.9 * s, 0, 0.9 * s, 2 * s, 0.9 * s, v); add(G.oct, lin(160, 200, 255), 0.5 * s, 0.5 * s, 0.2 * s, 0.5 * s, 1.1 * s, 0.5 * s, v * 2, 0, 0.4); break;
    case 'bigshroom': add(G.cyl8, lin(232, 224, 210), 0, 0.7 * s, 0, 0.35 * s, 1.4 * s, 0.35 * s); add(G.halfSph, tint(lin(196, 60, 70)), 0, 1.3 * s, 0, 1.8 * s, 1.1 * s, 1.8 * s); break;
    case 'flower': {
      const cols = [lin(240, 80, 80), lin(250, 220, 70), lin(250, 250, 250), lin(180, 110, 230), lin(255, 150, 200)];
      for (let i = 0; i < 3; i++) {
        const a = v * 6 + i * 2.1, r = 0.4 + i * 0.25;
        add(G.box, lin(70, 140, 50), Math.sin(a) * r, 0.15, Math.cos(a) * r, 0.05, 0.3, 0.05);
        add(G.box, cols[Math.floor(v * 5 + i) % 5], Math.sin(a) * r, 0.33, Math.cos(a) * r, 0.2, 0.12, 0.2, a);
      }
      break;
    }
    case 'bones': add(G.box, lin(230, 224, 210), 0, 0.1, 0, 1.2, 0.15, 0.15, v * 3); add(G.box, lin(230, 224, 210), 0.2, 0.1, 0.3, 0.15, 0.15, 0.9, v); add(G.sph, lin(236, 230, 215), -0.5, 0.2, 0, 0.4, 0.35, 0.4); break;
    case 'lamp': add(G.cyl6, lin(60, 60, 66), 0, 1.5, 0, 0.18, 3, 0.18); add(G.box, lin(255, 230, 150), 0, 3.15, 0, 0.45, 0.5, 0.45); add(G.cone4, lin(60, 60, 66), 0, 3.55, 0, 0.7, 0.35, 0.7, Math.PI / 4); break;
    case 'fence': add(G.box, lin(150, 110, 70), -0.9, 0.55, 0, 0.16, 1.1, 0.16); add(G.box, lin(150, 110, 70), 0.9, 0.55, 0, 0.16, 1.1, 0.16); add(G.box, lin(170, 128, 82), 0, 0.75, 0, 2.0, 0.12, 0.08); add(G.box, lin(170, 128, 82), 0, 0.4, 0, 2.0, 0.12, 0.08); break;
    case 'crate': add(G.box, lin(170, 120, 70), 0, 0.45, 0, 0.9, 0.9, 0.9); add(G.box, lin(120, 84, 50), 0, 0.92, 0, 0.95, 0.06, 0.95); break;
    case 'tent': add(G.cone4, lin(220, 200, 160), 0, 1.4, 0, 4.4, 2.8, 4.4, Math.PI / 4); add(G.box, lin(90, 60, 40), 0, 1.6, 0, 0.12, 3.2, 0.12); break;
    case 'campfire': for (let i = 0; i < 6; i++) { const a = i * 1.05; add(G.dodec, lin(110, 110, 110), Math.sin(a) * 0.8, 0.12, Math.cos(a) * 0.8, 0.4, 0.3, 0.4); } add(G.cyl6, lin(100, 70, 40), 0, 0.15, 0, 0.18, 1.3, 0.18, 0, Math.PI / 2, 0.5); add(G.cyl6, lin(100, 70, 40), 0, 0.15, 0, 0.18, 1.3, 0.18, 1.5, Math.PI / 2, 0); break;
    case 'ruin': add(G.cyl8, lin(160, 156, 146), 0, 1.3, 0, 1.2, 2.6 + v * 2, 1.2); add(G.box, lin(140, 136, 128), 0.2, 0.2, 0.9, 0.8, 0.4, 0.6, v); break;
  }
  return out;
}

const PROP_SHADOW = new Set(['tree', 'pine', 'pillar', 'deadtree', 'rock', 'tent', 'bigshroom', 'lamp', 'ruin', 'crystal']);

export class Renderer {
  constructor(canvas, opts = {}) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: !opts.touch, powerPreference: 'high-performance' });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.5, 600);
    this.horizon = hex('#bcd8f2');
    this.scene.fog = new THREE.Fog(this.horizon, 80, 150);
    this.scene.background = this.horizon;
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.chunks = new Map();
    this.camYaw = Math.PI * 0.25; this.camPitch = 0.95; this.camDist = 16;
    this.target = new THREE.Vector3();
    this.anim = [];
    this.buildLights();
    this.buildSky();
    this.buildWater();
    this.buildTown();
    this.propsByChunk = new Map();
    for (const p of PROPS) {
      const k = Math.floor(p.x / CHUNK) + ',' + Math.floor(p.z / CHUNK);
      let a = this.propsByChunk.get(k); if (!a) this.propsByChunk.set(k, (a = [])); a.push(p);
    }
    this.setShadows(!!opts.shadows);
    this.viewDist = 140;
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xe8f2ff, 0x5a6a48, 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2dc, 1.9);
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera; c.left = -38; c.right = 38; c.top = 38; c.bottom = -38; c.near = 1; c.far = 200;
    this.sun.shadow.bias = -0.0008; this.sun.shadow.normalBias = 0.6;
    this.scene.add(this.sun, this.sun.target);
  }
  setShadows(on) {
    this.shadows = on;
    this.gl.shadowMap.enabled = on;
    this.sun.castShadow = on;
    for (const ch of this.chunks.values()) if (ch.props) ch.props.castShadow = on;
    this.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(500, 24, 12);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: hex('#4f8fe8') }, mid: { value: this.horizon.clone() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top, mid; varying vec3 vP; void main(){ float h = max(vP.y, 0.0); gl_FragColor = vec4(mix(mid, top, pow(h, 0.6)), 1.0); }',
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
    // 구름 몇 개
    const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false });
    this.clouds = new THREE.Group();
    for (let i = 0; i < 26; i++) {
      const g = new THREE.Group();
      for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(G.ico1, cloudMat); m.scale.set(14 + k * 3, 6, 10); m.position.set(k * 9 - 13, Math.sin(k) * 2, (k % 2) * 4); g.add(m); }
      const a = hash2(3, i, 0) * Math.PI * 2, r = 80 + hash2(5, i, 1) * 320;
      g.position.set(Math.sin(a) * r, 70 + hash2(9, i, 2) * 20, Math.cos(a) * r);
      this.clouds.add(g);
    }
    this.scene.add(this.clouds);
  }

  buildWater() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#3f86d6'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.1})`; g.fillRect(Math.random() * 128, Math.random() * 128, 6 + Math.random() * 14, 1.5); }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(90, 90); tex.colorSpace = THREE.SRGBColorSpace;
    this.waterTex = tex;
    const w = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshLambertMaterial({ map: tex, transparent: true, opacity: 0.86 }));
    w.rotation.x = -Math.PI / 2; w.position.y = 0.02;
    w.receiveShadow = true;
    this.scene.add(w);
    this.lavaMat = new THREE.MeshBasicMaterial({ color: 0xff5a1f });
    for (const l of LAVA) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(l.r * 1.05, 20), this.lavaMat);
      m.rotation.x = -Math.PI / 2; m.position.set(l.x, 0.08, l.z);
      this.scene.add(m);
    }
  }

  buildTown() {
    const parts = [];
    const add = (geo, c, ...a) => parts.push({ geo, c, m: mat4(...a) });
    for (const b of BUILDINGS) {
      const y = heightAt(b.x, b.z) - 0.2;
      const wall = hex(b.wall), roof = hex(b.roof);
      add(G.box, hex('#8a7a66'), b.x, y + 0.25, b.z, 0, b.w + 0.3, 0.5, b.d + 0.3);
      add(G.box, wall, b.x, y + b.h / 2, b.z, 0, b.w, b.h, b.d);
      const s = (b.d + 1.4) / Math.SQRT2;
      add(G.box, roof, b.x, y + b.h, b.z, 0, b.w + 1.2, s, s, Math.PI / 4);
      // 문과 창문 (마을 중심을 향하는 면)
      const toC = Math.abs(b.x) > Math.abs(b.z) ? [Math.sign(-b.x), 0] : [0, Math.sign(-b.z)];
      const fx = b.x + toC[0] * (b.w / 2 + 0.03), fz = b.z + toC[1] * (b.d / 2 + 0.03);
      const ry = toC[0] ? Math.PI / 2 : 0;
      add(G.box, hex('#6a4426'), fx, y + 1.1, fz, ry, 1.3, 2.2, 0.1);
      for (const o of [-1, 1]) {
        const off = (toC[0] ? b.d : b.w) / 4 * o;
        const wx = fx + (toC[0] ? 0 : off), wz = fz + (toC[0] ? off : 0);
        add(G.box, hex('#9fd0f0'), wx, y + Math.min(b.h - 1.2, 2.6), wz, ry, 1.0, 0.9, 0.12);
        add(G.box, hex('#5a3a22'), wx, y + Math.min(b.h - 1.2, 2.6) - 0.55, wz, ry, 1.2, 0.12, 0.2);
      }
      if (b.chimney) add(G.box, hex('#6a6a70'), b.x + b.w / 4, y + b.h + 1.6, b.z - b.d / 5, 0, 0.9, 2.4, 0.9);
    }
    // 분수
    const fy = heightAt(0, 0);
    add(G.cyl12, hex('#b8b4aa'), 0, fy + 0.35, 0, 0, 6.4, 0.7, 6.4);
    add(G.cyl12, hex('#8fb8e0'), 0, fy + 0.72, 0, 0, 5.6, 0.06, 5.6);
    add(G.cyl8, hex('#c8c4ba'), 0, fy + 1.4, 0, 0, 0.8, 2.2, 0.8);
    add(G.cyl12, hex('#c8c4ba'), 0, fy + 2.5, 0, 0, 2.2, 0.35, 2.2);
    // 현상금 게시판
    add(G.box, hex('#7a5532'), 7, fy + 1.4, 7, Math.PI * 0.25, 2.4, 1.6, 0.15);
    add(G.box, hex('#e8dcc0'), 7.06, fy + 1.45, 6.94, Math.PI * 0.25, 2.0, 1.2, 0.12);
    add(G.box, hex('#5a3a22'), 6.2, fy + 0.6, 7.8, 0, 0.15, 1.6, 0.15);
    add(G.box, hex('#5a3a22'), 7.8, fy + 0.6, 6.2, 0, 0.15, 1.6, 0.15);
    // 보스 장소 바닥 문양
    const mesh = new THREE.Mesh(merge(parts), this.mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.town = mesh;
    for (const a of Object.values(ARENAS)) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(a.r - 1.2, a.r - 0.4, 48), new THREE.MeshBasicMaterial({ color: 0xc9a46a, transparent: true, opacity: 0.55, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(a.x, heightAt(a.x, a.z) + 0.06, a.z);
      this.scene.add(ring);
    }
    // 분수 물보라 + 이동의 돌 + 모닥불 (움직이는 것)
    this.glowMat = new THREE.MeshBasicMaterial({ color: 0x7ff0ff, transparent: true, opacity: 0.85 });
    for (const w of Object.values(WAYPOINTS)) {
      const y = heightAt(w.x, w.z);
      const st = new THREE.Mesh(merge([
        { geo: G.cone4, c: hex('#8d8a96'), m: mat4(0, 2.1, 0, Math.PI / 4, 1.2, 4.2, 1.2) },
        { geo: G.cyl8, c: hex('#6c6a74'), m: mat4(0, 0.2, 0, 0, 2.2, 0.4, 2.2) },
      ]), this.mat);
      st.position.set(w.x, y, w.z); st.castShadow = true;
      const rune = new THREE.Mesh(G.tor, this.glowMat); rune.scale.set(2.4, 2.4, 1.2); rune.rotation.x = Math.PI / 2; rune.position.set(w.x, y + 0.5, w.z);
      const orb = new THREE.Mesh(G.oct, this.glowMat); orb.position.set(w.x, y + 4.8, w.z); orb.scale.setScalar(0.7);
      this.scene.add(st, rune, orb);
      this.anim.push((t) => { rune.rotation.z = t * 0.8; orb.rotation.y = t * 1.5; orb.position.y = y + 4.8 + Math.sin(t * 2) * 0.2; });
    }
    const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9 });
    for (const c of Object.values(CAMPS)) {
      const y = heightAt(c.x, c.z);
      const f1 = new THREE.Mesh(G.cone7, flameMat), f2 = new THREE.Mesh(G.cone7, new THREE.MeshBasicMaterial({ color: 0xffe080 }));
      f1.position.set(c.x, y + 0.6, c.z); f2.position.set(c.x, y + 0.5, c.z);
      this.scene.add(f1, f2);
      this.anim.push((t) => { const k = 1 + Math.sin(t * 13 + c.x) * 0.12; f1.scale.set(0.9 * k, 1.2 * k, 0.9 * k); f2.scale.set(0.5, 0.7 * (2 - k), 0.5); });
    }
    const spray = new THREE.Mesh(G.cone8, new THREE.MeshLambertMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.6 }));
    spray.position.set(0, fy + 3.1, 0); spray.scale.set(0.7, 1.2, 0.7);
    this.scene.add(spray);
    this.anim.push((t) => { spray.scale.y = 1.1 + Math.sin(t * 6) * 0.15; });
  }

  // 지형 청크 하나 생성
  buildChunk(cx, cz) {
    const N = CHUNK / STEP + 1;
    const pos = new Float32Array(N * N * 3), nor = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3);
    const c = new THREE.Color();
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = cx * CHUNK + i * STEP, z = cz * CHUNK + j * STEP, k = (j * N + i) * 3;
      const h = heightAt(x, z);
      pos[k] = x; pos[k + 1] = h; pos[k + 2] = z;
      const hx = heightAt(x + 1, z) - heightAt(x - 1, z), hz = heightAt(x, z + 1) - heightAt(x, z - 1);
      const l = Math.hypot(hx, 2, hz);
      nor[k] = -hx / l; nor[k + 1] = 2 / l; nor[k + 2] = -hz / l;
      const cc = colorAt(x, z, h);
      c.setRGB(Math.min(1, cc[0] / 255), Math.min(1, cc[1] / 255), Math.min(1, cc[2] / 255), THREE.SRGBColorSpace);
      col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
    }
    const idx = [];
    for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
      const a = j * N + i, b = a + 1, d = a + N, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const terrain = new THREE.Mesh(g, this.mat);
    terrain.receiveShadow = true;
    this.scene.add(terrain);
    let props = null;
    const list = this.propsByChunk.get(cx + ',' + cz);
    if (list && list.length) {
      const parts = [];
      for (const p of list) {
        const m = mat4(p.x, p.y - 0.05, p.z, p.ry);
        for (const part of propParts(p)) parts.push({ geo: part.geo, c: part.c, m: m.clone().multiply(part.m) });
      }
      if (parts.length) {
        props = new THREE.Mesh(merge(parts), this.mat);
        props.castShadow = this.shadows; props.receiveShadow = true;
        this.scene.add(props);
      }
    }
    return { terrain, props };
  }

  // 카메라 주변 청크를 가까운 것부터 몇 개씩 생성/정리
  updateChunks(x, z, budget = 2) {
    const R = Math.ceil(this.viewDist / CHUNK) + 1;
    const ccx = Math.floor(x / CHUNK), ccz = Math.floor(z / CHUNK);
    const want = [];
    for (let dx = -R; dx <= R; dx++) for (let dz = -R; dz <= R; dz++) {
      const cx = ccx + dx, cz = ccz + dz;
      const mx = (cx + 0.5) * CHUNK, mz = (cz + 0.5) * CHUNK;
      const d = Math.hypot(mx - x, mz - z);
      if (d > this.viewDist + CHUNK || Math.hypot(mx, mz) > WORLD_R + 60) continue;
      want.push([d, cx, cz]);
    }
    want.sort((a, b) => a[0] - b[0]);
    const keep = new Set();
    let built = 0;
    for (const [, cx, cz] of want) {
      const k = cx + ',' + cz; keep.add(k);
      if (!this.chunks.has(k) && built < budget) { this.chunks.set(k, this.buildChunk(cx, cz)); built++; }
    }
    for (const [k, ch] of this.chunks) if (!keep.has(k)) {
      for (const m of [ch.terrain, ch.props]) if (m) { this.scene.remove(m); m.geometry.dispose(); }
      this.chunks.delete(k);
    }
    return { loaded: [...keep].filter((k) => this.chunks.has(k)).length, total: keep.size };
  }

  resize(w, h, pr) {
    this.gl.setPixelRatio(pr); this.gl.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  setViewDist(d) {
    this.viewDist = d;
    this.scene.fog.near = d * 0.55; this.scene.fog.far = d;
    this.camera.far = d + 120; this.camera.updateProjectionMatrix();
  }

  update(dt, t, tx, ty, tz) {
    this.target.x += (tx - this.target.x) * Math.min(1, dt * 10);
    this.target.y += (ty - this.target.y) * Math.min(1, dt * 6);
    this.target.z += (tz - this.target.z) * Math.min(1, dt * 10);
    if (Math.hypot(tx - this.target.x, tz - this.target.z) > 20) this.target.set(tx, ty, tz);
    const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
    const cam = this.camera;
    cam.position.set(this.target.x + Math.sin(this.camYaw) * cp * this.camDist, this.target.y + 1.2 + sp * this.camDist, this.target.z + Math.cos(this.camYaw) * cp * this.camDist);
    const gy = heightAt(cam.position.x, cam.position.z) + 1.5;
    if (cam.position.y < gy) cam.position.y = gy;
    cam.lookAt(this.target.x, this.target.y + 1.2, this.target.z);
    this.sky.position.copy(cam.position);
    this.sun.position.set(this.target.x - 40, this.target.y + 90, this.target.z + 30);
    this.sun.target.position.copy(this.target);
    this.clouds.rotation.y = t * 0.004;
    this.waterTex.offset.set(t * 0.004, t * 0.002);
    this.lavaMat.color.setRGB(1, 0.32 + Math.sin(t * 2) * 0.06, 0.1);
    for (const f of this.anim) f(t);
  }

  // 화면 좌표 → 지면 좌표
  groundAt(sx, sy) {
    const ndc = new THREE.Vector2((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    let t = 0;
    for (let i = 0; i < 80; i++) { const p = o.clone().addScaledVector(d, t); if (p.y <= heightAt(p.x, p.z)) return p; t += 2; }
    return null;
  }

  render() { this.gl.render(this.scene, this.camera); }
}

// 둥근 그림자 텍스처
let blob = null;
export function blobShadow() {
  if (!blob) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 4, 32, 32, 31);
    gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    blob = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
  }
  return blob;
}
