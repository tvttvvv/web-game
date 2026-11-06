// 섬 지도 (결정적): 지역 · 높이 · 색 · 길 · 소품 · 충돌 · 마을/야영지 · 몬스터 무리
import { makeNoise, mulberry32, hash2, smoothstep, lerp } from './noise.js';
import { SEED, WORLD_R, TOWN_R, angleDiff } from './constants.js';
import { MONSTERS } from './data.js';

const nA = makeNoise(SEED), nB = makeNoise(SEED + 7), nC = makeNoise(SEED + 13), nD = makeNoise(SEED + 29), nE = makeNoise(SEED + 41);
const DEG = 180 / Math.PI;

export const ZONE_INFO = {
  town: { name: '새벽 마을', lv: '안전 지대' }, field: { name: '초록 들판', lv: 'Lv 1~6' }, lake: { name: '고요한 호수', lv: 'Lv 4~8' },
  forest: { name: '속삭이는 숲', lv: 'Lv 6~12' }, canyon: { name: '붉은 바위 협곡', lv: 'Lv 12~18' }, waste: { name: '불타는 황무지', lv: 'Lv 18~26' }, sea: { name: '바다', lv: '' },
};
export const LAKE = { x: 0, z: -178, r: 40 };
export const CAMPS = {
  forest: { x: -150, z: -30, npc: 'scout', name: '숲 야영지' },
  canyon: { x: 150, z: 20, npc: 'miner', name: '협곡 야영지' },
  waste: { x: 10, z: 150, npc: 'scholar', name: '황무지 야영지' },
  lake: { x: 0, z: -128, npc: 'fisher', name: '호수 야영지' },
};
export const ARENAS = {
  slime_king: { x: 80, z: -72, r: 20 }, treant: { x: -228, z: -48, r: 22 },
  ancient_golem: { x: 228, z: 28, r: 22 }, lava_giant: { x: 18, z: 230, r: 24 },
};
export const WAYPOINTS = {
  town: { name: '새벽 마을', x: -7, z: 8 },
  lake: { name: '호수 야영지', x: CAMPS.lake.x + 6, z: CAMPS.lake.z - 2 },
  forest: { name: '숲 야영지', x: CAMPS.forest.x + 6, z: CAMPS.forest.z + 4 },
  canyon: { name: '협곡 야영지', x: CAMPS.canyon.x - 6, z: CAMPS.canyon.z + 4 },
  waste: { name: '황무지 야영지', x: CAMPS.waste.x - 6, z: CAMPS.waste.z - 4 },
};
export const NPC_POS = {
  chief: { x: -14, z: -17, ry: Math.PI }, merchant: { x: 17, z: -9, ry: Math.PI / 2 }, smith: { x: -17, z: -9, ry: -Math.PI / 2 },
  innkeeper: { x: 15, z: 14, ry: Math.PI * 0.75 }, board: { x: 7, z: 7, ry: Math.PI * 1.25 },
  scout: { x: CAMPS.forest.x, z: CAMPS.forest.z + 6, ry: 0 }, miner: { x: CAMPS.canyon.x, z: CAMPS.canyon.z + 6, ry: 0 },
  scholar: { x: CAMPS.waste.x, z: CAMPS.waste.z - 6, ry: Math.PI }, fisher: { x: CAMPS.lake.x - 4, z: CAMPS.lake.z + 5, ry: 0 },
};
export const ROADS = [
  [[0, 0], [0, -128]],
  [[0, 0], [-60, -8], [-150, -30]], [[-150, -30], [-228, -48]],
  [[0, 0], [70, 8], [150, 20]], [[150, 20], [228, 28]],
  [[0, 0], [6, 80], [10, 150]], [[10, 150], [18, 230]],
  [[0, 0], [40, -36], [80, -72]],
];
export const BUILDINGS = [
  { x: -14, z: -27, w: 13, d: 9, h: 5, wall: '#e8dcc4', roof: '#7a4a9a', name: '촌장의 집' },
  { x: 25, z: -10, w: 9, d: 9, h: 4.5, wall: '#f0e0c0', roof: '#c0504a', name: '잡화점' },
  { x: -25, z: -10, w: 10, d: 9, h: 4.5, wall: '#b8a890', roof: '#4a4a52', name: '대장간', chimney: true },
  { x: 23, z: 23, w: 12, d: 10, h: 7, wall: '#f2e6d0', roof: '#3a7a5a', name: '여관' },
  { x: -23, z: 23, w: 9, d: 8, h: 4.5, wall: '#e0d0b0', roof: '#a06030' },
  { x: -6, z: 31, w: 7, d: 6, h: 4, wall: '#e8d8c0', roof: '#4a6aa0' },
  { x: 30, z: 4, w: 6, d: 6, h: 4, wall: '#e4d4b8', roof: '#a04a4a' },
];

// ---------- 지역 가중치 (부드러운 전환) ----------
function weights(x, z) {
  const r = Math.hypot(x, z);
  const a = Math.atan2(x, -z) * DEG + nE.noise2(x / 120 + 5, z / 120) * 12;
  const outer = smoothstep(104, 128, r + nE.noise2(x / 90, z / 90) * 14);
  const sec = (c, half) => smoothstep(half + 14, half - 14, Math.abs(angleDiff(a / DEG, c / DEG) * DEG));
  return { r, a, outer, lake: outer * sec(0, 35), canyon: outer * sec(90, 55), forest: outer * sec(-90, 55), waste: outer * sec(180, 35) };
}

export function zoneAt(x, z) {
  const r = Math.hypot(x, z);
  if (r < TOWN_R) return 'town';
  if (r > WORLD_R - 14) return 'sea';
  const w = weights(x, z);
  if (w.outer < 0.5) return 'field';
  const best = [['lake', w.lake], ['canyon', w.canyon], ['forest', w.forest], ['waste', w.waste]].sort((p, q) => q[1] - p[1])[0];
  return best[0];
}

// 용암 웅덩이 (황무지)
export const LAVA = [];
{
  const rnd = mulberry32(SEED * 3 + 1);
  for (let i = 0; i < 400 && LAVA.length < 14; i++) {
    const a = Math.PI + (rnd() - 0.5) * 1.1, r = 135 + rnd() * 130;
    const px = -Math.sin(a) * r, pz = -Math.cos(a) * r;
    if (zoneAt(px, pz) !== 'waste' || Math.hypot(px - CAMPS.waste.x, pz - CAMPS.waste.z) < 22 || Math.hypot(px - ARENAS.lava_giant.x, pz - ARENAS.lava_giant.z) < 30) continue;
    if (LAVA.some((l) => Math.hypot(l.x - px, l.z - pz) < 22) || roadDist(px, pz) < 16) continue;
    LAVA.push({ x: px, z: pz, r: 4 + rnd() * 4 });
  }
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0;
  return Math.hypot(px - ax - t * dx, pz - az - t * dz);
}
export function roadDist(x, z) {
  let d = 1e9;
  for (const r of ROADS) for (let i = 0; i < r.length - 1; i++) d = Math.min(d, segDist(x, z, r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]));
  return d;
}

const FLATS = [
  ...Object.values(CAMPS).map((c) => ({ x: c.x, z: c.z, r: 14, h: 1.6 })),
  ...Object.values(ARENAS).map((a) => ({ x: a.x, z: a.z, r: a.r + 4, h: 1.4 })),
];

export function heightAt(x, z) {
  const w = weights(x, z);
  let h = 1.8 + nA.fbm2(x / 150, z / 150, 4) * 3 + nB.fbm2(x / 38, z / 38, 2) * 0.8;
  h += w.forest * (1.5 + Math.max(0, nC.fbm2(x / 55, z / 55, 3)) * 7);
  const ridge = 1 - Math.abs(nC.fbm2(x / 70, z / 70, 3));
  h += w.canyon * (1 + smoothstep(0.55, 0.7, ridge) * 9 + nB.fbm2(x / 20, z / 20, 2) * 0.6);
  h += w.waste * (0.8 + nD.fbm2(x / 28, z / 28, 3) * 2.2);
  // 호수
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  h = lerp(h, -3.2, smoothstep(LAKE.r + 14, LAKE.r - 10, dl));
  // 용암 웅덩이
  for (const l of LAVA) { const d = Math.hypot(x - l.x, z - l.z); if (d < l.r + 4) h = lerp(h, -1.2, smoothstep(l.r + 3, l.r * 0.6, d)); }
  // 마을 · 야영지 · 보스 장소 평탄화
  h = lerp(h, 1.2, smoothstep(TOWN_R + 14, TOWN_R - 8, w.r));
  for (const f of FLATS) { const d = Math.hypot(x - f.x, z - f.z); if (d < f.r + 10) h = lerp(h, f.h + (h - f.h) * 0.15, smoothstep(f.r + 8, f.r - 4, d)); }
  // 길은 살짝 평평하게
  const rd = roadDist(x, z);
  if (rd < 6) h = lerp(h, Math.max(0.6, h * 0.7 + 0.5), smoothstep(6, 1.5, rd) * 0.5);
  // 섬 가장자리
  h = lerp(h, -7, smoothstep(WORLD_R - 48, WORLD_R - 4, w.r));
  const deep = dl < LAKE.r + 10 || w.r > WORLD_R - 60 || LAVA.some((l) => Math.hypot(x - l.x, z - l.z) < l.r + 3);
  return deep ? h : Math.max(0.35, h);
}

const COL = {
  field: [96, 168, 72], forest: [58, 122, 58], canyon: [182, 112, 72], waste: [74, 58, 56], lake: [104, 170, 92],
  town: [120, 160, 96], plaza: [158, 154, 146], road: [168, 138, 96], sand: [222, 204, 150], mesa: [206, 140, 92],
  lavaEdge: [60, 36, 32],
};
export function colorAt(x, z, h) {
  const w = weights(x, z);
  const f = Math.max(0, 1 - w.lake - w.canyon - w.forest - w.waste);
  let c = [0, 0, 0];
  const add = (col, k) => { c[0] += col[0] * k; c[1] += col[1] * k; c[2] += col[2] * k; };
  add(COL.field, f); add(COL.lake, w.lake); add(COL.forest, w.forest); add(COL.waste, w.waste);
  add(h > 6 ? COL.mesa : COL.canyon, w.canyon);
  const tot = f + w.lake + w.forest + w.waste + w.canyon || 1;
  c = c.map((v) => v / tot);
  const n = nB.noise2(x / 7, z / 7) * 0.08 + nA.noise2(x / 23, z / 23) * 0.06;
  c = c.map((v) => v * (1 + n));
  if (w.r < TOWN_R + 4) c = c.map((v, i) => lerp(v, COL.town[i], smoothstep(TOWN_R + 4, TOWN_R - 4, w.r) * 0.6));
  if (w.r < 15) c = c.map((v, i) => lerp(v, COL.plaza[i] * (1 + ((Math.floor(x / 2) + Math.floor(z / 2)) % 2 ? 0.04 : -0.04)), smoothstep(15, 13, w.r)));
  const rd = roadDist(x, z);
  if (rd < 3 && w.r >= 13) c = c.map((v, i) => lerp(v, COL.road[i] * (1 + n), smoothstep(3, 1.6, rd)));
  if (h < 1.3 && (w.r > WORLD_R - 70 || Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r + 16)) c = c.map((v, i) => lerp(v, COL.sand[i], smoothstep(1.3, 0.6, h)));
  for (const l of LAVA) { const d = Math.hypot(x - l.x, z - l.z); if (d < l.r + 4) c = c.map((v, i) => lerp(v, COL.lavaEdge[i], smoothstep(l.r + 4, l.r, d))); }
  return c;
}

export const lavaAt = (x, z) => LAVA.some((l) => Math.hypot(x - l.x, z - l.z) < l.r * 0.8);

// ---------- 소품 + 충돌체 ----------
export const PROPS = [];      // { t, x, z, s, ry, y }
export const COLLIDERS = [];  // { x, z, r } 또는 { x0, z0, x1, z1 }
const GRID = new Map();
const CELL = 8;
function addCollider(c) {
  const i = COLLIDERS.push(c) - 1;
  const x0 = c.r !== undefined ? c.x - c.r : c.x0, x1 = c.r !== undefined ? c.x + c.r : c.x1;
  const z0 = c.r !== undefined ? c.z - c.r : c.z0, z1 = c.r !== undefined ? c.z + c.r : c.z1;
  for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++)
    for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) {
      const k = gx * 10007 + gz;
      let a = GRID.get(k); if (!a) GRID.set(k, (a = [])); a.push(i);
    }
}
const PROP_R = { tree: 0.55, pine: 0.5, rock: 0.95, pillar: 1.5, deadtree: 0.35, crystal: 0.6, bigshroom: 0.7, tent: 2.2, crate: 0.7, lamp: 0.25, fence: 0, well: 1.6 };

function placeProps() {
  const keepOut = [
    ...Object.values(CAMPS).map((c) => [c.x, c.z, 14]), ...Object.values(ARENAS).map((a) => [a.x, a.z, a.r + 2]),
    ...Object.values(WAYPOINTS).map((w) => [w.x, w.z, 4]),
  ];
  const S = 5;
  for (let gx = -WORLD_R; gx < WORLD_R; gx += S)
    for (let gz = -WORLD_R; gz < WORLD_R; gz += S) {
      const h1 = hash2(SEED, gx, gz), h2 = hash2(SEED + 1, gx, gz), h3 = hash2(SEED + 2, gx, gz);
      const x = gx + h1 * S, z = gz + h2 * S;
      const r = Math.hypot(x, z);
      if (r < TOWN_R + 3 || r > WORLD_R - 30) continue;
      if (keepOut.some(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) < kr)) continue;
      const rd = roadDist(x, z);
      if (rd < 3.5) continue;
      const zone = zoneAt(x, z);
      const h = heightAt(x, z);
      if (h < 0.5 || lavaAt(x, z)) continue;
      const dens = nC.noise2(x / 40, z / 40) * 0.5 + 0.5;
      let t = null;
      if (zone === 'field') t = h3 < 0.05 + dens * 0.06 ? 'tree' : h3 < 0.1 + dens * 0.06 ? 'bush' : h3 < 0.13 ? 'rock' : h3 < 0.32 ? 'flower' : null;
      else if (zone === 'lake') t = h3 < 0.12 ? 'pine' : h3 < 0.2 ? 'tree' : h3 < 0.26 ? 'rock' : h3 < 0.4 ? 'flower' : null;
      else if (zone === 'forest') t = h3 < 0.28 + dens * 0.2 ? (h1 < 0.5 ? 'pine' : 'tree') : h3 < 0.52 ? 'bush' : h3 < 0.56 ? 'bigshroom' : h3 < 0.6 ? 'rock' : h3 < 0.7 ? 'flower' : null;
      else if (zone === 'canyon') t = h3 < 0.12 ? 'rock' : h3 < 0.15 ? 'pillar' : h3 < 0.17 ? 'crystal' : h3 < 0.19 ? 'deadtree' : null;
      else if (zone === 'waste') t = h3 < 0.12 ? 'rock' : h3 < 0.18 ? 'deadtree' : h3 < 0.21 ? 'bones' : null;
      if (!t) continue;
      if (rd < 6 && PROP_R[t]) continue;
      const s = t === 'flower' ? 1 : 0.8 + hash2(SEED + 3, gx, gz) * 0.7;
      PROPS.push({ t, x, z, s, ry: hash2(SEED + 4, gx, gz) * Math.PI * 2, y: h, zone });
      if (PROP_R[t]) addCollider({ x, z, r: PROP_R[t] * s });
    }
  // 마을
  for (const b of BUILDINGS) addCollider({ x0: b.x - b.w / 2 - 0.2, z0: b.z - b.d / 2 - 0.2, x1: b.x + b.w / 2 + 0.2, z1: b.z + b.d / 2 + 0.2 });
  addCollider({ x: 0, z: 0, r: 3.4 }); // 분수
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.31;
    const x = Math.sin(a) * 15.5, z = Math.cos(a) * 15.5;
    PROPS.push({ t: 'lamp', x, z, s: 1, ry: 0, y: heightAt(x, z), zone: 'town' });
    addCollider({ x, z, r: 0.3 });
  }
  // 마을 울타리 (길 쪽은 비움)
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const x = Math.sin(a) * (TOWN_R - 1), z = -Math.cos(a) * (TOWN_R - 1);
    if (roadDist(x, z) < 6) continue;
    PROPS.push({ t: 'fence', x, z, s: 1, ry: -a, y: heightAt(x, z), zone: 'town' });
    addCollider({ x, z, r: 0.9 });
  }
  for (const [x, z] of [[-30, -2], [31, 15], [-31, 12], [12, -30], [-3, -36], [26, -24]]) {
    PROPS.push({ t: 'tree', x, z, s: 1.1, ry: x, y: heightAt(x, z), zone: 'town' }); addCollider({ x, z, r: 0.6 });
  }
  for (const [x, z] of [[20, -16], [-19, -16], [11, 9]]) { PROPS.push({ t: 'crate', x, z, s: 1, ry: x, y: heightAt(x, z), zone: 'town' }); addCollider({ x, z, r: 0.7 }); }
  // 야영지
  for (const [k, c] of Object.entries(CAMPS)) {
    const tx = c.x + (k === 'waste' ? 6 : -6), tz = c.z + (k === 'waste' ? 4 : -4);
    PROPS.push({ t: 'tent', x: tx, z: tz, s: 1, ry: 0.4, y: heightAt(tx, tz), zone: k }); addCollider({ x: tx, z: tz, r: 2.2 });
    PROPS.push({ t: 'campfire', x: c.x, z: c.z, s: 1, ry: 0, y: heightAt(c.x, c.z), zone: k }); addCollider({ x: c.x, z: c.z, r: 0.8 });
    PROPS.push({ t: 'crate', x: c.x + 4, z: c.z - 5, s: 1, ry: 0.3, y: heightAt(c.x + 4, c.z - 5), zone: k }); addCollider({ x: c.x + 4, z: c.z - 5, r: 0.7 });
  }
  for (const [, w] of Object.entries(WAYPOINTS)) addCollider({ x: w.x, z: w.z, r: 0.9 });
  // 보스 장소 기둥
  for (const a of Object.values(ARENAS)) for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2;
    const x = a.x + Math.sin(ang) * (a.r + 1), z = a.z + Math.cos(ang) * (a.r + 1);
    PROPS.push({ t: 'ruin', x, z, s: 1, ry: ang, y: heightAt(x, z), zone: 'arena' }); addCollider({ x, z, r: 0.9 });
  }
}
placeProps();

// 원 충돌체 이동: 막히면 미끄러지듯 밀어냄. 깊은 물/섬 밖은 못 감
export function moveCircle(x, z, dx, dz, r, opts = {}) {
  let nx = x + dx, nz = z + dz;
  for (let it = 0; it < 2; it++) {
    const gx0 = Math.floor((nx - r) / CELL), gx1 = Math.floor((nx + r) / CELL), gz0 = Math.floor((nz - r) / CELL), gz1 = Math.floor((nz + r) / CELL);
    for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
      const a = GRID.get(gx * 10007 + gz);
      if (!a) continue;
      for (const i of a) {
        const c = COLLIDERS[i];
        if (c.r !== undefined) {
          const ddx = nx - c.x, ddz = nz - c.z, d = Math.hypot(ddx, ddz), m = c.r + r;
          if (d < m && d > 1e-6) { nx = c.x + (ddx / d) * m; nz = c.z + (ddz / d) * m; }
        } else {
          const cx = Math.max(c.x0, Math.min(nx, c.x1)), cz = Math.max(c.z0, Math.min(nz, c.z1));
          const ddx = nx - cx, ddz = nz - cz, d = Math.hypot(ddx, ddz);
          if (d < r) {
            if (d > 1e-6) { nx = cx + (ddx / d) * r; nz = cz + (ddz / d) * r; }
            else { // 안쪽: 가장 가까운 변으로
              const ex = [nx - c.x0, c.x1 - nx, nz - c.z0, c.z1 - nz], m = Math.min(...ex);
              if (m === ex[0]) nx = c.x0 - r; else if (m === ex[1]) nx = c.x1 + r; else if (m === ex[2]) nz = c.z0 - r; else nz = c.z1 + r;
            }
          }
        }
      }
    }
  }
  const lim = WORLD_R - 18, rr = Math.hypot(nx, nz);
  if (rr > lim) { nx *= lim / rr; nz *= lim / rr; }
  if (!opts.fly && heightAt(nx, nz) < -0.9) {
    if (heightAt(nx, z) >= -0.9) nz = z; else if (heightAt(x, nz) >= -0.9) nx = x; else { nx = x; nz = z; }
  }
  return [nx, nz];
}

// ---------- 몬스터 무리 ----------
export const SPAWNS = [];
{
  const rnd = mulberry32(SEED * 7 + 3);
  const pick = (zone, r, a) => {
    if (zone === 'field') return r < 72 ? 'slime' : a < -40 && rnd() < 0.35 ? 'mushroom' : rnd() < 0.25 ? 'slime' : 'boar';
    if (zone === 'lake') return rnd() < 0.65 ? 'crab' : 'mushroom';
    if (zone === 'forest') return r < 185 ? (rnd() < 0.8 ? 'wolf' : 'mushroom') : rnd() < 0.6 ? 'goblin' : 'goblin_archer';
    if (zone === 'canyon') return r < 185 ? (rnd() < 0.55 ? 'skeleton' : 'bat') : r < 212 ? (rnd() < 0.5 ? 'skeleton_archer' : 'skeleton') : 'rock_golem';
    if (zone === 'waste') return r < 180 ? (rnd() < 0.75 ? 'orc' : 'orc_shaman') : r < 205 ? (rnd() < 0.5 ? 'orc_shaman' : 'orc') : 'imp';
    return null;
  };
  const want = { field: 24, lake: 9, forest: 24, canyon: 24, waste: 22 };
  const have = { field: 0, lake: 0, forest: 0, canyon: 0, waste: 0 };
  for (let i = 0; i < 6000; i++) {
    const a = rnd() * Math.PI * 2, r = TOWN_R + 12 + rnd() * (WORLD_R - TOWN_R - 50);
    const x = -Math.sin(a) * r, z = -Math.cos(a) * r;
    const zone = zoneAt(x, z);
    if (!want[zone] || have[zone] >= want[zone]) continue;
    if (heightAt(x, z) < 0.6 || lavaAt(x, z) || roadDist(x, z) < 7) continue;
    if (Object.values(CAMPS).some((c) => Math.hypot(x - c.x, z - c.z) < 28)) continue;
    if (Object.values(ARENAS).some((c) => Math.hypot(x - c.x, z - c.z) < c.r + 16)) continue;
    if (SPAWNS.some((s) => Math.hypot(x - s.x, z - s.z) < 22)) continue;
    const deg = Math.atan2(x, -z) * DEG;
    const type = pick(zone, r, deg);
    const M = MONSTERS[type];
    const span = M.lv[1] - M.lv[0];
    const f = zone === 'field' ? Math.min(1, Math.max(0, (r - 50) / 70)) : Math.min(1, Math.max(0, (r - 130) / 120));
    const lv = M.lv[0] + Math.round(span * Math.min(1, f + (rnd() - 0.5) * 0.4));
    const n = type === 'rock_golem' || type === 'orc_shaman' ? 2 + Math.floor(rnd() * 2) : 3 + Math.floor(rnd() * 2);
    SPAWNS.push({ id: SPAWNS.length, type, lv: Math.max(M.lv[0], Math.min(M.lv[1], lv)), n, x, z, r: 6 });
    have[zone]++;
  }
  for (const [type, a] of Object.entries(ARENAS)) SPAWNS.push({ id: SPAWNS.length, type, lv: MONSTERS[type].lv[0], n: 1, x: a.x, z: a.z, r: 2, boss: true });
}
