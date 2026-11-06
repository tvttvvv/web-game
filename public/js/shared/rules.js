// 규칙: 능력치 · 피해 · 경험치 · 아이템 생성/가치 · 강화 · 인벤토리 · 캐릭터 검증
import { CLASSES, MONSTERS, RARITY, TIER_LV, GEAR, GEAR_BASE, BONUS_POOL, PCT_STATS, STACK } from './data.js';
import { MAX_LEVEL, INV_SIZE, EQUIP_SLOTS, clamp } from './constants.js';

export const xpToNext = (lv) => Math.round(40 * Math.pow(lv, 1.65) + 30);
const r1 = (v) => Math.round(v * 10) / 10;

export function monsterStats(type, lv) {
  const M = MONSTERS[type];
  const d = Math.max(0, lv - M.lv[0]);
  return {
    hp: Math.round(M.hp * Math.pow(1.14, d)), atk: M.atk * Math.pow(1.1, d),
    def: M.def * Math.pow(1.08, d), xp: Math.round(M.xp * Math.pow(1.12, d)),
  };
}

export function itemStats(it) {
  const g = it && GEAR[it.k];
  if (!g) return {};
  const t = g.tier, base = GEAR_BASE[g.slot];
  const lvMult = 1 + Math.max(0, (it.lv || TIER_LV[t]) - TIER_LV[t]) * 0.06;
  const m = RARITY[it.r || 0].mult * lvMult * (1 + 0.08 * (it.en || 0));
  const out = {};
  for (const s in base) out[s] = PCT_STATS.has(s) ? r1(base[s][t] * m) : Math.round(base[s][t] * m);
  for (const [s, v] of it.b || []) out[s] = PCT_STATS.has(s) ? r1((out[s] || 0) + v) : (out[s] || 0) + v;
  return out;
}

// 캐릭터 + 장비 + 버프 → 실제 능력치
export function deriveStats(ch, buffs = []) {
  const C = CLASSES[ch.cls];
  const L = ch.lv - 1;
  const s = {
    maxHp: C.base.hp + C.grow.hp * L, maxMp: C.base.mp + C.grow.mp * L,
    atk: C.base.atk + C.grow.atk * L, def: C.base.def + C.grow.def * L, crit: C.base.crit + C.grow.crit * L,
    critdmg: 160, aspdPct: 0, spdPct: 0,
  };
  for (const slot of EQUIP_SLOTS) {
    const st = itemStats(ch.equip && ch.equip[slot]);
    s.atk += st.atk || 0; s.def += st.def || 0; s.maxHp += st.hp || 0; s.maxMp += st.mp || 0;
    s.crit += st.crit || 0; s.aspdPct += st.aspd || 0; s.spdPct += st.spd || 0; s.critdmg += st.critdmg || 0;
  }
  let atkB = 0, defB = 0, spdB = 0, critB = 0, regen = 0;
  for (const b of buffs) { atkB += b.atk || 0; defB += b.def || 0; spdB += b.spd || 0; critB += b.crit || 0; regen += b.regen || 0; }
  return {
    maxHp: Math.round(s.maxHp), maxMp: Math.round(s.maxMp),
    atk: Math.round(s.atk * (1 + atkB)), def: Math.round(s.def * (1 + defB)),
    crit: Math.min(75, r1(s.crit + critB)), critdmg: s.critdmg / 100,
    aspd: C.aspd / (1 + Math.min(80, s.aspdPct) / 100),
    spd: C.spd * (1 + Math.min(50, s.spdPct) / 100) * (1 + spdB),
    regen,
  };
}

export function rollDamage(atk, mult, def, crit, critdmg, rnd) {
  const isCrit = rnd() * 100 < crit;
  let d = atk * mult * (0.9 + rnd() * 0.2) * (60 / (60 + Math.max(0, def)));
  if (isCrit) d *= critdmg;
  return { dmg: Math.max(1, Math.round(d)), crit: isCrit };
}

// ---------- 아이템 ----------
let seq = 0;
export const newUid = (rnd) => (Date.now().toString(36).slice(-6) + Math.floor(rnd() * 46656).toString(36) + (seq++ % 1296).toString(36));
export function tierFor(ilvl) { let t = 0; for (let i = 0; i < TIER_LV.length; i++) if (ilvl >= TIER_LV[i]) t = i; return t; }
export function rollRarity(rnd, boost = 1) {
  const r = rnd();
  if (r < 0.006 * boost) return 4;
  if (r < 0.04 * boost) return 3;
  if (r < 0.14 * boost) return 2;
  if (r < 0.42) return 1;
  return 0;
}
export function gearKey(slot, cls, tier) { return slot === 'weapon' ? `${cls}_w${tier}` : `${slot}_${tier}`; }
export function makeGear(key, ilvl, rarity, rnd) {
  const g = GEAR[key];
  const it = { u: newUid(rnd), k: key, r: clamp(rarity | 0, 0, 4), lv: Math.max(TIER_LV[g.tier], ilvl | 0), en: 0, b: [] };
  const pool = Object.keys(BONUS_POOL).filter((s) => !GEAR_BASE[g.slot][s]);
  for (let i = 0; i < RARITY[it.r].bonus && pool.length; i++) {
    const s = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    const v = BONUS_POOL[s](it.lv) * (0.6 + rnd() * 0.4);
    it.b.push([s, PCT_STATS.has(s) ? r1(v) : Math.max(1, Math.round(v))]);
  }
  return it;
}
// 무작위 장비 (무기는 주인 직업 위주)
export function randomGear(cls, ilvl, rarity, rnd, slot = null) {
  const sl = slot || (rnd() < 0.35 ? 'weapon' : ['helm', 'armor', 'boots', 'ring'][Math.floor(rnd() * 4)]);
  let c = cls;
  if (sl === 'weapon' && rnd() < 0.25) c = Object.keys(CLASSES)[Math.floor(rnd() * 4)];
  return makeGear(gearKey(sl, c, tierFor(ilvl)), ilvl, rarity, rnd);
}
export const isStack = (k) => !!STACK[k];
export function itemName(it) {
  if (!it) return '';
  if (STACK[it.k]) return STACK[it.k].name;
  const g = GEAR[it.k];
  return (it.en ? `+${it.en} ` : '') + (g ? g.name : '?');
}
export function itemValue(it) {
  if (!it) return 0;
  if (STACK[it.k]) return Math.max(1, Math.floor(STACK[it.k].price * 0.3));
  return Math.round((5 + (it.lv || 1) * 4) * (1 + (it.r || 0) * 1.5) + (it.en || 0) * (it.lv || 1) * 3);
}
export function buyPrice(key) {
  if (STACK[key]) return STACK[key].price;
  const g = GEAR[key];
  return g ? (g.slot === 'weapon' ? [60, 450, 1500, 4000, 9000][g.tier] : [40, 300, 1000, 2700, 6000][g.tier]) : 0;
}
export const ENH_CHANCE = [1, 1, 1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3];
export function enhanceInfo(it) {
  if (!it || !GEAR[it.k] || (it.en || 0) >= 10) return null;
  const en = it.en || 0;
  return { chance: ENH_CHANCE[en], gold: Math.round(30 + (it.lv || 1) * 12 * (en + 1)), stones: en >= 5 ? 2 : 1 };
}
export function canEquip(ch, it) {
  const g = it && GEAR[it.k];
  if (!g) return '장비가 아니에요';
  if (g.slot === 'weapon' && g.cls !== ch.cls) return '다른 직업의 무기예요';
  if ((it.lv || 1) > ch.lv + 2) return `레벨 ${it.lv - 2} 이상이 필요해요`;
  return null;
}

// ---------- 인벤토리 ----------
export function addStack(inv, k, n) {
  for (let i = 0; i < inv.length && n > 0; i++) if (inv[i] && inv[i].k === k && inv[i].n !== undefined) { inv[i].n += n; n = 0; }
  for (let i = 0; i < inv.length && n > 0; i++) if (!inv[i]) { inv[i] = { k, n }; n = 0; }
  return n;
}
export function addGear(inv, it) {
  const i = inv.findIndex((s) => !s);
  if (i < 0) return false;
  inv[i] = it;
  return true;
}
export const countStack = (inv, k) => inv.reduce((a, s) => a + (s && s.k === k && s.n ? s.n : 0), 0);
export function removeStack(inv, k, n) {
  if (countStack(inv, k) < n) return false;
  for (let i = inv.length - 1; i >= 0 && n > 0; i--) {
    const s = inv[i];
    if (s && s.k === k && s.n) { const t = Math.min(n, s.n); s.n -= t; n -= t; if (s.n <= 0) inv[i] = null; }
  }
  return true;
}
export const freeSlots = (inv) => inv.filter((s) => !s).length;

// ---------- 캐릭터 ----------
export function newChar(cls, name, look, rnd) {
  const ch = {
    v: 1, cls, name, look: sanitizeLook(look), lv: 1, xp: 0, gold: 50,
    inv: new Array(INV_SIZE).fill(null), equip: {}, quests: { done: [], active: {} }, bounty: null,
    wps: ['town'], title: '', made: Date.now(),
  };
  ch.equip.weapon = makeGear(`${cls}_w0`, 1, 0, rnd);
  ch.equip.armor = makeGear('armor_0', 1, 0, rnd);
  addStack(ch.inv, 'hp1', 3);
  return ch;
}
export const sanitizeLook = (l) => (Array.isArray(l) ? l.slice(0, 4).map((v) => clamp(v | 0, 0, 15)) : [0, 0, 0, 0]);

function cleanItem(it) {
  if (!it || typeof it !== 'object' || typeof it.k !== 'string') return null;
  if (STACK[it.k]) { const n = it.n | 0; return n > 0 ? { k: it.k, n: Math.min(n, 9999) } : null; }
  const g = GEAR[it.k];
  if (!g) return null;
  const out = { u: String(it.u || Math.random().toString(36).slice(2)).slice(0, 20), k: it.k, r: clamp(it.r | 0, 0, 4), lv: clamp(it.lv | 0 || 1, 1, 40), en: clamp(it.en | 0, 0, 10), b: [] };
  if (Array.isArray(it.b)) for (const e of it.b.slice(0, 4)) {
    if (!Array.isArray(e) || !BONUS_POOL[e[0]]) continue;
    const max = BONUS_POOL[e[0]](out.lv) * 1.01;
    out.b.push([e[0], clamp(+e[1] || 0, 0, PCT_STATS.has(e[0]) ? r1(max) : Math.ceil(max))]);
  }
  return out;
}
// 클라이언트가 저장해 온 캐릭터 검증 (값 범위를 넘으면 잘라냄)
export function sanitizeChar(c) {
  if (!c || typeof c !== 'object' || !CLASSES[c.cls]) return null;
  const ch = {
    v: 1, cls: c.cls, name: String(c.name || '').slice(0, 12), look: sanitizeLook(c.look),
    lv: clamp(c.lv | 0 || 1, 1, MAX_LEVEL), xp: Math.max(0, c.xp | 0), gold: clamp(c.gold | 0, 0, 99999999),
    inv: new Array(INV_SIZE).fill(null), equip: {}, quests: { done: [], active: {} }, bounty: null,
    wps: Array.isArray(c.wps) ? c.wps.filter((w) => typeof w === 'string').slice(0, 10) : ['town'],
    title: String(c.title || '').slice(0, 20), made: +c.made || Date.now(),
  };
  if (!ch.wps.includes('town')) ch.wps.unshift('town');
  if (Array.isArray(c.inv)) for (let i = 0; i < INV_SIZE; i++) ch.inv[i] = cleanItem(c.inv[i]);
  if (c.equip && typeof c.equip === 'object') for (const s of EQUIP_SLOTS) {
    const it = cleanItem(c.equip[s]);
    if (it && GEAR[it.k] && GEAR[it.k].slot === s && !(s === 'weapon' && GEAR[it.k].cls !== ch.cls)) ch.equip[s] = it;
  }
  if (c.quests && typeof c.quests === 'object') {
    if (Array.isArray(c.quests.done)) ch.quests.done = c.quests.done.filter((q) => typeof q === 'string').slice(0, 100);
    if (c.quests.active && typeof c.quests.active === 'object') for (const q in c.quests.active) ch.quests.active[q] = { n: Math.max(0, c.quests.active[q].n | 0) };
  }
  if (c.bounty && typeof c.bounty === 'object' && typeof c.bounty.mob === 'string' && MONSTERS[c.bounty.mob]) ch.bounty = { mob: c.bounty.mob, n: c.bounty.n | 0, need: clamp(c.bounty.need | 0, 1, 50), lv: c.bounty.lv | 0 };
  if (ch.xp >= xpToNext(ch.lv) * 3) ch.xp = 0;
  return ch;
}
