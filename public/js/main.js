// 별빛 모험단 — 클라이언트 진입점 (렌더링 · 조작 · 네트워크 메시지 처리)
import { THREE, Renderer } from './client/renderer.js';
import { playerModel, npcModel, monsterModel, lootModel } from './client/models.js';
import { FX } from './client/fx.js';
import { Input } from './client/input.js';
import { UI } from './client/ui.js';
import { Sound } from './client/audio.js';
import { detectMode, createNet, ROOM } from './net.js';
import { PROTO, PLAYER_R, INTERACT_R, WORLD_R, clamp, dist, dirOf, ryTo, angleDiff } from './shared/constants.js';
import { CLASSES, SKILLS, DODGE, MONSTERS, STACK, NPCS, GEAR, RARITY, POTION_CD, QUEST_BY_ID } from './shared/data.js';
import { deriveStats, countStack, itemName } from './shared/rules.js';
import { heightAt, moveCircle, NPC_POS, WAYPOINTS, CAMPS, ARENAS, SPAWNS } from './shared/world.js';

const $ = (id) => document.getElementById(id);
const MOB_KEYS = Object.keys(MONSTERS);
const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const nowMs = () => Date.now();
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
if (touch) document.body.classList.add('touch');
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// ---------- 저장 ----------
const load = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const DEFAULTS = { dist: touch ? 120 : 160, res: touch ? 0.8 : 1, vol: 0.7, sens: 1, shadows: !touch, nums: true, names: true };
const settings = Object.assign({}, DEFAULTS, load('rpg_settings', {}));
const token = (() => {
  const make = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : '') + Math.random().toString(36).slice(2) + Date.now().toString(36);
  try {
    let t = localStorage.getItem('pc_token');
    if (!t || t.length < 16) { t = make(); localStorage.setItem('pc_token', t); }
    return t;
  } catch { return make(); }
})();
let savedName = '';
try { savedName = localStorage.getItem('pc_name') || ''; } catch {}

// ---------- 상태 ----------
const S = {
  id: 0, joined: false, live: false, role: '', ch: null, st: null, lst: null,
  x: 0, z: 0, y: 0, ry: 0, vry: 0, hp: 1, mp: 1, maxHp: 1, maxMp: 1, spd: 0,
  downed: false, downAt: 0, cds: {}, atkT: 0, potT: 0,
  target: 0, intent: null, dash: null, cast: null, moving: false,
  players: new Map(), mobs: new Map(), loot: new Map(), npcs: new Map(),
  buffs: [], bkey: '', party: [], pkey: '', boss: {}, online: 0, qt: [],
  posT: 0, sentX: 1e9, sentZ: 1e9, sentRy: 0, shake: 0, model: null, mkey: '',
  loading: false, loadT: 0, kick: 0,
};
{
  const c = load('rpg_char_v1', null);
  if (c && CLASSES[c.cls]) S.ch = c;
}

// ---------- 화면 구성 ----------
const canvas = $('c');
const R = new Renderer(canvas, { touch, shadows: settings.shadows });
R.camDist = touch ? 19 : 19;
const fx = new FX(R.scene, R.camera, $('nums'));
const sound = new Sound();
const ui = new UI(sound);
const input = new Input(canvas, {
  joyBase: $('joy'), joyKnob: $('joy-knob'),
  buttons: { atk: $('b-atk'), s0: $('s0'), s1: $('s1'), s2: $('s2'), s3: $('s3'), dodge: $('b-dodge'), hp: $('b-hp'), mp: $('b-mp'), act: $('b-act') },
});
for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, () => sound.unlock(), { capture: true, passive: true });

// 휴대폰처럼 작은 화면에서는 퀘스트 안내를 왼쪽으로 옮김
function layout() {
  const small = innerHeight < 560 || innerWidth < 600;
  document.body.classList.toggle('small', small);
  const tr = $('tracker');
  if (small) { if (tr.parentNode !== $('hud-tl')) $('hud-tl').insertBefore(tr, $('buffs')); }
  else if (tr.parentNode !== $('hud-tr')) $('hud-tr').insertBefore(tr, $('feed'));
}
function resize() { layout(); R.resize(innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 2) * settings.res); }
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 200));
function applySetting(k) {
  if (k === 'dist') R.setViewDist(settings.dist);
  if (k === 'res') resize();
  if (k === 'vol') sound.setVolume(settings.vol);
  if (k === 'sens') input.sens = settings.sens;
  if (k === 'shadows') R.setShadows(settings.shadows);
  save('rpg_settings', settings);
}
ui.bindSettings(settings, (k) => { if (k === 'res') settings.manualRes = true; applySetting(k); });
for (const k of ['dist', 'vol', 'sens']) applySetting(k);
resize();

// NPC
for (const [key, p] of Object.entries(NPC_POS)) {
  const N = { key, x: p.x, z: p.z, ry: p.ry, vry: p.ry, model: null, height: 2.5 };
  if (key !== 'board') {
    N.model = npcModel(key);
    N.model.root.position.set(p.x, heightAt(p.x, p.z), p.z);
    N.model.root.rotation.y = p.ry;
    R.scene.add(N.model.root);
    N.height = N.model.height + 0.2;
  }
  S.npcs.set(key, N);
}

// 대상 표시 고리 + 퀘스트 방향 화살표
const targetRing = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 40), new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.9, depthWrite: false }));
targetRing.rotation.x = -Math.PI / 2; targetRing.visible = false; targetRing.renderOrder = 2;
R.scene.add(targetRing);
const guide = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 4), new THREE.MeshBasicMaterial({ color: 0xffd84a, transparent: true, opacity: 0.85, depthWrite: false }));
guide.visible = false; guide.rotation.order = 'YXZ';
R.scene.add(guide);

// ---------- 네트워크 ----------
let net = null, netOpen = false, pendingCreate = null, lastStatus = '월드에 접속 중…';
const send = (o) => { if (net && netOpen) net.send(o); };
const creating = () => !$('create').hidden;
function status(t, lost) {
  lastStatus = t;
  if (!S.joined) { if (!creating()) ui.loading(t); return; }
  const pill = $('netpill');
  pill.textContent = t; pill.hidden = false;
  if (lost) S.live = false;
}
function tryJoin() {
  if (!netOpen) return;
  if (S.ch) send({ t: 'join', ver: PROTO, token, name: S.ch.name, char: S.ch, pos: S.joined ? [r1(S.x), r1(S.z)] : load('rpg_pos_v1', null) });
  else if (pendingCreate) send({ t: 'join', ver: PROTO, token, name: pendingCreate.name, cls: pendingCreate.cls, look: pendingCreate.look });
}
const KICK = {
  4000: '다른 창에서 같은 캐릭터로 접속해서 연결이 끊겼어요.', 4001: '접속 정보가 잘못됐어요.', 4002: '월드가 가득 찼어요. 잠시 후 다시 시도해 주세요.',
  4004: '새 버전이 나왔어요. 새로고침해 주세요.', 4005: '캐릭터 정보가 없어요. 새로고침해 주세요.',
};
function onKicked(code) {
  S.kick = code; S.live = false; netOpen = false;
  $('netpill').hidden = true;
  ui.loading(KICK[code] || '연결이 끊겼어요.', undefined, true);
}
async function startNet() {
  const mode = await detectMode();
  net = createNet(mode, {
    open: () => { netOpen = true; tryJoin(); },
    message: onMessage,
    status: (t) => status(t),
    lost: (t) => { netOpen = false; status(t, true); },
    kicked: onKicked,
    role: (r) => { S.role = r; renderRole(); },
  });
  window.__pc.net = net;
}
function renderRole() {
  $('role').textContent = ({ server: '서버에 접속 중', host: '내 기기가 월드를 열고 있어요 (호스트) — 창을 닫으면 다른 사람이 이어받아요', guest: '다른 모험가의 월드에 접속 중 (P2P)' }[S.role] || '') + (ROOM ? ` · 비밀 방: ${ROOM}` : '');
}

// ---------- 메시지 ----------
function onMessage(m) {
  window.__pc.msgCount++;
  switch (m.t) {
    case 'welcome': return onWelcome(m);
    case 'pl': return onPlayer(m);
    case 'pq': { const P = S.players.get(m.id); if (P) { R.scene.remove(P.model.root); P.model.dispose(); S.players.delete(m.id); } return; }
    case 's': return onState(m);
    case 'fx': for (const e of m.f) onFx(e); for (const h of m.h) onHit(h); return;
    case 'char': {
      S.ch = m.ch; S.st = m.st;
      save('rpg_char_v1', S.ch);
      recalcLocal();
      ensureMyModel();
      ui.setCharacter(S.ch, S.st);
      updateQuestTargets();
      return;
    }
    case 'tp': {
      const far = dist(S.x, S.z, m.x, m.z) > 12;
      S.x = m.x; S.z = m.z; S.dash = null; S.intent = null; S.cast = null;
      if (far) { fx.pillar(S.x, S.z, 0x7ff0ff, 0.9, 6); sound.blink(); R.target.set(S.x, heightAt(S.x, S.z), S.z); needChunks = true; }
      return;
    }
    case 'down':
      S.downed = true; S.downAt = nowMs(); S.intent = null; S.dash = null; S.cast = null;
      ui.closeAll(); ui.showDeath(m.by); sound.down();
      return;
    case 'up': S.downed = false; ui.hideDeath(); sound.revive(); fx.pillar(S.x, S.z, 0xfff0a0, 1, 6); return;
    case 'xp': if (settings.nums && m.n > 0) fx.number(S.x, S.y + 2.6, S.z, `+${m.n} 경험치`, 'xp'); return;
    case 'gold': if (settings.nums) fx.number(m.x, heightAt(m.x, m.z) + 1.6, m.z, `+${m.n} G`, 'gold'); sound.coin(); return;
    case 'loot': for (const [id, x, z, it] of m.l) addLoot(id, x, z, it); return;
    case 'picked': {
      const L = S.loot.get(m.id);
      if (L) { R.scene.remove(L.mesh); S.loot.delete(m.id); }
      const it = m.it, g = GEAR[it.k];
      ui.feed(`${g ? '' : STACK[it.k].icon + ' '}<b style="color:${g ? RARITY[it.r || 0].color : '#fff'}">${esc(itemName(it))}</b>${it.n > 1 ? ` ×${it.n}` : ''}`);
      if (g && it.r >= 3) sound.rare(); else sound.pickup();
      return;
    }
    case 'qprog': {
      const Q = m.q === 'bounty' ? null : QUEST_BY_ID[m.q];
      const name = Q ? Q.name : `현상금: ${S.ch && S.ch.bounty ? MONSTERS[S.ch.bounty.mob].name : ''}`;
      ui.feed(`📜 ${esc(name)} <b>${m.n}/${m.need}</b>`);
      if (m.n >= m.need) { sound.quest(); ui.toast(Q ? `목표 달성! ${NPCS[Q.npc].name}에게 돌아가세요` : '현상금 목표 달성! 게시판으로 가세요'); }
      return;
    }
    case 'enh':
      sound.enhance(m.ok);
      ui.banner(m.ok ? `강화 성공! +${m.en}` : '강화 실패…', m.ok ? m.name : '장비는 그대로예요. 다시 도전해 보세요', 2200);
      return;
    case 'msg': ui.toast(m.m); if (m.snd === 'coin') sound.coin(); return;
    case 'banner':
      ui.banner(m.a, m.b);
      if (/레벨 업/.test(m.a)) sound.levelup(); else if (/등장|분열/.test(m.a)) sound.warn(); else sound.quest();
      return;
    case 'chat': ui.chatLine(m.id ? m.name : '', m.m, m.id ? (m.party ? 'party' : '') : 'sys'); return;
    case 'pinv': ui.invite(m.from, m.name); sound.quest(); return;
    case 'boss': S.boss = {}; for (const [type, alive, ms] of m.l) S.boss[type] = { alive, at: nowMs() + ms }; return;
    case 'kick': onKicked(m.code); return;
  }
}

function clearWorld() {
  for (const P of S.players.values()) { R.scene.remove(P.model.root); P.model.dispose(); }
  for (const M of S.mobs.values()) { R.scene.remove(M.model.root); M.model.dispose(); }
  for (const L of S.loot.values()) R.scene.remove(L.mesh);
  S.players.clear(); S.mobs.clear(); S.loot.clear();
  S.target = 0;
}

function onWelcome(m) {
  clearWorld();
  S.id = m.id; S.ch = m.ch; S.st = m.st;
  S.x = m.x; S.z = m.z; S.y = heightAt(S.x, S.z); S.hp = m.hp; S.mp = m.mp; S.maxHp = m.st.maxHp; S.maxMp = m.st.maxMp;
  S.downed = false; S.dash = null; S.intent = null; S.cast = null; S.cds = {}; S.atkT = 0; S.potT = 0; S.buffs = []; S.bkey = '';
  S.live = true; S.kick = 0;
  pendingCreate = null;
  save('rpg_char_v1', S.ch);
  try { localStorage.setItem('pc_name', S.ch.name); } catch {}
  recalcLocal();
  ensureMyModel();
  S.model.downed = false;
  ui.hideDeath();
  ui.setCharacter(S.ch, S.st);
  updateQuestTargets();
  $('netpill').hidden = true;
  R.target.set(S.x, S.y, S.z);
  needChunks = true;
  if (!S.joined) {
    document.body.classList.add('ingame');
    S.joined = true; S.loading = true; S.loadT = performance.now();
    ui.loading('섬을 그리는 중…', 0);
    setTimeout(() => ui.toast(touch ? '왼쪽 아래를 끌어 이동 · ⚔️ 공격 · 몬스터를 누르면 자동으로 싸워요' : 'WASD 이동 · Space 공격 · 1~4 스킬 · Shift 구르기 · F 대화 · I 가방 · M 지도', 6000), 1500);
    if (touch && innerWidth < innerHeight && innerWidth < 600) setTimeout(() => ui.toast('📱 화면을 가로로 돌리면 더 넓게 볼 수 있어요', 4000), 8000);
  }
}

function gearOf(ch) {
  const e = ch.equip;
  return [e.weapon ? GEAR[e.weapon.k].tier : 0, e.weapon ? e.weapon.r : 0, e.armor ? GEAR[e.armor.k].tier : -1, e.helm ? GEAR[e.helm.k].tier : -1];
}
function ensureMyModel() {
  const key = S.ch.cls + JSON.stringify(S.ch.look) + JSON.stringify(gearOf(S.ch));
  if (S.mkey === key && S.model) return;
  const old = S.model;
  S.model = playerModel(S.ch.cls, S.ch.look, gearOf(S.ch));
  if (old) { S.model.downed = old.downed; R.scene.remove(old.root); old.dispose(); }
  S.model.root.position.set(S.x, heightAt(S.x, S.z), S.z);
  R.scene.add(S.model.root);
  S.mkey = key;
}
function recalcLocal() {
  if (!S.ch) return;
  S.lst = deriveStats(S.ch, S.buffs.map((k) => SKILLS[k] && SKILLS[k].buff).filter(Boolean));
}

function onPlayer(m) {
  if (m.id === S.id) return;
  let P = S.players.get(m.id);
  if (!P) { P = { id: m.id, x: 0, z: 0, ry: 0, tx: 0, tz: 0, tr: 0, hp: 100, downed: 0, anim: 0, seen: false, spd: 0, mkey: '' }; S.players.set(m.id, P); }
  Object.assign(P, { name: m.name, cls: m.cls, look: m.look, lv: m.lv, title: m.title, w: m.w });
  const key = m.cls + JSON.stringify(m.look) + JSON.stringify(m.w);
  if (P.mkey !== key) {
    const down = P.model ? P.model.downed : false;
    if (P.model) { R.scene.remove(P.model.root); P.model.dispose(); }
    P.model = playerModel(m.cls, m.look, m.w);
    P.model.downed = down;
    P.model.root.visible = P.seen;
    P.model.root.position.set(P.x, heightAt(P.x, P.z), P.z);
    R.scene.add(P.model.root);
    P.mkey = key;
  }
}

function makeMob(id, type, x, z, ry, lv) {
  const model = monsterModel(type);
  model.root.position.set(x, heightAt(x, z), z);
  model.root.rotation.y = ry;
  R.scene.add(model.root);
  const M = { id, type, T: MONSTERS[type], model, x, z, ry, tx: x, tz: z, tr: ry, hp: 100, fl: 0, lv, dead: false, dieT: 0, spd: 0 };
  S.mobs.set(id, M);
  return M;
}
function removeMob(M) {
  R.scene.remove(M.model.root); M.model.dispose();
  S.mobs.delete(M.id);
  if (S.target === M.id) S.target = 0;
}

function onState(m) {
  S.online = m.on;
  const seen = new Set();
  for (const [id, x, z, ry, anim, hp, downed] of m.p) {
    const P = S.players.get(id);
    if (!P || !P.model) continue;
    seen.add(id);
    if (!P.seen || dist(P.x, P.z, x, z) > 15) { P.x = x; P.z = z; P.ry = ry; P.seen = true; P.model.root.visible = true; }
    P.tx = x; P.tz = z; P.tr = ry; P.hp = hp; P.downed = downed; P.anim = anim;
  }
  for (const P of S.players.values()) if (P.seen && !seen.has(P.id)) { P.seen = false; P.model.root.visible = false; }
  const ms = new Set();
  for (const [id, ti, x, z, ry, hp, fl, lv] of m.m) {
    ms.add(id);
    let M = S.mobs.get(id);
    if (!M) { const type = MOB_KEYS[ti]; if (!type) continue; M = makeMob(id, type, x, z, ry, lv); }
    if (M.dead) continue;
    M.tx = x; M.tz = z; M.tr = ry; M.hp = hp; M.fl = fl; M.lv = lv;
  }
  for (const M of [...S.mobs.values()]) if (!M.dead && !ms.has(M.id)) removeMob(M);
  const [hp, mp, maxHp, maxMp] = m.me;
  S.hp = hp; S.mp = mp; S.maxHp = maxHp; S.maxMp = maxMp;
  const pt = m.pt || [];
  S.party = pt;
  ui.setParty(pt, S.id);
  const bf = m.bf || [];
  const bkey = bf.map((b) => b[0]).join(',');
  if (bkey !== S.bkey) { S.bkey = bkey; S.buffs = bf.map((b) => b[0]); recalcLocal(); }
  ui.setBuffs(bf);
}

// ---------- 효과 ----------
const ATK_ANIM = { warrior: ['swing', 0.3], archer: ['bow', 0.35], mage: ['cast', 0.35], cleric: ['swing', 0.35] };
const SKILL_ANIM = {
  w1: ['spin', 0.4], w2: ['swing', 0.3], w3: ['cast', 0.5], w4: ['slam', 0.45], a1: ['bow', 0.35], a2: ['bow', 0.4], a3: ['roll', 0.3], a4: ['bow', 0.5],
  m1: ['cast', 0.4], m2: ['cast', 0.5], m3: ['cast', 0.25], m4: ['cast', 0.6], c1: ['cast', 0.5], c2: ['cast', 0.4], c3: ['cast', 0.5], c4: ['cast', 0.7],
};
const PROJ_COL = { arrow: 0xe8d8b0, bolt: 0x7fb8ff, holy: 0xffe070 };
// 플레이어 정보 (나 또는 다른 사람)
function pinfo(pid) {
  if (pid === S.id) return S.model ? { x: S.x, z: S.z, model: S.model, cls: S.ch.cls, rec: null } : null;
  const P = S.players.get(pid);
  return P && P.seen ? { x: P.x, z: P.z, model: P.model, cls: P.cls, rec: P } : null;
}
const livePos = (pid, dy = 1) => () => { const p = pinfo(pid); return p ? { x: p.x, y: heightAt(p.x, p.z) + dy, z: p.z } : null; };
const mobCenter = (M) => ({ x: M.x, y: heightAt(M.x, M.z) + Math.min(M.model.height * 0.55, 2.4) + (M.T.fly ? 1.2 : 0), z: M.z });
const nearMe = (x, z, r = 30) => dist(S.x, S.z, x, z) < r;

function attackFx(P, cls, ry, M) {
  const C = CLASSES[cls], y = heightAt(P.x, P.z);
  const [dx, dz] = dirOf(ry);
  if (C.proj) {
    if (!M) return;
    fx.proj(C.proj, { x: P.x + dx * 0.6, y: y + 1.4, z: P.z + dz * 0.6 }, () => mobCenter(M), (pt) => fx.burst(pt.x, pt.y, pt.z, PROJ_COL[C.proj], 6, { speed: 3, up: 1.5, life: 0.35 }));
  } else fx.slash(P.x + dx * 1.1, y + 1.1, P.z + dz * 1.1, ry, cls === 'warrior' ? 0xffffff : 0xffe8a0, 2.3, 2.1, 0.2);
}
function attackSound(cls, x, z) {
  if (!nearMe(x, z, 25)) return;
  const C = CLASSES[cls];
  if (!C.proj) sound.swing(); else if (C.proj === 'arrow') sound.bow(); else sound.magic(C.proj === 'holy' ? 2 : 0);
}
function skillSound(key, x, z) {
  if (!nearMe(x, z, 30)) return;
  const s = { w1: 'swing', w2: 'dodge', w3: 'buff', w4: 'swing', a1: 'bow', a2: 'bow', a3: 'dodge', a4: 'bow', m1: 'magic', m2: 'magic', m3: 'blink', m4: 'magic', c1: 'heal', c2: 'magic', c3: 'buff', c4: 'revive' }[key];
  if (s) sound[s]();
}
// 스킬 효과: 나는 쓸 때 바로, 다른 사람은 호스트가 알려줄 때
function skillFx(key, x, z, tx, tz, ry, tid) {
  const y = heightAt(x, z);
  const [dx, dz] = dirOf(ry);
  const boomNear = (bx, bz) => { if (nearMe(bx, bz, 35)) sound.boom(false); };
  switch (key) {
    case 'w1':
      fx.slash(x, y + 1, z, ry, 0xfff0d0, 3.8, Math.PI * 2, 0.35); fx.ring(x, z, 3.8, 0xffb070, 0.4);
      fx.burst(x, y + 1, z, 0xffd0a0, 14, { speed: 7, up: 1.5 });
      break;
    case 'w2':
      for (let i = 0; i <= 7; i++) setTimeout(() => { const px = x + dx * i, pz = z + dz * i; fx.burst(px, heightAt(px, pz) + 0.8, pz, 0xfff0e0, 3, { speed: 1.5, up: 1, life: 0.4 }); }, i * 30);
      setTimeout(() => fx.slash(x + dx * 7, heightAt(x + dx * 7, z + dz * 7) + 1, z + dz * 7, ry, 0xffffff, 2.6, 2.4, 0.25), 220);
      break;
    case 'w3': fx.pillar(x, z, 0xff6040, 0.8, 4); fx.ring(x, z, 9, 0xff5030, 0.6); break;
    case 'w4':
      fx.sector(x, z, 9, ry, 70, 0xffc060, 0.5);
      setTimeout(() => {
        for (let i = 1; i <= 4; i++) { const d = i * 2.1, px = x + dx * d, pz = z + dz * d; fx.burst(px, heightAt(px, pz) + 0.3, pz, 0xd8b080, 8, { speed: 4, up: 4, size: 0.2 }); }
        fx.ring(x + dx * 3, z + dz * 3, 5, 0xffd080, 0.4);
        boomNear(x, z);
        if (nearMe(x, z, 12)) S.shake = Math.max(S.shake, 0.35);
      }, 350);
      break;
    case 'a1':
      for (let i = 0; i < 5; i++) {
        const [ax, az] = dirOf(ry + (i / 4 - 0.5) * 50 * Math.PI / 180);
        fx.proj('arrow', { x, y: y + 1.3, z }, { x: x + ax * 15, y: heightAt(x + ax * 15, z + az * 15) + 1, z: z + az * 15 });
      }
      break;
    case 'a2':
      fx.ring(tx, tz, 4.2, 0x9fff9f, 1.9);
      for (let k = 0; k < 4; k++) setTimeout(() => {
        for (let j = 0; j < 7; j++) {
          const ox = tx + (Math.random() - 0.5) * 7, oz = tz + (Math.random() - 0.5) * 7, gy = heightAt(ox, oz);
          fx.proj('arrow', { x: ox - 1, y: gy + 11, z: oz - 1 }, { x: ox, y: gy, z: oz }, () => fx.burst(ox, gy + 0.1, oz, 0xd8c8a0, 3, { speed: 2, up: 2, life: 0.3 }));
        }
      }, Math.max(0, k * 400 - 150));
      break;
    case 'a3': fx.burst(x, y + 0.6, z, 0xa0ffb0, 18, { speed: 5, up: 1 }); fx.ring(x, z, 2.5, 0x9fffbf, 0.4); break;
    case 'a4':
      fx.proj('bigarrow', { x, y: y + 1.3, z }, { x: x + dx * 24, y: heightAt(x + dx * 24, z + dz * 24) + 1.2, z: z + dz * 24 });
      fx.burst(x + dx, y + 1.3, z + dz, 0xc0ffd0, 10, { speed: 4, up: 1 });
      break;
    case 'm1': {
      const M = S.mobs.get(tid);
      fx.proj('fireball', { x: x + dx * 0.5, y: y + 1.6, z: z + dz * 0.5 }, M ? () => mobCenter(M) : { x: tx, y: heightAt(tx, tz) + 0.8, z: tz });
      break;
    }
    case 'm2':
      fx.ring(x, z, 5.5, 0xa8e8ff, 0.5); fx.sphere(x, y + 0.6, z, 4.5, 0x5fb0ff, 0.45, 0.22);
      fx.burst(x, y + 1, z, 0xe0f8ff, 30, { speed: 9, up: 2, size: 0.18 });
      break;
    case 'm3': fx.burst(x, y + 1, z, 0xc080ff, 16, { speed: 3, up: 2 }); break;
    case 'm4': {
      const gy = heightAt(tx, tz);
      fx.warn('circle', tx, tz, 6.5, 1000);
      fx.proj('fireball', { x: tx - 8, y: gy + 20, z: tz - 4 }, { x: tx, y: gy + 0.5, z: tz }, null, 2.4);
      break;
    }
    case 'c1': fx.ring(x, z, 10, 0x80ff9a, 0.6); fx.rise(x, y, z, 0x9fffb0, 24, 2.5); break;
    case 'c2': setTimeout(() => { fx.pillar(tx, tz, 0xfff0a0, 0.7, 7); fx.boom('c2', tx, tz, 3.8); boomNear(tx, tz); }, 300); break;
    case 'c3': fx.ring(x, z, 12, 0xffe080, 0.7); fx.rise(x, y, z, 0xffe8a0, 20, 3); break;
    case 'c4': fx.pillar(x, z, 0xfff4c0, 1.4, 12); fx.ring(x, z, 15, 0xffe8a0, 0.9); break;
  }
}

function onFx(e) {
  switch (e[0]) {
    case 'atk': {
      const [, pid, tid, ry] = e;
      if (pid === S.id) return;
      const P = pinfo(pid); if (!P) return;
      P.rec.ry = P.rec.tr = ry;
      const a = ATK_ANIM[P.cls]; P.model.play(a[0], a[1]);
      attackFx(P, P.cls, ry, S.mobs.get(tid));
      attackSound(P.cls, P.x, P.z);
      return;
    }
    case 'skill': {
      const [, pid, key, tx, tz, ry, tid] = e;
      if (pid === S.id) return;
      const P = pinfo(pid); if (!P) return;
      P.rec.ry = P.rec.tr = ry;
      const a = SKILL_ANIM[key]; if (a) P.model.play(a[0], a[1]);
      skillFx(key, P.x, P.z, tx, tz, ry, tid);
      skillSound(key, P.x, P.z);
      return;
    }
    case 'dodge': {
      if (e[1] === S.id) return;
      const P = pinfo(e[1]); if (!P) return;
      P.model.play('roll', 0.35);
      fx.burst(P.x, heightAt(P.x, P.z) + 0.2, P.z, 0xd8c8a8, 6, { speed: 2, up: 1, life: 0.4 });
      return;
    }
    case 'matk': {
      const M = S.mobs.get(e[1]); if (!M) return;
      const T = M.T;
      M.model.play(T.boss ? 'slam' : T.ranged ? (T.bow ? 'bow' : 'cast') : 'swing', T.boss ? 0.6 : 0.45);
      if (nearMe(M.x, M.z, 22)) sound.mob(T.model, 'atk');
      return;
    }
    case 'mproj': {
      const [, mid, tid, kind] = e;
      const M = S.mobs.get(mid), to = livePos(tid, 1.1);
      if (!M || !to()) return;
      const c = mobCenter(M);
      fx.proj(kind, c, to, (pt) => pt && fx.burst(pt.x, pt.y, pt.z, kind === 'fire' ? 0xff7030 : kind === 'spore' ? 0xa060e0 : 0xe8d8b0, 6, { speed: 3, up: 1, life: 0.35 }));
      return;
    }
    case 'warn': {
      const [, shape, x, z, r, ms, ry, arc] = e;
      fx.warn(shape, x, z, r, ms, ry, arc);
      if (nearMe(x, z, r + 12)) sound.warn();
      return;
    }
    case 'boom': {
      const [, kind, x, z, r] = e;
      fx.boom(kind, x, z, r);
      if (nearMe(x, z, 40)) sound.boom(r >= 5);
      if (r >= 4 && nearMe(x, z, r + 8)) S.shake = Math.max(S.shake, r >= 6 ? 0.6 : 0.35);
      return;
    }
    case 'die': {
      const M = S.mobs.get(e[1]); if (!M) return;
      M.dead = true; M.dieT = 0;
      const c = mobCenter(M);
      fx.burst(c.x, c.y, c.z, M.T.color, M.T.boss ? 50 : 16, { speed: M.T.boss ? 8 : 4, up: 4, size: M.T.boss ? 0.3 : 0.16 });
      if (M.T.boss) { fx.pillar(M.x, M.z, 0xffe080, 2, 14); S.shake = 0.6; }
      if (nearMe(M.x, M.z, 30)) sound.mob(M.T.model, 'die');
      if (S.target === M.id) S.target = 0;
      return;
    }
    case 'lvl': {
      const P = pinfo(e[1]); if (!P) return;
      fx.pillar(P.x, P.z, 0xffe070, 1.6, 10); fx.ring(P.x, P.z, 4, 0xffe070, 0.8);
      fx.rise(P.x, heightAt(P.x, P.z), P.z, 0xfff0a0, 30, 1.5);
      return;
    }
    case 'down': { const P = pinfo(e[1]); if (P) P.model.downed = true; return; }
    case 'revive': {
      const P = pinfo(e[1]); if (!P) return;
      P.model.downed = false;
      fx.pillar(P.x, P.z, 0xfff0a0, 1, 6);
      if (e[1] !== S.id && nearMe(P.x, P.z, 25)) sound.revive();
      return;
    }
    case 'buff': { const P = pinfo(e[1]); if (P) { fx.ring(P.x, P.z, 1.6, 0xffe080, 0.6); fx.rise(P.x, heightAt(P.x, P.z), P.z, 0xffe8a0, 8, 0.8); } return; }
    case 'potion': {
      const P = pinfo(e[1]); if (!P) return;
      const k = e[2], col = k === 'scroll' ? 0x7ff0ff : STACK[k] && STACK[k].mana ? 0x5aa0ff : 0xff5a6a;
      fx.rise(P.x, heightAt(P.x, P.z), P.z, col, 12, 0.7);
      if (e[1] === S.id) sound.potion();
      return;
    }
  }
}

function flashHurt() { const el = $('hurt'); el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); }
function onHit([kind, id, amt, crit]) {
  if (kind === 0) {
    const M = S.mobs.get(id); if (!M) return;
    M.model.hit();
    if (nearMe(M.x, M.z, 30)) sound.hit(!!crit);
    if (settings.nums) fx.number(M.x, heightAt(M.x, M.z) + Math.min(M.model.height, 3.5) + 0.4 + (M.T.fly ? 1.2 : 0), M.z, crit ? `${amt}!` : amt, crit ? 'crit' : 'dmg');
  } else if (kind === 1) {
    if (id === S.id) {
      if (S.model) S.model.hit();
      sound.hurt(); flashHurt();
      if (settings.nums) fx.number(S.x, S.y + 2.3, S.z, `-${amt}`, 'hurt');
    } else {
      const P = S.players.get(id);
      if (P && P.seen) { P.model.hit(); if (settings.nums) fx.number(P.x, heightAt(P.x, P.z) + 2.3, P.z, `-${amt}`, 'hurt o'); }
    }
  } else if (kind === 2 && amt > 0) {
    const P = id === S.id ? { x: S.x, z: S.z } : S.players.get(id);
    if (P && settings.nums) fx.number(P.x, heightAt(P.x, P.z) + 2.3, P.z, `+${amt}`, 'heal');
  }
}

// ---------- 전리품 ----------
function addLoot(id, x, z, it) {
  if (S.loot.has(id)) return;
  const g = GEAR[it.k];
  const mesh = lootModel(it, g ? it.r || 0 : null);
  const y = heightAt(x, z);
  mesh.position.set(x, y, z);
  R.scene.add(mesh);
  S.loot.set(id, { id, x, z, y, it, mesh, t0: nowMs() });
  if (g && it.r >= 3) { fx.pillar(x, z, parseInt(RARITY[it.r].color.slice(1), 16), 1.2, 6); sound.rare(); }
}

// ---------- 내 캐릭터 조작 ----------
const validMob = (id) => { const M = S.mobs.get(id); return M && !M.dead ? M : null; };
function pickTarget(range) {
  let best = null, bs = 1e9;
  const [fx_, fz_] = dirOf(S.ry);
  for (const M of S.mobs.values()) {
    if (M.dead) continue;
    const dx = M.x - S.x, dz = M.z - S.z, d = Math.hypot(dx, dz);
    if (d > range + M.T.size * 0.5) continue;
    const front = d < 0.01 ? 1 : (dx * fx_ + dz * fz_) / d;
    const score = d - front * 2.5 - (M.fl & 16 ? 2 : 0);
    if (score < bs) { bs = score; best = M; }
  }
  return best;
}
function cycleTarget() {
  const list = [...S.mobs.values()].filter((M) => !M.dead && dist(S.x, S.z, M.x, M.z) < 25).sort((a, b) => dist(S.x, S.z, a.x, a.z) - dist(S.x, S.z, b.x, b.z));
  if (!list.length) { S.target = 0; return; }
  const i = list.findIndex((M) => M.id === S.target);
  S.target = list[(i + 1) % list.length].id;
  sound.click();
}
const reachOf = (M) => CLASSES[S.ch.cls].range + M.T.size * 0.4;
function worldMove() {
  const mx = input.move.x, mz = input.move.z, y = R.camYaw;
  return [Math.cos(y) * mx - Math.sin(y) * mz, -Math.sin(y) * mx - Math.cos(y) * mz];
}
const live = () => S.joined && S.live && !S.downed && S.model;

function doAttack(M) {
  const C = CLASSES[S.ch.cls];
  S.atkT = nowMs() + (S.lst ? S.lst.aspd : C.aspd) * 1000;
  S.lastAtk = nowMs();
  if (M) S.ry = ryTo(M.x - S.x, M.z - S.z);
  send({ t: 'atk', tid: M ? M.id : 0, ry: r2(S.ry) });
  const a = ATK_ANIM[S.ch.cls]; S.model.play(a[0], a[1]);
  attackFx({ x: S.x, z: S.z }, S.ch.cls, S.ry, M);
  attackSound(S.ch.cls, S.x, S.z);
}
function attackTap() {
  if (!live()) return;
  const C = CLASSES[S.ch.cls];
  let M = validMob(S.target);
  if (!M || dist(S.x, S.z, M.x, M.z) > 30) { M = pickTarget(C.range + (C.proj ? 4 : 7)); S.target = M ? M.id : 0; }
  if (M) S.intent = { type: 'attack', id: M.id, until: nowMs() + 3000 };
  else if (nowMs() >= S.atkT) doAttack(null);
}
function combat() {
  if (!live()) return;
  const C = CLASSES[S.ch.cls], now = nowMs();
  const held = input.attackHeld;
  if (!held && !(S.intent && S.intent.type === 'attack')) return;
  let M = validMob(S.intent && S.intent.type === 'attack' ? S.intent.id : S.target);
  if (!M && held) { M = validMob(S.target); }
  if ((!M || dist(S.x, S.z, M.x, M.z) > 30) && held) { M = pickTarget(C.range + (C.proj ? 5 : 10)); }
  if (!M) { if (S.intent && S.intent.type === 'attack') S.intent = null; if (held && now >= S.atkT) doAttack(null); return; }
  S.target = M.id;
  if (held && S.moving === 'manual') { // 직접 움직이며 공격 (사거리 안일 때만)
    if (dist(S.x, S.z, M.x, M.z) <= reachOf(M) && now >= S.atkT) doAttack(M);
    return;
  }
  if (held) S.intent = { type: 'attack', id: M.id, until: now + 600 };
  if (dist(S.x, S.z, M.x, M.z) <= reachOf(M)) {
    if (now >= S.atkT) { doAttack(M); if (!held) S.intent = null; }
    else S.ry = ryTo(M.x - S.x, M.z - S.z);
  }
}

function startDash(dx, dz, len, dur) {
  const d = Math.hypot(dx, dz) || 1;
  S.dash = { vx: (dx / d) * len / dur, vz: (dz / d) * len / dur, left: dur };
  S.intent = null;
}
function blink(dx, dz, len) {
  let x = S.x, z = S.z;
  for (let i = 0; i < len / 0.5; i++) {
    const [nx, nz] = moveCircle(x, z, dx * 0.5, dz * 0.5, PLAYER_R);
    if (Math.hypot(nx - x, nz - z) < 0.1) break;
    x = nx; z = nz;
  }
  S.x = x; S.z = z;
  fx.burst(x, heightAt(x, z) + 1, z, 0xc080ff, 16, { speed: 3, up: 2 });
}
function useSkill(i) {
  if (!live()) return;
  const key = CLASSES[S.ch.cls].skills[i], Sk = SKILLS[key], now = nowMs();
  if (!Sk) return;
  if (S.ch.lv < Sk.lv) return ui.toast(`${Sk.name}: 레벨 ${Sk.lv}에 배워요`);
  if ((S.cds[key] || 0) > now) return;
  if (S.mp < Sk.mp) return ui.toast('마나가 부족해요');
  const rng = Sk.range || 10;
  let M = validMob(S.target);
  if (M && dist(S.x, S.z, M.x, M.z) > rng + 3) M = null;
  if (!M && ['aoePoint', 'projAoe', 'fan', 'line', 'cone', 'dash'].includes(Sk.type)) { M = pickTarget(rng + 1); if (M) S.target = M.id; }
  if (Sk.type === 'blink') M = null;
  let ry = S.ry;
  const [wx, wz] = worldMove();
  if (Sk.type === 'blink' && Math.hypot(wx, wz) > 0.1) ry = ryTo(wx, wz);
  if (M) ry = ryTo(M.x - S.x, M.z - S.z);
  S.ry = ry;
  const [dx, dz] = dirOf(ry);
  let tx = S.x + dx * Math.min(rng, 8), tz = S.z + dz * Math.min(rng, 8);
  if (M) { tx = M.x; tz = M.z; }
  send({ t: 'skill', s: i, tid: M ? M.id : 0, x: r1(tx), z: r1(tz), ry: r2(ry) });
  S.cds[key] = now + Sk.cd * 1000;
  S.mp = Math.max(0, S.mp - Sk.mp);
  const a = SKILL_ANIM[key]; S.model.play(a[0], a[1]);
  skillFx(key, S.x, S.z, tx, tz, ry, M ? M.id : 0);
  skillSound(key, S.x, S.z);
  if (Sk.type === 'dash') startDash(dx, dz, Sk.len, 0.25);
  if (Sk.dash) startDash(dx * Math.sign(Sk.dash), dz * Math.sign(Sk.dash), Math.abs(Sk.dash), 0.25);
  if (Sk.type === 'blink') blink(dx, dz, Sk.len);
  S.intent = null;
}
function dodge() {
  if (!live() || S.dash) return;
  const now = nowMs();
  if ((S.cds.dodge || 0) > now) return;
  S.cds.dodge = now + DODGE.cd * 1000;
  send({ t: 'dodge' });
  let [dx, dz] = worldMove();
  if (Math.hypot(dx, dz) < 0.1) [dx, dz] = dirOf(S.ry); else S.ry = ryTo(dx, dz);
  startDash(dx, dz, DODGE.len, 0.3);
  S.model.play('roll', 0.35);
  sound.dodge();
  fx.burst(S.x, S.y + 0.2, S.z, 0xd8c8a8, 8, { speed: 2, up: 1, life: 0.4 });
}
function drink(kind) {
  if (!live()) return;
  const now = nowMs();
  if (now < S.potT) return;
  const keys = kind === 'hp' ? ['hp1', 'hp2', 'hp3'] : ['mp1', 'mp2', 'mp3'];
  const missing = kind === 'hp' ? S.maxHp - S.hp : S.maxMp - S.mp;
  const have = keys.filter((k) => countStack(S.ch.inv, k) > 0);
  if (!have.length) return ui.toast(kind === 'hp' ? '체력 물약이 없어요 — 상인에게서 살 수 있어요' : '마나 물약이 없어요 — 상인에게서 살 수 있어요');
  if (missing <= 0) return ui.toast(kind === 'hp' ? '체력이 가득해요' : '마나가 가득해요');
  let pick = have[0];
  for (const k of have) if ((STACK[k].heal || STACK[k].mana) <= missing * 1.3 + 40) pick = k;
  send({ t: 'use', slot: S.ch.inv.findIndex((s) => s && s.k === pick) });
  S.potT = now + POTION_CD * 1000;
}

// 주변 상호작용 (부활 · 대화 · 줍기 · 이동의 돌)
function context() {
  if (!S.joined || S.downed) return null;
  for (const P of S.players.values()) if (P.seen && P.downed && dist(S.x, S.z, P.x, P.z) < 3.2) return { type: 'revive', P, label: '부활' };
  for (const [k, p] of Object.entries(NPC_POS)) if (dist(S.x, S.z, p.x, p.z) <= INTERACT_R) return { type: 'npc', key: k, label: k === 'board' ? '의뢰' : '대화' };
  let best = null, bd = 4.2;
  for (const L of S.loot.values()) { const d = dist(S.x, S.z, L.x, L.z); if (d < bd) { bd = d; best = L; } }
  if (best) return { type: 'loot', L: best, label: '줍기' };
  if (nearStone()) return { type: 'stone', label: '이동' };
  return null;
}
const nearStone = () => Object.values(WAYPOINTS).some((w) => dist(S.x, S.z, w.x, w.z) <= 6.5);
function act() {
  const c = context();
  if (!c) return;
  if (c.type === 'revive') startRevive(c.P);
  else if (c.type === 'npc') ui.openDialog(c.key);
  else if (c.type === 'loot') send({ t: 'pick', id: c.L.id });
  else if (c.type === 'stone') openMap();
}
function startRevive(P) {
  send({ t: 'revive', id: P.id });
  S.cast = { until: nowMs() + 2500, dur: 2500, label: `${P.name} 님을 일으키는 중`, id: P.id };
}

// 화면을 눌렀을 때 그 위치의 대상 찾기
const _v = new THREE.Vector3();
function screenOf(x, y, z) {
  _v.set(x, y, z).project(R.camera);
  if (_v.z > 1) return null;
  return [(_v.x + 1) / 2 * innerWidth, (1 - _v.y) / 2 * innerHeight];
}
function pickScreen(sx, sy) {
  let best = null, bd = touch ? 62 : 48;
  const test = (x, y, z, rad, hit) => {
    const p = screenOf(x, y, z);
    if (!p) return;
    const d = Math.hypot(p[0] - sx, p[1] - sy) - rad;
    if (d < bd) { bd = d; best = hit; }
  };
  for (const M of S.mobs.values()) if (!M.dead) { const c = mobCenter(M); test(c.x, c.y, c.z, M.T.size * 14, { kind: 'mob', M }); }
  for (const P of S.players.values()) if (P.seen) test(P.x, heightAt(P.x, P.z) + 1, P.z, 8, { kind: 'player', P });
  for (const N of S.npcs.values()) test(N.x, heightAt(N.x, N.z) + 1.1, N.z, 10, { kind: 'npc', key: N.key });
  for (const L of S.loot.values()) test(L.x, L.y + 0.4, L.z, 6, { kind: 'loot', L });
  for (const [k, w] of Object.entries(WAYPOINTS)) test(w.x, heightAt(w.x, w.z) + 2, w.z, 12, { kind: 'stone', k, w });
  return best;
}
function onTap(sx, sy) {
  if (!live()) return;
  const h = pickScreen(sx, sy);
  if (!h) { // 마우스: 땅을 누르면 그곳으로 걸어가기
    if (!input.touchMode) { const p = R.groundAt(sx, sy); if (p) { S.intent = { type: 'move', x: p.x, z: p.z, until: nowMs() + 15000 }; fx.ring(p.x, p.z, 0.8, 0xffffff, 0.4); } }
    return;
  }
  if (h.kind === 'mob') { S.target = h.M.id; S.intent = { type: 'attack', id: h.M.id, until: nowMs() + 4000 }; sound.click(); }
  else if (h.kind === 'npc') { if (dist(S.x, S.z, NPC_POS[h.key].x, NPC_POS[h.key].z) <= INTERACT_R) ui.openDialog(h.key); else S.intent = { type: 'npc', key: h.key, until: nowMs() + 20000 }; }
  else if (h.kind === 'player') {
    if (h.P.downed) S.intent = { type: 'revive', id: h.P.id, until: nowMs() + 10000 };
    else ui.playerMenu(h.P.id, h.P.name, `${CLASSES[h.P.cls].name} Lv${h.P.lv}`);
  } else if (h.kind === 'loot') S.intent = { type: 'loot', id: h.L.id, until: nowMs() + 8000 };
  else if (h.kind === 'stone') { if (dist(S.x, S.z, h.w.x, h.w.z) <= 6.5) openMap(); else S.intent = { type: 'stone', k: h.k, until: nowMs() + 20000 }; }
}
// 자동 이동 목표 (대상에게 다가가기)
function intentGoal() {
  const I = S.intent;
  if (!I) return null;
  if (nowMs() > I.until) { S.intent = null; return null; }
  if (I.type === 'attack') {
    const M = validMob(I.id);
    if (!M) { S.intent = null; return null; }
    return dist(S.x, S.z, M.x, M.z) <= reachOf(M) * 0.9 ? null : { x: M.x, z: M.z };
  }
  if (I.type === 'npc') {
    const p = NPC_POS[I.key];
    if (dist(S.x, S.z, p.x, p.z) <= INTERACT_R - 1.5) { S.intent = null; ui.openDialog(I.key); return null; }
    return p;
  }
  if (I.type === 'loot') {
    const L = S.loot.get(I.id);
    if (!L) { S.intent = null; return null; }
    if (dist(S.x, S.z, L.x, L.z) <= 1.4) { S.intent = null; send({ t: 'pick', id: L.id }); return null; }
    return L;
  }
  if (I.type === 'revive') {
    const P = S.players.get(I.id);
    if (!P || !P.seen || !P.downed) { S.intent = null; return null; }
    if (dist(S.x, S.z, P.x, P.z) <= 2.4) { S.intent = null; startRevive(P); return null; }
    return P;
  }
  if (I.type === 'move') {
    if (dist(S.x, S.z, I.x, I.z) <= 0.6) { S.intent = null; return null; }
    return I;
  }
  if (I.type === 'stone') {
    const w = WAYPOINTS[I.k];
    if (dist(S.x, S.z, w.x, w.z) <= 5) { S.intent = null; openMap(); return null; }
    return w;
  }
  return null;
}

function updateSelf(dt, t) {
  if (!S.model) return;
  const [wx, wz] = worldMove();
  const manual = Math.hypot(wx, wz) > 0.05 && !S.downed;
  if (manual) { if (S.intent && S.intent.type !== 'attack') S.intent = null; if (S.intent && !input.attackHeld) S.intent = null; S.cast = null; }
  const speed = S.lst ? S.lst.spd : CLASSES[S.ch.cls].spd;
  let mx = 0, mz = 0, how = false;
  if (!S.downed && !ui.anyOpen) {
    if (manual) { mx = wx; mz = wz; how = 'manual'; }
    else {
      const g = intentGoal();
      if (g) { const dx = g.x - S.x, dz = g.z - S.z, d = Math.hypot(dx, dz) || 1; mx = dx / d; mz = dz / d; how = 'auto'; }
    }
  }
  const ox = S.x, oz = S.z;
  if (S.dash) {
    const k = Math.min(dt, S.dash.left);
    [S.x, S.z] = moveCircle(S.x, S.z, S.dash.vx * k, S.dash.vz * k, PLAYER_R);
    S.dash.left -= dt;
    if (S.dash.left <= 0) S.dash = null;
  } else if (how) {
    const m = Math.min(1, Math.hypot(mx, mz)), d = Math.hypot(mx, mz) || 1, step = speed * m * dt;
    [S.x, S.z] = moveCircle(S.x, S.z, (mx / d) * step, (mz / d) * step, PLAYER_R);
    if (nowMs() > (S.lastAtk || 0) + 350) S.ry = ryTo(mx, mz);
  }
  S.moving = how;
  const moved = Math.hypot(S.x - ox, S.z - oz);
  S.spd = S.spd * 0.7 + (moved / Math.max(dt, 1e-3)) * 0.3;
  if (S.spd > 1 && !S.dash) sound.step();
  S.y += (heightAt(S.x, S.z) - S.y) * Math.min(1, dt * 18);
  S.vry += angleDiff(S.vry, S.ry) * Math.min(1, dt * 16);
  S.model.downed = S.downed;
  S.model.update(dt, { speed: S.dash ? 0 : S.spd });
  S.model.root.position.set(S.x, S.y, S.z);
  S.model.root.rotation.y = S.vry;
  if (S.cast) {
    if (nowMs() >= S.cast.until) S.cast = null;
    else { const P = S.players.get(S.cast.id); if (!P || !P.downed || dist(S.x, S.z, P.x, P.z) > 3.5) S.cast = null; }
  }
  // 위치 전송 (초당 10번)
  if (S.live && !S.downed && t - S.posT > 0.1) {
    if (dist(S.x, S.z, S.sentX, S.sentZ) > 0.03 || Math.abs(angleDiff(S.ry, S.sentRy)) > 0.05) {
      send({ t: 'pos', x: r2(S.x), z: r2(S.z), ry: r2(S.ry), a: S.spd > 0.5 ? 1 : 0 });
      S.sentX = S.x; S.sentZ = S.z; S.sentRy = S.ry; S.posT = t;
    }
  }
}

function updateOthers(dt) {
  const k = Math.min(1, dt * 10);
  for (const P of S.players.values()) {
    if (!P.seen) continue;
    const ox = P.x, oz = P.z;
    P.x += (P.tx - P.x) * k; P.z += (P.tz - P.z) * k;
    P.ry += angleDiff(P.ry, P.tr) * Math.min(1, dt * 12);
    P.spd = P.spd * 0.75 + (Math.hypot(P.x - ox, P.z - oz) / Math.max(dt, 1e-3)) * 0.25;
    P.model.downed = !!P.downed;
    P.model.update(dt, { speed: P.spd > 0.4 ? P.spd : 0 });
    P.model.root.position.set(P.x, heightAt(P.x, P.z), P.z);
    P.model.root.rotation.y = P.ry;
  }
}
function updateMobs(dt) {
  const k = Math.min(1, dt * 9);
  for (const M of [...S.mobs.values()]) {
    if (M.dead) {
      M.dieT += dt;
      const s = Math.max(0.01, 1 - M.dieT / 0.6);
      M.model.root.scale.setScalar(s);
      M.model.root.position.y = heightAt(M.x, M.z) - M.dieT * 0.8;
      if (M.dieT > 0.65) removeMob(M);
      continue;
    }
    const ox = M.x, oz = M.z;
    M.x += (M.tx - M.x) * k; M.z += (M.tz - M.z) * k;
    M.ry += angleDiff(M.ry, M.tr) * Math.min(1, dt * 10);
    M.spd = M.spd * 0.75 + (Math.hypot(M.x - ox, M.z - oz) / Math.max(dt, 1e-3)) * 0.25;
    M.model.update(M.fl & 2 ? 0 : dt, { speed: M.spd > 0.3 ? M.spd : 0 });
    M.model.root.position.set(M.x, heightAt(M.x, M.z), M.z);
    M.model.root.rotation.y = M.ry;
  }
}
function updateWorldBits(dt, t) {
  const now = nowMs();
  for (const L of [...S.loot.values()]) {
    if (now - L.t0 > 120000) { R.scene.remove(L.mesh); S.loot.delete(L.id); continue; }
    L.mesh.position.y = L.y + 0.08 + Math.sin(t * 3 + L.id) * 0.08;
    L.mesh.rotation.y += dt * 1.2;
    const b = L.mesh.userData.beam; if (b) b.scale.set(1, 0.8 + Math.sin(t * 4 + L.id) * 0.2, 1);
  }
  for (const N of S.npcs.values()) {
    if (!N.model) continue;
    const d = S.joined ? dist(S.x, S.z, N.x, N.z) : 99;
    const want = d < 9 ? ryTo(S.x - N.x, S.z - N.z) : N.ry;
    N.vry += angleDiff(N.vry, want) * Math.min(1, dt * 4);
    N.model.root.rotation.y = N.vry;
    N.model.update(dt, { speed: 0 });
  }
  const M = validMob(S.target);
  targetRing.visible = !!M;
  if (M) {
    const s = M.T.size * 0.75 + 0.5;
    targetRing.position.set(M.x, heightAt(M.x, M.z) + 0.1, M.z);
    targetRing.scale.set(s, s, s);
    targetRing.rotation.z = t * 1.5;
  }
  // 퀘스트 방향 화살표 (멀리 있을 때)
  const q = S.qt[0];
  guide.visible = !!(S.joined && q && !S.downed && dist(S.x, S.z, q.x, q.z) > 14);
  if (guide.visible) {
    const a = ryTo(q.x - S.x, q.z - S.z), [dx, dz] = dirOf(a);
    guide.position.set(S.x + dx * 1.7, S.y + 0.35 + Math.sin(t * 4) * 0.05, S.z + dz * 1.7);
    guide.rotation.set(-Math.PI / 2, a, 0);
  }
}

// ---------- 이름표 ----------
function updateLabels() {
  if (!S.joined) { ui.labelsEnd(); return; }
  const myLv = S.ch.lv;
  const bar = (hp, c = '') => `<i class="${c}"><u style="width:${hp}%"></u></i>`;
  for (const M of S.mobs.values()) {
    if (M.dead) continue;
    const d = dist(S.x, S.z, M.x, M.z);
    const tgt = S.target === M.id;
    if (d > 32 || (!tgt && !M.T.boss && M.hp >= 100 && !(M.fl & 16) && d > 14)) continue;
    const p = screenOf(M.x, heightAt(M.x, M.z) + Math.min(M.model.height, 4) + 0.35 + (M.T.fly ? 1.2 : 0), M.z);
    if (!p) continue;
    const lc = M.lv >= myLv + 4 ? 'hi' : M.lv <= myLv - 5 ? 'lo' : '';
    const st = (M.fl & 2 ? '💫' : '') + (M.fl & 4 ? '❄️' : '');
    const name = tgt || M.T.boss || settings.names ? `<b>${M.T.name}</b><em class="${lc}">Lv${M.lv}</em>` : '';
    ui.label('m' + M.id, p[0], p[1], name + st + (M.hp < 100 || tgt || M.T.boss ? bar(M.hp) : ''), 'mob' + (tgt ? ' tgt' : '') + (M.T.boss ? ' boss' : ''));
  }
  const inParty = new Set(S.party.map((m) => m[0]));
  for (const P of S.players.values()) {
    if (!P.seen || dist(S.x, S.z, P.x, P.z) > 45) continue;
    const p = screenOf(P.x, heightAt(P.x, P.z) + 2.25, P.z);
    if (!p) continue;
    const name = settings.names || inParty.has(P.id) ? `<b>${esc(P.name)}</b>${P.title ? `<small>${esc(P.title)}</small>` : ''}` : '';
    ui.label('p' + P.id, p[0], p[1], name + (P.downed ? '<em class="down">쓰러짐 — 눌러서 일으키기</em>' : P.hp < 100 ? bar(P.hp, 'g') : ''), 'pl' + (inParty.has(P.id) ? ' party' : ''));
  }
  for (const N of S.npcs.values()) {
    const d = dist(S.x, S.z, N.x, N.z);
    if (d > 40) continue;
    const p = screenOf(N.x, heightAt(N.x, N.z) + N.height, N.z);
    if (!p) continue;
    const mark = ui.npcMark(N.key), Nd = NPCS[N.key];
    ui.label('n' + N.key, p[0], p[1], (mark ? `<s class="mark ${mark === '?' ? 'q' : ''}">${mark}</s>` : '') + (settings.names || d < 14 ? `<b>${Nd.name}</b><small>${Nd.title}</small>` : ''), 'npc');
  }
  if (S.cast) {
    const p = screenOf(S.x, S.y + 2.4, S.z);
    if (p) ui.label('cast', p[0], p[1], `<span>${esc(S.cast.label)}</span>${bar(Math.round((1 - (S.cast.until - nowMs()) / S.cast.dur) * 100), 'c')}`, 'cast');
  }
  ui.labelsEnd();
}

// ---------- 지도 ----------
const spawnNear = (type) => { let b = null, bd = 1e9; for (const s of SPAWNS) if (s.type === type) { const d = dist(S.x, S.z, s.x, s.z); if (d < bd) { bd = d; b = s; } } return b; };
function updateQuestTargets() {
  const out = [];
  if (!S.ch) { S.qt = out; return; }
  const qs = S.ch.quests;
  for (const qid in qs.active) {
    const Q = QUEST_BY_ID[qid]; if (!Q) continue;
    const o = Q.obj;
    if (ui.questState(Q) === 'ready') { out.push({ ...NPC_POS[Q.npc] }); continue; }
    if (o.type === 'talk') out.push({ ...NPC_POS[o.npc] });
    else if (o.type === 'boss') out.push({ x: ARENAS[o.mob].x, z: ARENAS[o.mob].z });
    else if (o.type === 'kill') { const s = spawnNear(o.mob); if (s) out.push({ x: s.x, z: s.z }); }
    else if (o.type === 'collect') {
      const mob = MOB_KEYS.find((k) => !MONSTERS[k].boss && MONSTERS[k].drops.some((d) => d[0] === o.item));
      const s = mob && spawnNear(mob); if (s) out.push({ x: s.x, z: s.z });
    }
  }
  const b = S.ch.bounty;
  if (b) { if (b.n >= b.need) out.push({ ...NPC_POS.board }); else { const s = spawnNear(b.mob); if (s) out.push({ x: s.x, z: s.z }); } }
  if (!Object.keys(qs.active).length) { const nq = ui.nextQuest(); if (nq && ui.questState(nq) === 'avail') out.push({ ...NPC_POS[nq.npc] }); }
  out.sort((a, c) => dist(S.x, S.z, a.x, a.z) - dist(S.x, S.z, c.x, c.z));
  S.qt = out;
}
function drawMini() {
  const span = 120, mk = [];
  for (const M of S.mobs.values()) if (!M.dead) mk.push({ x: M.x, z: M.z, c: M.T.boss ? '#ff2a2a' : M.fl & 16 ? '#ff5040' : '#e0786a', r: M.T.boss ? 5 : 2 });
  for (const N of S.npcs.values()) mk.push({ x: N.x, z: N.z, c: '#ffe066', r: 2.5 });
  for (const w of Object.values(WAYPOINTS)) mk.push({ x: w.x, z: w.z, c: '#7ff0ff', r: 3.5 });
  const inParty = new Set(S.party.map((m) => m[0]));
  for (const P of S.players.values()) if (P.seen) mk.push({ x: P.x, z: P.z, c: inParty.has(P.id) ? '#6aff7a' : '#5ab0ff', r: 3 });
  const lim = span / 2 * 0.88;
  for (const q of S.qt) {
    let dx = q.x - S.x, dz = q.z - S.z;
    const m = Math.max(Math.abs(dx), Math.abs(dz));
    if (m > lim) { dx *= lim / m; dz *= lim / m; }
    mk.push({ x: S.x + dx, z: S.z + dz, icon: '★', c: '#ffd84a', size: 15 });
  }
  mk.push({ x: S.x, z: S.z, c: '#ffffff', r: 4, me: true, ry: S.ry });
  ui.drawMap($('minimap'), S.x, S.z, span, mk);
}
const ZONE_LABELS = [['새벽 마을', 0, 30], ['초록 들판', -62, 66], ['고요한 호수', 0, -228], ['속삭이는 숲', -210, 10], ['붉은 바위 협곡', 205, -22], ['불타는 황무지', -52, 205]];
const fmtTime = (ms) => { const s = Math.ceil(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`; };
function drawBigMap() {
  const mk = [];
  for (const [n, x, z] of ZONE_LABELS) mk.push({ x, z, icon: n, c: 'rgba(255,255,255,0.92)', size: 13 });
  mk.push({ x: 0, z: 0, icon: '🏠', size: 18 });
  for (const c of Object.values(CAMPS)) mk.push({ x: c.x, z: c.z, icon: '⛺', size: 16 });
  for (const [k, w] of Object.entries(WAYPOINTS)) mk.push({ x: w.x + 7, z: w.z, icon: S.ch.wps.includes(k) ? '🔷' : '◇', c: '#cfe8ff', size: 13 });
  for (const type of Object.keys(ARENAS)) { const a = ARENAS[type], b = S.boss[type]; mk.push({ x: a.x, z: a.z, icon: b && b.alive ? '👑' : '💀', size: 18 }); }
  for (const q of S.qt) mk.push({ x: q.x, z: q.z - 8, icon: '★', c: '#ffd84a', size: 20 });
  const inParty = new Set(S.party.map((m) => m[0]));
  for (const P of S.players.values()) if (P.seen && !inParty.has(P.id)) mk.push({ x: P.x, z: P.z, c: '#5ab0ff', r: 4 });
  for (const m of S.party) if (m[0] !== S.id) mk.push({ x: m[5], z: m[6], c: '#6aff7a', r: 5 });
  mk.push({ x: S.x, z: S.z, c: '#ffffff', r: 6, me: true, ry: S.ry });
  ui.drawMap($('map-canvas'), 0, 0, 2 * WORLD_R + 20, mk);
  const now = nowMs();
  $('map-boss').innerHTML = '<b>보스</b>' + Object.keys(ARENAS).map((type) => {
    const T = MONSTERS[type], b = S.boss[type];
    const st = !b ? '' : b.alive ? '<em class="alive">등장 중!</em>' : b.at > now ? `<em>${fmtTime(b.at - now)} 뒤 등장</em>` : '<em>다가가면 등장</em>';
    return `<div>👑 ${T.name} <small>Lv${T.lv[0]}</small> ${st}</div>`;
  }).join('');
}
function openMap() {
  if (!S.joined) return;
  if (ui.openPanel === 'map') return ui.closeAll();
  ui.openMap(nearStone());
  drawBigMap();
}

// ---------- UI 이벤트 ----------
ui.on('item', (a, sel) => {
  if (a === 'equip') send({ t: 'equip', slot: sel.i });
  else if (a === 'unequip') send({ t: 'unequip', slot: sel.eq });
  else if (a === 'use') { if (nowMs() >= S.potT) { send({ t: 'use', slot: sel.i }); S.potT = nowMs() + POTION_CD * 1000; } }
  else if (a === 'sell') send({ t: 'sell', slot: sel.i });
  else if (a === 'trash') send({ t: 'trash', slot: sel.i });
});
ui.on('sellmat', () => {
  if (!ui.near.shop) return ui.toast('상인 곁에서 팔 수 있어요');
  let n = 0;
  S.ch.inv.forEach((s, i) => { const T = s && STACK[s.k]; if (T && !T.heal && !T.mana && s.k !== 'scroll' && s.k !== 'stone') { send({ t: 'sell', slot: i }); n++; } });
  if (!n) ui.toast('팔 재료가 없어요');
});
ui.on('talk', (npc) => send({ t: 'talk', npc }));
ui.on('quest', (a, q) => send({ t: a, q }));
ui.on('bounty', (a) => send({ t: 'bounty', a }));
ui.on('rest', () => send({ t: 'rest' }));
ui.on('buy', (npc, k, n) => send({ t: 'buy', npc, k, n }));
ui.on('enhance', (sel) => send(sel.eq ? { t: 'enhance', eq: sel.eq } : { t: 'enhance', slot: sel.i }));
ui.on('tp', (wp) => send({ t: 'tp', wp }));
ui.on('paccept', (from) => send({ t: 'paccept', from }));
ui.on('pinvite', (id) => send({ t: 'pinvite', id }));
ui.on('pleave', () => send({ t: 'pleave' }));
ui.on('respawn', () => send({ t: 'respawn' }));
ui.on('chat', (m) => send({ t: 'chat', m }));
ui.on('map', () => openMap());
ui.on('retry', () => {
  if (S.kick === 4004 || S.kick === 4005) return location.reload();
  S.kick = 0;
  ui.loading('다시 연결 중…');
  if (net) net.restart();
});
ui.on('newchar', () => {
  try { localStorage.removeItem('rpg_char_v1'); localStorage.removeItem('rpg_pos_v1'); } catch {}
  location.reload();
});
input.onCommand = (cmd) => {
  if (cmd === 'escape') {
    if (!$('chat-form').hidden) ui.closeChat();
    else if (ui.openPanel) ui.closeAll();
    else if (S.target) S.target = 0;
    else if (S.joined) ui.toggle('menu');
    return;
  }
  if (!S.joined || creating()) return;
  if (cmd === 'chat') { if ($('chat-form').hidden) ui.openChat(); }
  else if (cmd === 'inv') ui.toggle('inv');
  else if (cmd === 'quest') ui.toggle('quest');
  else if (cmd === 'map') openMap();
};

function processQueue() {
  while (input.queue.length) {
    const q = input.queue.shift();
    if (!S.joined || creating()) continue;
    switch (q.type) {
      case 'atk': attackTap(); break;
      case 'skill': useSkill(q.i); break;
      case 'dodge': dodge(); break;
      case 'hp': drink('hp'); break;
      case 'mp': drink('mp'); break;
      case 'act': act(); break;
      case 'cycle': cycleTarget(); break;
      case 'tap': onTap(q.x, q.y); break;
    }
  }
}

// ---------- 화면 갱신 ----------
let needChunks = true, chunkX = 1e9, chunkZ = 1e9;
let lastF = performance.now(), T = 0;
const acc = { hud: 0, mini: 0, slow: 0, save: 0, fps: 0, frames: 0, map: 0 };
let tkey = '';
function hud(dt) {
  acc.hud += dt; acc.mini += dt; acc.slow += dt; acc.save += dt; acc.map += dt;
  if (acc.hud >= 0.1) {
    acc.hud = 0;
    ui.setVitals(S.hp, S.mp, S.maxHp, S.maxMp);
    ui.setCooldowns(S.cds, S.mp);
    const c = context();
    ui.setAct(c ? c.label : '');
    if (c) $('b-act').querySelector('.ic').textContent = { revive: '✨', npc: '💬', loot: '✋', stone: '🔷' }[c.type];
    const M = validMob(S.target);
    const k = M ? `${M.id}:${M.hp}:${M.lv}` : '';
    if (k !== tkey) { tkey = k; ui.setTarget(M ? { name: M.T.name, lv: M.lv, hp: M.hp, boss: M.T.boss } : null); }
    if (S.downed) ui.setDeathTimer(60 - (nowMs() - S.downAt) / 1000);
    $('b-atk').classList.toggle('on', input.attackHeld);
  }
  if (acc.mini >= 0.25) { acc.mini = 0; drawMini(); }
  if (acc.map >= 0.5) { acc.map = 0; if (ui.openPanel === 'map') drawBigMap(); }
  if (acc.slow >= 0.5) {
    acc.slow = 0;
    ui.setZone(S.x, S.z);
    ui.setOnline(S.online);
    let shop = null;
    for (const k in NPCS) if (NPCS[k].shop && dist(S.x, S.z, NPC_POS[k].x, NPC_POS[k].z) <= INTERACT_R + 1.5) shop = k;
    ui.near = { shop, smith: dist(S.x, S.z, NPC_POS.smith.x, NPC_POS.smith.z) <= INTERACT_R + 1.5 };
    if (ui.openPanel === 'dialog' && ui.npc && dist(S.x, S.z, NPC_POS[ui.npc].x, NPC_POS[ui.npc].z) > INTERACT_R + 3) ui.closeAll();
    updateQuestTargets();
  }
  if (acc.save >= 5) { acc.save = 0; if (S.live) save('rpg_pos_v1', [r1(S.x), r1(S.z)]); }
}

function frame(nowP) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (nowP - lastF) / 1000);
  lastF = nowP; T += dt;
  input.enabled = !ui.anyOpen && !creating();
  const cam = input.poll();
  R.camYaw += cam.yaw;
  R.camDist = clamp(R.camDist + cam.zoom, 9, 34);
  processQueue();
  if (S.joined) { updateSelf(dt, T); combat(); }
  updateOthers(dt);
  updateMobs(dt);
  updateWorldBits(dt, T);
  let tx = 0, tz = 0;
  if (S.joined) { tx = S.x; tz = S.z; } else { R.camYaw += dt * 0.06; tz = 4; }
  if (needChunks || dist(tx, tz, chunkX, chunkZ) > 4) {
    const r = R.updateChunks(tx, tz, S.loading ? 8 : touch ? 1 : 2);
    needChunks = r.loaded < r.total; chunkX = tx; chunkZ = tz;
    if (S.loading) {
      const f = r.loaded / Math.max(1, r.total);
      ui.loading('섬을 그리는 중…', f);
      if (f >= 0.8 || performance.now() - S.loadT > 8000) { S.loading = false; ui.hideLoading(); }
    }
  }
  R.update(dt, T, tx, S.joined ? S.y : heightAt(tx, tz), tz);
  if (S.shake > 0) {
    const s = S.shake * 0.5;
    R.camera.position.x += (Math.random() - 0.5) * s; R.camera.position.y += (Math.random() - 0.5) * s; R.camera.position.z += (Math.random() - 0.5) * s;
    S.shake = Math.max(0, S.shake - dt * 1.6);
  }
  fx.update(dt);
  R.render();
  updateLabels();
  if (S.joined) hud(dt);
  // 느리면 해상도를 자동으로 낮춤
  acc.fps += dt; acc.frames++;
  if (acc.fps >= 3) {
    const fps = acc.frames / acc.fps;
    acc.fps = 0; acc.frames = 0;
    if (S.joined && !S.loading && !settings.manualRes && fps < 24 && settings.res > 0.55) { settings.res = r2(settings.res - 0.1); applySetting('res'); }
  }
}

addEventListener('pagehide', () => { if (S.live) save('rpg_pos_v1', [r1(S.x), r1(S.z)]); if (S.ch) save('rpg_char_v1', S.ch); });

window.__pc = { S, R, ui, input, fx, sound, settings, send, msgCount: 0, net: null, useSkill, doAttack, act };

// ---------- 시작 ----------
requestAnimationFrame(frame);
if (S.ch) ui.loading(lastStatus);
else {
  ui.hideLoading();
  ui.showCreate(savedName, (cls, name, look) => {
    pendingCreate = { cls, name, look };
    try { localStorage.setItem('pc_name', name); } catch {}
    ui.loading(lastStatus);
    tryJoin();
  });
}
startNet();
