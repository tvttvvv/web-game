// 이펙트: 투사체 · 폭발 · 베기 · 파티클 · 바닥 경고 · 피해 숫자
import { THREE, G } from './renderer.js';
import { heightAt } from '../shared/world.js';

const add = THREE.AdditiveBlending;
const PROJ = {
  arrow: { geo: 'arrow', color: 0xe8d8b0, speed: 24 }, bolt: { geo: G.sph, color: 0x7fb8ff, speed: 22, glow: true, size: 0.45 },
  holy: { geo: G.oct, color: 0xffe070, speed: 22, glow: true, size: 0.5 }, fire: { geo: G.sph, color: 0xff7030, speed: 16, glow: true, size: 0.5 },
  spore: { geo: G.sph, color: 0xa060e0, speed: 14, glow: true, size: 0.4 }, fireball: { geo: G.sph, color: 0xff6a20, speed: 22, glow: true, size: 0.9 },
  bigarrow: { geo: 'arrow', color: 0xb0ffd0, speed: 34, size: 2.2, glow: true },
};

export class FX {
  constructor(scene, camera, numsEl) {
    this.scene = scene; this.cam = camera; this.nums = numsEl;
    this.list = [];
    this.arrowGeo = new THREE.BoxGeometry(0.06, 0.06, 0.9);
    this.mats = new Map();
    this.maxP = 400;
    this.pm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ blending: add, transparent: true, depthWrite: false }), this.maxP);
    this.pm.frustumCulled = false; this.pm.count = 0;
    this.pm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.parts = [];
    scene.add(this.pm);
    this._m = new THREE.Matrix4(); this._c = new THREE.Color(); this._v = new THREE.Vector3();
    this.numCount = 0;
  }
  mat(color, opacity = 1, glow = true) {
    const k = color + ':' + opacity + glow;
    let m = this.mats.get(k);
    if (!m) { m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: glow ? add : THREE.NormalBlending, side: THREE.DoubleSide }); this.mats.set(k, m); }
    return m;
  }
  // 투명도를 바꾸는 효과는 각자 재질을 씀 (같은 색 효과끼리 서로 간섭하지 않게)
  own(color, opacity = 1, glow = true) {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: glow ? add : THREE.NormalBlending, side: THREE.DoubleSide });
    m.userData.own = true;
    return m;
  }
  run(obj, dur, upd, scene = true) {
    if (obj && scene) this.scene.add(obj);
    this.list.push({ obj, t: 0, dur, upd });
  }

  // 파티클
  burst(x, y, z, color, n = 10, o = {}) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= this.maxP) this.parts.shift();
      const a = Math.random() * Math.PI * 2, sp = (o.speed || 4) * (0.4 + Math.random() * 0.8);
      this.parts.push({ x, y, z, vx: Math.cos(a) * sp, vy: (o.up ?? 3) * (0.3 + Math.random()), vz: Math.sin(a) * sp, life: (o.life || 0.6) * (0.6 + Math.random() * 0.6), max: 1, s: (o.size || 0.14) * (0.6 + Math.random() * 0.8), c, g: o.grav ?? 9 });
    }
  }
  rise(x, y, z, color, n = 12, r = 1) {
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, d = Math.random() * r; this.burst(x + Math.cos(a) * d, y + Math.random() * 0.5, z + Math.sin(a) * d, color, 1, { speed: 0.3, up: 3, grav: -1, life: 1 }); }
  }

  ring(x, z, r, color, dur = 0.5, y = null, thick = 0.25) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), this.own(color, 0.9));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, (y ?? heightAt(x, z)) + 0.15, z);
    this.run(m, dur, (k) => { const s = r * (0.3 + k * 0.7); m.scale.set(s, s, s); m.material.opacity = 0.9 * (1 - k); void thick; });
  }
  sphere(x, y, z, r, color, dur = 0.4, op = 0.45) {
    const m = new THREE.Mesh(G.sph16, this.own(color, op));
    m.position.set(x, y, z);
    this.run(m, dur, (k) => { m.scale.setScalar(r * 2 * (0.3 + k * 0.7)); m.material.opacity = op * (1 - k); });
  }
  slash(x, y, z, ry, color = 0xffffff, r = 2.4, arc = 2.2, dur = 0.22) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.55, r, 24, 1, -arc / 2, arc), this.own(color, 0.85));
    m.rotation.set(-Math.PI / 2, 0, ry + Math.PI / 2);
    m.position.set(x, y, z);
    this.run(m, dur, (k) => { m.material.opacity = 0.85 * (1 - k); m.rotation.z = ry + Math.PI / 2 + (k - 0.5) * 0.8; m.scale.setScalar(0.85 + k * 0.25); });
  }
  pillar(x, z, color, dur = 1.2, h = 8) {
    const y = heightAt(x, z);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, h, 16, 1, true), this.own(color, 0.55));
    m.position.set(x, y + h / 2, z);
    this.run(m, dur, (k) => { m.material.opacity = 0.55 * (1 - k); m.scale.set(1 - k * 0.5, 1, 1 - k * 0.5); });
    this.ring(x, z, 3, color, dur * 0.8);
    this.rise(x, y, z, color, 20, 1.2);
  }
  sector(x, z, r, ry, arcDeg, color, dur = 0.35) {
    const arc = arcDeg * Math.PI / 180;
    const m = new THREE.Mesh(new THREE.CircleGeometry(r, 24, -arc / 2, arc), this.own(color, 0.45));
    m.rotation.set(-Math.PI / 2, 0, ry + Math.PI / 2);
    m.position.set(x, heightAt(x, z) + 0.2, z);
    this.run(m, dur, (k) => { m.material.opacity = 0.45 * (1 - k); });
  }

  // 투사체: to는 {x,y,z} 또는 그런 값을 돌려주는 함수
  proj(kind, from, to, onEnd, size) {
    const P = PROJ[kind] || PROJ.bolt;
    const geo = P.geo === 'arrow' ? this.arrowGeo : P.geo;
    const m = new THREE.Mesh(geo, P.glow ? this.mat(P.color, 1) : new THREE.MeshBasicMaterial({ color: P.color }));
    m.scale.setScalar(size || P.size || 1);
    m.position.set(from.x, from.y, from.z);
    const tgt = () => (typeof to === 'function' ? to() : to);
    const t0 = tgt();
    const d = Math.hypot(t0.x - from.x, t0.y - from.y, t0.z - from.z);
    const dur = Math.max(0.08, d / P.speed);
    const s = { x: from.x, y: from.y, z: from.z };
    this.run(m, dur, (k, dt, done) => {
      const t = tgt() || t0;
      const nx = s.x + (t.x - s.x) * k, ny = s.y + (t.y - s.y) * k + Math.sin(k * Math.PI) * (kind === 'arrow' ? d * 0.04 : 0), nz = s.z + (t.z - s.z) * k;
      m.lookAt(nx + (t.x - s.x), ny + (t.y - s.y) * 0.1, nz + (t.z - s.z));
      m.position.set(nx, ny, nz);
      if (P.glow && Math.random() < 0.6) this.burst(nx, ny, nz, P.color, 1, { speed: 0.4, up: 0.3, grav: 0, life: 0.25, size: (P.size || 0.5) * 0.4 });
      if (done && onEnd) onEnd(t);
    });
  }

  // 보스 바닥 경고 (빨간 원이 차오름)
  warn(shape, x, z, r, ms, ry = 0, arc = 0) {
    const y = heightAt(x, z) + 0.12;
    const g = new THREE.Group();
    const geoO = shape === 'cone' ? new THREE.CircleGeometry(r, 32, -arc * Math.PI / 360, arc * Math.PI / 180) : new THREE.CircleGeometry(r, 40);
    const outer = new THREE.Mesh(geoO, this.own(0xff3020, 0.28, false));
    const inner = new THREE.Mesh(geoO, this.mat(0xff5030, 0.45, false));
    const edge = shape === 'cone' ? null : new THREE.Mesh(new THREE.RingGeometry(r * 0.95, r, 48), this.mat(0xff6040, 0.9, false));
    for (const m of [outer, inner, edge]) if (m) { m.rotation.set(-Math.PI / 2, 0, shape === 'cone' ? ry + Math.PI / 2 : 0); g.add(m); }
    g.position.set(x, y, z);
    this.run(g, ms / 1000, (k) => { inner.scale.setScalar(Math.max(0.01, k)); outer.material.opacity = 0.2 + Math.sin(k * 20) * 0.06; });
  }
  boom(kind, x, z, r) {
    const y = heightAt(x, z) + 0.5;
    const col = { m1: 0xff6a20, m4: 0xff5a10, c2: 0xfff0a0, slime_king: 0x4ab2ff, treant: 0x7ad050, ancient_golem: 0xc8a070, lava_giant: 0xff5020 }[kind] || 0xffa040;
    this.sphere(x, y, z, r * 0.9, col, 0.45, 0.4);
    this.ring(x, z, r * 1.1, col, 0.5);
    this.burst(x, y, z, col, 24, { speed: r * 2.2, up: 5, size: 0.22 });
  }

  // 떠오르는 숫자 (DOM)
  number(x, y, z, text, cls) {
    if (!this.nums || this.numCount > 50) return;
    const v = this._v.set(x, y, z).project(this.cam);
    if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return;
    const el = document.createElement('div');
    el.className = 'num ' + (cls || '');
    el.textContent = text;
    el.style.left = ((v.x + 1) / 2 * innerWidth + (Math.random() - 0.5) * 30) + 'px';
    el.style.top = ((1 - v.y) / 2 * innerHeight) + 'px';
    this.nums.appendChild(el);
    this.numCount++;
    setTimeout(() => { el.remove(); this.numCount--; }, 1000);
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.t += dt;
      const k = Math.min(1, e.t / e.dur);
      const done = e.t >= e.dur;
      if (e.upd) e.upd(k, dt, done);
      if (done) {
        this.list.splice(i, 1);
        if (e.obj) {
          this.scene.remove(e.obj);
          e.obj.traverse?.((o) => {
            if (o.geometry && !Object.values(G).includes(o.geometry) && o.geometry !== this.arrowGeo) o.geometry.dispose();
            if (o.material && o.material.userData.own) o.material.dispose();
          });
        }
      }
    }
    let n = 0;
    const m = this._m;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) { this.parts.splice(i, 1); continue; }
      p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vx *= 0.97; p.vz *= 0.97;
    }
    for (const p of this.parts) {
      const s = p.s * Math.min(1, p.life * 3);
      m.makeScale(s, s, s); m.setPosition(p.x, p.y, p.z);
      this.pm.setMatrixAt(n, m); this.pm.setColorAt(n, p.c);
      n++;
    }
    this.pm.count = n;
    this.pm.instanceMatrix.needsUpdate = true;
    if (this.pm.instanceColor) this.pm.instanceColor.needsUpdate = true;
  }
}
