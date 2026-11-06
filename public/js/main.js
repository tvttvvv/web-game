// 픽셀 커먼스 3D — 클라이언트 진입점
import { buildAtlas } from './client/textures.js';
import { Renderer, THREE } from './client/renderer.js';
import { ClientWorld } from './client/chunks.js';
import { Icons } from './client/icons.js';
import { Entities, ItemMeshes, Hand } from './client/entities.js';
import { Input } from './client/input.js';
import { LocalPlayer } from './client/player.js';
import { Sound } from './client/audio.js';
import { UI } from './client/ui.js';
import { detectMode, createNet, loadSave, storeSave } from './net.js';
import {
  PROTO, CS, CH, SAFE_R, CLAIM_R, REACH, MAX_HP, MAX_FOOD, MAX_AIR, timeOfDay, daylight, isNight, yawToDir, bkey, clamp,
} from './shared/constants.js';
import { BLOCKS, B, SOLID, isDoor, isChest, isFurnace, isSign, isWheat } from './shared/blocks.js';
import { ITEMS, I, invFromWire, breakInfo, toolOf, itemName } from './shared/items.js';
import { raycast } from './shared/physics.js';
import { resolvePlacement } from './shared/rules.js';
import { createGenerator, BIOME_NAMES } from './shared/worldgen.js';

const $ = (id) => document.getElementById(id);
const touchDevice = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// ---------- 설정 ----------
const DEFAULTS = { dist: touchDevice ? 4 : 6, bright: 0.5, sens: 1, fov: 72, res: touchDevice ? 0.8 : 1, vol: 0.7, autoJump: touchDevice, clouds: true, bob: true, names: true, invert: false };
const settings = Object.assign({}, DEFAULTS, (() => { try { return JSON.parse(localStorage.getItem('pc3_settings') || '{}'); } catch { return {}; } })());
const saveSettings = () => { try { localStorage.setItem('pc3_settings', JSON.stringify(settings)); } catch {} };

// ---------- 준비 ----------
const canvas = $('game');
const atlas = buildAtlas();
const R = new Renderer(canvas, atlas);
const icons = new Icons(atlas);
const items = new ItemMeshes(atlas, R.atlasTex, icons);
const ents = new Entities(R, items);
const hand = new Hand(R, items);
const sound = new Sound();
const ui = new UI(icons, sound);
const input = new Input(canvas, {
  joyBase: $('joy-base'), joyKnob: $('joy-knob'),
  buttons: { jump: $('t-jump'), mine: $('t-mine'), use: $('t-use'), sneak: $('t-sneak') },
});

const S = {
  id: 0, tag: '', name: '', skin: [0, 0, 0, 0], role: '', online: 1,
  world: null, gen: null, player: null, inv: new Array(36).fill(null), sel: 0,
  hp: MAX_HP, food: MAX_FOOD, air: MAX_AIR, dead: false,
  epoch: Date.now(), clockOff: 0, spawn: [0.5, 50, 0.5], claims: [], signs: {}, snap: null,
  view: 0, ready: false, mining: null, attackCd: 0, digCd: 0, lastPos: 0, swing: 0, hurtTilt: 0,
  station: { table: false, furnace: false }, debug: false, hud: true, wasNight: false, joined: false,
};
let net = null;
const send = (o) => net && net.send(o);

// 토큰/이름
const token = (() => {
  try {
    let t = localStorage.getItem('pc_token');
    if (!t) { t = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : '') + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('pc_token', t); }
    return t;
  } catch { return Math.random().toString(36).slice(2) + Date.now().toString(36) + Math.random().toString(36).slice(2); }
})();
const ANIMALS = ['토끼', '여우', '고양이', '펭귄', '곰', '수달', '다람쥐', '부엉이', '사슴', '판다'];
let myName = '', mySkin = null;
try { myName = localStorage.getItem('pc_name') || ''; mySkin = JSON.parse(localStorage.getItem('pc3_skin') || 'null'); } catch {}
const firstVisit = !myName;
if (!myName) myName = ANIMALS[Math.floor(Math.random() * ANIMALS.length)] + Math.floor(100 + Math.random() * 900);
if (!Array.isArray(mySkin)) mySkin = [Math.floor(Math.random() * 3), Math.floor(Math.random() * 8), Math.floor(Math.random() * 12), Math.floor(Math.random() * 6)];

// ---------- 도전 과제 ----------
const GOALS = [
  ['log', '🪵', '첫 나무', '원목을 캐요', () => has('#logs')],
  ['table', '🛠️', '작업대', '작업대를 만들어요', () => has(B.crafting_table)],
  ['wpick', '⛏️', '나무 곡괭이', '나무 곡괭이를 만들어요', () => has(I.wood_pickaxe)],
  ['spick', '🪨', '돌 시대', '돌 곡괭이를 만들어요', () => has(I.stone_pickaxe)],
  ['torch', '🔥', '어둠을 밝혀라', '횃불을 만들어요', () => has(B.torch)],
  ['iron', '⚙️', '철의 시대', '철 주괴를 얻어요', () => has(I.iron_ingot)],
  ['diamond', '💎', '다이아몬드!', '다이아몬드를 얻어요', () => has(I.diamond)],
  ['bread', '🍞', '농부', '밀을 길러 빵을 만들어요', () => has(I.bread) && S.goalFlags.farm],
  ['door', '🚪', '내 집', '문을 설치해요', () => S.goalFlags.door],
  ['bed', '🛏️', '편안한 밤', '침대를 사용해요', () => S.goalFlags.bed],
  ['flag', '🚩', '내 땅', '깃발을 세워요', () => S.goalFlags.flag],
  ['zombie', '🧟', '용감한 모험가', '좀비를 물리쳐요', () => S.goalFlags.zombie],
  ['night', '🌙', '첫날밤', '밤을 무사히 보내요', () => S.goalFlags.night],
  ['deep', '🕳️', '깊은 곳으로', '높이 16 아래까지 내려가요', () => S.goalFlags.deep],
  ['peak', '🏔️', '정상에서', '높이 80 위로 올라가요', () => S.goalFlags.peak],
  ['wool', '🎨', '알록달록', '양털을 염색해요', () => S.inv.some((s) => s && s.id > 115 && s.id <= 130)],
  ['friend', '🤝', '이웃', '다른 플레이어 곁에 가요', () => S.goalFlags.friend],
  ['explore', '🧭', '탐험가', '스폰에서 300칸 떨어진 곳까지 가요', () => S.goalFlags.explore],
];
S.goalFlags = {};
let goalDone = new Set();
try { goalDone = new Set(JSON.parse(localStorage.getItem('pc3_goals') || '[]')); S.goalFlags = JSON.parse(localStorage.getItem('pc3_goalflags') || '{}'); } catch {}
const has = (spec) => S.inv.some((s) => s && (typeof spec === 'string' ? ({ '#logs': [9, 20, 22] })[spec].includes(s.id) : s.id === spec));
function flag(k) { if (!S.goalFlags[k]) { S.goalFlags[k] = true; try { localStorage.setItem('pc3_goalflags', JSON.stringify(S.goalFlags)); } catch {} checkGoals(); } }
function checkGoals() {
  if (!S.joined) return;
  for (const [id, icon, name] of GOALS) {
    if (goalDone.has(id)) continue;
    const g = GOALS.find((x) => x[0] === id);
    if (g[4]()) {
      goalDone.add(id);
      try { localStorage.setItem('pc3_goals', JSON.stringify([...goalDone])); } catch {}
      ui.banner(`${icon} ${name}`, '도전 과제 달성!', 3000);
      sound.achieve();
    }
  }
  ui.setGoals(GOALS.map(([id, icon, name, desc]) => ({ icon, name, desc, done: goalDone.has(id) })));
}

// ---------- 화면 크기 ----------
function resize() {
  R.resize(innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 2) * settings.res);
}
addEventListener('resize', resize);
resize();

function applySetting(k) {
  saveSettings();
  if (k === 'res') resize();
  if (k === 'dist' && S.world) { S.world.radius = settings.dist; S.world._init = false; R.setRenderDistance(settings.dist); }
  if (k === 'vol') sound.setVolume(settings.vol);
  R.brightness = settings.bright;
  R.cloudsOn = settings.clouds;
  ents.showNames = settings.names;
  input.mouseSens = settings.sens; input.touchSens = settings.sens; input.invertY = settings.invert;
}
ui.bindSettings(settings, (k) => { settings.manual = true; applySetting(k); });
for (const k of ['res', 'vol', 'bright']) applySetting(k);
R.setRenderDistance(settings.dist);

// ---------- 네트워크 ----------
const KICK = {
  4000: '다른 창에서 같은 캐릭터로 접속했어요.',
  4002: '월드가 가득 찼어요. 잠시 후 다시 시도해 주세요.',
  4003: '이 네트워크에서 접속이 너무 많아요.',
  4004: '새 버전이 나왔어요. 새로고침해 주세요.',
};
ui.loading('월드를 찾는 중…', 0.05);
$('load-tip').textContent = touchDevice ? '왼쪽 아래를 끌어서 이동, 블록을 꾹 누르면 캐고 톡 누르면 놓아요' : 'WASD 이동 · 마우스 왼쪽 캐기 · 오른쪽 놓기 · E 가방';

function mirror() {
  if (!S.world || !S.gen) return null;
  const sn = S.snap || {};
  return {
    v: 3, seed: S.seed, epoch: S.epoch, ts: Date.now(), mods: S.world.modsObject(), signs: S.signs,
    claims: sn.claims || [], players: sn.players || {}, containers: sn.containers || {}, crops: sn.crops || {}, saplings: sn.saplings || {},
  };
}

async function startNet() {
  const mode = await detectMode();
  net = createNet(mode, {
    open: () => send({ t: 'join', ver: PROTO, name: myName, token, skin: mySkin }),
    message: onMsg,
    status: (t) => { if (!S.ready) ui.loading(t); },
    lost: (t) => { S.ready = false; S.joined = false; ui.loading(t, 0.1); input.releaseAll(); },
    kicked: (code) => { S.ready = false; ui.loading(KICK[code] || '연결이 종료됐어요.', 0, true); input.releaseAll(); },
    role: (r) => { S.role = r; },
    mirror,
  });
}
ui.on('retry', () => { if (KICK[4004] && $('load-msg').textContent === KICK[4004]) location.reload(); else net && net.restart(); });

const msgCount = {};
function onMsg(m) {
  msgCount[m.t] = (msgCount[m.t] || 0) + 1;
  switch (m.t) {
    case 'welcome': return onWelcome(m);
    case 'world':
      if (!S.world) return;
      S.world.loadMods(m.mods || {});
      S.claims = m.claims || [];
      S.signs = m.signs || {};
      signMeshes.clearAll();
      return;
    case 'pl':
      ents.setInfo(m.id, m.name, m.skin);
      if (m.id === S.id) { S.name = m.name; S.skin = m.skin; hand.setSkin(m.skin); updateHeld(); try { localStorage.setItem('pc_name', m.name); localStorage.setItem('pc3_skin', JSON.stringify(m.skin)); } catch {} }
      return;
    case 'pq': ents.removePlayer(m.id); return;
    case 's': {
      S.clockOff = m.tm - Date.now();
      S.online = m.on;
      const before = new Map([...ents.mobs].map(([id, e]) => [id, e.hp]));
      ents.state(m);
      for (const [id, e] of ents.mobs) { const h = before.get(id); if (h !== undefined && e.hp < h) mobSound(e, 'hurt'); }
      if (!S.goalFlags.friend) for (const r of m.p) if (S.player && Math.hypot(r[1] - S.player.x, r[3] - S.player.z) < 6) flag('friend');
      return;
    }
    case 'bs': {
      const l = m.l;
      for (let i = 0; i < l.length; i += 4) applyBlock(l[i], l[i + 1], l[i + 2], l[i + 3], true);
      return;
    }
    case 'b1': applyBlock(m.x, m.y, m.z, m.v, false); return;
    case 'inv': {
      const old = S.inv;
      S.inv = invFromWire(m.s);
      ui.setInventory(S.inv);
      updateHeld();
      if (old.some(Boolean) && countAll(S.inv) > countAll(old)) sound.pop();
      if (S.inv.some((s) => s && s.id === I.wheat)) flag('farm');
      checkGoals();
      return;
    }
    case 'you':
      if (m.hp < S.hp && !m.dead) { ui.hit(); sound.hurt(); S.hurtTilt = 0.35; }
      S.hp = m.hp; S.food = m.food; S.air = m.air;
      ui.setStats(S.hp, S.food, S.air);
      return;
    case 'hurt':
      if (S.player) S.player.knock(m.kx, m.kz);
      ui.hit(); sound.hurt(); S.hurtTilt = 0.35;
      return;
    case 'died':
      S.dead = true; input.releaseAll(); ui.closeInventory(); ui.showDeath(m.reason);
      return;
    case 'tp':
      if (S.player) { S.player.setPos(m.x, m.y, m.z); S.player.frozen = !S.world.isLoaded(m.x, m.z); }
      return;
    case 'chat':
      if (!m.id) ui.chatLine('', m.m, true);
      else { ui.chatLine(m.name, m.m, false); ents.bubble(m.id, m.m); }
      return;
    case 'msg': ui.toast(m.m); return;
    case 'chest':
      if (ui.chest && ui.chest.k === m.k && !$('inv').hidden) ui.setChest(m.k, invFromWire(m.s));
      else { exitLock(); input.releaseAll(); ui.openInventory({ k: m.k, slots: invFromWire(m.s) }); }
      return;
    case 'sign': if (m.text === null) delete S.signs[m.k]; else S.signs[m.k] = m.text; signMeshes.refresh(m.k); return;
    case 'signs': S.signs = m.signs || {}; signMeshes.clearAll(); return;
    case 'signEdit': openSignEditor(m.x, m.y, m.z); return;
    case 'claims': S.claims = m.c || []; return;
    case 'snap': S.snap = m.d; return;
    case 'fx':
      if (m.k === 'mobdie') { R.burst(m.x, m.y, m.z, m.type === 'slime' ? [0.4, 0.8, 0.3] : [0.8, 0.8, 0.8], 18, { up: 2, spread: 0.6 }); }
      if (m.k === 'toolbreak') { sound.toolBreak(); ui.toast('도구가 부서졌어요'); }
      return;
  }
}
const countAll = (inv) => inv.reduce((a, s) => a + (s ? s.n : 0), 0);

function onWelcome(m) {
  if (S.world && S.seed === m.seed) {
    // 같은 월드에 다시 접속 (호스트 교체): 메시를 유지하고 변경분만 새로 받음
  } else {
    if (S.world) S.world.dispose();
    S.world = new ClientWorld(R, atlas, m.seed);
    S.gen = createGenerator(m.seed);
  }
  S.world.radius = settings.dist;
  S.world._init = false;
  S.seed = m.seed; S.epoch = m.epoch; S.clockOff = m.now - Date.now();
  S.id = m.id; S.tag = m.tag; S.name = m.name; S.skin = m.skin; S.spawn = m.spawn;
  S.inv = invFromWire(m.inv); S.hp = m.hp; S.food = m.food; S.dead = false; S.air = MAX_AIR;
  ents.clear();
  ents.ensureSelf(m.id);
  ents.setInfo(m.id, m.name, m.skin);
  hand.setSkin(m.skin);
  if (!S.player) S.player = new LocalPlayer(S.world);
  S.player.world = S.world;
  S.player.getB = (x, y, z) => { const b = S.world.getBlock(x, y, z); return b < 0 ? 6 : b; };
  S.player.setPos(m.pos[0], m.pos[1], m.pos[2]);
  S.player.frozen = true;
  ui.setInventory(S.inv); ui.setSelected(S.sel); ui.setStats(S.hp, S.food, S.air); ui.hideDeath();
  ui.setProfile(m.name, m.skin);
  updateHeld();
  S.joined = true;
  checkGoals();
  try { localStorage.setItem('pc_name', m.name); } catch {}
  ui.loading('월드를 불러오는 중…', 0.3);
}

// 블록 변경 적용 (+ 다른 사람이 부순 블록이면 효과)
function applyBlock(x, y, z, v, fx) {
  if (!S.world) return;
  const old = S.world.getBlock(x, y, z);
  if (old === v) return;
  S.world.setBlock(x, y, z, v);
  if (!fx || !S.player) return;
  const d = Math.hypot(x - S.player.x, y - S.player.y, z - S.player.z);
  if (d > 32) return;
  if (old > 0 && v === 0) { R.burst(x + 0.5, y + 0.5, z + 0.5, colorOf(old), 12); sound.break(BLOCKS[old].sound); }
  else if (old === 0 && v > 0 && d > 2) sound.place(BLOCKS[v].sound);
  else if (isDoor(v) && isDoor(old) && BLOCKS[v].door.half === 0) sound.door();
}
const colorOf = (id) => { const c = atlas.colors; return [c[id * 3], c[id * 3 + 1], c[id * 3 + 2]]; };

// ---------- 표지판 글씨 ----------
const signMeshes = {
  map: new Map(),
  clearAll() { for (const k of [...this.map.keys()]) this.remove(k); },
  remove(k) { const m = this.map.get(k); if (m) { R.scene.remove(m); m.material.map.dispose(); m.material.dispose(); m.geometry.dispose(); this.map.delete(k); } },
  refresh(k) { this.remove(k); },
  update() {
    if (!S.player || !S.world) return;
    const px = S.player.x, py = S.player.y, pz = S.player.z;
    for (const [k, m] of this.map) {
      const [x, y, z] = k.split(',').map(Number);
      if (Math.abs(x - px) > 40 || Math.abs(z - pz) > 40 || !isSign(S.world.getBlock(x, y, z)) || m.userData.id !== S.world.getBlock(x, y, z)) this.remove(k);
    }
    for (const k in S.signs) {
      if (this.map.has(k)) continue;
      const [x, y, z] = k.split(',').map(Number);
      if (Math.abs(x - px) > 40 || Math.abs(z - pz) > 40 || Math.abs(y - py) > 40) continue;
      const id = S.world.getBlock(x, y, z);
      if (!isSign(id)) continue;
      const mesh = makeSignMesh(id, x, y, z, S.signs[k]);
      mesh.userData.id = id;
      this.map.set(k, mesh); R.scene.add(mesh);
    }
    const day = daylight(curT());
    for (const [k, m] of this.map) {
      const [x, y, z] = k.split(',').map(Number);
      m.material.color.setScalar(lightAt(x + 0.5, y + 0.5, z + 0.5, day));
    }
  },
};
function makeSignMesh(id, x, y, z, text) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1d1208'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 26px system-ui, sans-serif';
  String(text || '').split('\n').slice(0, 4).forEach((l, i) => g.fillText(l, 128, 18 + i * 30));
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.5), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  const b = BLOCKS[id].sign;
  const f = b.face;
  const ROT = [Math.PI, Math.PI / 2, 0, -Math.PI / 2];
  const nx = [0, 1, 0, -1][f], nz = [-1, 0, 1, 0][f];
  let cx = x + 0.5, cy, cz = z + 0.5;
  if (b.wall) { cy = y + 0.5; cx += nx * (0.5 - 2 / 16) * -1 + nx * 0.0; cz += nz * (0.5 - 2 / 16) * -1; cx += nx * 0.003; cz += nz * 0.003; }
  else { cy = y + 0.75; cx += nx * (1 / 16 + 0.003); cz += nz * (1 / 16 + 0.003); }
  mesh.position.set(cx, cy, cz);
  mesh.rotation.y = ROT[f];
  return mesh;
}
function openSignEditor(x, y, z) {
  exitLock();
  input.releaseAll();
  ui.openSign(S.signs[bkey(x, y, z)] || '', (text) => send({ t: 'sign', x, y, z, text }));
}

// ---------- 시간 / 빛 ----------
const curT = () => timeOfDay(S.epoch, Date.now() + S.clockOff);
function lightAt(x, y, z, day) {
  if (!S.world) return 1;
  const sky = S.world.skyExposure(x, y, z);
  const blk = S.world.blockLightAt(x, y, z);
  return Math.max(0.12 + settings.bright * 0.1, Math.max(sky * day, blk));
}

// ---------- 상호작용 ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function rayDir(point) {
  if (!point || point === 'center') {
    const d = S.player.dir();
    if (S.view === 0) return { o: S.player.eyePos(), d };
    return { o: S.player.eyePos(), d };
  }
  ndc.set((point.x / innerWidth) * 2 - 1, -(point.y / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, R.camera);
  const o = S.view === 0 ? R.camera.position : new THREE.Vector3(...S.player.eyePos());
  if (S.view !== 0) {
    // 3인칭: 화면 점이 가리키는 곳을 향해 눈에서 광선
    const far = R.camera.position.clone().addScaledVector(ray.ray.direction, 30);
    const d = far.sub(o).normalize();
    return { o: [o.x, o.y, o.z], d: [d.x, d.y, d.z] };
  }
  return { o: [o.x, o.y, o.z], d: [ray.ray.direction.x, ray.ray.direction.y, ray.ray.direction.z] };
}
const pickable = (id) => id !== B.water;
function target(point) {
  const { o, d } = rayDir(point);
  const getB = (x, y, z) => { const b = S.world.getBlock(x, y, z); return b < 0 ? 0 : b; };
  const hit = raycast(getB, o[0], o[1], o[2], d[0], d[1], d[2], REACH, pickable);
  const mob = ents.raycastMobs(o[0], o[1], o[2], d[0], d[1], d[2], Math.min(REACH - 1.5, hit ? hit.dist : REACH));
  if (mob) return { mob };
  return hit ? { block: hit } : null;
}
function zoneBlock(x, z) {
  if (Math.hypot(x + 0.5 - S.spawn[0], z + 0.5 - S.spawn[2]) < SAFE_R) return '스폰 광장 근처는 보호 구역이에요';
  for (const c of S.claims) if (c[4] !== S.tag && Math.abs(x - c[0]) <= CLAIM_R && Math.abs(z - c[2]) <= CLAIM_R) return `${c[3]} 님의 땅이에요`;
  return null;
}
function claimUse(x, z) {
  for (const c of S.claims) if (c[4] !== S.tag && Math.abs(x - c[0]) <= CLAIM_R && Math.abs(z - c[2]) <= CLAIM_R) return `${c[3]} 님의 땅이에요`;
  return null;
}
const heldItem = () => S.inv[S.sel];
function swing() { hand.swing = Math.max(hand.swing, 0.01); S.swing = 0.25; }

function attack(mobId) {
  if (S.attackCd > 0) return;
  S.attackCd = 0.42;
  swing();
  send({ t: 'hit', id: mobId });
  const e = ents.mobs.get(mobId);
  if (e) { mobSound(e, 'hurt'); if (e.type === 'zombie' && e.hp <= (toolOf(heldItem()?.id)?.dmg || 1)) setTimeout(() => { if (!ents.mobs.has(mobId)) flag('zombie'); }, 600); }
}

function updateMining(dt) {
  const p = S.player;
  if (!input.mine || S.dead || ui.anyOpen) { S.mining = null; R.crack.visible = false; return; }
  const t = target(input.mine);
  if (!t) { S.mining = null; R.crack.visible = false; return; }
  if (t.mob) { attack(t.mob.id); S.mining = null; R.crack.visible = false; return; }
  const h = t.block;
  if (S.digCd > 0) return;
  const k = bkey(h.x, h.y, h.z);
  if (!S.mining || S.mining.k !== k) {
    const why = zoneBlock(h.x, h.z);
    if (why) { if (!S.mining || S.mining.k !== k) ui.toast(why, 1500); S.mining = { k, blocked: true }; return; }
    S.mining = { k, x: h.x, y: h.y, z: h.z, id: h.id, prog: 0, snd: 0 };
  }
  const M = S.mining;
  if (M.blocked) return;
  const info = breakInfo(h.id, heldItem()?.id);
  if (!isFinite(info.time)) { R.crack.visible = false; return; }
  M.prog += dt / info.time;
  M.snd -= dt;
  hand.swing = Math.max(hand.swing, 0.01); S.swing = 0.25;
  if (M.snd <= 0) { M.snd = 0.25; sound.dig(BLOCKS[h.id].sound); if (Math.random() < 0.6) R.burst(h.x + 0.5, h.y + 0.5, h.z + 0.5, colorOf(h.id), 2, { up: 2 }); }
  R.crack.visible = info.time > 0.15;
  R.crack.position.set(h.x + 0.5, h.y + 0.5, h.z + 0.5);
  R.crack.material.map = R.crackTex[Math.min(9, Math.floor(M.prog * 10))];
  if (M.prog >= 1) {
    send({ t: 'dig', x: h.x, y: h.y, z: h.z });
    applyBlock(h.x, h.y, h.z, 0, false);
    // 문은 위아래 함께
    if (isDoor(h.id)) { const oy = BLOCKS[h.id].door.half ? h.y - 1 : h.y + 1; if (isDoor(S.world.getBlock(h.x, oy, h.z))) applyBlock(h.x, oy, h.z, 0, false); }
    R.burst(h.x + 0.5, h.y + 0.5, h.z + 0.5, colorOf(h.id), 16);
    sound.break(BLOCKS[h.id].sound);
    S.mining = null; R.crack.visible = false;
    S.digCd = 0.18;
  }
}

function eat(slot = S.sel) {
  const s = S.inv[slot];
  if (!s || !ITEMS[s.id]?.food) return false;
  if (S.food >= MAX_FOOD && !ITEMS[s.id].heal) { ui.toast('배가 불러요', 1200); return true; }
  send({ t: 'eat', s: slot });
  sound.eat(); hand.eat = 0.6;
  if (s.id === I.bread) flag('farm');
  return true;
}

function useAt(point) {
  if (S.dead || !S.player) return;
  const t = target(point);
  const held = heldItem();
  if (t && t.mob) return attack(t.mob.id);
  if (!t) { if (held) eat(); return; }
  const h = t.block, id = h.id;
  // 블록 사용
  if (isDoor(id)) {
    const why = claimUse(h.x, h.z);
    if (why) return ui.toast(why);
    const d = BLOCKS[id].door, by = d.half ? h.y - 1 : h.y;
    for (const [yy, half] of [[by, 0], [by + 1, 1]]) if (isDoor(S.world.getBlock(h.x, yy, h.z))) applyBlock(h.x, yy, h.z, 77 + half * 8 + (1 - d.open) * 4 + d.dir, false);
    sound.door(); swing();
    return send({ t: 'use', x: h.x, y: h.y, z: h.z });
  }
  if (isChest(id)) { swing(); return send({ t: 'use', x: h.x, y: h.y, z: h.z }); }
  if (id === B.crafting_table || isFurnace(id)) {
    swing();
    ui.cat = id === B.crafting_table ? 'tools' : 'smelt';
    return openInventory();
  }
  if (id === B.bed) { flag('bed'); swing(); return send({ t: 'use', x: h.x, y: h.y, z: h.z }); }
  if (isSign(id) && !(held && ITEMS[held.id].block !== undefined && !S.player.sneaking)) {
    const why = zoneBlock(h.x, h.z) && claimUse(h.x, h.z);
    if (why) return ui.toast((S.signs[bkey(h.x, h.y, h.z)] || '').replace(/\n/g, ' / ') || why, 3000);
    return openSignEditor(h.x, h.y, h.z);
  }
  if (id === B.flag) {
    const c = S.claims.find((c) => c[0] === h.x && c[1] === h.y && c[2] === h.z);
    if (c && !held) return ui.toast(`${c[3]} 님의 땅 (17×17)`);
  }
  if (held && toolOf(held.id)?.cls === 'hoe' && (id === B.grass || id === B.dirt || id === B.snowy_grass)) {
    const why = zoneBlock(h.x, h.z);
    if (why) return ui.toast(why);
    if (S.world.getBlock(h.x, h.y + 1, h.z) === 0) { applyBlock(h.x, h.y, h.z, B.farmland, false); sound.place('gravel'); swing(); }
    return send({ t: 'use', x: h.x, y: h.y, z: h.z });
  }
  if (!held) return;
  const it = ITEMS[held.id];
  if (it.food && it.block === undefined) return eat();
  if (it.block === undefined && !it.place) return;
  // 놓기
  const N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][h.face];
  let x = h.x, y = h.y, z = h.z;
  if (!(BLOCKS[id] && BLOCKS[id].replaceable)) { x += N[0]; y += N[1]; z += N[2]; }
  if (y < 0 || y >= CH) return;
  const why = zoneBlock(x, z);
  if (why) return ui.toast(why);
  const dir = yawToDir(S.player.yaw);
  const getB = (a, b, c) => { const v = S.world.getBlock(a, b, c); return v < 0 ? 0 : v; };
  const res = resolvePlacement(held.id, x, y, z, h.face, dir, getB);
  if (res.err !== undefined) { if (res.err) ui.toast(res.err); return; }
  // 내 몸과 겹치면 안 됨
  if (SOLID[res.id] && BLOCKS[res.id].render !== 'cross') {
    const p = S.player, hw = p.w / 2 - 0.01;
    const inter = (bx, by, bz) => p.x + hw > bx && p.x - hw < bx + 1 && p.y + p.h - 0.01 > by && p.y + 0.01 < by + 1 && p.z + hw > bz && p.z - hw < bz + 1;
    if (inter(x, y, z) || (res.extra && inter(res.extra[0], res.extra[1], res.extra[2]))) return;
  }
  applyBlock(x, y, z, res.id, false);
  if (res.extra) applyBlock(res.extra[0], res.extra[1], res.extra[2], res.extra[3], false);
  sound.place(BLOCKS[res.id].sound); swing();
  send({ t: 'place', x, y, z, s: S.sel, f: h.face, d: dir });
  if (isDoor(res.id)) flag('door');
  if (res.id === B.flag) flag('flag');
}

function openInventory() {
  exitLock();
  input.releaseAll();
  ui.openInventory(null);
}
function exitLock() { if (document.pointerLockElement) document.exitPointerLock?.(); }

function updateHeld() {
  const s = S.inv[S.sel];
  hand.setHeld(s ? s.id : 0);
}

function mobSound(e, kind) {
  if (!S.player) return;
  const dx = e.x - S.player.x, dz = e.z - S.player.z, d = Math.hypot(dx, dz, e.y - S.player.y);
  if (d > 24) return;
  const fx = -Math.sin(S.player.yaw), fz = -Math.cos(S.player.yaw);
  const pan = clamp((dx * -fz + dz * fx) / (d || 1), -1, 1);
  sound.mob(e.type, kind, pan, 1 - d / 26);
}

// ---------- UI 콜백 ----------
ui.on('select', (i) => { S.sel = i; ui.setSelected(i); updateHeld(); sound.click(); });
ui.on('swap', (a, b, half) => send({ t: 'swap', a, b, half }));
ui.on('trash', (a) => send({ t: 'trash', a }));
ui.on('eat', (a) => eat(a));
ui.on('craft', (r, n) => send({ t: 'craft', r, n }));
ui.on('closeChest', () => send({ t: 'closeChest' }));
ui.on('chat', (text) => {
  send({ t: 'chat', m: text });
  if (text[0] !== '/') ents.bubble(S.id, text);
});
ui.on('respawn', () => { send({ t: 'respawn' }); ui.hideDeath(); S.dead = false; });
ui.on('name', (n) => { if (n) send({ t: 'name', name: n }); });
ui.on('skin', (sk) => { mySkin = sk; try { localStorage.setItem('pc3_skin', JSON.stringify(sk)); } catch {} send({ t: 'skin', skin: sk }); });

$('b-chat').addEventListener('click', () => { exitLock(); ui.openChat(); });
$('b-inv').addEventListener('click', () => openInventory());
$('b-menu').addEventListener('click', () => { exitLock(); ui.openMenu(); });
$('b-view').addEventListener('click', () => { S.view = (S.view + 1) % 3; });

input.onCommand = (c) => {
  if (c === 'inventory') { if (!$('inv').hidden) ui.closeInventory(); else if (!ui.anyOpen) openInventory(); return; }
  if (c === 'escape') {
    if (!$('sign').hidden) return;
    if (!$('inv').hidden) return ui.closeInventory();
    if (!$('menu').hidden) return ui.closeMenu();
    if (ui.chatOpen) return ui.closeChat();
    return;
  }
  if (ui.anyOpen) return;
  if (c === 'chat' || c === 'chat/') { exitLock(); ui.openChat(c === 'chat/' ? '/' : ''); return; }
  if (c === 'view') S.view = (S.view + 1) % 3;
  if (c === 'hud') { S.hud = !S.hud; ui.setHud(S.hud); }
  if (c === 'debug') S.debug = !S.debug;
  if (c === 'eat') eat();
  if (c.startsWith('slot')) { S.sel = +c.slice(4); ui.setSelected(S.sel); updateHeld(); }
  if (c === 'unlocked' && !ui.anyOpen && S.ready && !touchDevice && !input.touchMode) ui.openMenu();
  if (c === 'pick') {
    const t = target('center');
    if (t && t.block) { const want = BLOCKS[t.block.id].item ?? t.block.id; const i = S.inv.findIndex((s, k) => k < 9 && s && s.id === want); if (i >= 0) { S.sel = i; ui.setSelected(i); updateHeld(); } }
  }
};
addEventListener('pointerdown', () => sound.unlock(), { capture: true });
addEventListener('keydown', () => sound.unlock(), { capture: true });

// ---------- 매 프레임 ----------
let last = performance.now();
let acc = { pos: 0, station: 0, ui: 0, signs: 0, save: 0, idle: 0, perf: 0 };
let fps = 0, fpsN = 0, fpsT = 0;
const camEuler = new THREE.Euler(0, 0, 0, 'YXZ');

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fpsN++; fpsT += dt; if (fpsT >= 1) { fps = fpsN; fpsN = 0; fpsT = 0; }
  const t = curT();
  if (!S.world || !S.player) { R.updateSky(0.2, R.camera.position, dt, now / 1000); R.render(); return; }
  const p = S.player;
  input.enabled = !ui.anyOpen && !S.dead;
  $('touch').hidden = !(input.touchMode || touchDevice) || ui.anyOpen;
  ui.setCrosshair(S.hud && S.view === 0);

  // 청크 로딩
  S.world.update(p.x, p.z);
  const prog = S.world.progress();
  if (p.frozen && S.world.isLoaded(p.x, p.z) && S.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)) >= 0) p.frozen = false;
  if (!S.ready && S.joined) {
    const need = Math.min(prog.total, 21);
    ui.loading('월드를 불러오는 중…', 0.3 + 0.7 * Math.min(1, prog.loaded / Math.max(1, need)));
    if (prog.loaded >= need && !p.frozen) {
      S.ready = true; ui.hideLoading();
      if (firstVisit && !S.welcomed) { S.welcomed = true; ui.banner('픽셀 커먼스에 오신 걸 환영해요!', touchDevice ? '왼쪽을 끌어 이동 · 블록을 꾹 눌러 캐기 · ⚙️ 도움말' : '클릭해서 시작 · WASD 이동 · E 가방 · Esc 메뉴', 6000); }
      else ui.banner(`${S.name} 님, 다시 오셨네요`, '', 2500);
    }
  }

  // 시점
  const look = input.poll();
  p.yaw += look.dx;
  p.pitch = clamp(p.pitch + look.dy, -1.55, 1.55);
  if (input.hotbarDelta) { S.sel = ((S.sel + input.hotbarDelta) % 9 + 9) % 9; input.hotbarDelta = 0; ui.setSelected(S.sel); updateHeld(); }

  // 물리
  if (!S.dead && S.ready) {
    const ev = p.update(dt, input, { autoJump: settings.autoJump && (input.touchMode || touchDevice) });
    if (ev.landed) send({ t: 'fall', d: ev.landed });
    if (ev.bounced && sound.ok('bounce', 100)) sound.burst('slime', 0.2, 0.4, 0.7);
    if (ev.splash) sound.splash();
    if (ev.step !== null && ev.step > 0) sound.step(BLOCKS[ev.step] ? BLOCKS[ev.step].sound : 'stone');
  }
  S.attackCd -= dt; S.digCd -= dt; S.swing -= dt;
  if (S.ready && !S.dead) {
    updateMining(dt);
    while (input.useQueue.length) {
      const pt = input.useQueue.shift();
      if (!ui.anyOpen) useAt(pt);
    }
  } else input.useQueue.length = 0;

  // 위치 전송
  acc.pos += dt;
  if (acc.pos >= 0.066 && S.ready && !S.dead) {
    acc.pos = 0;
    const f = (p.sneaking ? 1 : 0) | (p.sprinting ? 2 : 0) | (S.swing > 0 ? 4 : 0);
    send({ t: 'pos', x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3), f, h: S.sel });
  }

  // 카메라
  const eye = p.eyePos();
  const bob = settings.bob && S.view === 0 ? p.walk : 0;
  const bobY = settings.bob ? Math.abs(Math.cos(bob * 2.6)) * 0.045 : 0, bobX = settings.bob ? Math.sin(bob * 2.6) * 0.03 : 0;
  S.hurtTilt = Math.max(0, S.hurtTilt - dt);
  const fov = settings.fov + (p.sprinting ? 8 : 0);
  R.camera.fov += (fov - R.camera.fov) * Math.min(1, dt * 8);
  R.camera.updateProjectionMatrix();
  if (S.view === 0) {
    R.camera.position.set(eye[0] + Math.cos(p.yaw) * bobX, eye[1] + bobY, eye[2] - Math.sin(p.yaw) * bobX);
    camEuler.set(p.pitch, p.yaw, Math.sin(S.hurtTilt * 20) * S.hurtTilt * 0.3);
  } else {
    const d = p.dir(), back = S.view === 1 ? -1 : 1;
    let dist = 4;
    const getB = (x, y, z) => { const b = S.world.getBlock(x, y, z); return b < 0 ? 0 : b; };
    const hit = raycast(getB, eye[0], eye[1], eye[2], d[0] * back, d[1] * back, d[2] * back, 4.2, (id) => BLOCKS[id].opaque);
    if (hit) dist = Math.max(0.6, hit.dist - 0.3);
    R.camera.position.set(eye[0] + d[0] * back * dist, eye[1] + d[1] * back * dist, eye[2] + d[2] * back * dist);
    camEuler.set(S.view === 1 ? p.pitch : -p.pitch, S.view === 1 ? p.yaw : p.yaw + Math.PI, 0);
  }
  R.camera.quaternion.setFromEuler(camEuler);
  R.underwater = p.eyeInWater;
  ui.setUnderwater(p.eyeInWater);

  // 하늘/빛
  const sky = R.updateSky(t, R.camera.position, dt, now / 1000);
  const day = sky.day;
  const here = lightAt(p.x, p.y + 1.5, p.z, day);

  // 선택 테두리
  if (S.ready && !S.dead && S.view === 0 && !ui.anyOpen) {
    const tg = target('center');
    if (tg && tg.block) {
      const bs = BLOCKS[tg.block.id];
      let box = [0, 0, 0, 1, 1, 1];
      if (bs.render === 'model') { const b = bs.boxes; box = [16, 16, 16, 0, 0, 0]; for (const q of b) for (let i = 0; i < 3; i++) { box[i] = Math.min(box[i], q[i]); box[i + 3] = Math.max(box[i + 3], q[i + 3]); } box = box.map((v) => v / 16); }
      else if (bs.render === 'cross') box = (bs.sel ? bs.sel[0] : [2, 0, 2, 14, 14, 14]).map((v) => v / 16);
      R.selBox.visible = true;
      R.selBox.position.set(tg.block.x + (box[0] + box[3]) / 2, tg.block.y + (box[1] + box[4]) / 2, tg.block.z + (box[2] + box[5]) / 2);
      R.selBox.scale.set(box[3] - box[0] + 0.004, box[4] - box[1] + 0.004, box[5] - box[2] + 0.004);
    } else R.selBox.visible = false;
  } else R.selBox.visible = false;

  // 엔티티/손/파티클
  ents.update(dt, (x, y, z) => lightAt(x, y, z, day), { x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, fl: (p.sneaking ? 1 : 0), held: S.inv[S.sel] ? S.inv[S.sel].id : 0, visible: S.view !== 0 && S.ready, swing: S.swing > 0.2 });
  hand.update(dt, here, Math.hypot(p.vx, p.vz) > 1 && p.onGround, S.view === 0 && S.ready && !S.dead);
  R.updateParticles(dt, (x, y, z) => S.world.solidAt(x, y, z), here);
  for (const e of ents.mobs.values()) if (e.burnFx && Math.random() < dt * 6) R.burst(e.x, e.y + 1.4, e.z, [1, 0.6, 0.15], 1, { up: 1.5, spread: 0.6, grav: -2, size: 0.08 });

  // 몹 소리 (가끔)
  acc.idle += dt;
  if (acc.idle > 2.5) {
    acc.idle = 0;
    for (const e of ents.mobs.values()) if (Math.random() < 0.15) { mobSound(e, 'idle'); break; }
  }

  // 주기적 작업
  acc.station += dt;
  if (acc.station >= 0.5) {
    acc.station = 0;
    const st = { table: false, furnace: false };
    const bx = Math.floor(p.x), by = Math.floor(p.y + 1), bz = Math.floor(p.z);
    for (let y = by - 4; y <= by + 4; y++) for (let z = bz - 4; z <= bz + 4; z++) for (let x = bx - 4; x <= bx + 4; x++) {
      const b = S.world.getBlock(x, y, z);
      if (b === B.crafting_table) st.table = true; else if (isFurnace(b)) st.furnace = true;
    }
    ui.setStation(st);
    if (p.y < 16) flag('deep');
    if (p.y > 80) flag('peak');
    if (Math.hypot(p.x, p.z) > 300) flag('explore');
    const night = isNight(t);
    if (S.wasNight && !night && !S.dead && S.ready) { flag('night'); ui.banner('☀️ 아침이 밝았어요', '', 2500); }
    if (!S.wasNight && night && S.ready) ui.banner('🌙 밤이 됐어요', '몬스터를 조심하세요! 횃불 주변은 안전해요', 3500);
    S.wasNight = night;
  }
  acc.signs += dt;
  if (acc.signs >= 0.5) { acc.signs = 0; signMeshes.update(); }
  acc.ui += dt;
  if (acc.ui >= 0.25) {
    acc.ui = 0;
    const hours = (t * 24 + 6) % 24, hh = Math.floor(hours), mm = Math.floor((hours - hh) * 60);
    const clock = `${day > 0.6 ? '☀️' : day > 0.3 ? '🌇' : '🌙'} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const zone = Math.hypot(p.x - S.spawn[0], p.z - S.spawn[2]) < SAFE_R ? '🏘️ 스폰 광장 (보호)' : (() => { const c = S.claims.find((c) => Math.abs(p.x - c[0]) <= CLAIM_R + 0.5 && Math.abs(p.z - c[2]) <= CLAIM_R + 0.5); return c ? `🚩 ${c[3]} 님의 땅` : ''; })();
    ui.setInfo({ time: clock, online: `👥 ${S.online}`, role: S.role === 'host' ? '🏠 내가 호스트' : '', zone });
    if (S.debug) {
      const c = S.gen.column(Math.floor(p.x), Math.floor(p.z));
      const r = R.gl.info.render;
      ui.setDebug(`${fps} fps  ${r.calls} draw  ${(r.triangles / 1000).toFixed(0)}k tri\nXYZ ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}\n바이옴 ${BIOME_NAMES[c.biome]}  청크 ${prog.loaded}/${prog.total}\n메시 평균 ${(S.world.meshMs / Math.max(1, S.world.meshCount)).toFixed(1)}ms  몹 ${ents.mobs.size}`);
    } else ui.setDebug('');
  }
  // 기기가 버거워하면 화질 자동 조절 (설정을 직접 바꾼 적이 없을 때만)
  acc.perf += dt;
  if (acc.perf >= 5 && S.ready && !ui.anyOpen && !document.hidden) {
    acc.perf = 0;
    if (!settings.manual && fps > 0 && fps < 22) {
      if (settings.dist > 3) { settings.dist--; applySetting('dist'); }
      else if (settings.res > 0.6) { settings.res = Math.max(0.6, +(settings.res - 0.15).toFixed(2)); applySetting('res'); }
      else acc.perf = -1e9;
      if (acc.perf >= 0) ui.toast('기기에 맞춰 화질을 조절했어요 (⚙️ 설정에서 바꿀 수 있어요)', 2500);
    }
  }
  // P2P 손님: 월드 사본을 이 기기에도 저장 (모두 나가도 이어갈 수 있게)
  acc.save += dt;
  if (acc.save >= 30 && S.role === 'guest' && S.ready) { acc.save = 0; const mr = mirror(); if (mr) storeSave(mr); }

  R.render();
}
requestAnimationFrame(frame);
startNet();

// 개발/테스트용 접근
window.__pc = { S, R, ui, input, send, settings, ents, msgCount, get net() { return net; } };
