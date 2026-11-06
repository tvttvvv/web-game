// 권위 게임 로직 (Node 서버와 P2P 호스트가 같은 코드를 씀)
import { PROTO, TOWN_R, WORLD_R, INV_SIZE, EQUIP_SLOTS, INTERACT_R, SHARE_R, PLAYER_R, MAX_LEVEL, clamp, dist, dirOf, angleDiff, ryTo } from '../shared/constants.js';
import { CLASSES, SKILLS, DODGE, MONSTERS, STACK, NPCS, SHOPS, QUESTS, QUEST_BY_ID, BOUNTY_MOBS, POTION_CD, GEAR, TIER_LV } from '../shared/data.js';
import {
  xpToNext, monsterStats, deriveStats, rollDamage, rollRarity, randomGear, makeGear, tierFor, itemValue, buyPrice,
  enhanceInfo, canEquip, addStack, addGear, countStack, removeStack, newChar, sanitizeChar, itemName,
} from '../shared/rules.js';
import { SPAWNS, ARENAS, NPC_POS, WAYPOINTS, moveCircle, lavaAt } from '../shared/world.js';
import { mulberry32 } from '../shared/noise.js';

export const MOB_KEYS = Object.keys(MONSTERS);
const MAX_PLAYERS = 30;
const PROJ_SPEED = 24;
const r1 = (v) => Math.round(v * 10) / 10;
const now = () => Date.now();

function sanitizeName(s) {
  if (typeof s !== 'string') return '';
  return s.normalize('NFC').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 12);
}
const inTown = (x, z) => Math.hypot(x, z) < TOWN_R - 1;

export class Game {
  constructor(opts = {}) {
    this.hash = opts.hash;
    this.p2p = !!opts.p2p;
    this.log = opts.log || (() => {});
    this.rand = mulberry32((Date.now() ^ 0x5bd1e995) >>> 0);
    this.players = new Map();
    this.byPid = new Map();
    this.mobs = new Map();
    this.nextId = 1; this.nextMob = 1; this.nextLoot = 1; this.nextParty = 1;
    this.events = [];
    this.fx = []; this.hits = [];
    this.parties = new Map();
    this.camps = SPAWNS.map((s) => ({ ...s, mobs: new Set(), next: 0, lastNear: 0 }));
    this.tickN = 0;
    this.acc = { camp: 0, misc: 0 };
    this.bossSig = '';
  }

  // ---------- 전송 ----------
  send(p, o) { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(o)); }
  broadcast(o, except) { const s = JSON.stringify(o); for (const q of this.players.values()) if (q !== except && q.ws.readyState === 1) q.ws.send(s); }
  toast(p, m) { this.send(p, { t: 'msg', m }); }
  later(sec, fn) { this.events.push({ at: now() + sec * 1000, fn }); }
  addFx(x, z, e) { this.fx.push({ x, z, e }); }
  addHit(x, z, kind, id, amount, crit) { this.hits.push({ x, z, h: [kind, id, amount, crit ? 1 : 0] }); }

  // ---------- 접속 ----------
  join(ws, msg) {
    if (msg.ver !== PROTO) { try { ws.send(JSON.stringify({ t: 'kick', code: 4004 })); } catch {} return ws.close(4004, 'version'); }
    const token = typeof msg.token === 'string' ? msg.token : '';
    if (token.length < 16 || token.length > 100) return ws.close(4001, 'bad token');
    const pid = this.hash(token);
    const old = this.byPid.get(pid);
    if (old) { old.ws.close(4000, 'duplicate'); this.remove(old); }
    if (this.players.size >= MAX_PLAYERS) return ws.close(4002, 'full');
    let ch = sanitizeChar(msg.char);
    const name = sanitizeName(msg.name) || (ch && ch.name) || '모험가' + Math.floor(100 + this.rand() * 900);
    if (!ch) {
      if (!CLASSES[msg.cls]) return ws.close(4005, 'no class');
      ch = newChar(msg.cls, name, msg.look, this.rand);
    }
    ch.name = name;
    const a = this.rand() * Math.PI * 2;
    let x = Math.sin(a) * 7, z = Math.cos(a) * 7 + 2;
    // 이어서 하기: 마지막 위치 (호스트가 바뀌어도 그 자리에서 계속)
    if (Array.isArray(msg.pos) && Number.isFinite(+msg.pos[0]) && Number.isFinite(+msg.pos[1]) && Math.hypot(+msg.pos[0], +msg.pos[1]) < WORLD_R - 20) {
      const [nx, nz] = moveCircle(+msg.pos[0], +msg.pos[1], 0, 0, PLAYER_R);
      x = nx; z = nz;
    }
    const p = {
      id: this.nextId++, pid, ws, ch, name, x, z, ry: 0, anim: 0,
      st: null, hp: 1, mp: 1, buffs: [], cds: {}, atkT: 0, potT: 0, dodgeT: 0, invuln: 0, downed: 0, revive: null,
      lastHurt: 0, regenAcc: 0, party: 0, loot: new Map(), budget: 150, budgetT: now(), lastPos: now(), allowJump: now() + 2000,
      dirty: false, charSent: 0, invite: 0, lavaT: 0, joined: now(),
    };
    this.recalc(p);
    p.hp = p.st.maxHp; p.mp = p.st.maxMp;
    this.players.set(p.id, p);
    this.byPid.set(pid, p);
    ws.player = p;
    this.send(p, { t: 'welcome', ver: PROTO, id: p.id, ch, x: p.x, z: p.z, hp: p.hp, mp: p.mp, st: p.st, now: now() });
    for (const q of this.players.values()) this.send(p, this.plMsg(q));
    this.broadcast(this.plMsg(p), p);
    this.send(p, this.bossMsg());
    this.broadcast({ t: 'chat', id: 0, m: `${name} 님(${CLASSES[ch.cls].name} Lv${ch.lv})이 섬에 도착했어요` });
    this.log(`[join] ${name} ${ch.cls} Lv${ch.lv} online=${this.players.size}`);
  }
  plMsg(q) { return { t: 'pl', id: q.id, name: q.name, cls: q.ch.cls, look: q.ch.look, lv: q.ch.lv, title: q.ch.title, w: this.gearLook(q) }; }
  gearLook(q) { const e = q.ch.equip; return [e.weapon ? GEAR[e.weapon.k].tier : 0, e.weapon ? e.weapon.r : 0, e.armor ? GEAR[e.armor.k].tier : -1, e.helm ? GEAR[e.helm.k].tier : -1]; }

  remove(p) {
    if (!this.players.delete(p.id)) return;
    if (this.byPid.get(p.pid) === p) this.byPid.delete(p.pid);
    this.leaveParty(p);
    for (const m of this.mobs.values()) { m.threat.delete(p.id); if (m.target === p.id) m.target = 0; }
    this.broadcast({ t: 'pq', id: p.id });
    this.broadcast({ t: 'chat', id: 0, m: `${p.name} 님이 섬을 떠났어요` });
    this.log(`[leave] ${p.name} online=${this.players.size}`);
  }

  recalc(p) {
    const t = now();
    p.buffs = p.buffs.filter((b) => b.until > t);
    p.st = deriveStats(p.ch, p.buffs);
    p.hp = Math.min(p.hp, p.st.maxHp); p.mp = Math.min(p.mp, p.st.maxMp);
  }
  dirty(p) { p.dirty = true; }

  // ---------- 메시지 ----------
  handle(p, m) {
    const t = now();
    if (t - p.budgetT > 1000) { p.budget = 150; p.budgetT = t; }
    if (--p.budget < 0 || !m || typeof m !== 'object') return;
    switch (m.t) {
      case 'pos': return this.onPos(p, m, t);
      case 'atk': return this.onAtk(p, m, t);
      case 'skill': return this.onSkill(p, m, t);
      case 'dodge': return this.onDodge(p, m, t);
      case 'use': return this.onUse(p, m, t);
      case 'pick': return this.onPick(p, m);
      case 'equip': return this.onEquip(p, m);
      case 'unequip': return this.onUnequip(p, m);
      case 'swap': return this.onSwap(p, m);
      case 'trash': return this.onTrash(p, m);
      case 'buy': return this.onBuy(p, m);
      case 'sell': return this.onSell(p, m);
      case 'enhance': return this.onEnhance(p, m);
      case 'rest': return this.onRest(p, m);
      case 'talk': return this.onTalk(p, m);
      case 'qaccept': return this.onQuestAccept(p, m);
      case 'qdone': return this.onQuestDone(p, m);
      case 'bounty': return this.onBounty(p, m);
      case 'tp': return this.onTp(p, m, t);
      case 'revive': return this.onRevive(p, m);
      case 'respawn': return this.onRespawn(p);
      case 'pinvite': return this.onInvite(p, m, t);
      case 'paccept': return this.onAcceptInvite(p, m);
      case 'pleave': this.leaveParty(p); return;
      case 'chat': return this.onChat(p, m, t);
    }
  }

  near(p, npc, extra = 2) { const n = NPC_POS[npc]; return n && dist(p.x, p.z, n.x, n.z) <= INTERACT_R + extra; }

  onPos(p, m, t) {
    if (p.downed) return;
    const x = +m.x, z = +m.z;
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 400 || Math.abs(z) > 400) return;
    const dt = Math.max(0.05, (t - p.lastPos) / 1000);
    const maxD = p.st.spd * 1.5 * dt + 1.2;
    if (dist(x, z, p.x, p.z) > maxD && t > p.allowJump) {
      this.send(p, { t: 'tp', x: p.x, z: p.z });
      p.allowJump = t + 400;
      return;
    }
    p.x = x; p.z = z; p.lastPos = t;
    p.ry = Number.isFinite(+m.ry) ? +m.ry : p.ry;
    p.anim = m.a | 0;
    if (p.revive) { const q = this.players.get(p.revive.id); if (!q || dist(p.x, p.z, q.x, q.z) > 3.5) p.revive = null; }
  }

  // ----- 전투 -----
  mobsNear(x, z, r) { const out = []; for (const m of this.mobs.values()) if (!m.dead && dist(x, z, m.x, m.z) <= r + m.size * 0.5) out.push(m); return out; }
  findTarget(p, tid, range) {
    const m = this.mobs.get(tid | 0);
    if (m && !m.dead && dist(p.x, p.z, m.x, m.z) <= range + 2 + m.size * 0.5) return m;
    let best = null, bd = 1e9;
    const [fx, fz] = dirOf(p.ry);
    for (const q of this.mobs.values()) {
      if (q.dead) continue;
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d > range + q.size * 0.5 + 0.5) continue;
      const front = d < 2 || (dx * fx + dz * fz) / d > -0.2;
      const score = d - (front ? 3 : 0);
      if (front && score < bd) { bd = score; best = q; }
    }
    return best;
  }

  onAtk(p, m, t) {
    if (p.downed || t < p.atkT) return;
    const C = CLASSES[p.ch.cls];
    p.atkT = t + p.st.aspd * 1000 * 0.92;
    if (Number.isFinite(+m.ry)) p.ry = +m.ry;
    const tgt = this.findTarget(p, m.tid, C.range);
    if (tgt) p.ry = ryTo(tgt.x - p.x, tgt.z - p.z);
    this.addFx(p.x, p.z, ['atk', p.id, tgt ? tgt.id : 0, r1(p.ry)]);
    if (!tgt) return;
    if (C.proj) {
      const d = dist(p.x, p.z, tgt.x, tgt.z);
      this.later(d / PROJ_SPEED, () => this.damageMob(p, tgt, 1));
    } else {
      // 근접: 앞쪽 부채꼴 안의 적 최대 3마리
      const [fx, fz] = dirOf(p.ry);
      const list = this.mobsNear(p.x, p.z, C.range + 0.6).filter((q) => q === tgt || ((q.x - p.x) * fx + (q.z - p.z) * fz) / (dist(p.x, p.z, q.x, q.z) || 1) > 0.3).slice(0, 3);
      this.later(0.18, () => list.forEach((q, i) => this.damageMob(p, q, i === 0 || q === tgt ? 1 : 0.6)));
    }
  }

  onSkill(p, m, t) {
    const C = CLASSES[p.ch.cls];
    const key = C.skills[m.s | 0];
    const S = SKILLS[key];
    if (!S || p.downed) return;
    if (p.ch.lv < S.lv) return this.toast(p, `레벨 ${S.lv}에 배워요`);
    if (t < (p.cds[key] || 0) - 150) return;
    if (p.mp < S.mp) return this.toast(p, '마나가 부족해요');
    p.mp -= S.mp;
    p.cds[key] = t + S.cd * 1000;
    if (Number.isFinite(+m.ry)) p.ry = +m.ry;
    const [fx, fz] = dirOf(p.ry);
    let tx = p.x + fx * Math.min(S.range || 8, 8), tz = p.z + fz * Math.min(S.range || 8, 8);
    const tg = this.mobs.get(m.tid | 0);
    if (tg && !tg.dead && dist(p.x, p.z, tg.x, tg.z) <= (S.range || 10) + 3) { tx = tg.x; tz = tg.z; p.ry = ryTo(tx - p.x, tz - p.z); }
    else if (Number.isFinite(+m.x) && Number.isFinite(+m.z) && dist(p.x, p.z, +m.x, +m.z) <= (S.range || 10) + 2) { tx = +m.x; tz = +m.z; }
    const [dx, dz] = dirOf(p.ry);
    this.addFx(p.x, p.z, ['skill', p.id, key, r1(tx), r1(tz), r1(p.ry), tg ? tg.id : 0]);
    const hitAll = (list, mult, opts = {}, delay = 0.15) => this.later(delay, () => list.forEach((q) => this.damageMob(p, q, mult, opts)));
    switch (S.type) {
      case 'aoeSelf': hitAll(this.mobsNear(p.x, p.z, S.r), S.mult, { slow: S.slow, slowDur: S.slowDur }); break;
      case 'dash': {
        p.allowJump = t + 900; p.invuln = t + 350;
        const list = [...this.mobs.values()].filter((q) => !q.dead && this.segHit(p.x, p.z, dx, dz, S.len, S.w + q.size * 0.4, q));
        hitAll(list, S.mult, {}, 0.2);
        break;
      }
      case 'buffSelf':
        p.buffs.push({ key, until: t + S.dur * 1000, ...S.buff });
        this.recalc(p);
        if (S.dash) p.allowJump = t + 900;
        if (S.taunt) for (const q of this.mobsNear(p.x, p.z, S.taunt)) { q.target = p.id; q.threat.set(p.id, (q.threat.get(p.id) || 0) + 9999); if (q.state === 'idle') q.state = 'chase'; }
        break;
      case 'cone': {
        const list = this.mobsNear(p.x, p.z, S.len).filter((q) => Math.abs(angleDiff(p.ry, ryTo(q.x - p.x, q.z - p.z))) * 180 / Math.PI <= S.arc / 2 + 10 || dist(p.x, p.z, q.x, q.z) < 1.5);
        hitAll(list, S.mult, { stun: S.stun }, 0.35);
        break;
      }
      case 'fan': {
        const hit = new Set();
        for (let i = 0; i < S.n; i++) {
          const ang = p.ry + ((i / (S.n - 1)) - 0.5) * S.arc * Math.PI / 180;
          const [ax, az] = dirOf(ang);
          let best = null, bd = 1e9;
          for (const q of this.mobs.values()) {
            if (q.dead) continue;
            const along = (q.x - p.x) * ax + (q.z - p.z) * az;
            if (along < 0 || along > S.len) continue;
            const off = Math.abs((q.x - p.x) * az - (q.z - p.z) * ax);
            if (off < 0.9 + q.size * 0.4 && along < bd) { bd = along; best = q; }
          }
          if (best) { const q = best; const mult = hit.has(q.id) ? S.mult * 0.6 : S.mult; hit.add(q.id); this.later(bd / PROJ_SPEED, () => this.damageMob(p, q, mult)); }
        }
        break;
      }
      case 'aoePoint': {
        const ticks = S.ticks || 1;
        for (let i = 0; i < ticks; i++) this.later((S.delay || 0.3) + i * (S.interval || 0), () => {
          this.mobsNear(tx, tz, S.r).forEach((q) => this.damageMob(p, q, S.mult, { stun: S.stun }));
          if (S.delay) this.addFx(tx, tz, ['boom', key, r1(tx), r1(tz), S.r]);
        });
        break;
      }
      case 'line': {
        const list = [...this.mobs.values()].filter((q) => !q.dead && this.segHit(p.x, p.z, dx, dz, S.len, S.w + q.size * 0.4, q));
        for (const q of list) this.later(dist(p.x, p.z, q.x, q.z) / 34, () => this.damageMob(p, q, S.mult));
        break;
      }
      case 'projAoe': {
        const d = dist(p.x, p.z, tx, tz);
        this.later(d / 22, () => {
          const cx = tg && !tg.dead ? tg.x : tx, cz = tg && !tg.dead ? tg.z : tz;
          this.mobsNear(cx, cz, S.r).forEach((q) => this.damageMob(p, q, S.mult));
          this.addFx(cx, cz, ['boom', key, r1(cx), r1(cz), S.r]);
        });
        break;
      }
      case 'blink': p.allowJump = t + 900; p.invuln = t + 250; break;
      case 'heal': {
        for (const q of this.players.values()) {
          if (q.downed || dist(p.x, p.z, q.x, q.z) > S.r) continue;
          const amt = Math.round(q.st.maxHp * S.heal + p.st.atk * S.healAtk);
          q.hp = Math.min(q.st.maxHp, q.hp + amt);
          this.addHit(q.x, q.z, 2, q.id, amt, false);
        }
        break;
      }
      case 'buffAll':
        for (const q of this.players.values()) if (!q.downed && dist(p.x, p.z, q.x, q.z) <= S.r) { q.buffs.push({ key, until: t + S.dur * 1000, ...S.buff }); this.recalc(q); this.addFx(q.x, q.z, ['buff', q.id, key]); }
        break;
      case 'revive':
        for (const q of this.players.values()) {
          if (dist(p.x, p.z, q.x, q.z) > S.r) continue;
          if (q.downed) this.revivePlayer(q, S.heal);
          else { const amt = Math.round(q.st.maxHp * 0.3); q.hp = Math.min(q.st.maxHp, q.hp + amt); this.addHit(q.x, q.z, 2, q.id, amt, false); }
        }
        break;
    }
  }
  segHit(x, z, dx, dz, len, w, q) {
    const along = (q.x - x) * dx + (q.z - z) * dz;
    if (along < -1 || along > len + 1) return false;
    return Math.abs((q.x - x) * dz - (q.z - z) * dx) <= w;
  }

  onDodge(p, m, t) {
    if (p.downed || t < p.dodgeT) return;
    p.dodgeT = t + DODGE.cd * 1000 - 100;
    p.invuln = t + DODGE.invuln * 1000;
    p.allowJump = t + 700;
    this.addFx(p.x, p.z, ['dodge', p.id]);
  }

  damageMob(p, m, mult, opts = {}) {
    if (!m || m.dead || !this.players.has(p.id)) return;
    const r = rollDamage(p.st.atk, mult, m.def, p.st.crit, p.st.critdmg, this.rand);
    m.hp -= r.dmg;
    m.hurtAt = now();
    m.threat.set(p.id, (m.threat.get(p.id) || 0) + r.dmg);
    if (m.state === 'idle' || m.state === 'return') { m.state = 'chase'; m.target = p.id; }
    if (opts.stun && !m.boss) m.stunUntil = now() + opts.stun * 1000;
    if (opts.slow) { m.slowUntil = now() + (opts.slowDur || 2) * 1000; m.slowF = opts.slow; }
    this.addHit(m.x, m.z, 0, m.id, r.dmg, r.crit);
    if (m.hp <= 0) this.killMob(m);
  }

  hurtPlayer(p, raw, src) {
    const t = now();
    if (p.downed || t < p.invuln || inTown(p.x, p.z)) return;
    const dmg = Math.max(1, Math.round(raw * (60 / (60 + p.st.def)) * (0.9 + this.rand() * 0.2)));
    p.hp -= dmg;
    p.lastHurt = t;
    this.addHit(p.x, p.z, 1, p.id, dmg, false);
    if (p.hp <= 0) this.downPlayer(p, src);
  }

  downPlayer(p, src) {
    p.hp = 0; p.downed = now(); p.revive = null; p.buffs = []; this.recalc(p); p.hp = 0;
    for (const m of this.mobs.values()) if (m.target === p.id) { m.target = 0; m.threat.delete(p.id); }
    this.send(p, { t: 'down', by: src ? MONSTERS[src.type].name : '' });
    this.addFx(p.x, p.z, ['down', p.id]);
    this.broadcast({ t: 'chat', id: 0, m: `${p.name} 님이 쓰러졌어요! 근처 동료가 일으킬 수 있어요` });
  }
  revivePlayer(q, frac) {
    if (!q.downed) return;
    q.downed = 0; q.revive = null;
    q.hp = Math.max(1, Math.round(q.st.maxHp * frac)); q.mp = Math.max(q.mp, Math.round(q.st.maxMp * 0.3));
    q.invuln = now() + 2000;
    this.send(q, { t: 'up' });
    this.addFx(q.x, q.z, ['revive', q.id]);
  }
  onRevive(p, m) {
    const q = this.players.get(m.id | 0);
    if (!q || q === p || !q.downed || p.downed || dist(p.x, p.z, q.x, q.z) > 3.5) return;
    p.revive = { id: q.id, until: now() + 2500 };
    this.toast(p, `${q.name} 님을 일으키는 중…`);
  }
  onRespawn(p) {
    if (!p.downed) return;
    p.downed = 0;
    p.hp = Math.round(p.st.maxHp * 0.6); p.mp = Math.round(p.st.maxMp * 0.6);
    this.teleport(p, Math.sin(p.id) * 6, 3 + Math.cos(p.id) * 6);
    this.send(p, { t: 'up' });
    p.invuln = now() + 3000;
  }
  teleport(p, x, z) { p.x = x; p.z = z; p.allowJump = now() + 1500; this.send(p, { t: 'tp', x, z }); }

  // ----- 몬스터 처치 · 보상 -----
  killMob(m) {
    m.dead = true;
    this.mobs.delete(m.id);
    const camp = this.camps[m.camp];
    if (camp) {
      camp.mobs.delete(m.id);
      const M = MONSTERS[m.type];
      camp.next = Math.max(camp.next, now() + (m.boss ? M.respawn * 1000 : (18 + this.rand() * 14) * 1000));
    }
    this.addFx(m.x, m.z, ['die', m.id]);
    const M = MONSTERS[m.type];
    const ms = monsterStats(m.type, m.lv);
    const got = new Set();
    for (const [pid] of m.threat) {
      const q = this.players.get(pid);
      if (!q || q.downed || dist(q.x, q.z, m.x, m.z) > 70) continue;
      got.add(q);
      if (q.party) for (const o of this.partyMembers(q)) if (!o.downed && dist(o.x, o.z, m.x, m.z) <= SHARE_R) got.add(o);
    }
    for (const q of got) {
      const diff = q.ch.lv - m.lv;
      const f = diff <= 4 ? 1 : Math.max(0.1, 1 - 0.18 * (diff - 4));
      this.addXp(q, Math.round(ms.xp * f * (got.size > 1 ? 1.15 : 1)));
      const gold = Math.round((M.gold[0] + this.rand() * (M.gold[1] - M.gold[0])) * (1 + (m.lv - M.lv[0]) * 0.1));
      q.ch.gold += gold;
      this.send(q, { t: 'gold', n: gold, x: r1(m.x), z: r1(m.z) });
      this.rollLoot(q, m);
      this.questKill(q, m);
      this.dirty(q);
    }
    if (m.boss) {
      this.broadcast({ t: 'chat', id: 0, m: `👑 ${M.name} 처치! (참여 ${got.size}명)` });
      this.broadcast({ t: 'banner', a: `${M.name} 처치!`, b: '보스 전리품을 확인하세요' });
      this.bossSig = '';
    }
  }

  rollLoot(q, m) {
    const M = MONSTERS[m.type], rnd = this.rand;
    const drops = [];
    const gearN = m.boss ? 3 : rnd() < 0.08 ? 1 : 0;
    for (let i = 0; i < gearN; i++) drops.push(randomGear(q.ch.cls, m.lv, rollRarity(rnd, m.boss ? 4 : 1), rnd));
    for (const [k, ch] of M.drops) if (rnd() < ch) drops.push({ k, n: m.boss ? 3 : 1 });
    if (rnd() < (m.boss ? 1 : 0.035)) drops.push({ k: 'stone', n: m.boss ? 3 : 1 });
    if (rnd() < 0.06) drops.push({ k: m.lv >= 18 ? 'hp3' : m.lv >= 8 ? 'hp2' : 'hp1', n: 1 });
    if (rnd() < 0.04) drops.push({ k: m.lv >= 18 ? 'mp3' : m.lv >= 8 ? 'mp2' : 'mp1', n: 1 });
    const list = [];
    for (const it of drops) {
      const id = this.nextLoot++;
      const a = rnd() * Math.PI * 2, r = 0.6 + rnd() * 1.4;
      const L = { id, x: m.x + Math.sin(a) * r, z: m.z + Math.cos(a) * r, it, until: now() + 120000 };
      q.loot.set(id, L);
      list.push([id, r1(L.x), r1(L.z), it]);
    }
    if (q.loot.size > 40) { const first = q.loot.keys().next().value; q.loot.delete(first); }
    if (list.length) this.send(q, { t: 'loot', l: list });
  }

  onPick(p, m) {
    const L = p.loot.get(m.id | 0);
    if (!L || p.downed || dist(p.x, p.z, L.x, L.z) > 4.5) return;
    this.pickLoot(p, L);
  }
  pickLoot(p, L) {
    const it = L.it;
    let ok;
    if (it.n !== undefined) ok = addStack(p.ch.inv, it.k, it.n) === 0;
    else ok = addGear(p.ch.inv, it);
    if (!ok) { if (!p.fullWarn || now() - p.fullWarn > 4000) { p.fullWarn = now(); this.toast(p, '가방이 가득 찼어요'); } return; }
    p.loot.delete(L.id);
    this.send(p, { t: 'picked', id: L.id, it });
    this.dirty(p);
  }

  addXp(p, n) {
    if (p.ch.lv >= MAX_LEVEL) return;
    p.ch.xp += n;
    let up = false;
    while (p.ch.lv < MAX_LEVEL && p.ch.xp >= xpToNext(p.ch.lv)) { p.ch.xp -= xpToNext(p.ch.lv); p.ch.lv++; up = true; }
    if (p.ch.lv >= MAX_LEVEL) p.ch.xp = 0;
    this.send(p, { t: 'xp', n });
    if (up) {
      this.recalc(p);
      p.hp = p.st.maxHp; p.mp = p.st.maxMp;
      this.addFx(p.x, p.z, ['lvl', p.id]);
      this.broadcast(this.plMsg(p));
      const newSkill = CLASSES[p.ch.cls].skills.map((k) => SKILLS[k]).find((s) => s.lv === p.ch.lv);
      this.send(p, { t: 'banner', a: `레벨 업! Lv ${p.ch.lv}`, b: newSkill ? `새 스킬: ${newSkill.name}` : '능력치가 올랐어요' });
    }
    this.dirty(p);
  }

  // ----- 퀘스트 -----
  questKill(p, m) {
    const act = p.ch.quests.active;
    for (const qid in act) {
      const Q = QUEST_BY_ID[qid];
      if (!Q) continue;
      if ((Q.obj.type === 'kill' && Q.obj.mob === m.type) || (Q.obj.type === 'boss' && Q.obj.mob === m.type)) {
        const need = Q.obj.n || 1;
        if (act[qid].n < need) { act[qid].n++; this.send(p, { t: 'qprog', q: qid, n: act[qid].n, need }); }
      }
    }
    const b = p.ch.bounty;
    if (b && b.mob === m.type && b.n < b.need) { b.n++; this.send(p, { t: 'qprog', q: 'bounty', n: b.n, need: b.need }); }
  }
  questReady(p, Q) {
    const a = p.ch.quests.active[Q.id];
    if (!a) return false;
    if (Q.obj.type === 'collect') return countStack(p.ch.inv, Q.obj.item) >= Q.obj.n;
    if (Q.obj.type === 'talk') return this.near(p, Q.obj.npc);
    return a.n >= (Q.obj.n || 1);
  }
  onQuestAccept(p, m) {
    const Q = QUEST_BY_ID[m.q];
    if (!Q) return;
    const qs = p.ch.quests;
    if (qs.done.includes(Q.id) || qs.active[Q.id]) return;
    if (!this.near(p, Q.npc)) return this.toast(p, '의뢰한 NPC 곁에서 받을 수 있어요');
    if (Q.pre && !qs.done.includes(Q.pre)) return;
    if (p.ch.lv < Q.lv) return this.toast(p, `레벨 ${Q.lv} 이상이 필요해요`);
    qs.active[Q.id] = { n: 0 };
    this.send(p, { t: 'banner', a: '새 퀘스트', b: Q.name });
    this.dirty(p);
    if (Q.obj.type === 'talk' && this.near(p, Q.obj.npc)) this.onQuestDone(p, { q: Q.id });
  }
  onQuestDone(p, m) {
    const Q = QUEST_BY_ID[m.q];
    if (!Q || !p.ch.quests.active[Q.id]) return;
    const turnIn = Q.obj.type === 'talk' ? Q.obj.npc : Q.npc;
    if (!this.near(p, turnIn)) return this.toast(p, `${NPCS[turnIn].name}에게 가야 해요`);
    if (!this.questReady(p, Q)) return this.toast(p, '아직 목표를 다 채우지 못했어요');
    const R = Q.reward;
    const need = (R.items ? R.items.length : 0) + (R.gear ? 1 : 0);
    if (p.ch.inv.filter((s) => !s).length < need) return this.toast(p, '가방에 빈칸이 필요해요');
    if (Q.obj.type === 'collect') removeStack(p.ch.inv, Q.obj.item, Q.obj.n);
    delete p.ch.quests.active[Q.id];
    p.ch.quests.done.push(Q.id);
    p.ch.gold += R.gold || 0;
    for (const [k, n] of R.items || []) addStack(p.ch.inv, k, n);
    if (R.gear) {
      const slot = R.gear === 'random' ? null : R.gear;
      addGear(p.ch.inv, randomGear(p.ch.cls, Math.max(p.ch.lv, Q.lv), R.rar || 0, this.rand, slot === 'weapon' ? 'weapon' : slot === 'armor' ? 'armor' : null));
    }
    if (R.title) p.ch.title = R.title;
    this.send(p, { t: 'banner', a: '퀘스트 완료!', b: `${Q.name} · 경험치 ${R.xp} · ${R.gold || 0} 골드` });
    this.addXp(p, R.xp || 0);
    if (R.title) this.broadcast(this.plMsg(p));
    this.dirty(p);
  }
  onTalk(p, m) {
    const npc = m.npc;
    if (!NPCS[npc] || !this.near(p, npc)) return;
    for (const qid in p.ch.quests.active) {
      const Q = QUEST_BY_ID[qid];
      if (Q && Q.obj.type === 'talk' && Q.obj.npc === npc) this.onQuestDone(p, { q: qid });
    }
  }
  onBounty(p, m) {
    if (!this.near(p, 'board')) return;
    const ch = p.ch;
    if (m.a === 'take') {
      if (ch.bounty) return;
      let best = 'slime', bd = 1e9;
      for (const k of BOUNTY_MOBS) { const M = MONSTERS[k]; const d = Math.abs((M.lv[0] + M.lv[1]) / 2 - ch.lv); if (d < bd) { bd = d; best = k; } }
      const alts = BOUNTY_MOBS.filter((k) => Math.abs((MONSTERS[k].lv[0] + MONSTERS[k].lv[1]) / 2 - ch.lv) <= bd + 1.5);
      const mob = alts[Math.floor(this.rand() * alts.length)] || best;
      ch.bounty = { mob, n: 0, need: 10, lv: ch.lv };
      this.send(p, { t: 'banner', a: '현상금 의뢰', b: `${MONSTERS[mob].name} 10마리 처치` });
    } else if (m.a === 'done') {
      const b = ch.bounty;
      if (!b || b.n < b.need) return this.toast(p, '아직 다 처치하지 못했어요');
      ch.bounty = null;
      const gold = 40 + ch.lv * 25;
      ch.gold += gold;
      if (this.rand() < 0.35) addStack(ch.inv, 'stone', 1);
      this.send(p, { t: 'banner', a: '현상금 완료!', b: `${gold} 골드 · 경험치` });
      this.addXp(p, Math.round(xpToNext(ch.lv) * 0.3));
    } else if (m.a === 'drop') ch.bounty = null;
    this.dirty(p);
  }

  // ----- 아이템 -----
  onUse(p, m, t) {
    const i = m.slot | 0, s = p.ch.inv[i];
    if (!s || s.n === undefined || p.downed) return;
    const S = STACK[s.k];
    if (!S || (!S.heal && !S.mana && s.k !== 'scroll')) return;
    if (t < p.potT) return;
    p.potT = t + POTION_CD * 1000;
    if (S.heal) { const a = Math.min(S.heal, p.st.maxHp - p.hp); p.hp += a; this.addHit(p.x, p.z, 2, p.id, a, false); }
    if (S.mana) p.mp = Math.min(p.st.maxMp, p.mp + S.mana);
    if (s.k === 'scroll') this.teleport(p, -4 + this.rand() * 8, 4 + this.rand() * 4);
    s.n--; if (s.n <= 0) p.ch.inv[i] = null;
    this.addFx(p.x, p.z, ['potion', p.id, s.k]);
    this.dirty(p);
  }
  onEquip(p, m) {
    const i = m.slot | 0, it = p.ch.inv[i];
    if (!it || !GEAR[it.k]) return;
    const why = canEquip(p.ch, it);
    if (why) return this.toast(p, why);
    const slot = GEAR[it.k].slot;
    p.ch.inv[i] = p.ch.equip[slot] || null;
    p.ch.equip[slot] = it;
    this.recalc(p); this.dirty(p);
    this.broadcast(this.plMsg(p));
  }
  onUnequip(p, m) {
    const slot = m.slot;
    if (!EQUIP_SLOTS.includes(slot) || !p.ch.equip[slot] || slot === 'weapon') return;
    if (!addGear(p.ch.inv, p.ch.equip[slot])) return this.toast(p, '가방이 가득 찼어요');
    delete p.ch.equip[slot];
    this.recalc(p); this.dirty(p);
    this.broadcast(this.plMsg(p));
  }
  onSwap(p, m) {
    const a = m.a | 0, b = m.b | 0, inv = p.ch.inv;
    if (a < 0 || b < 0 || a >= INV_SIZE || b >= INV_SIZE || a === b) return;
    if (inv[a] && inv[b] && inv[a].n !== undefined && inv[a].k === inv[b].k) { inv[b].n += inv[a].n; inv[a] = null; }
    else [inv[a], inv[b]] = [inv[b], inv[a]];
    this.dirty(p);
  }
  onTrash(p, m) { const i = m.slot | 0; if (p.ch.inv[i]) { p.ch.inv[i] = null; this.dirty(p); } }
  shopNear(p) { for (const k in NPCS) if (NPCS[k].shop && this.near(p, k)) return k; return null; }
  onBuy(p, m) {
    const npc = m.npc;
    if (!NPCS[npc] || !NPCS[npc].shop || !this.near(p, npc)) return;
    const list = SHOPS[NPCS[npc].shop];
    const k = String(m.k || '');
    if (!list.includes(k) && !list.includes('@' + k)) return;
    const n = clamp(m.n | 0 || 1, 1, 99);
    const price = buyPrice(k) * (GEAR[k] ? 1 : n);
    if (p.ch.gold < price) return this.toast(p, '골드가 부족해요');
    if (GEAR[k]) { if (!addGear(p.ch.inv, makeGear(k, TIER_LV[GEAR[k].tier], 0, this.rand))) return this.toast(p, '가방이 가득 찼어요'); }
    else if (addStack(p.ch.inv, k, n) > 0) return this.toast(p, '가방이 가득 찼어요');
    p.ch.gold -= price;
    this.send(p, { t: 'msg', m: `구매했어요 (-${price} 골드)`, snd: 'coin' });
    this.dirty(p);
  }
  onSell(p, m) {
    if (!this.shopNear(p)) return this.toast(p, '상인 곁에서 팔 수 있어요');
    const i = m.slot | 0, it = p.ch.inv[i];
    if (!it) return;
    const v = itemValue(it) * (it.n || 1);
    p.ch.inv[i] = null;
    p.ch.gold += v;
    this.send(p, { t: 'msg', m: `${itemName(it)} 판매 (+${v} 골드)`, snd: 'coin' });
    this.dirty(p);
  }
  onEnhance(p, m) {
    if (!this.near(p, 'smith')) return this.toast(p, '대장장이 곁에서 강화할 수 있어요');
    const it = m.eq ? p.ch.equip[m.eq] : p.ch.inv[m.slot | 0];
    const info = enhanceInfo(it);
    if (!info) return this.toast(p, '더 강화할 수 없어요');
    if (p.ch.gold < info.gold) return this.toast(p, '골드가 부족해요');
    if (countStack(p.ch.inv, 'stone') < info.stones) return this.toast(p, `강화석이 ${info.stones}개 필요해요`);
    p.ch.gold -= info.gold;
    removeStack(p.ch.inv, 'stone', info.stones);
    const ok = this.rand() < info.chance;
    if (ok) it.en = (it.en || 0) + 1;
    this.recalc(p); this.dirty(p);
    this.send(p, { t: 'enh', ok, name: itemName(it), en: it.en || 0 });
    if (ok && it.en >= 7) this.broadcast({ t: 'chat', id: 0, m: `🔥 ${p.name} 님이 ${itemName(it)} 강화에 성공했어요!` });
    if (m.eq) this.broadcast(this.plMsg(p));
  }
  onRest(p) {
    if (!this.near(p, 'innkeeper')) return;
    p.hp = p.st.maxHp; p.mp = p.st.maxMp;
    this.addHit(p.x, p.z, 2, p.id, p.st.maxHp, false);
    this.toast(p, '푹 쉬었어요. 체력과 마나가 가득 찼어요');
  }
  onTp(p, m, t) {
    const w = WAYPOINTS[m.wp];
    if (!w || !p.ch.wps.includes(m.wp) || p.downed) return;
    const nearStone = Object.values(WAYPOINTS).some((s) => dist(p.x, p.z, s.x, s.z) <= 7);
    if (!nearStone) return this.toast(p, '이동의 돌 근처에서 쓸 수 있어요');
    this.teleport(p, w.x + 2.5, w.z + 2.5);
  }

  // ----- 파티 -----
  partyMembers(p) { const pt = this.parties.get(p.party); return pt ? [...pt.members].map((id) => this.players.get(id)).filter(Boolean) : [p]; }
  onInvite(p, m, t) {
    const q = this.players.get(m.id | 0);
    if (!q || q === p) return;
    if (q.party && q.party === p.party) return;
    if (p.party && this.parties.get(p.party).members.size >= 4) return this.toast(p, '파티는 4명까지예요');
    if (q.party) return this.toast(p, `${q.name} 님은 이미 다른 파티에 있어요`);
    q.invite = p.id; q.inviteT = t;
    this.send(q, { t: 'pinv', from: p.id, name: p.name });
    this.toast(p, `${q.name} 님에게 파티를 신청했어요`);
  }
  onAcceptInvite(p, m) {
    const q = this.players.get(m.from | 0);
    if (!q || p.invite !== q.id || now() - p.inviteT > 60000) return;
    p.invite = 0;
    this.leaveParty(p);
    if (!q.party) { const id = this.nextParty++; this.parties.set(id, { id, leader: q.id, members: new Set([q.id]) }); q.party = id; }
    const pt = this.parties.get(q.party);
    if (pt.members.size >= 4) return this.toast(p, '파티가 가득 찼어요');
    pt.members.add(p.id); p.party = pt.id;
    for (const o of this.partyMembers(p)) this.toast(o, `${p.name} 님이 파티에 들어왔어요`);
  }
  leaveParty(p) {
    if (!p.party) return;
    const pt = this.parties.get(p.party);
    p.party = 0;
    if (!pt) return;
    pt.members.delete(p.id);
    for (const id of pt.members) { const o = this.players.get(id); if (o) this.toast(o, `${p.name} 님이 파티를 떠났어요`); }
    if (pt.members.size <= 1) { for (const id of pt.members) { const o = this.players.get(id); if (o) o.party = 0; } this.parties.delete(pt.id); }
  }

  onChat(p, m, t) {
    if (typeof m.m !== 'string' || t - (p.lastChat || 0) < 800) return;
    let text = m.m.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
    if (!text) return;
    p.lastChat = t;
    if (text.startsWith('/p ') && p.party) {
      text = text.slice(3);
      for (const o of this.partyMembers(p)) this.send(o, { t: 'chat', id: p.id, name: p.name, m: text, party: 1 });
      return;
    }
    if (text === '/who') return this.toast(p, '접속 중: ' + [...this.players.values()].map((q) => `${q.name}(Lv${q.ch.lv})`).join(', '));
    this.broadcast({ t: 'chat', id: p.id, name: p.name, m: text });
  }

  // ---------- 시뮬레이션 ----------
  tick(dt) {
    const t = now();
    this.tickN++;
    // 지연된 효과
    if (this.events.length) {
      const due = this.events.filter((e) => e.at <= t);
      this.events = this.events.filter((e) => e.at > t);
      for (const e of due) { try { e.fn(); } catch (err) { this.log('event error ' + err.message); } }
    }
    for (const p of this.players.values()) this.tickPlayer(p, dt, t);
    this.acc.camp += dt;
    if (this.acc.camp >= 0.5) { this.acc.camp = 0; this.tickCamps(t); }
    for (const m of this.mobs.values()) this.tickMob(m, dt, t);
    this.flush(t);
  }

  tickPlayer(p, dt, t) {
    if (p.buffs.length && p.buffs.some((b) => b.until <= t)) this.recalc(p);
    if (p.downed) {
      if (t - p.downed > 60000) this.onRespawn(p);
      return;
    }
    const regenHp = (t - p.lastHurt > 6000 ? 0.03 : 0) + (p.st.regen || 0);
    p.regenAcc += dt;
    if (p.regenAcc >= 0.5) {
      const k = p.regenAcc; p.regenAcc = 0;
      if (regenHp) p.hp = Math.min(p.st.maxHp, p.hp + p.st.maxHp * regenHp * k);
      p.mp = Math.min(p.st.maxMp, p.mp + p.st.maxMp * (t - p.lastHurt > 6000 ? 0.03 : 0.012) * k);
    }
    if (lavaAt(p.x, p.z)) { p.lavaT += dt; if (p.lavaT >= 0.5) { p.lavaT = 0; this.hurtPlayer(p, p.st.maxHp * 0.06 * (60 + p.st.def) / 60, null); } }
    if (p.revive) {
      const q = this.players.get(p.revive.id);
      if (!q || !q.downed) p.revive = null;
      else if (t >= p.revive.until) { this.revivePlayer(q, 0.4); this.toast(p, `${q.name} 님을 일으켰어요!`); p.revive = null; }
    }
    // 주변 전리품 자동 줍기
    if (p.loot.size && this.tickN % 4 === 0) for (const L of [...p.loot.values()]) {
      if (L.until < t) { p.loot.delete(L.id); continue; }
      if (dist(p.x, p.z, L.x, L.z) < 1.8) this.pickLoot(p, L);
    }
    // 이동의 돌 발견
    if (this.tickN % 10 === 0) for (const [k, w] of Object.entries(WAYPOINTS)) {
      if (!p.ch.wps.includes(k) && dist(p.x, p.z, w.x, w.z) < 8) {
        p.ch.wps.push(k);
        this.send(p, { t: 'banner', a: '이동의 돌 발견!', b: `${w.name} — 이동의 돌에서 언제든 순간이동할 수 있어요` });
        this.dirty(p);
      }
    }
  }

  // 플레이어 근처 무리만 깨어 있음
  tickCamps(t) {
    const ps = [...this.players.values()];
    for (const c of this.camps) {
      const near = ps.some((p) => dist(p.x, p.z, c.x, c.z) < (c.boss ? ARENAS[c.type].r + 45 : 95));
      if (near) c.lastNear = t;
      if (near && c.mobs.size < c.n && t >= c.next) {
        const k = c.n - c.mobs.size;
        for (let i = 0; i < (c.boss ? 1 : Math.min(k, 2)); i++) this.spawnMob(c);
        if (c.boss) for (const p of ps) if (dist(p.x, p.z, c.x, c.z) < 160) this.send(p, { t: 'banner', a: `👑 ${MONSTERS[c.type].name} 등장!`, b: '보스가 나타났어요. 동료와 함께 도전하세요' });
        c.next = t + 2500;
      }
      if (!near && c.mobs.size && t - c.lastNear > 45000) {
        for (const id of c.mobs) { const m = this.mobs.get(id); if (m && m.state === 'idle') { this.mobs.delete(id); c.mobs.delete(id); } }
      }
    }
    const sig = this.camps.filter((c) => c.boss).map((c) => (c.mobs.size ? 1 : 0)).join('');
    if (sig !== this.bossSig) { this.bossSig = sig; this.broadcast(this.bossMsg()); }
  }
  bossMsg() { return { t: 'boss', l: this.camps.filter((c) => c.boss).map((c) => [c.type, c.mobs.size ? 1 : 0, Math.max(0, c.next - now())]) }; }

  spawnMob(c, type = c.type, lv = c.lv, at = null) {
    const M = MONSTERS[type];
    const st = monsterStats(type, lv);
    const a = this.rand() * Math.PI * 2, r = at ? 0 : this.rand() * c.r;
    const x = at ? at[0] : c.x + Math.sin(a) * r, z = at ? at[1] : c.z + Math.cos(a) * r;
    const m = {
      id: this.nextMob++, type, lv, camp: c.id, x, z, ry: this.rand() * 6.28, hp: st.hp, maxHp: st.hp, atk: st.atk, def: st.def,
      spd: M.spd, size: M.size, boss: !!M.boss, state: 'idle', target: 0, threat: new Map(), atkT: 0, wind: null,
      stunUntil: 0, slowUntil: 0, slowF: 0, hurtAt: 0, home: { x: c.x, z: c.z }, wander: null, anim: 0, skillT: now() + 5000, phase: 0,
    };
    this.mobs.set(m.id, m);
    c.mobs.add(m.id);
    return m;
  }

  tickMob(m, dt, t) {
    const M = MONSTERS[m.type];
    m.anim = 0;
    if (t < m.stunUntil) return;
    const leash = m.boss ? ARENAS[m.type].r + 14 : 30;
    const homeD = dist(m.x, m.z, m.home.x, m.home.z);
    let target = m.target ? this.players.get(m.target) : null;
    if (target && (target.downed || inTown(target.x, target.z) || dist(target.x, target.z, m.x, m.z) > 40)) { m.threat.delete(target.id); target = null; m.target = 0; }
    if (m.state === 'return') {
      if (homeD < 2) { m.state = 'idle'; m.hp = m.maxHp; m.threat.clear(); }
      else this.step(m, m.home.x, m.home.z, dt, 1.4);
      return;
    }
    if (!target) {
      // 가장 위협적인 대상 또는 가까운 플레이어
      let best = null, bv = -1;
      for (const [pid, v] of m.threat) { const p = this.players.get(pid); if (p && !p.downed && !inTown(p.x, p.z) && v > bv) { bv = v; best = p; } }
      if (!best) for (const p of this.players.values()) {
        if (p.downed || inTown(p.x, p.z)) continue;
        if (dist(p.x, p.z, m.x, m.z) <= M.aggro) { best = p; break; }
      }
      if (best) { m.target = best.id; m.state = 'chase'; target = best; }
    }
    if (!target) {
      if (m.state === 'chase') { m.state = homeD > 3 ? 'return' : 'idle'; return; }
      // 어슬렁
      if (!m.wander || t > m.wander.t) {
        const a = this.rand() * 6.28, r = this.rand() * (m.boss ? 6 : 7);
        m.wander = this.rand() < 0.5 ? { x: m.home.x + Math.sin(a) * r, z: m.home.z + Math.cos(a) * r, t: t + 4000 + this.rand() * 5000 } : { x: m.x, z: m.z, t: t + 3000 + this.rand() * 3000 };
      }
      if (dist(m.x, m.z, m.wander.x, m.wander.z) > 0.6) this.step(m, m.wander.x, m.wander.z, dt, 0.45);
      return;
    }
    if (homeD > leash) { m.state = 'return'; m.target = 0; m.threat.clear(); return; }
    if (m.boss) this.bossSkills(m, target, t);
    const d = dist(m.x, m.z, target.x, target.z);
    const reach = M.range + m.size * 0.4;
    if (m.wind) {
      if (t >= m.wind.at) {
        const w = m.wind; m.wind = null;
        const tg = this.players.get(w.tid);
        if (tg && !tg.downed) {
          if (M.ranged) {
            const dd = dist(m.x, m.z, tg.x, tg.z);
            this.addFx(m.x, m.z, ['mproj', m.id, tg.id, M.ranged]);
            this.later(dd / 16, () => { if (!tg.downed && dist(m.x, m.z, tg.x, tg.z) < M.range * 1.4) this.hurtPlayer(tg, m.atk, m); });
          } else if (dist(m.x, m.z, tg.x, tg.z) <= reach + 0.9) this.hurtPlayer(tg, m.atk, m);
        }
      }
      return;
    }
    m.ry = ryTo(target.x - m.x, target.z - m.z);
    if (M.ranged && d < M.range * 0.45 && !m.boss) this.step(m, m.x - (target.x - m.x), m.z - (target.z - m.z), dt, 0.8);
    else if (d > reach * 0.9) this.step(m, target.x, target.z, dt, 1);
    if (d <= reach + 0.3 && t >= m.atkT) {
      m.atkT = t + M.aspd * 1000;
      m.wind = { at: t + (M.ranged ? 450 : 420), tid: target.id };
      m.anim = 1;
      this.addFx(m.x, m.z, ['matk', m.id, target.id]);
    }
  }

  step(m, tx, tz, dt, k) {
    let dx = tx - m.x, dz = tz - m.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const slow = now() < m.slowUntil ? 1 - m.slowF : 1;
    const s = Math.min(d, m.spd * k * slow * dt);
    dx /= d; dz /= d;
    m.ry = ryTo(dx, dz);
    let [nx, nz] = moveCircle(m.x, m.z, dx * s, dz * s, 0.4 * m.size, { fly: MONSTERS[m.type].fly });
    if (Math.hypot(nx, nz) < TOWN_R + 2) return;
    // 서로 겹치지 않게 살짝 밀기
    for (const o of this.mobs.values()) {
      if (o === m) continue;
      const ox = nx - o.x, oz = nz - o.z, od = Math.hypot(ox, oz), mn = 0.45 * (m.size + o.size);
      if (od < mn && od > 0.01) { nx += (ox / od) * (mn - od) * 0.5; nz += (oz / od) * (mn - od) * 0.5; }
    }
    m.x = nx; m.z = nz;
  }

  // 보스 패턴: 바닥에 경고를 띄운 뒤 피해
  bossSkills(m, target, t) {
    if (t < m.skillT) return;
    const M = MONSTERS[m.type];
    m.skillT = t + 6500 + this.rand() * 3000;
    const ps = [...this.players.values()].filter((p) => !p.downed && dist(p.x, p.z, m.x, m.z) < 30);
    const warn = (x, z, r, ms, mult, shape = 'circle', extra = {}) => {
      this.addFx(x, z, ['warn', shape, r1(x), r1(z), r, ms, r1(extra.ry || 0), extra.arc || 0]);
      this.later(ms / 1000, () => {
        if (!this.mobs.has(m.id)) return;
        this.addFx(x, z, ['boom', m.type, r1(x), r1(z), r]);
        for (const p of this.players.values()) {
          if (p.downed) continue;
          const d = dist(p.x, p.z, x, z);
          let inside = d <= r + PLAYER_R;
          if (shape === 'cone') inside = d <= r && Math.abs(angleDiff(extra.ry, ryTo(p.x - x, p.z - z))) <= (extra.arc / 2) * Math.PI / 180;
          if (inside) this.hurtPlayer(p, m.atk * mult, m);
        }
        if (extra.after) extra.after();
      });
    };
    const pick = () => this.rand();
    if (m.type === 'slime_king') {
      if (m.hp < m.maxHp * 0.5 && !m.phase) {
        m.phase = 1;
        for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; this.spawnMob(this.camps[m.camp], 'slime', 4, [m.x + Math.sin(a) * 4, m.z + Math.cos(a) * 4]).state = 'chase'; }
        this.broadcast({ t: 'banner', a: '슬라임 킹이 분열했어요!', b: '' });
        return;
      }
      const tx = target.x, tz = target.z;
      warn(tx, tz, 5, 1300, 2.2, 'circle', { after: () => { m.x = tx; m.z = tz; } });
    } else if (m.type === 'treant') {
      if (pick() < 0.35) { for (let i = 0; i < 3; i++) { const a = pick() * 6.28; const w = this.spawnMob(this.camps[m.camp], 'wolf', 11, [m.x + Math.sin(a) * 5, m.z + Math.cos(a) * 5]); w.state = 'chase'; w.target = target.id; } }
      for (const p of ps.slice(0, 4)) warn(p.x, p.z, 3.2, 1400, 1.8);
    } else if (m.type === 'ancient_golem') {
      if (pick() < 0.5) warn(m.x, m.z, 7.5, 1400, 2.2);
      else for (let i = 0; i < 5; i++) { const p = ps[i % Math.max(1, ps.length)] || target; warn(p.x + (pick() - 0.5) * 6, p.z + (pick() - 0.5) * 6, 3.2, 1500, 1.7); }
    } else if (m.type === 'lava_giant') {
      const r = pick();
      if (r < 0.33) warn(m.x, m.z, 8.5, 1500, 2.4);
      else if (r < 0.66) for (let i = 0; i < 6; i++) { const p = ps[i % Math.max(1, ps.length)] || target; warn(p.x + (pick() - 0.5) * 8, p.z + (pick() - 0.5) * 8, 3.6, 1600, 1.9); }
      else { const ry = ryTo(target.x - m.x, target.z - m.z); warn(m.x, m.z, 13, 1300, 2.1, 'cone', { ry, arc: 70 }); }
    }
    void M;
  }

  // 효과/피해 숫자/상태 전송
  flush(t) {
    const ps = [...this.players.values()];
    if (this.fx.length || this.hits.length) {
      for (const p of ps) {
        const fx = this.fx.filter((f) => Math.abs(f.x - p.x) < 80 && Math.abs(f.z - p.z) < 80).map((f) => f.e);
        const hits = this.hits.filter((h) => Math.abs(h.x - p.x) < 60 && Math.abs(h.z - p.z) < 60).map((h) => h.h);
        if (fx.length || hits.length) this.send(p, { t: 'fx', f: fx, h: hits });
      }
      this.fx = []; this.hits = [];
    }
    if (this.tickN % 2) return;
    const mobs = [...this.mobs.values()];
    for (const p of ps) {
      if (p.ws.readyState !== 1 || p.ws.bufferedAmount > 1e6) continue;
      const pl = [], ml = [];
      for (const q of ps) {
        if (q === p || Math.abs(q.x - p.x) > 110 || Math.abs(q.z - p.z) > 110) continue;
        pl.push([q.id, r1(q.x), r1(q.z), r1(q.ry), q.anim, Math.round((q.hp / q.st.maxHp) * 100), q.downed ? 1 : 0]);
      }
      for (const m of mobs) {
        if (Math.abs(m.x - p.x) > 90 || Math.abs(m.z - p.z) > 90) continue;
        const fl = (t - m.hurtAt < 200 ? 1 : 0) | (t < m.stunUntil ? 2 : 0) | (t < m.slowUntil ? 4 : 0) | (m.wind ? 8 : 0) | (m.state === 'chase' ? 16 : 0);
        ml.push([m.id, MOB_KEYS.indexOf(m.type), r1(m.x), r1(m.z), r1(m.ry), Math.ceil((m.hp / m.maxHp) * 100), fl, m.lv]);
      }
      const msg = { t: 's', tm: t, on: ps.length, p: pl, m: ml, me: [Math.round(p.hp), Math.round(p.mp), p.st.maxHp, p.st.maxMp] };
      if (p.party) msg.pt = this.partyMembers(p).map((q) => [q.id, q.name, q.ch.cls, q.ch.lv, Math.round((q.hp / q.st.maxHp) * 100), r1(q.x), r1(q.z), q.downed ? 1 : 0]);
      if (p.buffs.length) msg.bf = p.buffs.map((b) => [b.key, Math.max(0, Math.round((b.until - t) / 100) / 10)]);
      p.ws.send(JSON.stringify(msg));
      if (p.dirty && t - p.charSent > 250) { p.dirty = false; p.charSent = t; this.send(p, { t: 'char', ch: p.ch, st: p.st }); }
    }
  }
}

// 연결 하나를 게임에 연결 (Node ws, P2P, 루프백 공용)
export function bindSocket(game, ws) {
  return {
    receive(raw) {
      let msg;
      try { msg = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (!ws.player) { if (msg.t === 'join') game.join(ws, msg); return; }
      game.handle(ws.player, msg);
    },
    closed() { if (ws.player) game.remove(ws.player); },
  };
}
