// 캐릭터 · NPC · 몬스터 모델 (기본 도형을 부위별로 합쳐 그리기 횟수를 줄임) + 애니메이션
import { THREE, merge, mat4, G, blobShadow } from './renderer.js';
import { MONSTERS, NPCS, RARITY } from '../shared/data.js';

const C = (h) => new THREE.Color(h);
export const SKIN = ['#f1c9a5', '#e0ac85', '#b47a52', '#7a5038'];
export const HAIR = ['#2b1d14', '#6b4226', '#d9b25f', '#c0c0c0', '#a8322a', '#3a5aa8', '#f2f2f2', '#2f7a4a'];
export const OUTFIT = ['#3f6fd6', '#c8483e', '#3fa060', '#8a5ad0', '#d0902a', '#2a8a8a', '#d05a9a', '#5a5a66'];
const TIER = ['#8a5a3a', '#9aa0a8', '#c8ccd4', '#5a8ad8', '#e8c050'];
const P = (geo, c, x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) => ({ geo, c: typeof c === 'string' ? C(c) : c, m: mat4(x, y, z, ry, sx, sy, sz, rx, rz) });
const cache = new Map();
const cached = (k, f) => { let g = cache.get(k); if (!g) { g = f(); cache.set(k, g); } return g; };
const blobGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

function grp(x, y, z, ...meshes) { const g = new THREE.Group(); g.position.set(x, y, z); for (const m of meshes) if (m) g.add(m); return g; }

export class Model {
  constructor(kind, opts = {}) {
    this.kind = kind;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: !!opts.alpha, opacity: opts.alpha || 1 });
    this.parts = {};
    this.phase = Math.random() * 6; this.act = null; this.actT = 0; this.hitT = 0; this.downed = false; this.dodgeT = 0;
    this.height = opts.height || 1.9;
    const sh = new THREE.Mesh(blobGeo, blobShadow());
    sh.scale.setScalar(opts.shadow || 1.2); sh.position.y = 0.04; sh.renderOrder = 1;
    this.root.add(sh); this.shadow = sh;
  }
  mesh(geo) { const m = new THREE.Mesh(geo, this.mat); return m; }
  play(act, dur) { this.act = act; this.actT = 0; this.actDur = dur; }
  hit() { this.hitT = 0.16; }
  dispose() { this.mat.dispose(); }

  // st: { speed, fly }
  update(dt, st = {}) {
    const p = this.parts, sp = st.speed || 0;
    this.phase += dt * (sp > 0.3 ? 2 + sp * 1.7 : 1.5);
    const walk = Math.min(1, sp / 4);
    if (this.hitT > 0) { this.hitT -= dt; this.mat.emissive.setRGB(0.7, 0.05, 0.05); } else this.mat.emissive.setRGB(0, 0, 0);
    if (this.act) { this.actT += dt; if (this.actT >= this.actDur) this.act = null; }
    const k = this.act ? this.actT / this.actDur : 0;
    this.body.rotation.set(0, 0, 0);
    this.body.position.y = 0;
    if (this.kind === 'human') {
      const s = Math.sin(this.phase);
      p.legL.rotation.x = s * 0.9 * walk; p.legR.rotation.x = -s * 0.9 * walk;
      p.armL.rotation.set(-s * 0.7 * walk, 0, 0.08); p.armR.rotation.set(s * 0.7 * walk, 0, -0.08);
      this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.06 * walk + Math.sin(this.phase * 0.7) * 0.01;
      p.torso.rotation.set(0, 0, 0);
      if (this.act === 'swing') { p.armR.rotation.x = -2.4 + k * 3.2; p.torso.rotation.y = 0.5 - k * 1.0; }
      else if (this.act === 'bow') { p.armR.rotation.x = -1.5; p.armL.rotation.x = -1.5; p.armL.rotation.y = 0.3 * (1 - k); }
      else if (this.act === 'cast') { const u = Math.sin(k * Math.PI); p.armR.rotation.x = -1.2 - u * 1.4; p.armL.rotation.x = -1.2 - u * 1.4; }
      else if (this.act === 'spin') { this.body.rotation.y = k * Math.PI * 2; p.armR.rotation.x = -1.6; }
      else if (this.act === 'slam') { p.armR.rotation.x = -2.8 + k * 3.6; p.armL.rotation.x = -2.8 + k * 3.6; }
      else if (this.act === 'roll') { this.body.rotation.x = -k * Math.PI * 2; this.body.position.y = 0.45 - Math.abs(Math.sin(k * Math.PI)) * 0.2; }
      if (this.zombieArms) { p.armL.rotation.x -= 1.2; p.armR.rotation.x -= 1.2; }
    } else if (this.kind === 'slime') {
      const h = Math.abs(Math.sin(this.phase * 1.4)) * (sp > 0.2 ? 1 : 0.25);
      this.body.position.y = h * 0.45;
      this.body.scale.set(1 + (1 - h) * 0.12, 1 - (1 - h) * 0.14 + h * 0.12, 1 + (1 - h) * 0.12);
      if (this.act === 'swing') { this.body.scale.y *= 1 - Math.sin(k * Math.PI) * 0.3; this.body.position.z = -Math.sin(k * Math.PI) * 0.5; }
    } else if (this.kind === 'quad') {
      const s = Math.sin(this.phase * 1.3);
      if (p.legs) p.legs.forEach((l, i) => { l.rotation.x = (i % 2 ? s : -s) * 0.8 * walk * (i < 2 ? 1 : -1); });
      this.body.position.y = Math.abs(s) * 0.04 * walk;
      if (this.act === 'swing') { this.body.position.z = -Math.sin(k * Math.PI) * 0.45; if (p.head) p.head.rotation.x = Math.sin(k * Math.PI) * 0.4; }
      if (p.claws) p.claws.forEach((c, i) => { c.rotation.y = (i ? -1 : 1) * (0.3 + (this.act === 'swing' ? Math.sin(k * Math.PI) * 0.6 : Math.sin(this.phase) * 0.1)); });
    } else if (this.kind === 'fly') {
      const f = Math.sin(this.phase * 5);
      if (p.wingL) { p.wingL.rotation.z = 0.3 + f * 0.7; p.wingR.rotation.z = -0.3 - f * 0.7; }
      this.body.position.y = 1.4 + Math.sin(this.phase) * 0.25;
      if (this.act === 'swing') this.body.position.z = -Math.sin(k * Math.PI) * 0.7;
    } else if (this.kind === 'shroom') {
      const s = Math.sin(this.phase * 1.6);
      this.body.rotation.z = s * 0.08 * (sp > 0.2 ? 1 : 0.3);
      this.body.position.y = Math.abs(s) * 0.08 * walk;
      if (this.act === 'swing') this.body.scale.y = 1 - Math.sin(k * Math.PI) * 0.25; else this.body.scale.y = 1;
    }
    if (this.downed) { this.body.rotation.x = -Math.PI / 2; this.body.position.y = 0.25; }
  }
}

// ---------- 무기 ----------
function weaponParts(kind, tier, rar) {
  const glow = rar >= 2 ? C(RARITY[rar].color) : null;
  const metal = glow ? C('#e8eef8').lerp(glow, 0.35) : C(['#b8b8b8', '#c8ccd4', '#d8dce4', '#a8c4f0', '#f0d070'][tier] || '#c8ccd4');
  const out = [];
  if (kind === 'sword') {
    out.push(P(G.box, metal, 0, 0, -0.62, 0.09, 0.03, 0.95 + tier * 0.05));
    out.push(P(G.box, glow || C('#8a6a3a'), 0, 0, -0.12, 0.34, 0.06, 0.07));
    out.push(P(G.box, '#5a3a22', 0, 0, 0.05, 0.06, 0.06, 0.24));
  } else if (kind === 'bow') {
    const wood = glow || C(['#8a5a2a', '#6a4a3a', '#c8b070', '#5a8aa0', '#f0c040'][tier]);
    const arc = cached('bowarc', () => new THREE.TorusGeometry(0.5, 0.035, 4, 14, Math.PI * 0.9));
    out.push({ geo: arc, c: wood, m: mat4(0, 0, -0.1, Math.PI / 2, 1, 1, 1, 0, -Math.PI * 0.45) });
    out.push(P(G.box, '#eeeeee', 0, 0, -0.1, 0.01, 0.95, 0.01));
  } else if (kind === 'staff') {
    out.push(P(G.cyl6, '#6a4a2a', 0, 0.45, 0, 0.07, 1.7, 0.07));
    out.push(P(G.oct, glow || C(['#8fd0ff', '#b48aff', '#7affd0', '#ff8ae0', '#ffe070'][tier]), 0, 1.4, 0, 0.3, 0.38, 0.3));
  } else if (kind === 'mace') {
    out.push(P(G.cyl6, '#6a4a2a', 0, 0, -0.25, 0.07, 0.06, 0.7, 0, Math.PI / 2));
    out.push(P(G.dodec, metal, 0, 0, -0.65, 0.32, 0.32, 0.32));
    if (glow) out.push(P(G.oct, glow, 0, 0, -0.65, 0.2, 0.42, 0.2));
  } else if (kind === 'club') out.push(P(G.cyl6, '#7a5532', 0, 0, -0.35, 0.13, 0.11, 0.85, 0, Math.PI / 2));
  else if (kind === 'axe') { out.push(P(G.cyl6, '#5a3a22', 0, 0, -0.35, 0.07, 0.07, 1.0, 0, Math.PI / 2)); out.push(P(G.box, '#9aa0a8', 0, 0.12, -0.75, 0.05, 0.42, 0.3)); }
  return out;
}

// ---------- 사람형 ----------
// o: { skin, hair, outfit, cls, armor(tier|-1), helm(tier|-1), weapon:{kind,tier,rar}, scale, ears, skull, tusks, horns, wings, robe }
export function humanoid(o) {
  const M = new Model('human', { height: 1.9 * (o.scale || 1), shadow: 1.1 * (o.scale || 1) });
  const sk = C(o.skin), hair = C(o.hair || '#2b1d14'), cloth = C(o.outfit), pants = C(o.pants || '#3a3a48');
  const armor = o.armor >= 0 ? C(TIER[o.armor]) : null;
  const thin = o.skull ? 0.55 : 1;
  const key = JSON.stringify(o);
  const geos = cached('hum' + key, () => {
    const leg = merge([P(G.box, o.skull ? sk : pants, 0, -0.36, 0, 0.2 * thin, 0.74, 0.22 * thin), P(G.box, o.skull ? sk : C('#4a3426'), 0, -0.72, -0.05, 0.23, 0.13, 0.32)]);
    const tp = [P(G.box, o.skull ? sk : cloth, 0, 0.34, 0, 0.56 * (o.skull ? 0.7 : 1), 0.62, 0.32), P(G.box, '#4a3426', 0, 0.06, 0, 0.58, 0.08, 0.34)];
    if (o.skull) for (let i = 0; i < 3; i++) tp.push(P(G.box, '#3a3a3a', 0, 0.2 + i * 0.13, -0.17, 0.42, 0.04, 0.02));
    if (armor) { tp.push(P(G.box, armor, 0, 0.38, -0.02, 0.6, 0.48, 0.36)); tp.push(P(G.sph, armor, 0.36, 0.56, 0, 0.3, 0.22, 0.3)); tp.push(P(G.sph, armor, -0.36, 0.56, 0, 0.3, 0.22, 0.3)); }
    if (o.robe) tp.push(P(G.cone8, o.robe, 0, -0.18, 0, 0.95, 1.1, 0.8));
    if (o.cls === 'archer') { tp.push(P(G.box, '#3f7a3a', 0, 0.2, 0.2, 0.52, 0.9, 0.04)); tp.push(P(G.cyl6, '#7a5532', 0.12, 0.45, 0.22, 0.14, 0.6, 0.14, 0, 0.3)); }
    if (o.cls === 'cleric') tp.push(P(G.box, '#e8c050', 0, 0.34, -0.17, 0.12, 0.6, 0.02));
    const hp = [P(o.skull ? G.sph : G.sph16, sk, 0, 0.3, 0, 0.58, 0.58, 0.56)];
    if (!o.skull && !o.bald) { hp.push(P(G.halfSph, hair, 0, 0.32, 0.02, 0.63, 0.5, 0.62)); hp.push(P(G.box, hair, 0, 0.24, 0.17, 0.56, 0.32, 0.22)); }
    const eye = o.skull ? '#111111' : o.glow || '#222222';
    hp.push(P(G.box, eye, -0.11, 0.3, -0.27, o.skull ? 0.12 : 0.07, o.skull ? 0.12 : 0.09, 0.04));
    hp.push(P(G.box, eye, 0.11, 0.3, -0.27, o.skull ? 0.12 : 0.07, o.skull ? 0.12 : 0.09, 0.04));
    if (o.ears) { hp.push(P(G.cone4, sk, -0.36, 0.34, 0, 0.12, 0.38, 0.1, 0, 0, Math.PI / 2)); hp.push(P(G.cone4, sk, 0.36, 0.34, 0, 0.12, 0.38, 0.1, 0, 0, -Math.PI / 2)); }
    if (o.tusks) { hp.push(P(G.cone4, '#f0ead8', -0.1, 0.12, -0.26, 0.06, 0.16, 0.06, 0, Math.PI)); hp.push(P(G.cone4, '#f0ead8', 0.1, 0.12, -0.26, 0.06, 0.16, 0.06, 0, Math.PI)); }
    if (o.horns) { hp.push(P(G.cone4, '#2a1a1a', -0.18, 0.62, 0, 0.1, 0.32, 0.1, 0, 0, 0.4)); hp.push(P(G.cone4, '#2a1a1a', 0.18, 0.62, 0, 0.1, 0.32, 0.1, 0, 0, -0.4)); }
    if (o.cls === 'mage') { hp.push(P(G.cone8, o.outfit, 0, 0.82, 0.04, 0.55, 0.62, 0.55, 0, -0.12)); hp.push(P(G.cyl12, o.outfit, 0, 0.55, 0, 0.95, 0.04, 0.95)); }
    if (o.cls === 'archer') hp.push(P(G.halfSph, '#3f7a3a', 0, 0.3, 0.03, 0.68, 0.62, 0.66));
    if (o.cls === 'cleric') hp.push(P(G.tor, '#f0d060', 0, 0.62, 0, 0.62, 0.62, 0.62, 0, Math.PI / 2));
    if (o.helm >= 0) { hp.push(P(G.halfSph, TIER[o.helm], 0, 0.34, 0, 0.66, 0.56, 0.66)); hp.push(P(G.box, TIER[o.helm], 0, 0.25, -0.3, 0.06, 0.2, 0.04)); }
    const arm = merge([P(G.box, o.skull ? sk : armor || cloth, 0, -0.18, 0, 0.17 * thin, 0.36, 0.19 * thin), P(G.box, sk, 0, -0.42, 0, 0.15 * thin, 0.26, 0.16 * thin), P(G.sph, sk, 0, -0.58, 0, 0.17, 0.17, 0.17)]);
    let weapon = null;
    if (o.weapon) { const wp = weaponParts(o.weapon.kind, o.weapon.tier || 0, o.weapon.rar || 0); if (wp.length) weapon = merge(wp); }
    let wings = null;
    if (o.wings) wings = merge([P(G.box, o.wings, 0.5, 0.1, 0, 0.9, 0.5, 0.04, 0, 0, 0.3)]);
    return { leg, torso: merge(tp), head: merge(hp), arm, weapon, wings };
  });
  const B = M.body;
  const legL = grp(-0.13, 0.75, 0, M.mesh(geos.leg)), legR = grp(0.13, 0.75, 0, M.mesh(geos.leg));
  const torso = grp(0, 0.75, 0, M.mesh(geos.torso));
  const head = grp(0, 1.35, 0, M.mesh(geos.head));
  const armL = grp(-0.37, 1.28, 0, M.mesh(geos.arm)), armR = grp(0.37, 1.28, 0, M.mesh(geos.arm));
  if (geos.weapon) {
    const w = M.mesh(geos.weapon);
    w.position.set(0, -0.6, 0);
    if (o.weapon.kind === 'staff') w.position.set(0, -0.6, -0.05);
    armR.add(w); M.parts.weapon = w;
  }
  if (geos.wings) { const wl = M.mesh(geos.wings), wr = M.mesh(geos.wings); wr.scale.x = -1; torso.add(grp(0.15, 0.45, 0.18, wl), grp(-0.15, 0.45, 0.18, wr)); }
  B.add(legL, legR, torso, head, armL, armR);
  B.scale.setScalar(o.scale || 1);
  Object.assign(M.parts, { legL, legR, torso, head, armL, armR });
  return M;
}

const CLS_WEAPON = { warrior: 'sword', archer: 'bow', mage: 'staff', cleric: 'mace' };
// gear: [weaponTier, weaponRarity, armorTier, helmTier]
export function playerModel(cls, look, gear = [0, 0, -1, -1]) {
  const l = look || [0, 0, 0, 0];
  const outfit = OUTFIT[l[2] % OUTFIT.length];
  return humanoid({
    skin: SKIN[l[0] % SKIN.length], hair: HAIR[l[1] % HAIR.length], outfit, pants: cls === 'cleric' ? '#e8e2d4' : '#3a3a48', cls,
    armor: cls === 'warrior' ? Math.max(0, gear[2]) : cls === 'mage' || cls === 'cleric' ? -1 : gear[2] >= 2 ? gear[2] : -1,
    helm: cls === 'warrior' ? gear[3] : -1,
    robe: cls === 'mage' ? outfit : cls === 'cleric' ? '#f2eee4' : null,
    weapon: { kind: CLS_WEAPON[cls], tier: gear[0], rar: gear[1] },
  });
}
export function npcModel(key) {
  const n = NPCS[key];
  const look = { chief: ['#e0ac85', '#e8e8e8'], merchant: ['#f1c9a5', '#a8322a'], smith: ['#b47a52', '#2b1d14'], innkeeper: ['#f1c9a5', '#6b4226'], scout: ['#e0ac85', '#2b1d14'], miner: ['#b47a52', '#6b4226'], scholar: ['#f1c9a5', '#d9b25f'], fisher: ['#e0ac85', '#c0c0c0'] }[key] || ['#f1c9a5', '#2b1d14'];
  return humanoid({ skin: look[0], hair: look[1], outfit: n.color, robe: key === 'chief' || key === 'scholar' ? n.color : null, cls: key === 'smith' ? null : null, weapon: key === 'smith' ? { kind: 'mace', tier: 1 } : key === 'scout' ? { kind: 'bow', tier: 0 } : key === 'miner' ? { kind: 'axe' } : null });
}

// ---------- 몬스터 ----------
export function monsterModel(type) {
  const T = MONSTERS[type];
  const s = T.size || 1;
  let M;
  switch (T.model) {
    case 'slime': {
      M = new Model('slime', { alpha: 0.92, height: 1.1 * s, shadow: 1.3 * s });
      const g = cached('slime' + type, () => {
        const parts = [P(G.sph16, T.color, 0, 0.42, 0, 1.0, 0.82, 1.0), P(G.sph, '#ffffff', -0.2, 0.62, -0.38, 0.2, 0.24, 0.1), P(G.sph, '#ffffff', 0.2, 0.62, -0.38, 0.2, 0.24, 0.1),
          P(G.sph, '#111111', -0.2, 0.6, -0.44, 0.1, 0.13, 0.06), P(G.sph, '#111111', 0.2, 0.6, -0.44, 0.1, 0.13, 0.06), P(G.sph, '#ffffff', -0.25, 0.75, -0.22, 0.12, 0.08, 0.1)];
        if (T.crown) { parts.push(P(G.cyl8, '#f0c040', 0, 0.9, 0, 0.42, 0.16, 0.42)); for (let i = 0; i < 5; i++) { const a = i * 1.257; parts.push(P(G.cone4, '#f0c040', Math.sin(a) * 0.17, 1.04, Math.cos(a) * 0.17, 0.09, 0.16, 0.09)); } parts.push(P(G.oct, '#e0404a', 0, 0.92, -0.2, 0.08, 0.1, 0.05)); }
        return merge(parts);
      });
      M.body.add(M.mesh(g));
      break;
    }
    case 'boar': case 'wolf': {
      M = new Model('quad', { height: 1.1 * s, shadow: 1.5 * s });
      const wolf = T.model === 'wolf';
      const g = cached(T.model, () => {
        const col = T.color;
        const body = wolf ? [P(G.box, col, 0, 0.62, 0, 0.5, 0.5, 1.15), P(G.box, '#6a6c74', 0, 0.86, 0.1, 0.42, 0.12, 0.8), P(G.cyl6, col, 0, 0.72, 0.72, 0.1, 0.6, 0.1, 0, -0.9)]
          : [P(G.box, col, 0, 0.62, 0, 0.78, 0.66, 1.25), P(G.box, '#5a3a22', 0, 0.98, 0, 0.18, 0.14, 1.0), P(G.cyl6, col, 0, 0.7, 0.66, 0.06, 0.3, 0.06, 0, -0.6)];
        const head = wolf ? [P(G.box, col, 0, 0, -0.18, 0.42, 0.4, 0.42), P(G.box, '#7a7c84', 0, -0.06, -0.48, 0.24, 0.2, 0.32), P(G.cone4, col, -0.13, 0.27, -0.12, 0.1, 0.22, 0.08), P(G.cone4, col, 0.13, 0.27, -0.12, 0.1, 0.22, 0.08), P(G.box, '#ffcc33', -0.1, 0.06, -0.39, 0.05, 0.05, 0.02), P(G.box, '#ffcc33', 0.1, 0.06, -0.39, 0.05, 0.05, 0.02)]
          : [P(G.box, col, 0, 0, -0.2, 0.56, 0.5, 0.45), P(G.box, '#d89a8a', 0, -0.06, -0.48, 0.3, 0.24, 0.14), P(G.cone4, '#f0ead8', -0.17, -0.1, -0.45, 0.06, 0.24, 0.06, 0, Math.PI * 0.85), P(G.cone4, '#f0ead8', 0.17, -0.1, -0.45, 0.06, 0.24, 0.06, 0, Math.PI * 0.85), P(G.box, '#111111', -0.15, 0.08, -0.43, 0.06, 0.06, 0.02), P(G.box, '#111111', 0.15, 0.08, -0.43, 0.06, 0.06, 0.02)];
        return { body: merge(body), head: merge(head), leg: merge([P(G.box, wolf ? col : '#5a3a22', 0, -0.22, 0, 0.16, 0.46, 0.16)]) };
      });
      M.body.add(M.mesh(g.body));
      const head = grp(0, 0.72, -0.62, M.mesh(g.head)); M.body.add(head);
      M.parts.head = head;
      M.parts.legs = [[-0.22, -0.42], [0.22, -0.42], [-0.22, 0.42], [0.22, 0.42]].map(([x, z]) => { const l = grp(x, 0.45, z, M.mesh(g.leg)); M.body.add(l); return l; });
      M.body.scale.setScalar(s);
      break;
    }
    case 'crab': {
      M = new Model('quad', { height: 0.9 * s, shadow: 1.6 * s });
      const g = cached('crab', () => ({
        body: merge([P(G.sph16, T.color, 0, 0.42, 0, 1.25, 0.5, 0.95), P(G.cyl6, T.color, -0.18, 0.62, -0.35, 0.05, 0.3, 0.05), P(G.cyl6, T.color, 0.18, 0.62, -0.35, 0.05, 0.3, 0.05), P(G.sph, '#111111', -0.18, 0.8, -0.35, 0.1, 0.1, 0.1), P(G.sph, '#111111', 0.18, 0.8, -0.35, 0.1, 0.1, 0.1),
          ...[-1, 1].flatMap((sx) => [0, 1, 2].map((i) => P(G.cyl6, '#c04a2a', sx * 0.7, 0.25, -0.2 + i * 0.25, 0.06, 0.6, 0.06, 0, 0, sx * 1.0)))]),
        claw: merge([P(G.cyl6, T.color, 0, 0, -0.25, 0.1, 0.5, 0.1, 0, Math.PI / 2), P(G.box, T.color, 0, 0, -0.6, 0.3, 0.2, 0.36), P(G.box, '#c04a2a', 0.08, 0.06, -0.82, 0.08, 0.1, 0.2)]),
      }));
      M.body.add(M.mesh(g.body));
      M.parts.claws = [-1, 1].map((sx) => { const c = grp(sx * 0.42, 0.45, -0.38, M.mesh(g.claw)); M.body.add(c); return c; });
      M.parts.legs = [];
      M.body.scale.setScalar(s);
      break;
    }
    case 'mushroom': {
      M = new Model('shroom', { height: 1.3 * s, shadow: 1.2 * s });
      const g = cached('shroom', () => merge([
        P(G.cyl8, '#efe6d6', 0, 0.42, 0, 0.5, 0.8, 0.5), P(G.halfSph, T.color, 0, 0.8, 0, 1.3, 0.9, 1.3),
        ...[[0.3, 1.1, -0.2], [-0.35, 1.0, 0.1], [0.05, 1.18, 0.3], [-0.1, 0.95, -0.45], [0.42, 0.92, 0.25]].map(([x, y, z]) => P(G.sph, '#ffffff', x, y, z, 0.18, 0.1, 0.18)),
        P(G.box, '#111111', -0.1, 0.55, -0.25, 0.06, 0.1, 0.02), P(G.box, '#111111', 0.1, 0.55, -0.25, 0.06, 0.1, 0.02),
        P(G.box, '#efe6d6', -0.14, 0.05, 0, 0.14, 0.1, 0.2), P(G.box, '#efe6d6', 0.14, 0.05, 0, 0.14, 0.1, 0.2)]));
      M.body.add(M.mesh(g));
      M.body.scale.setScalar(s);
      break;
    }
    case 'bat': case 'imp': {
      const imp = T.model === 'imp';
      if (imp) {
        M = humanoid({ skin: T.color, outfit: '#7a2a1a', pants: '#5a1a10', horns: true, ears: true, bald: true, wings: '#5a1a1a', glow: '#ffdd44', scale: 0.75 });
        M.kind = 'fly'; M.parts.wingL = null;
        M.flyHuman = true;
      } else {
        M = new Model('fly', { height: 2.2, shadow: 0.9 });
        const g = cached('bat', () => ({
          body: merge([P(G.sph, T.color, 0, 0, 0, 0.5, 0.45, 0.5), P(G.cone4, T.color, -0.14, 0.3, 0, 0.1, 0.25, 0.08), P(G.cone4, T.color, 0.14, 0.3, 0, 0.1, 0.25, 0.08), P(G.box, '#ff4040', -0.1, 0.05, -0.24, 0.06, 0.06, 0.02), P(G.box, '#ff4040', 0.1, 0.05, -0.24, 0.06, 0.06, 0.02)]),
          wing: merge([P(G.box, '#3a2a4a', 0.5, 0, 0, 0.9, 0.04, 0.5)]),
        }));
        M.body.add(M.mesh(g.body));
        M.parts.wingL = grp(0.18, 0.05, 0, M.mesh(g.wing)); M.parts.wingR = grp(-0.18, 0.05, 0, M.mesh(g.wing)); M.parts.wingR.scale.x = -1;
        M.body.add(M.parts.wingL, M.parts.wingR);
        M.body.scale.setScalar(s);
      }
      break;
    }
    case 'goblin': M = humanoid({ skin: T.color, outfit: '#7a5532', pants: '#4a3426', ears: true, bald: true, scale: 0.78, weapon: { kind: T.bow ? 'bow' : 'club' }, glow: '#ffee55' }); break;
    case 'skeleton': M = humanoid({ skin: T.color, outfit: T.color, skull: true, weapon: { kind: T.bow ? 'bow' : 'sword', tier: 1 } }); break;
    case 'orc': M = humanoid({ skin: T.color, outfit: '#5a4a3a', pants: '#3a2a20', hair: '#1a1a1a', tusks: true, armor: T.staff ? -1 : 0, robe: T.staff ? '#5a3a6a' : null, scale: T.size, weapon: { kind: T.staff ? 'staff' : 'axe', tier: 2 } }); break;
    case 'golem': M = golem(T); break;
    case 'treant': M = treant(T); break;
    case 'giant': M = humanoid({ skin: '#3a3030', outfit: '#2a2222', pants: '#2a2222', bald: true, armor: -1, glow: '#ffaa22', scale: T.size, weapon: { kind: 'club' }, horns: true }); M.lava = true; break;
    default: M = new Model('slime');
  }
  if (T.model === 'golem' || T.model === 'giant') M.height = 2.6 * s;
  M.height = Math.max(M.height, (T.size || 1) * 1.1);
  M.shadow.scale.setScalar(1.2 * s);
  return M;
}

function golem(T) {
  const M = new Model('human', { height: 2.4, shadow: 1.8 });
  const g = cached('golem' + T.color, () => {
    const c = T.color, d = new THREE.Color(T.color).multiplyScalar(0.75);
    return {
      torso: merge([P(G.dodec, c, 0, 0.5, 0, 1.3, 1.2, 0.9), P(G.oct, '#ffb040', 0, 0.55, -0.4, 0.3, 0.3, 0.1), P(G.dodec, d, 0.2, 0.9, 0.2, 0.6, 0.4, 0.5)]),
      head: merge([P(G.box, c, 0, 0.2, 0, 0.5, 0.42, 0.45), P(G.box, '#ffcc44', -0.12, 0.22, -0.23, 0.1, 0.06, 0.02), P(G.box, '#ffcc44', 0.12, 0.22, -0.23, 0.1, 0.06, 0.02)]),
      arm: merge([P(G.box, c, 0, -0.3, 0, 0.42, 0.7, 0.42), P(G.dodec, d, 0, -0.78, 0, 0.6, 0.55, 0.6)]),
      leg: merge([P(G.box, c, 0, -0.3, 0, 0.42, 0.62, 0.45)]),
    };
  });
  const legL = grp(-0.3, 0.62, 0, M.mesh(g.leg)), legR = grp(0.3, 0.62, 0, M.mesh(g.leg));
  const torso = grp(0, 0.75, 0, M.mesh(g.torso)), head = grp(0, 1.55, -0.05, M.mesh(g.head));
  const armL = grp(-0.85, 1.35, 0, M.mesh(g.arm)), armR = grp(0.85, 1.35, 0, M.mesh(g.arm));
  M.body.add(legL, legR, torso, head, armL, armR);
  Object.assign(M.parts, { legL, legR, torso, head, armL, armR });
  M.body.scale.setScalar(T.size / 1.4);
  return M;
}

function treant(T) {
  const M = new Model('human', { height: 3.2, shadow: 2.4 });
  const g = cached('treant', () => ({
    torso: merge([P(G.cyl8, '#6b4a2a', 0, 0.5, 0, 1.0, 1.6, 0.9), P(G.box, '#ffe066', -0.18, 0.75, -0.42, 0.12, 0.1, 0.04), P(G.box, '#ffe066', 0.18, 0.75, -0.42, 0.12, 0.1, 0.04), P(G.box, '#2a1a0a', 0, 0.42, -0.43, 0.3, 0.08, 0.04)]),
    head: merge([P(G.ico1, '#3f8a3a', 0, 0.5, 0, 2.0, 1.4, 2.0), P(G.ico, '#4f9a44', 0.6, 0.9, 0.2, 1.1, 0.9, 1.1), P(G.ico, '#357a32', -0.6, 0.7, -0.2, 1.0, 0.8, 1.0)]),
    arm: merge([P(G.cyl6, '#5a3a1e', 0, -0.4, 0, 0.22, 1.0, 0.22), P(G.cyl6, '#5a3a1e', 0.15, -0.95, -0.1, 0.12, 0.5, 0.12, 0, 0.4, 0.4), P(G.ico, '#3f8a3a', 0, -1.1, 0, 0.5, 0.4, 0.5)]),
    leg: merge([P(G.cyl6, '#5a3a1e', 0, -0.3, 0, 0.35, 0.65, 0.35), P(G.box, '#5a3a1e', 0, -0.6, -0.15, 0.5, 0.12, 0.6)]),
  }));
  const legL = grp(-0.3, 0.65, 0, M.mesh(g.leg)), legR = grp(0.3, 0.65, 0, M.mesh(g.leg));
  const torso = grp(0, 0.7, 0, M.mesh(g.torso)), head = grp(0, 1.9, 0, M.mesh(g.head));
  const armL = grp(-0.6, 1.6, 0, M.mesh(g.arm)), armR = grp(0.6, 1.6, 0, M.mesh(g.arm));
  M.body.add(legL, legR, torso, head, armL, armR);
  Object.assign(M.parts, { legL, legR, torso, head, armL, armR });
  M.body.scale.setScalar(T.size / 2);
  return M;
}

// 바닥에 떨어진 전리품 (등급 빛기둥)
export function lootModel(it, rarity) {
  const g = new THREE.Group();
  const isGear = rarity !== undefined && rarity !== null;
  const col = isGear ? RARITY[rarity].color : '#f0e0a0';
  const bag = new THREE.Mesh(cached('lootbag', () => merge([P(G.sph, '#a8743a', 0, 0.25, 0, 0.5, 0.45, 0.5), P(G.cyl6, '#7a5532', 0, 0.5, 0, 0.18, 0.12, 0.18)])), new THREE.MeshLambertMaterial({ vertexColors: true }));
  const chest = isGear ? new THREE.Mesh(cached('lootchest', () => merge([P(G.box, '#7a4a2a', 0, 0.25, 0, 0.7, 0.45, 0.5), P(G.box, '#e8c050', 0, 0.3, -0.26, 0.12, 0.16, 0.04)])), new THREE.MeshLambertMaterial({ vertexColors: true })) : null;
  g.add(chest || bag);
  const beam = new THREE.Mesh(cached('beam', () => new THREE.CylinderGeometry(0.22, 0.32, 3.2, 8, 1, true)), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: isGear ? 0.45 : 0.25, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  beam.position.y = 1.6;
  g.add(beam);
  g.userData.beam = beam;
  return g;
}
