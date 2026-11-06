// 권위 게임 로직: 서버(Node)와 P2P 호스트(브라우저)에서 똑같이 돌아감
import {
  PROTO, CS, CH, SEA, SAFE_R, CLAIM_R, MAX_CLAIMS, MAX_HP, MAX_FOOD, MAX_AIR, REACH,
  PLAYER_W, PLAYER_H, EYE, DIRS, FACES, ckey, bkey, timeOfDay, isNight, daylight, clamp,
} from '../shared/constants.js';
import {
  BLOCKS, B, SOLID, OPAQUE, collisionBoxes, isDoor, isSign, isChest, isWheat, isSapling,
} from '../shared/blocks.js';
import {
  ITEMS, I, RECIPES, INV_SIZE, newInv, addItem, removeItem, canCraft, craft, invToWire, invFromWire,
  breakInfo, toolOf, maxStack,
} from '../shared/items.js';
import { moveEntity, boxesOverlap } from '../shared/physics.js';
import { resolvePlacement, dirOf } from '../shared/rules.js';
import { mulberry32, hash2 } from '../shared/noise.js';

const MAX_PLAYERS = 40;
const CHEST_SIZE = 27;
const r1 = (n) => Math.round(n * 100) / 100;

export const MOB = {
  zombie: { hp: 20, w: 0.6, h: 1.9, speed: 2.4, dmg: 3, hostile: true, drops: [['rotten_flesh', 0, 2]] },
  slime: { hp: 8, w: 0.9, h: 0.9, speed: 2.8, dmg: 2, hostile: true, hop: true, drops: [['slimeball', 0, 2]] },
  pig: { hp: 10, w: 0.9, h: 0.9, speed: 1.5, drops: [['raw_pork', 1, 3]] },
  sheep: { hp: 8, w: 0.9, h: 1.3, speed: 1.4, drops: [['wool_0', 1, 2], ['raw_mutton', 1, 2]] },
  chicken: { hp: 4, w: 0.45, h: 0.7, speed: 1.6, drops: [['raw_chicken', 1, 1], ['feather', 0, 2]], flap: true },
};
export const MOB_TYPES = Object.keys(MOB);

function sanitizeName(s) {
  if (typeof s !== 'string') return '';
  return s.normalize('NFC').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 12);
}
const sanitizeSkin = (s) => (Array.isArray(s) ? s.slice(0, 4).map((v) => clamp(v | 0, 0, 15)) : [0, 0, 0, 0]);
const itemIdOf = (k) => I[k] ?? B[k];

export class Game {
  // opts: { hash(token)→pid, p2p: bool, log }
  constructor(world, opts = {}) {
    this.world = world;
    this.hash = opts.hash;
    this.p2p = !!opts.p2p;
    this.log = opts.log || (() => {});
    this.players = new Map();
    this.byPid = new Map();
    this.mobs = new Map();
    this.nextId = 1;
    this.nextMob = 1;
    this.edits = [];
    this.tickN = 0;
    this.acc = { spawn: 0, passive: 0, crops: 0, snap: 0, sweep: 0, burn: 0 };
    this.rand = mulberry32((Date.now() & 0xffffffff) >>> 0);
    this.getBlock = (x, y, z) => this.world.getBlock(x, y, z);
    this.lastSnap = '';
  }

  get spawn() { return this.world.gen.spawn; }
  time() { return timeOfDay(this.world.epoch, Date.now()); }

  // ---------------- 전송 ----------------
  send(p, o) { if (p.ws.readyState === 1) p.ws.send(JSON.stringify(o)); }
  broadcast(o, except) {
    const s = JSON.stringify(o);
    for (const q of this.players.values()) if (q !== except && q.ws.readyState === 1) q.ws.send(s);
  }
  toast(p, m) { this.send(p, { t: 'msg', m }); }
  sendInv(p) { this.send(p, { t: 'inv', s: invToWire(p.inv) }); }
  sendYou(p) {
    const sig = `${p.hp}|${p.food}|${Math.ceil(p.air)}|${p.dead ? 1 : 0}`;
    if (sig === p.youSig) return;
    p.youSig = sig;
    this.send(p, { t: 'you', hp: p.hp, food: p.food, air: Math.ceil(p.air), dead: p.dead });
  }
  claimsWire() { return this.world.claims.map((c) => [c.x, c.y, c.z, c.name, c.owner.slice(0, 8)]); }

  // ---------------- 접속 ----------------
  join(ws, msg) {
    if (msg.ver !== PROTO) { this.send({ ws }, { t: 'kick', code: 4004 }); return ws.close(4004, 'version'); }
    const token = typeof msg.token === 'string' ? msg.token : '';
    if (token.length < 16 || token.length > 100) return ws.close(4001, 'bad token');
    const pid = this.hash(token);
    const old = this.byPid.get(pid);
    if (old) { old.ws.close(4000, 'duplicate'); this.remove(old); }
    if (this.players.size >= MAX_PLAYERS) return ws.close(4002, 'full');

    const W = this.world;
    let rec = W.players[pid];
    const fresh = !rec;
    if (!rec) {
      rec = W.players[pid] = { name: '', inv: null, hp: MAX_HP, food: MAX_FOOD, pos: null, spawn: null, skin: null };
      const inv = newInv();
      addItem(inv, I.bread, 5);
      rec.inv = invToWire(inv);
    }
    const name = sanitizeName(msg.name) || rec.name || 'Guest' + (1000 + Math.floor(this.rand() * 9000));
    rec.name = name;
    rec.skin = sanitizeSkin(msg.skin || rec.skin);
    W.dirty = true;

    let pos = Array.isArray(rec.pos) && rec.pos.every(Number.isFinite) && rec.pos[1] > 0 && rec.pos[1] < CH + 10 ? rec.pos : null;
    if (!pos) pos = this.spawnPoint(rec);
    pos = this.freeSpot(pos[0], pos[1], pos[2]);

    const p = {
      id: this.nextId++, pid, tag: pid.slice(0, 8), name, skin: rec.skin, ws,
      x: pos[0], y: pos[1], z: pos[2], yaw: 0, pitch: 0, fl: 0, held: 0,
      inv: invFromWire(rec.inv), hp: clamp(rec.hp | 0 || MAX_HP, 1, MAX_HP), food: clamp(rec.food ?? MAX_FOOD, 0, MAX_FOOD), air: MAX_AIR,
      foodT: 0, regenT: 0, regenN: 0, starveT: 0, drownT: 0, dead: false,
      lastTp: Date.now(), lastHit: 0, lastDig: 0, lastAct: 0, lastChat: 0, lastCmd: 0, invuln: Date.now() + 3000,
      openChest: null, budget: 120, budgetT: Date.now(), youSig: '', fallSeen: 0, joinedAt: Date.now(),
    };
    this.players.set(p.id, p);
    this.byPid.set(pid, p);
    ws.player = p;

    this.send(p, {
      t: 'welcome', ver: PROTO, id: p.id, tag: p.tag, name, skin: p.skin, seed: W.seed, epoch: W.epoch, now: Date.now(),
      spawn: this.spawn, pos: [p.x, p.y, p.z], hp: p.hp, food: p.food, inv: invToWire(p.inv), host: !!msg.local, fresh,
    });
    this.send(p, { t: 'world', mods: W.modsObject(), claims: this.claimsWire(), signs: W.signs });
    for (const q of this.players.values()) this.send(p, { t: 'pl', id: q.id, name: q.name, skin: q.skin });
    this.broadcast({ t: 'pl', id: p.id, name, skin: p.skin }, p);
    this.broadcast({ t: 'chat', id: 0, m: `${name} 님이 들어왔어요` });
    if (this.p2p && !ws.local) { this.lastSnap = ''; this.acc.snap = 19; }
    this.log(`[join] ${name} online=${this.players.size}`);
  }

  remove(p) {
    if (!this.players.delete(p.id)) return;
    if (this.byPid.get(p.pid) === p) this.byPid.delete(p.pid);
    this.syncRecord(p);
    this.broadcast({ t: 'pq', id: p.id });
    this.broadcast({ t: 'chat', id: 0, m: `${p.name} 님이 나갔어요` });
    this.log(`[leave] ${p.name} online=${this.players.size}`);
  }

  syncRecord(p) {
    const rec = this.world.players[p.pid];
    if (!rec) return;
    rec.name = p.name; rec.skin = p.skin; rec.inv = invToWire(p.inv);
    rec.hp = p.dead ? MAX_HP : p.hp; rec.food = p.food;
    rec.pos = p.dead ? null : [r1(p.x), r1(p.y), r1(p.z)];
    this.world.dirty = true;
  }
  syncAll() { for (const p of this.players.values()) this.syncRecord(p); }

  spawnPoint(rec) {
    const W = this.world;
    if (rec && Array.isArray(rec.spawn)) {
      const [x, y, z] = rec.spawn;
      if (W.getBlock(Math.floor(x), Math.floor(y - 0.5), Math.floor(z)) === B.bed) return [x, y, z];
      rec.spawn = null;
    }
    const s = this.spawn;
    return [s[0] + (this.rand() - 0.5) * 4, s[1], s[2] + (this.rand() - 0.5) * 4];
  }

  // 블록에 끼지 않는 위치 찾기
  freeSpot(x, y, z) {
    const e = { x, y, z, w: PLAYER_W, h: PLAYER_H };
    for (let k = 0; k < CH; k++) {
      if (!this.overlapsSolid(e)) return [e.x, e.y, e.z];
      e.y = Math.floor(e.y) + 1;
    }
    return [x, CH, z];
  }
  overlapsSolid(e) {
    const hw = e.w / 2, a = [e.x - hw, e.y, e.z - hw, e.x + hw, e.y + e.h, e.z + hw];
    for (let y = Math.floor(a[1]); y <= Math.floor(a[4] - 1e-6); y++)
      for (let z = Math.floor(a[2]); z <= Math.floor(a[5] - 1e-6); z++)
        for (let x = Math.floor(a[0]); x <= Math.floor(a[3] - 1e-6); x++) {
          const id = this.getBlock(x, y, z);
          const bs = SOLID[id] && collisionBoxes(id);
          if (bs) for (const b of bs) if (boxesOverlap(a, [x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]])) return true;
        }
    return false;
  }

  // ---------------- 메시지 ----------------
  handle(p, m) {
    const now = Date.now();
    if (now - p.budgetT > 1000) { p.budget = 120; p.budgetT = now; }
    if (--p.budget < 0 || !m || typeof m !== 'object') return;
    switch (m.t) {
      case 'pos': return this.onPos(p, m, now);
      case 'dig': return this.onDig(p, m, now);
      case 'place': return this.onPlace(p, m, now);
      case 'use': return this.onUse(p, m, now);
      case 'hit': return this.onHit(p, m, now);
      case 'eat': return this.onEat(p, m);
      case 'craft': return this.onCraft(p, m);
      case 'swap': return this.onSwap(p, m);
      case 'trash': return this.onTrash(p, m);
      case 'closeChest': p.openChest = null; return;
      case 'chat': return this.onChat(p, m, now);
      case 'sign': return this.onSign(p, m);
      case 'fall': return this.onFall(p, m);
      case 'respawn': return this.onRespawn(p);
      case 'name': {
        const n = sanitizeName(m.name);
        if (!n || n === p.name || now - p.lastChat < 1500) return;
        p.lastChat = now;
        const old = p.name; p.name = n;
        this.syncRecord(p);
        this.broadcast({ t: 'pl', id: p.id, name: n, skin: p.skin });
        this.broadcast({ t: 'chat', id: 0, m: `${old} 님이 ${n}(으)로 이름을 바꿨어요` });
        return;
      }
      case 'skin':
        p.skin = sanitizeSkin(m.skin); this.syncRecord(p);
        this.broadcast({ t: 'pl', id: p.id, name: p.name, skin: p.skin });
        return;
      case 'merge': return this.onMerge(p, m);
    }
  }

  cell(m) {
    const x = m.x, y = m.y, z = m.z;
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z) || y < 0 || y >= CH) return null;
    if (Math.abs(x) > 3e7 || Math.abs(z) > 3e7) return null;
    return [x, y, z];
  }
  reachable(p, x, y, z, extra = 1.5) {
    return Math.hypot(x + 0.5 - p.x, y + 0.5 - (p.y + EYE), z + 0.5 - p.z) <= REACH + extra;
  }
  canEdit(p, x, z) {
    if (Math.hypot(x + 0.5 - this.spawn[0], z + 0.5 - this.spawn[2]) < SAFE_R) return '스폰 광장 근처는 보호 구역이에요';
    for (const c of this.world.claims)
      if (c.owner !== p.pid && Math.abs(x - c.x) <= CLAIM_R && Math.abs(z - c.z) <= CLAIM_R) return `${c.name} 님의 땅이에요`;
    return null;
  }
  canUse(p, x, z) {
    for (const c of this.world.claims)
      if (c.owner !== p.pid && Math.abs(x - c.x) <= CLAIM_R && Math.abs(z - c.z) <= CLAIM_R) return `${c.name} 님의 땅이에요`;
    return null;
  }
  // 실패 시 그 칸의 실제 블록을 다시 알려줌 (예측 되돌리기)
  deny(p, x, y, z, why) {
    this.send(p, { t: 'b1', x, y, z, v: this.getBlock(x, y, z) });
    if (why) this.toast(p, why);
  }
  setBlock(x, y, z, id) {
    if (this.world.setBlock(x, y, z, id)) this.edits.push(x, y, z, id);
  }

  onPos(p, m, now) {
    if (p.dead) return;
    const x = +m.x, y = +m.y, z = +m.z;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || y < -64 || y > CH + 64) return;
    if (Math.hypot(x - p.x, y - p.y, z - p.z) > 30 && now - p.lastTp > 3000) {
      this.send(p, { t: 'tp', x: p.x, y: p.y, z: p.z });
      return;
    }
    p.x = x; p.y = y; p.z = z;
    p.yaw = Number.isFinite(+m.yaw) ? +m.yaw : 0;
    p.pitch = clamp(+m.pitch || 0, -1.6, 1.6);
    p.fl = (m.f | 0) & 0xff;
    p.held = clamp(m.h | 0, 0, 8);
    if (y < -20) this.kill(p, '세상 밖으로 떨어졌어요');
  }

  give(p, list) {
    let full = false;
    for (const [id, n] of list) if (n > 0 && addItem(p.inv, id, n) > 0) full = true;
    if (full) this.toast(p, '가방이 가득 찼어요');
  }
  // 도구 내구도 감소
  wear(p, slot, n = 1) {
    const s = p.inv[slot];
    if (!s || !toolOf(s.id)) return;
    s.d -= n;
    if (s.d <= 0) { p.inv[slot] = null; this.send(p, { t: 'fx', k: 'toolbreak' }); }
  }

  dropsFor(id) {
    const b = BLOCKS[id], r = this.rand;
    if (b.drop === 'special') {
      if (b.key.startsWith('leaves')) {
        const out = [];
        if (r() < 0.06) out.push([b.key === 'leaves_birch' ? B.sapling_birch : b.key === 'leaves_spruce' ? B.sapling_spruce : B.sapling_oak, 1]);
        if (b.key === 'leaves_oak' && r() < 0.035) out.push([I.apple, 1]);
        return out;
      }
      if (id === B.tall_grass) return r() < 0.15 ? [[I.seeds, 1]] : [];
      if (isWheat(id)) return BLOCKS[id].stage === 7 ? [[I.wheat, 1], [I.seeds, 1 + Math.floor(r() * 3)]] : [[I.seeds, 1]];
      return [];
    }
    if (b.drop === undefined) return [[b.item ?? id, 1]];
    return [[itemIdOf(b.drop), 1]];
  }

  // 블록 제거 + 받침이 사라진 블록들 연쇄 제거 (드롭은 drops 배열에 모음)
  removeBlock(x, y, z, drops) {
    const W = this.world;
    const id = W.getBlock(x, y, z);
    if (!id) return;
    this.setBlock(x, y, z, 0);
    const k = bkey(x, y, z);
    if (isSign(id) && W.signs[k] !== undefined) { delete W.signs[k]; this.broadcast({ t: 'sign', k, text: null }); }
    if (isWheat(id)) delete W.crops[k];
    if (isSapling(id)) delete W.saplings[k];
    if (isDoor(id)) {
      const half = BLOCKS[id].door.half, oy = half ? y - 1 : y + 1;
      if (isDoor(W.getBlock(x, oy, z))) this.setBlock(x, oy, z, 0);
    }
    // 위에 얹힌 것
    const up = W.getBlock(x, y + 1, z);
    if (up) {
      const s = BLOCKS[up].support;
      if (s === 'ground' || s === 'farmland' || s === 'torch' || s === 'sand' || (isDoor(up) && BLOCKS[up].door.half === 0)) {
        if (drops) drops.push(...this.dropsFor(up));
        this.removeBlock(x, y + 1, z, drops);
      }
    }
    // 옆 벽에 붙어 있던 것
    for (let e = 0; e < 4; e++) {
      const nx = x - DIRS[e][0], nz = z - DIRS[e][1];
      const nid = W.getBlock(nx, y, nz);
      const nb = BLOCKS[nid];
      if (nb && nb.support === 'wall' && nb.dir === e) {
        if (drops) drops.push(...this.dropsFor(nid));
        this.removeBlock(nx, y, nz, drops);
      }
    }
  }

  onDig(p, m, now) {
    const c = this.cell(m);
    if (!c || p.dead) return;
    const [x, y, z] = c;
    const W = this.world;
    if (!this.reachable(p, x, y, z)) return this.deny(p, x, y, z);
    const id = W.getBlock(x, y, z), b = BLOCKS[id];
    if (!id || !b || b.hardness < 0) return this.deny(p, x, y, z);
    const why = this.canEdit(p, x, z);
    if (why) return this.deny(p, x, y, z, why);
    if (now - p.lastDig < 30) return this.deny(p, x, y, z);
    p.lastDig = now;
    const k = bkey(x, y, z);
    if (isChest(id)) {
      const ct = W.containers[k];
      if (ct && ct.some(Boolean)) return this.deny(p, x, y, z, '상자를 먼저 비워 주세요');
      delete W.containers[k];
    }
    if (id === B.flag) {
      const i = W.claims.findIndex((cl) => cl.x === x && cl.y === y && cl.z === z);
      if (i >= 0) {
        if (W.claims[i].owner !== p.pid) return this.deny(p, x, y, z, '남의 깃발이에요');
        W.claims.splice(i, 1);
        this.broadcast({ t: 'claims', c: this.claimsWire() });
        this.toast(p, '땅 보호가 해제됐어요');
      }
    }
    const held = p.inv[p.held];
    const info = breakInfo(id, held && held.id);
    const drops = info.drops ? this.dropsFor(id) : [];
    if (!info.drops && b.tier) this.toast(p, b.tier >= 3 ? '철 곡괭이 이상이 필요해요' : b.tier === 2 ? '돌 곡괭이 이상이 필요해요' : '곡괭이가 필요해요');
    this.removeBlock(x, y, z, drops);
    this.give(p, drops);
    if (held && toolOf(held.id) && b.hardness > 0) this.wear(p, p.held, toolOf(held.id).cls === 'sword' ? 2 : 1);
    this.sendInv(p);
  }

  entityBlocks(x, y, z, id) {
    const bs = collisionBoxes(id);
    if (!bs || !SOLID[id]) return false;
    const boxes = bs.map((b) => [x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]]);
    const hit = (e, w, h) => {
      const a = [e.x - w / 2, e.y, e.z - w / 2, e.x + w / 2, e.y + h, e.z + w / 2];
      return boxes.some((b) => boxesOverlap(a, b));
    };
    for (const q of this.players.values()) if (!q.dead && hit(q, PLAYER_W - 0.02, PLAYER_H - 0.02)) return true;
    for (const mb of this.mobs.values()) if (hit(mb, MOB[mb.type].w, MOB[mb.type].h)) return true;
    return false;
  }

  replaceable(id) { return id === 0 || (BLOCKS[id] && BLOCKS[id].replaceable); }

  onPlace(p, m, now) {
    const c = this.cell(m);
    if (!c || p.dead) return;
    const [x, y, z] = c;
    const W = this.world;
    const slot = m.s | 0, f = m.f | 0, d = ((m.d | 0) % 4 + 4) % 4;
    const st = p.inv[slot];
    if (slot < 0 || slot >= INV_SIZE || !st) return this.deny(p, x, y, z);
    const it = ITEMS[st.id];
    if (!it || (it.block === undefined && !it.place)) return this.deny(p, x, y, z);
    if (!this.reachable(p, x, y, z, 2)) return this.deny(p, x, y, z);
    if (now - p.lastAct < 40) return this.deny(p, x, y, z);
    if (!this.replaceable(W.getBlock(x, y, z))) return this.deny(p, x, y, z);
    const why = this.canEdit(p, x, z);
    if (why) return this.deny(p, x, y, z, why);
    p.lastAct = now;

    const k = bkey(x, y, z);
    const res = resolvePlacement(st.id, x, y, z, f, d, this.getBlock);
    if (res.err !== undefined) return this.deny(p, x, y, z, res.err || null);
    const id = res.id, extra = res.extra;
    if (extra && this.canEdit(p, extra[0], extra[2])) return this.deny(p, x, y, z, '여기엔 놓을 수 없어요');
    if (id === B.flag) {
      const mine = W.claims.filter((cl) => cl.owner === p.pid).length;
      if (mine >= MAX_CLAIMS) return this.deny(p, x, y, z, `깃발은 최대 ${MAX_CLAIMS}개까지 세울 수 있어요`);
      if (Math.hypot(x - this.spawn[0], z - this.spawn[2]) < SAFE_R + CLAIM_R) return this.deny(p, x, y, z, '스폰에서 더 떨어진 곳에 세워요');
      for (const cl of W.claims) if (Math.max(Math.abs(cl.x - x), Math.abs(cl.z - z)) <= CLAIM_R * 2) return this.deny(p, x, y, z, '다른 땅과 겹쳐요');
    }
    if (this.entityBlocks(x, y, z, id) || (extra && this.entityBlocks(extra[0], extra[1], extra[2], extra[3]))) return this.deny(p, x, y, z, '누가 서 있어요');

    st.n--; if (st.n <= 0) p.inv[slot] = null;
    this.setBlock(x, y, z, id);
    if (extra) this.setBlock(extra[0], extra[1], extra[2], extra[3]);
    if (isWheat(id)) W.crops[k] = Date.now() + this.growTime();
    if (isSapling(id)) W.saplings[k] = Date.now() + 120000 + this.rand() * 120000;
    if (isChest(id)) W.containers[k] = new Array(CHEST_SIZE).fill(0);
    if (id === B.flag) {
      W.claims.push({ x, y, z, owner: p.pid, name: p.name });
      this.broadcast({ t: 'claims', c: this.claimsWire() });
      this.toast(p, `주변 ${CLAIM_R * 2 + 1}×${CLAIM_R * 2 + 1} 땅이 보호돼요`);
    }
    if (isSign(id)) this.send(p, { t: 'signEdit', x, y, z });
    this.sendInv(p);
  }

  growTime() { return 35000 + this.rand() * 30000; }

  onUse(p, m) {
    const c = this.cell(m);
    if (!c || p.dead) return;
    const [x, y, z] = c;
    const W = this.world;
    if (!this.reachable(p, x, y, z, 2)) return;
    const id = W.getBlock(x, y, z);
    const k = bkey(x, y, z);
    if (isDoor(id)) {
      const why = this.canUse(p, x, z);
      if (why) return this.toast(p, why);
      const { half, open, dir } = BLOCKS[id].door;
      const by = half ? y - 1 : y;
      for (const [yy, h] of [[by, 0], [by + 1, 1]]) if (isDoor(W.getBlock(x, yy, z))) this.setBlock(x, yy, z, 77 + h * 8 + (1 - open) * 4 + dir);
      return;
    }
    if (isChest(id)) {
      const why = this.canUse(p, x, z);
      if (why) return this.toast(p, why);
      if (!W.containers[k]) W.containers[k] = new Array(CHEST_SIZE).fill(0);
      p.openChest = k;
      this.send(p, { t: 'chest', k, s: W.containers[k] });
      return;
    }
    if (id === B.bed) {
      const rec = W.players[p.pid];
      if (rec) rec.spawn = [x + 0.5, y + 0.6, z + 0.5];
      W.dirty = true;
      return this.toast(p, '이제 이 침대에서 다시 시작해요 (/home)');
    }
    const held = p.inv[p.held];
    const tool = held && toolOf(held.id);
    if (tool && tool.cls === 'hoe' && (id === B.grass || id === B.dirt || id === B.snowy_grass) && !W.getBlock(x, y + 1, z)) {
      const why = this.canEdit(p, x, z);
      if (why) return this.toast(p, why);
      this.setBlock(x, y, z, B.farmland);
      this.wear(p, p.held, 1);
      this.sendInv(p);
    }
  }

  onHit(p, m, now) {
    const mob = this.mobs.get(m.id | 0);
    if (!mob || p.dead || now - p.lastHit < 280) return;
    const T = MOB[mob.type];
    if (Math.hypot(mob.x - p.x, mob.y + T.h / 2 - (p.y + EYE), mob.z - p.z) > 5.5) return;
    p.lastHit = now;
    const held = p.inv[p.held];
    const tool = held && toolOf(held.id);
    const dmg = tool ? tool.dmg : 1;
    if (tool) this.wear(p, p.held, tool.cls === 'sword' ? 1 : 2);
    this.damageMob(mob, dmg, p);
    if (tool) this.sendInv(p);
  }

  damageMob(mob, dmg, p) {
    const T = MOB[mob.type];
    if (Date.now() - mob.hurtAt < 350) return;
    mob.hp -= dmg;
    mob.hurtAt = Date.now();
    const dx = mob.x - p.x, dz = mob.z - p.z, d = Math.hypot(dx, dz) || 1;
    mob.kx = (dx / d) * 6; mob.kz = (dz / d) * 6;
    if (mob.onGround) mob.vy = 5;
    if (!T.hostile) { mob.flee = 5; mob.fleeFrom = [p.x, p.z]; }
    else mob.target = p.id;
    if (mob.hp <= 0) {
      this.mobs.delete(mob.id);
      const list = [];
      for (const [key, a, b] of T.drops) { const n = a + Math.floor(this.rand() * (b - a + 1)); if (n > 0) list.push([itemIdOf(key), n]); }
      if (mob.type === 'zombie' && this.rand() < 0.03) list.push([I.iron_ingot, 1]);
      this.give(p, list);
      this.sendInv(p);
      this.broadcast({ t: 'fx', k: 'mobdie', x: r1(mob.x), y: r1(mob.y + T.h / 2), z: r1(mob.z), type: mob.type });
    }
  }

  onEat(p, m) {
    const s = p.inv[m.s | 0];
    if (!s || p.dead) return;
    const it = ITEMS[s.id];
    if (!it || !it.food) return;
    if (p.food >= MAX_FOOD && !it.heal) return this.toast(p, '배가 불러요');
    p.food = Math.min(MAX_FOOD, p.food + it.food);
    if (it.heal) p.hp = Math.min(MAX_HP, p.hp + it.heal);
    if (s.id === I.rotten_flesh && this.rand() < 0.4) p.food = Math.max(0, p.food - 2);
    s.n--; if (s.n <= 0) p.inv[m.s | 0] = null;
    this.sendInv(p); this.sendYou(p);
    this.broadcast({ t: 'fx', k: 'eat', id: p.id }, p);
  }

  nearBlock(p, test, r = 5) {
    const bx = Math.floor(p.x), by = Math.floor(p.y + 1), bz = Math.floor(p.z);
    for (let y = by - r; y <= by + r; y++) for (let z = bz - r; z <= bz + r; z++) for (let x = bx - r; x <= bx + r; x++) if (test(this.getBlock(x, y, z))) return true;
    return false;
  }

  onCraft(p, m) {
    const r = RECIPES[m.r | 0];
    if (!r || p.dead) return;
    if (r.st === 'table' && !this.nearBlock(p, (b) => b === B.crafting_table)) return this.toast(p, '작업대 근처에서 만들 수 있어요');
    if (r.st === 'furnace' && !this.nearBlock(p, (b) => b >= 57 && b <= 60)) return this.toast(p, '화로 근처에서 만들 수 있어요');
    const n = clamp(m.n | 0, 1, 64);
    let made = 0;
    for (let i = 0; i < n; i++) { if (!craft(p.inv, r)) break; made++; }
    if (!made) this.toast(p, canCraft(p.inv, r) ? '만들 수 없어요' : '재료가 부족하거나 가방이 가득 찼어요');
    this.sendInv(p);
  }

  // 슬롯 a → b (0~35 가방, 100~126 열린 상자). 같은 아이템이면 합치고 아니면 바꿈
  onSwap(p, m) {
    const a = m.a | 0, b = m.b | 0, half = !!m.half;
    if (a === b || p.dead) return;
    const W = this.world;
    let chest = null;
    if (a >= 100 || b >= 100) {
      chest = p.openChest && W.containers[p.openChest];
      if (!chest) return;
      const [cx, cy, cz] = p.openChest.split(',').map(Number);
      if (!isChest(W.getBlock(cx, cy, cz)) || !this.reachable(p, cx, cy, cz, 3)) { p.openChest = null; return; }
    }
    const get = (i) => (i >= 100 ? (chest[i - 100] ? { id: chest[i - 100][0], n: chest[i - 100][1], d: chest[i - 100][2] } : null) : p.inv[i]);
    const put = (i, s) => {
      if (i >= 100) chest[i - 100] = s ? (s.d !== undefined ? [s.id, s.n, s.d] : [s.id, s.n]) : 0;
      else p.inv[i] = s;
    };
    const valid = (i) => (i >= 0 && i < INV_SIZE) || (i >= 100 && i < 100 + CHEST_SIZE);
    if (!valid(a) || !valid(b)) return;
    let A = get(a), Bs = get(b);
    if (!A) return;
    A = { ...A }; Bs = Bs ? { ...Bs } : null;
    if (half) {
      if (Bs || A.n < 2) return;
      const k = Math.floor(A.n / 2);
      put(b, { id: A.id, n: k, ...(A.d !== undefined ? { d: A.d } : {}) });
      A.n -= k; put(a, A);
    } else if (Bs && Bs.id === A.id && maxStack(A.id) > 1) {
      const k = Math.min(A.n, maxStack(A.id) - Bs.n);
      Bs.n += k; A.n -= k;
      put(b, Bs); put(a, A.n > 0 ? A : null);
    } else { put(b, A); put(a, Bs); }
    this.sendInv(p);
    if (chest) {
      W.dirty = true;
      for (const q of this.players.values()) if (q.openChest === p.openChest) this.send(q, { t: 'chest', k: p.openChest, s: chest });
    }
  }

  onTrash(p, m) {
    const a = m.a | 0;
    if (a >= 0 && a < INV_SIZE && p.inv[a]) { p.inv[a] = null; this.sendInv(p); }
  }

  onChat(p, m, now) {
    if (typeof m.m !== 'string' || now - p.lastChat < 900) return;
    const text = m.m.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
    if (!text) return;
    p.lastChat = now;
    if (text[0] === '/') {
      const cmd = text.slice(1).split(/\s+/)[0].toLowerCase();
      if (cmd === 'spawn' || cmd === 'home') {
        if (now - p.lastCmd < 20000) return this.toast(p, '잠시 후에 다시 쓸 수 있어요');
        let pos;
        if (cmd === 'home') {
          const rec = this.world.players[p.pid];
          if (!rec || !rec.spawn) return this.toast(p, '침대를 먼저 써 주세요');
          pos = this.spawnPoint(rec);
        } else pos = this.spawnPoint(null);
        p.lastCmd = now;
        return this.teleport(p, pos);
      }
      if (cmd === 'who') return this.toast(p, '접속 중: ' + [...this.players.values()].map((q) => q.name).join(', '));
      return this.toast(p, '명령어: /spawn /home /who');
    }
    this.broadcast({ t: 'chat', id: p.id, name: p.name, m: text });
  }

  teleport(p, pos) {
    const [x, y, z] = this.freeSpot(pos[0], pos[1], pos[2]);
    p.x = x; p.y = y; p.z = z; p.lastTp = Date.now();
    this.send(p, { t: 'tp', x, y, z });
  }

  onSign(p, m) {
    const c = this.cell(m);
    if (!c) return;
    const [x, y, z] = c;
    if (!isSign(this.getBlock(x, y, z)) || !this.reachable(p, x, y, z, 4)) return;
    const why = this.canEdit(p, x, z) && this.canUse(p, x, z);
    if (why) return this.toast(p, why);
    const text = String(m.text || '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').split('\n').slice(0, 4).map((l) => l.slice(0, 16)).join('\n');
    const k = bkey(x, y, z);
    this.world.signs[k] = text;
    this.world.dirty = true;
    this.broadcast({ t: 'sign', k, text });
  }

  onFall(p, m) {
    const d = +m.d;
    if (!Number.isFinite(d) || d < 3.5 || p.dead) return;
    this.hurt(p, Math.min(40, Math.floor(d - 3)), null, '높은 곳에서 떨어졌어요');
  }

  hurt(p, n, src, reason) {
    const now = Date.now();
    if (p.dead || n <= 0 || now < p.invuln) return;
    if (src && Math.hypot(p.x - this.spawn[0], p.z - this.spawn[2]) < SAFE_R) return;
    p.hp = Math.max(0, p.hp - n);
    p.invuln = now + 450;
    let kx = 0, kz = 0;
    if (src) { const dx = p.x - src.x, dz = p.z - src.z, d = Math.hypot(dx, dz) || 1; kx = dx / d; kz = dz / d; }
    this.send(p, { t: 'hurt', n, kx, kz });
    if (p.hp <= 0) this.kill(p, reason || (src ? '몬스터에게 당했어요' : '쓰러졌어요'));
    else this.sendYou(p);
  }

  kill(p, reason) {
    if (p.dead) return;
    p.dead = true; p.hp = 0; p.openChest = null;
    this.send(p, { t: 'died', reason });
    this.sendYou(p);
    this.broadcast({ t: 'chat', id: 0, m: `${p.name} 님이 쓰러졌어요 (${reason})` });
  }

  onRespawn(p) {
    if (!p.dead) return;
    p.dead = false; p.hp = MAX_HP; p.food = Math.max(p.food, 14); p.air = MAX_AIR;
    p.invuln = Date.now() + 3000;
    this.teleport(p, this.spawnPoint(this.world.players[p.pid]));
    this.sendYou(p);
  }

  // P2P: 다른 기기에 저장돼 있던 월드 변경을 합침 (호스트 쪽 변경이 우선)
  onMerge(p, m) {
    if (!this.p2p || p.merged || !m.save || typeof m.save !== 'object') return;
    p.merged = true;
    const W = this.world, s = m.save;
    if (s.v !== 3 || s.seed !== W.seed) return;
    let n = 0;
    if (s.mods && typeof s.mods === 'object') {
      for (const k in s.mods) {
        const list = s.mods[k];
        if (!Array.isArray(list) || !/^-?\d+,-?\d+$/.test(k)) continue;
        const have = W.mods.get(k);
        const [cx, cz] = k.split(',').map(Number);
        for (const e of list) {
          if (!Array.isArray(e)) continue;
          const i = e[0] | 0, id = e[1] | 0;
          if (i < 0 || i >= CS * CS * CH || !BLOCKS[id] || (have && have.has(i))) continue;
          const lx = i % CS, lz = ((i / CS) | 0) % CS, y = (i / (CS * CS)) | 0;
          this.setBlock(cx * CS + lx, y, cz * CS + lz, id);
          n++;
        }
      }
    }
    for (const key of ['signs', 'containers', 'crops', 'saplings']) {
      const src = s[key];
      if (src && typeof src === 'object') for (const k in src) if (W[key][k] === undefined) W[key][k] = src[k];
    }
    if (s.players && typeof s.players === 'object') for (const pid in s.players) if (!W.players[pid] && /^[0-9a-f]{16}$/.test(pid)) W.players[pid] = s.players[pid];
    if (Array.isArray(s.claims)) for (const c of s.claims) {
      if (!c || !Number.isInteger(c.x) || !Number.isInteger(c.z)) continue;
      if (W.claims.some((o) => Math.max(Math.abs(o.x - c.x), Math.abs(o.z - c.z)) <= CLAIM_R * 2)) continue;
      if (W.getBlock(c.x, c.y, c.z) === B.flag) W.claims.push(c);
    }
    if (n) {
      this.log(`[merge] ${n} edits from ${p.name}`);
      this.broadcast({ t: 'signs', signs: W.signs });
      this.broadcast({ t: 'claims', c: this.claimsWire() });
    }
  }

  // ---------------- 시뮬레이션 ----------------
  tick(dt) {
    const now = Date.now();
    const t = this.time();
    this.tickN++;
    for (const p of this.players.values()) this.tickPlayer(p, dt, now);
    this.tickMobs(dt, now, t);
    this.acc.spawn += dt;
    if (this.acc.spawn >= 1) { this.acc.spawn = 0; this.spawnHostile(t); }
    this.acc.passive += dt;
    if (this.acc.passive >= 4) { this.acc.passive = 0; this.spawnPassive(t); }
    this.acc.crops += dt;
    if (this.acc.crops >= 2) { this.acc.crops = 0; this.growPlants(now); }
    if (this.edits.length) { this.broadcast({ t: 'bs', l: this.edits }); this.edits = []; }
    if (this.tickN % 2 === 0) this.broadcastState(now);
    if (this.p2p) {
      this.acc.snap += dt;
      if (this.acc.snap >= 20) { this.acc.snap = 0; this.sendSnapshot(); }
    }
    this.acc.sweep += dt;
    if (this.acc.sweep >= 30) {
      this.acc.sweep = 0;
      const keep = new Set();
      const add = (x, z) => { const cx = Math.floor(x / CS), cz = Math.floor(z / CS); for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) keep.add(ckey(cx + a, cz + b)); };
      for (const p of this.players.values()) add(p.x, p.z);
      for (const m of this.mobs.values()) add(m.x, m.z);
      this.world.sweep(keep);
    }
  }

  tickPlayer(p, dt, now) {
    if (p.dead) return;
    const sprint = p.fl & 2;
    p.foodT += dt * (sprint ? 2.2 : 1);
    if (p.foodT >= 45) { p.foodT = 0; if (p.food > 0) p.food--; }
    if (p.food >= 16 && p.hp < MAX_HP) {
      p.regenT += dt;
      if (p.regenT >= 3) { p.regenT = 0; p.hp++; if (++p.regenN % 3 === 0 && p.food > 0) p.food--; }
    } else p.regenT = 0;
    if (p.food <= 0) {
      p.starveT += dt;
      if (p.starveT >= 6) { p.starveT = 0; if (p.hp > 1) this.hurt(p, 1, null, '굶주렸어요'); }
    }
    const head = this.getBlock(Math.floor(p.x), Math.floor(p.y + EYE), Math.floor(p.z));
    if (head === B.water) {
      p.air = Math.max(0, p.air - dt);
      if (p.air <= 0) { p.drownT += dt; if (p.drownT >= 1) { p.drownT = 0; this.hurt(p, 2, null, '물에 빠졌어요'); } }
    } else p.air = Math.min(MAX_AIR, p.air + dt * 4);
    if (this.tickN % 4 === 0) this.sendYou(p);
  }

  // ---------- 몬스터 ----------
  addMob(type, x, y, z) {
    const T = MOB[type];
    const id = this.nextMob++;
    const m = { id, type, x, y, z, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0, yaw: this.rand() * 6.28, hp: T.hp, onGround: false, w: T.w, h: T.h, hurtAt: 0, atkCd: 0, hopCd: 0, goal: null, goalT: 0, flee: 0, fleeFrom: null, target: 0, burn: 0, anim: 0, age: 0 };
    this.mobs.set(id, m);
    return m;
  }

  tickMobs(dt, now, t) {
    const W = this.world;
    const day = !isNight(t) && daylight(t) > 0.5;
    const players = [...this.players.values()].filter((p) => !p.dead);
    for (const m of this.mobs.values()) {
      const T = MOB[m.type];
      m.age += dt;
      // 플레이어와 멀어지면 사라짐
      let nearest = null, nd = 1e9;
      for (const p of players) {
        const d = Math.hypot(p.x - m.x, p.y - m.y, p.z - m.z);
        if (d < nd) { nd = d; nearest = p; }
      }
      if (nd > 80) { this.mobs.delete(m.id); continue; }
      let dx = 0, dz = 0, speed = 0;
      m.anim = 0;
      if (T.hostile) {
        let tgt = null;
        if (m.target) { tgt = this.players.get(m.target); if (!tgt || tgt.dead || Math.hypot(tgt.x - m.x, tgt.z - m.z) > 30) tgt = null; }
        if (!tgt && nearest && nd < 22 && Math.hypot(nearest.x - this.spawn[0], nearest.z - this.spawn[2]) >= SAFE_R) tgt = nearest;
        m.target = tgt ? tgt.id : 0;
        if (tgt) {
          dx = tgt.x - m.x; dz = tgt.z - m.z;
          const d = Math.hypot(dx, dz) || 1;
          dx /= d; dz /= d; speed = T.speed;
          m.atkCd -= dt;
          if (d < 1.3 && Math.abs(tgt.y - m.y) < 1.6 && m.atkCd <= 0) {
            m.atkCd = 1.1; m.anim = 1;
            this.hurt(tgt, T.dmg, m, m.type === 'zombie' ? '좀비에게 당했어요' : '슬라임에게 당했어요');
          }
          if (d < 0.9) speed = 0;
        } else this.wander(m, now, T, (a, b, s) => { dx = a; dz = b; speed = s; });
        // 햇빛에 타는 좀비 / 낮에 사라지는 슬라임
        if (day) {
          const exposed = W.topY(Math.floor(m.x), Math.floor(m.z)) <= Math.floor(m.y + T.h);
          if (exposed) {
            m.burn += dt;
            if (m.burn >= 1) { m.burn = 0; m.hp -= m.type === 'zombie' ? 2 : 3; m.hurtAt = now; }
            if (m.hp <= 0) { this.mobs.delete(m.id); this.broadcast({ t: 'fx', k: 'mobdie', x: r1(m.x), y: r1(m.y + T.h / 2), z: r1(m.z), type: m.type }); continue; }
          }
        }
      } else if (m.flee > 0) {
        m.flee -= dt;
        dx = m.x - m.fleeFrom[0]; dz = m.z - m.fleeFrom[1];
        const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d; speed = T.speed * 1.9;
      } else this.wander(m, now, T, (a, b, s) => { dx = a; dz = b; speed = s; });

      if (T.hostile && Math.hypot(m.x + dx - this.spawn[0], m.z + dz - this.spawn[2]) < SAFE_R) speed = 0; // 스폰 광장에 못 들어옴

      // 이동
      if (T.hop) {
        m.hopCd -= dt;
        if (m.onGround) {
          m.vx *= 0.5; m.vz *= 0.5;
          if (speed > 0 && m.hopCd <= 0) { m.hopCd = 0.8 + this.rand() * 0.8; m.vy = 7.5; m.vx = dx * speed; m.vz = dz * speed; }
        }
      } else {
        const acc = m.onGround ? 10 : 3;
        m.vx += (dx * speed - m.vx) * Math.min(1, acc * dt);
        m.vz += (dz * speed - m.vz) * Math.min(1, acc * dt);
      }
      const inWater = this.getBlock(Math.floor(m.x), Math.floor(m.y + 0.4), Math.floor(m.z)) === B.water;
      if (inWater) m.vy = Math.min(m.vy + 28 * dt, 2.2);
      else m.vy -= 26 * dt;
      if (T.flap && m.vy < -3) m.vy = -3;
      m.vy = Math.max(m.vy, -40);
      const kx = m.kx, kz = m.kz;
      m.kx *= Math.pow(0.02, dt); m.kz *= Math.pow(0.02, dt);
      const res = moveEntity(m, (m.vx + kx) * dt, m.vy * dt, (m.vz + kz) * dt, this.getBlock, T.hop ? 0 : 0.6);
      m.onGround = res.onGround;
      if (res.hitY) m.vy = 0;
      if ((res.hitX || res.hitZ) && m.onGround && !T.hop && speed > 0) m.vy = 8.2;
      if (Math.abs(m.vx) + Math.abs(m.vz) > 0.05) m.yaw = Math.atan2(-m.vx, -m.vz);
      if (m.y < -10) this.mobs.delete(m.id);
    }
  }

  wander(m, now, T, set) {
    if (!m.goal || now > m.goalT) {
      if (this.rand() < 0.35) { m.goal = null; m.goalT = now + 2000 + this.rand() * 4000; }
      else { m.goal = [m.x + (this.rand() - 0.5) * 16, m.z + (this.rand() - 0.5) * 16]; m.goalT = now + 4000 + this.rand() * 5000; }
    }
    if (!m.goal) return set(0, 0, 0);
    let dx = m.goal[0] - m.x, dz = m.goal[1] - m.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.6) { m.goal = null; return set(0, 0, 0); }
    set(dx / d, dz / d, T.speed * 0.6);
  }

  countMobs(p, hostile, r) {
    let n = 0;
    for (const m of this.mobs.values()) if (!!MOB[m.type].hostile === hostile && Math.abs(m.x - p.x) < r && Math.abs(m.z - p.z) < r) n++;
    return n;
  }

  spawnHostile(t) {
    const W = this.world;
    if (this.mobs.size > 90) return;
    const night = isNight(t);
    for (const p of this.players.values()) {
      if (p.dead || Date.now() - p.joinedAt < 8000) continue;
      if (this.countMobs(p, true, 40) >= 6) continue;
      const px = Math.floor(p.x), pz = Math.floor(p.z);
      const underground = p.y < W.topY(px, pz) - 6;
      if (night && !underground && this.rand() < 0.7) {
        const a = this.rand() * Math.PI * 2, d = 18 + this.rand() * 14;
        const x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
        if (Math.hypot(x - this.spawn[0], z - this.spawn[2]) < SAFE_R + 6) continue;
        const y = W.topY(x, z);
        const g = W.getBlock(x, y, z);
        if (![B.grass, B.sand, B.stone, B.dirt, B.snowy_grass, B.snow, B.gravel, B.sandstone].includes(g)) continue;
        if (W.getBlock(x, y + 1, z) || W.getBlock(x, y + 2, z)) continue;
        if (W.litNear(x, y + 1, z, 9)) continue;
        this.addMob(this.rand() < 0.72 ? 'zombie' : 'slime', x + 0.5, y + 1, z + 0.5);
      } else if (underground && this.rand() < 0.45) {
        const x = px + Math.floor((this.rand() - 0.5) * 36), z = pz + Math.floor((this.rand() - 0.5) * 36);
        if (Math.hypot(x - p.x, z - p.z) < 10) continue;
        for (let y = Math.floor(p.y) + 8; y > Math.floor(p.y) - 8 && y > 2; y--) {
          if (SOLID[W.getBlock(x, y - 1, z)] && OPAQUE[W.getBlock(x, y - 1, z)] && !W.getBlock(x, y, z) && !W.getBlock(x, y + 1, z)) {
            if (y < W.topY(x, z) - 4 && !W.litNear(x, y, z, 9)) this.addMob(this.rand() < 0.75 ? 'zombie' : 'slime', x + 0.5, y, z + 0.5);
            break;
          }
        }
      }
    }
  }

  spawnPassive(t) {
    const W = this.world;
    if (isNight(t)) return;
    for (const p of this.players.values()) {
      if (p.dead || this.countMobs(p, false, 64) >= 8) continue;
      const a = this.rand() * Math.PI * 2, d = 24 + this.rand() * 24;
      const x = Math.floor(p.x + Math.cos(a) * d), z = Math.floor(p.z + Math.sin(a) * d);
      if (Math.hypot(x - this.spawn[0], z - this.spawn[2]) < SAFE_R) continue;
      const y = W.topY(x, z);
      if (W.getBlock(x, y, z) !== B.grass || W.getBlock(x, y + 1, z) > 0 && BLOCKS[W.getBlock(x, y + 1, z)].solid) continue;
      const type = ['pig', 'sheep', 'chicken'][Math.floor(this.rand() * 3)];
      const n = 2 + Math.floor(this.rand() * 2);
      for (let i = 0; i < n; i++) {
        const sx = x + Math.floor((this.rand() - 0.5) * 4), sz = z + Math.floor((this.rand() - 0.5) * 4);
        const sy = W.topY(sx, sz);
        if (W.getBlock(sx, sy, sz) === B.grass && !SOLID[W.getBlock(sx, sy + 1, sz)] && !SOLID[W.getBlock(sx, sy + 2, sz)]) this.addMob(type, sx + 0.5, sy + 1, sz + 0.5);
      }
    }
  }

  growPlants(now) {
    const W = this.world;
    for (const k in W.crops) {
      if (now < W.crops[k]) continue;
      const [x, y, z] = k.split(',').map(Number);
      const id = W.getBlock(x, y, z);
      if (!isWheat(id) || BLOCKS[id].stage >= 7) { delete W.crops[k]; continue; }
      this.setBlock(x, y, z, id + 1);
      if (BLOCKS[id + 1].stage >= 7) delete W.crops[k]; else W.crops[k] = now + this.growTime();
    }
    for (const k in W.saplings) {
      if (now < W.saplings[k]) continue;
      const [x, y, z] = k.split(',').map(Number);
      const id = W.getBlock(x, y, z);
      if (!isSapling(id)) { delete W.saplings[k]; continue; }
      const type = id === B.sapling_birch ? 'birch' : id === B.sapling_spruce ? 'spruce' : 'oak';
      const blocks = W.gen.treeBlocks(type, x, y, z, mulberry32((x * 31 + z * 17 + now) >>> 0));
      const ok = blocks.every(([bx, by, bz]) => by < CH && (bx === x && bz === z && by === y || !SOLID[W.getBlock(bx, by, bz)] || W.getBlock(bx, by, bz) === B.leaves_oak));
      if (!ok) { W.saplings[k] = now + 60000; continue; }
      delete W.saplings[k];
      for (const [bx, by, bz, bid] of blocks) {
        const cur = W.getBlock(bx, by, bz);
        if (cur === 0 || BLOCKS[cur].replaceable || (bx === x && bz === z && by === y) || (BLOCKS[cur].key.startsWith('leaves') && !BLOCKS[bid].key.startsWith('leaves'))) this.setBlock(bx, by, bz, bid);
      }
    }
  }

  broadcastState(now) {
    const ps = [...this.players.values()];
    const mobs = [...this.mobs.values()];
    for (const p of ps) {
      if (p.ws.readyState !== 1 || p.ws.bufferedAmount > 2e6) continue;
      const pl = [], ml = [];
      for (const q of ps) {
        if (q === p || q.dead || Math.abs(q.x - p.x) > 100 || Math.abs(q.z - p.z) > 100) continue;
        const h = q.inv[q.held];
        pl.push([q.id, r1(q.x), r1(q.y), r1(q.z), r1(q.yaw), r1(q.pitch), q.fl, h ? h.id : 0, q.hp]);
      }
      for (const m of mobs) {
        if (Math.abs(m.x - p.x) > 72 || Math.abs(m.z - p.z) > 72) continue;
        const fl = (now - m.hurtAt < 300 ? 1 : 0) | (m.burn > 0 && m.type === 'zombie' && !isNight(this.time()) ? 2 : 0) | (m.anim ? 4 : 0) | (m.onGround ? 0 : 8);
        ml.push([m.id, MOB_TYPES.indexOf(m.type), r1(m.x), r1(m.y), r1(m.z), r1(m.yaw), m.hp, fl]);
      }
      p.ws.send(JSON.stringify({ t: 's', tm: now, on: ps.length, p: pl, m: ml }));
    }
  }

  // P2P 손님에게 월드 사본 일부 전달 (호스트가 나가면 이어받을 수 있게)
  sendSnapshot() {
    this.syncAll();
    const W = this.world;
    const snap = { players: W.players, containers: W.containers, crops: W.crops, saplings: W.saplings, claims: W.claims, epoch: W.epoch };
    const s = JSON.stringify({ t: 'snap', d: snap });
    if (s === this.lastSnap) return;
    this.lastSnap = s;
    for (const q of this.players.values()) if (!q.ws.local && q.ws.readyState === 1) q.ws.send(s);
  }
}


// 연결 하나를 게임에 연결 (Node ws, P2P 연결, 로컬 루프백 공용)
// ws: { send(str), close(code), readyState, bufferedAmount, local? }
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
