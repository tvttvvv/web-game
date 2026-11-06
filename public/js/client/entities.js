// 플레이어·몹 모델 (박스 + 코드로 그린 픽셀 스킨), 이름표, 손에 든 아이템, 1인칭 손
import { THREE } from './renderer.js';
import { ITEMS } from '../shared/items.js';
import { BLOCKS, faceTile } from '../shared/blocks.js';
import { rayBox } from '../shared/physics.js';
import { MOB, MOB_TYPES } from '../core/game.js';

export const SKIN_TONES = ['#f2c9a0', '#dca878', '#a8714a', '#6e4a2e'];
export const HAIR = ['#3b2a1a', '#7a4a1e', '#d8b040', '#1c1c1c', '#a33a2a', '#e8e8e8', '#5b3a8c', '#2a7a4a'];
export const SHIRT = ['#3f8fd6', '#d9534f', '#5cb85c', '#f0ad4e', '#8e6bd1', '#e47bb2', '#2fb5a5', '#f2f2f2', '#444444', '#16a085', '#d35400', '#f1c40f'];
export const PANTS = ['#2e3a6b', '#3a3a3a', '#5a3a20', '#2a5a3a', '#6b2e4a', '#20506b'];

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb = (c, k = 0) => `rgb(${Math.max(0, Math.min(255, c[0] + k))},${Math.max(0, Math.min(255, c[1] + k))},${Math.max(0, Math.min(255, c[2] + k))})`;
function rnd(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- 스킨 아틀라스 ----------
class Skin {
  constructor(w = 128, h = 128) {
    this.c = document.createElement('canvas'); this.c.width = w; this.c.height = h;
    this.g = this.c.getContext('2d'); this.W = w; this.H = h;
    this.x = 0; this.y = 0; this.row = 0; this.r = rnd(w * 7 + h);
  }
  alloc(w, h) {
    if (this.x + w > this.W) { this.x = 0; this.y += this.row; this.row = 0; }
    const p = [this.x, this.y]; this.x += w; this.row = Math.max(this.row, h);
    return p;
  }
  fill(x, y, w, h, col, noise = 10) {
    const c = hex(col);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { this.g.fillStyle = rgb(c, (this.r() - 0.5) * noise * 2); this.g.fillRect(x + i, y + j, 1, 1); }
  }
  px(x, y, col) { this.g.fillStyle = col; this.g.fillRect(x, y, 1, 1); }
  // paint(face, x, y, w, h) — face: px nx py ny pz nz (nz = 앞)
  box(w, h, d, paint) {
    const sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    const names = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
    const rects = sizes.map(([fw, fh], i) => { const [x, y] = this.alloc(fw, fh); paint(names[i], x, y, fw, fh); return [x, y, fw, fh]; });
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    for (let f = 0; f < 6; f++) {
      const [x, y, fw, fh] = rects[f];
      const u0 = x / this.W, u1 = (x + fw) / this.W, vt = 1 - y / this.H, vb = 1 - (y + fh) / this.H;
      uv.setXY(f * 4, u0, vt); uv.setXY(f * 4 + 1, u1, vt); uv.setXY(f * 4 + 2, u0, vb); uv.setXY(f * 4 + 3, u1, vb);
    }
    uv.needsUpdate = true;
    return geo;
  }
  texture() {
    const t = new THREE.CanvasTexture(this.c);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    return t;
  }
}

function part(geo, mat, px, py, pz) { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); return m; }
function pivot(x, y, z, child) { const g = new THREE.Group(); g.position.set(x, y, z); if (child) g.add(child); return g; }

// ---------- 사람형 (플레이어/좀비) ----------
function humanoid(cols, zombie) {
  const S = new Skin(128, 64);
  const skin = cols.skin, hair = cols.hair, shirt = cols.shirt, pants = cols.pants;
  const head = S.box(8, 8, 8, (f, x, y, w, h) => {
    if (f === 'py') return S.fill(x, y, w, h, hair, 8);
    if (f === 'ny') return S.fill(x, y, w, h, skin, 4);
    S.fill(x, y, w, h, skin, 5);
    if (f === 'pz') { S.fill(x, y, w, zombie ? 2 : 6, hair, 8); return; }
    if (f === 'nz') {
      if (!zombie) S.fill(x, y, w, 2, hair, 8);
      S.px(x + 1, y + 4, '#ffffff'); S.px(x + 2, y + 4, zombie ? '#101010' : '#3b5bdb');
      S.px(x + 5, y + 4, zombie ? '#101010' : '#3b5bdb'); S.px(x + 6, y + 4, '#ffffff');
      S.fill(x + 3, y + 6, 2, 1, zombie ? '#2f4f2a' : '#a0604a', 4);
      return;
    }
    S.fill(x, y, w, zombie ? 1 : 3, hair, 8);
  });
  const body = S.box(8, 12, 4, (f, x, y, w, h) => {
    S.fill(x, y, w, h, shirt, 8);
    if (f === 'nz' || f === 'pz') S.fill(x, y + h - 1, w, 1, '#3a2a1a', 4);
  });
  const arm = S.box(4, 12, 4, (f, x, y, w, h) => {
    if (f === 'py') return S.fill(x, y, w, h, shirt, 8);
    if (f === 'ny') return S.fill(x, y, w, h, skin, 4);
    S.fill(x, y, w, 4, shirt, 8); S.fill(x, y + 4, w, h - 4, skin, 5);
  });
  const leg = S.box(4, 12, 4, (f, x, y, w, h) => {
    if (f === 'ny') return S.fill(x, y, w, h, '#2a2a2a', 4);
    S.fill(x, y, w, h, pants, 8);
    if (f !== 'py') S.fill(x, y + 10, w, 2, '#3a3a3a', 6);
  });
  const mat = new THREE.MeshBasicMaterial({ map: S.texture() });
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);
  const headP = pivot(0, 24, 0, part(head, mat, 0, 4, 0));
  const armR = pivot(-6, 22, 0, part(arm, mat, 0, -4, 0));
  const armL = pivot(6, 22, 0, part(arm, mat, 0, -4, 0));
  const legR = pivot(-2, 12, 0, part(leg, mat, 0, -6, 0));
  const legL = pivot(2, 12, 0, part(leg, mat, 0, -6, 0));
  model.add(part(body, mat, 0, 18, 0), headP, armR, armL, legR, legL);
  if (zombie) { armR.rotation.x = Math.PI / 2; armL.rotation.x = Math.PI / 2; }
  return { root, model, head: headP, armR, armL, legR, legL, mats: [mat], scale: 1.8 / 32 };
}

function quadruped(type) {
  const S = new Skin(128, 128);
  const mat = new THREE.MeshBasicMaterial({ map: null });
  const root = new THREE.Group(), model = new THREE.Group();
  root.add(model);
  let body, head, legGeo, legH, bodyY, headPos, snout = null;
  if (type === 'pig') {
    const pink = '#f0a5a2';
    body = S.box(10, 8, 16, (f, x, y, w, h) => S.fill(x, y, w, h, pink, 10));
    head = S.box(8, 8, 8, (f, x, y, w, h) => { S.fill(x, y, w, h, pink, 8); if (f === 'nz') { S.px(x + 1, y + 2, '#ffffff'); S.px(x + 2, y + 2, '#202020'); S.px(x + 5, y + 2, '#202020'); S.px(x + 6, y + 2, '#ffffff'); } });
    snout = S.box(4, 3, 1, (f, x, y, w, h) => { S.fill(x, y, w, h, '#f7c0bd', 4); if (f === 'nz') { S.px(x + 1, y + 1, '#8a4a4a'); S.px(x + 2, y + 1, '#8a4a4a'); } });
    legGeo = S.box(4, 6, 4, (f, x, y, w, h) => { S.fill(x, y, w, h, pink, 8); if (f !== 'py' && f !== 'ny') S.fill(x, y + h - 1, w, 1, '#8a5a50', 4); });
    legH = 6; bodyY = 10; headPos = [0, 12, -11];
  } else if (type === 'sheep') {
    body = S.box(10, 9, 16, (f, x, y, w, h) => S.fill(x, y, w, h, '#eceeee', 14));
    head = S.box(6, 6, 8, (f, x, y, w, h) => { S.fill(x, y, w, h, f === 'nz' ? '#d8c3a5' : '#eceeee', 10); if (f === 'nz') { S.px(x + 1, y + 2, '#ffffff'); S.px(x + 1, y + 3, '#202020'); S.px(x + 4, y + 3, '#202020'); S.px(x + 4, y + 2, '#ffffff'); S.fill(x + 2, y + 4, 2, 1, '#e8a0a0', 2); } });
    legGeo = S.box(4, 8, 4, (f, x, y, w, h) => { S.fill(x, y, w, h, '#d8c3a5', 8); S.fill(x, y, w, 3, '#eceeee', 10); });
    legH = 8; bodyY = 12.5; headPos = [0, 16, -10];
  } else {
    body = S.box(6, 6, 8, (f, x, y, w, h) => S.fill(x, y, w, h, '#f4f4f4', 8));
    head = S.box(4, 6, 3, (f, x, y, w, h) => { S.fill(x, y, w, h, '#f4f4f4', 6); if (f === 'px' || f === 'nx') S.px(x + 1, y + 2, '#202020'); if (f === 'nz') { S.px(x, y + 2, '#202020'); S.px(x + 3, y + 2, '#202020'); } });
    snout = S.box(4, 2, 2, (f, x, y, w, h) => S.fill(x, y, w, h, '#f0a020', 6));
    legGeo = S.box(1, 5, 1, (f, x, y, w, h) => S.fill(x, y, w, h, '#e0a030', 4));
    legH = 5; bodyY = 8; headPos = [0, 12, -4];
  }
  mat.map = S.texture();
  model.add(part(body, mat, 0, bodyY, 0));
  const headP = pivot(headPos[0], headPos[1], headPos[2], part(head, mat, 0, 0, type === 'chicken' ? 0 : -2));
  if (snout) headP.add(part(snout, mat, 0, type === 'chicken' ? -0.5 : -1, type === 'chicken' ? -2.5 : -6.5));
  if (type === 'chicken') {
    const w = S.box(2, 2, 2, (f, x, y, ww, hh) => S.fill(x, y, ww, hh, '#d02020', 6));
    mat.map = S.texture();
    headP.add(part(w, mat, 0, -2.5, -2.2));
  }
  model.add(headP);
  const legs = [];
  const lx = type === 'chicken' ? 1.5 : 3, lz = type === 'chicken' ? 0.5 : type === 'pig' ? 5 : 5;
  const spots = type === 'chicken' ? [[-lx, 0], [lx, 0]] : [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]];
  for (const [x, z] of spots) { const l = pivot(x, legH, z, part(legGeo, mat, 0, -legH / 2, 0)); legs.push(l); model.add(l); }
  const wings = [];
  if (type === 'chicken') {
    const wg = S.box(1, 4, 6, (f, x, y, w, h) => S.fill(x, y, w, h, '#e8e8e8', 8));
    mat.map = S.texture();
    for (const sx of [-3.5, 3.5]) { const p = pivot(sx, 10, 0, part(wg, mat, 0, -2, 0)); wings.push(p); model.add(p); }
  }
  return { root, model, head: headP, legs, wings, mats: [mat], scale: 1 / 16 };
}

function slime() {
  const S = new Skin(128, 64);
  const outer = S.box(16, 16, 16, (f, x, y, w, h) => S.fill(x, y, w, h, '#6fcf5a', 14));
  const inner = S.box(10, 10, 10, (f, x, y, w, h) => {
    S.fill(x, y, w, h, '#4caa3c', 10);
    if (f === 'nz') { S.fill(x + 2, y + 3, 2, 2, '#163a12', 0); S.fill(x + 6, y + 3, 2, 2, '#163a12', 0); S.fill(x + 4, y + 7, 2, 1, '#163a12', 0); }
  });
  const tex = S.texture();
  const inMat = new THREE.MeshBasicMaterial({ map: tex });
  const outMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.55, depthWrite: false });
  const root = new THREE.Group(), model = new THREE.Group();
  root.add(model);
  model.add(part(inner, inMat, 0, 6, 0));
  const o = part(outer, outMat, 0, 8, 0); o.renderOrder = 3;
  model.add(o);
  return { root, model, mats: [inMat, outMat], scale: 0.9 / 16 };
}

// 텍스트 스프라이트 (이름표/말풍선)
function textSprite(text, bg, fg, size = 28) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `bold ${size}px system-ui, sans-serif`;
  const lines = String(text).split('\n');
  const w = Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width))) + 16, h = lines.length * (size + 6) + 8;
  c.width = w; c.height = h;
  g.font = `bold ${size}px system-ui, sans-serif`;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.textBaseline = 'top';
  lines.forEach((l, i) => g.fillText(l, 8, 6 + i * (size + 6)));
  const t = new THREE.CanvasTexture(c);
  t.minFilter = THREE.LinearFilter;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  sp.scale.set(w / 110, h / 110, 1);
  sp.renderOrder = 20;
  return sp;
}

export function skinColors(skin) {
  const s = skin || [0, 0, 0, 0];
  return { skin: SKIN_TONES[s[0] % SKIN_TONES.length], hair: HAIR[s[1] % HAIR.length], shirt: SHIRT[s[2] % SHIRT.length], pants: PANTS[s[3] % PANTS.length] };
}

// 손에 든 아이템 메시 (블록=작은 큐브, 아이템=판)
export class ItemMeshes {
  constructor(atlas, atlasTex, icons) {
    this.atlas = atlas; this.atlasTex = atlasTex; this.icons = icons;
    this.blockMat = new THREE.MeshBasicMaterial({ map: atlasTex, alphaTest: 0.5 });
    this.cache = new Map();
  }
  make(id) {
    const it = ITEMS[id];
    if (!it) return null;
    if (it.icon && (it.icon.type === 'cube' || it.icon.type === 'slab' || it.icon.type === 'stairs')) {
      const b = it.block;
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const uv = geo.attributes.uv;
      for (let f = 0; f < 6; f++) {
        const ti = this.atlas.index.get(faceTile(b, f)) ?? 0;
        const u0 = ((ti % this.atlas.cols) * 16) / this.atlas.W, u1 = u0 + 16 / this.atlas.W;
        const v1 = 1 - (((ti / this.atlas.cols) | 0) * 16) / this.atlas.H, v0 = v1 - 16 / this.atlas.H;
        uv.setXY(f * 4, u0, v1); uv.setXY(f * 4 + 1, u1, v1); uv.setXY(f * 4 + 2, u0, v0); uv.setXY(f * 4 + 3, u1, v0);
      }
      const mat = this.blockMat.clone();
      const m = new THREE.Mesh(geo, mat);
      m.userData.block = true;
      return m;
    }
    let tex = this.cache.get(id);
    if (!tex) {
      tex = new THREE.CanvasTexture(this.icons.canvas(id));
      tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
      this.cache.set(id, tex);
    }
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }));
    return m;
  }
}

// ---------- 엔티티 관리 ----------
export class Entities {
  constructor(renderer, items) {
    this.r = renderer;
    this.items = items;
    this.players = new Map(); // id → ent
    this.mobs = new Map();
    this.info = new Map();    // id → { name, skin }
    this.selfId = 0;
    this.self = null;
    this.showNames = true;
  }

  setInfo(id, name, skin) {
    const old = this.info.get(id);
    this.info.set(id, { name, skin });
    const e = this.players.get(id) || (id === this.selfId ? this.self : null);
    if (e && (!old || old.name !== name || String(old.skin) !== String(skin))) this.rebuildPlayer(e, name, skin);
  }
  removePlayer(id) { const e = this.players.get(id); if (e) { this.r.entityRoot.remove(e.m.root); this.players.delete(id); } this.info.delete(id); }

  makePlayer(id) {
    const inf = this.info.get(id) || { name: '?', skin: [0, 0, 0, 0] };
    const e = { id, x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, yaw: 0, tyaw: 0, pitch: 0, fl: 0, held: 0, hp: 20, walk: 0, swing: 0, m: null, tag: null, bubble: null, bubbleT: 0, heldMesh: null, heldId: 0 };
    this.rebuildPlayer(e, inf.name, inf.skin);
    return e;
  }
  rebuildPlayer(e, name, skin) {
    if (e.m) this.r.entityRoot.remove(e.m.root);
    e.m = humanoid(skinColors(skin), false);
    e.m.model.scale.setScalar(e.m.scale);
    e.tag = textSprite(name, 'rgba(0,0,0,0.45)', '#ffffff');
    e.tag.position.y = 2.15;
    e.m.root.add(e.tag);
    e.heldId = -1;
    this.r.entityRoot.add(e.m.root);
  }
  ensureSelf(id) {
    this.selfId = id;
    if (!this.self) { this.self = this.makePlayer(id); this.self.tag.visible = false; }
    return this.self;
  }

  bubble(id, text) {
    const e = this.players.get(id) || (id === this.selfId ? this.self : null);
    if (!e) return;
    if (e.bubble) e.m.root.remove(e.bubble);
    e.bubble = textSprite(text.length > 24 ? text.slice(0, 24) + '…' : text, 'rgba(255,255,255,0.92)', '#111111', 26);
    e.bubble.position.y = 2.55;
    e.m.root.add(e.bubble);
    e.bubbleT = 6;
  }

  // 's' 메시지
  state(msg) {
    const seen = new Set();
    for (const r of msg.p) {
      const [id, x, y, z, yaw, pitch, fl, held, hp] = r;
      seen.add(id);
      let e = this.players.get(id);
      if (!e) { e = this.makePlayer(id); e.x = e.tx = x; e.y = e.ty = y; e.z = e.tz = z; e.yaw = yaw; this.players.set(id, e); }
      e.tx = x; e.ty = y; e.tz = z; e.tyaw = yaw; e.pitch = pitch; e.fl = fl; e.held = held; e.hp = hp;
      if (fl & 4) e.swing = Math.max(e.swing, 0.01);
    }
    for (const [id, e] of this.players) if (!seen.has(id)) { this.r.entityRoot.remove(e.m.root); this.players.delete(id); }
    const ms = new Set();
    for (const r of msg.m) {
      const [id, ti, x, y, z, yaw, hp, fl] = r;
      ms.add(id);
      let e = this.mobs.get(id);
      const type = MOB_TYPES[ti];
      if (!e) {
        const m = type === 'slime' ? slime() : type === 'zombie' ? humanoid({ skin: '#5f9e4f', hair: '#3a6a30', shirt: '#2aa5a5', pants: '#3b44a0' }, true) : quadruped(type);
        m.model.scale.setScalar(m.scale);
        e = { id, type, m, x, y, z, tx: x, ty: y, tz: z, yaw, tyaw: yaw, hp, fl, walk: 0, hop: 0 };
        this.r.entityRoot.add(m.root);
        this.mobs.set(id, e);
      }
      if (e.hp > hp) e.hurt = 0.3;
      e.tx = x; e.ty = y; e.tz = z; e.tyaw = yaw; e.hp = hp; e.fl = fl;
    }
    for (const [id, e] of this.mobs) if (!ms.has(id)) { this.r.entityRoot.remove(e.m.root); this.mobs.delete(id); }
  }

  update(dt, lightAt, selfState) {
    const k = 1 - Math.exp(-dt * 14);
    const lerpYaw = (a, b) => { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return a + d * k; };
    const all = [...this.players.values()];
    if (this.self && selfState) {
      const s = this.self;
      s.tx = selfState.x; s.ty = selfState.y; s.tz = selfState.z; s.tyaw = selfState.yaw; s.pitch = selfState.pitch; s.fl = selfState.fl; s.held = selfState.held;
      s.x = s.tx; s.y = s.ty; s.z = s.tz; s.yaw = s.tyaw;
      s.m.root.visible = !!selfState.visible;
      if (selfState.swing) s.swing = Math.max(s.swing, 0.01);
      all.push(s);
    }
    for (const e of all) {
      const ox = e.x, oz = e.z;
      if (e !== this.self) { e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k; e.z += (e.tz - e.z) * k; e.yaw = lerpYaw(e.yaw, e.tyaw); }
      const sp = Math.hypot(e.x - ox, e.z - oz) / Math.max(dt, 1e-4);
      e.walk += dt * Math.min(sp, 7) * 2.2;
      const amp = Math.min(1, sp / 4) * 0.8;
      const M = e.m;
      M.root.position.set(e.x, e.y, e.z);
      M.root.rotation.y = e.yaw;
      M.head.rotation.x = e.pitch;
      const sneak = e.fl & 1;
      M.model.position.y = sneak ? -0.12 : 0;
      M.legR.rotation.x = Math.sin(e.walk) * amp; M.legL.rotation.x = -Math.sin(e.walk) * amp;
      M.armL.rotation.x = Math.sin(e.walk) * amp * 0.8;
      if (e.swing > 0) { e.swing += dt * 4.5; if (e.swing >= 1) e.swing = 0; }
      M.armR.rotation.x = -Math.sin(e.walk) * amp * 0.8 + (e.swing > 0 ? Math.sin(e.swing * Math.PI) * 1.6 : 0);
      if (e.held !== e.heldId) {
        if (e.heldMesh) { M.armR.remove(e.heldMesh); e.heldMesh = null; }
        e.heldId = e.held;
        if (e.held) {
          const im = this.items.make(e.held);
          if (im) {
            if (im.userData.block) { im.scale.setScalar(5); im.position.set(0, -11, -3); }
            else { im.scale.setScalar(9); im.position.set(0, -11, -4); im.rotation.set(0, Math.PI / 2, Math.PI / 4); }
            e.heldMesh = im; M.armR.add(im);
          }
        }
      }
      const b = lightAt(e.x, e.y + 1.4, e.z);
      for (const mat of M.mats) mat.color.setScalar(b);
      if (e.heldMesh) e.heldMesh.material.color.setScalar(b);
      if (e.tag) e.tag.visible = e !== this.self && this.showNames;
      if (e.bubble) { e.bubbleT -= dt; if (e.bubbleT <= 0) { M.root.remove(e.bubble); e.bubble = null; } }
    }
    for (const e of this.mobs.values()) {
      const ox = e.x, oz = e.z;
      e.x += (e.tx - e.x) * k; e.y += (e.ty - e.y) * k; e.z += (e.tz - e.z) * k;
      e.yaw = lerpYaw(e.yaw, e.tyaw);
      const sp = Math.hypot(e.x - ox, e.z - oz) / Math.max(dt, 1e-4);
      e.walk += dt * Math.min(sp, 6) * 3;
      const amp = Math.min(1, sp / 2.5) * 0.7;
      const M = e.m;
      M.root.position.set(e.x, e.y, e.z);
      M.root.rotation.y = e.yaw;
      if (e.type === 'zombie') {
        M.legR.rotation.x = Math.sin(e.walk) * amp; M.legL.rotation.x = -Math.sin(e.walk) * amp;
        const atk = e.fl & 4 ? 0.5 : 0;
        M.armR.rotation.x = Math.PI / 2 - atk + Math.sin(e.walk * 0.5) * 0.05; M.armL.rotation.x = Math.PI / 2 - atk - Math.sin(e.walk * 0.5) * 0.05;
      } else if (e.type === 'slime') {
        const air = e.fl & 8;
        const target = air ? 1.25 : 0.82;
        e.hop += (target - e.hop || 0) * Math.min(1, dt * 10);
        const s = e.hop || 1;
        M.model.scale.set(e.m.scale / Math.sqrt(s), e.m.scale * s, e.m.scale / Math.sqrt(s));
      } else {
        e.legs = e.m.legs;
        M.legs.forEach((l, i) => { l.rotation.x = Math.sin(e.walk + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * amp; });
        if (M.wings.length) { const f = e.fl & 8 ? Math.sin(performance.now() / 40) * 0.9 : 0; M.wings[0].rotation.z = f; M.wings[1].rotation.z = -f; }
        if (M.head) M.head.rotation.x = Math.sin(performance.now() / 900 + e.id) * 0.08;
      }
      let b = lightAt(e.x, e.y + 0.8, e.z);
      if (e.hurt > 0) e.hurt -= dt;
      const hurt = (e.fl & 1) || e.hurt > 0;
      const burn = e.fl & 2;
      for (const mat of M.mats) {
        if (hurt) mat.color.setRGB(Math.max(b, 0.6) * 1.0, b * 0.35, b * 0.35);
        else if (burn) mat.color.setRGB(1, 0.55 + Math.random() * 0.2, 0.3);
        else mat.color.setScalar(b);
      }
      e.burnFx = burn;
    }
  }

  // 광선과 몹 충돌 (가장 가까운 것)
  raycastMobs(ox, oy, oz, dx, dy, dz, max) {
    let best = null;
    for (const e of this.mobs.values()) {
      const T = MOB[e.type];
      const hit = rayBox(ox, oy, oz, dx, dy, dz, [e.x - T.w / 2, e.y, e.z - T.w / 2, e.x + T.w / 2, e.y + T.h, e.z + T.w / 2]);
      if (hit && hit.t <= max && (!best || hit.t < best.dist)) best = { id: e.id, dist: hit.t, type: e.type };
    }
    return best;
  }

  clear() {
    for (const e of this.players.values()) this.r.entityRoot.remove(e.m.root);
    for (const e of this.mobs.values()) this.r.entityRoot.remove(e.m.root);
    this.players.clear(); this.mobs.clear();
  }
}

// ---------- 1인칭 손 ----------
export class Hand {
  constructor(renderer, items) {
    this.r = renderer; this.items = items;
    this.group = new THREE.Group();
    renderer.handCam.add(this.group);
    this.swing = 0; this.held = -1; this.itemMesh = null; this.bob = 0; this.eat = 0;
    this.setSkin([0, 0, 0, 0]);
  }
  setSkin(skin) {
    if (this.arm) this.group.remove(this.arm);
    const keep = this.held; this.held = -1;
    const cols = skinColors(skin);
    const S = new Skin(64, 32);
    const geo = S.box(4, 12, 4, (f, x, y, w, h) => { S.fill(x, y, w, h, cols.skin, 5); if (f !== 'ny') S.fill(x, y, w, 3, cols.shirt, 8); });
    this.armMat = new THREE.MeshBasicMaterial({ map: S.texture() });
    this.arm = new THREE.Mesh(geo, this.armMat);
    this.arm.scale.setScalar(0.035);
    this.group.add(this.arm);
    if (this.itemMesh) { this.group.remove(this.itemMesh); this.itemMesh = null; }
    this.setHeld(keep > 0 ? keep : 0);
  }
  setHeld(id) {
    if (id === this.held) return;
    this.held = id;
    if (this.itemMesh) { this.group.remove(this.itemMesh); this.itemMesh = null; }
    this.arm.visible = !id;
    if (!id) return;
    const m = this.items.make(id);
    if (!m) return;
    if (m.userData.block) { m.scale.setScalar(0.26); m.rotation.set(0.15, 0.7, 0); }
    else { m.scale.setScalar(0.36); m.rotation.set(0, -Math.PI / 2.6, 0.2); }
    this.itemMesh = m;
    this.group.add(m);
  }
  update(dt, brightness, moving, visible) {
    this.group.visible = visible;
    if (this.swing > 0) { this.swing += dt * 4.2; if (this.swing >= 1) this.swing = 0; }
    if (this.eat > 0) this.eat = Math.max(0, this.eat - dt);
    this.bob += dt * (moving ? 9 : 0);
    const s = Math.sin(this.swing * Math.PI);
    const bx = Math.sin(this.bob) * 0.012, by = Math.abs(Math.cos(this.bob)) * 0.012;
    const eatY = this.eat > 0 ? Math.sin(this.eat * 30) * 0.02 - 0.08 : 0;
    this.arm.position.set(0.4 + bx - s * 0.12, -0.42 + by - s * 0.05, -0.6 - s * 0.1);
    this.arm.rotation.set(-0.6 - s * 1.0, 0.3 - s * 0.3, 0.12);
    if (this.itemMesh) {
      const blk = this.itemMesh.userData.block;
      this.itemMesh.position.set(0.34 + bx - s * 0.14, (blk ? -0.32 : -0.28) + by - s * 0.06 + eatY, -0.62 - s * 0.12);
      this.itemMesh.rotation.x = (blk ? 0.15 : 0) - s * 0.9;
      this.itemMesh.material.color.setScalar(brightness);
    }
    this.armMat.color.setScalar(brightness);
  }
}
