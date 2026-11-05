import crypto from 'node:crypto';
import {
  CHUNK, T, isSolidTile, SPEED, PLAYER_R, MOB_R, REACH, SAFE_R, CLAIM_R,
  MAX_HP, MAX_FLAGS, BUILD, DROPS, DAY_LEN, mobTime, inSafe, moveEntity,
} from '../public/js/shared.js';

const MAX_PLAYERS = 100;
const MAX_MOBS = 120;
const r2 = (n) => Math.round(n * 100) / 100;
const ck = (cx, cy) => cx + ',' + cy;

function sanitizeName(s) {
  if (typeof s !== 'string') return '';
  return s.normalize('NFC').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 12);
}

export class Game {
  constructor(world) {
    this.world = world;
    this.players = new Map(); // id -> player
    this.byPid = new Map();
    this.mobs = new Map();
    this.nextId = 1;
    this.nextMobId = 1;
    this.tickN = 0;
    this.spawnAcc = 0;
    this.dieAcc = 0;
    this.lastSweep = Date.now();
    this.solidAt = (x, y) => isSolidTile(this.world.tileAt(x, y));
    this.mobSolidAt = (x, y) => this.solidAt(x, y) || inSafe(x + 0.5, y + 0.5);
  }

  timeOfDay() {
    return (((Date.now() - this.world.epoch) / 1000) % DAY_LEN) / DAY_LEN;
  }

  // ---------- 접속/해제 ----------
  join(ws, msg) {
    const token = typeof msg.token === 'string' ? msg.token : '';
    if (token.length < 16 || token.length > 80) return ws.close(4001, 'bad token');
    const pid = crypto.createHash('sha256').update(token).digest('hex').slice(0, 16);

    const old = this.byPid.get(pid);
    if (old) { old.ws.close(4000, 'duplicate'); this.remove(old); }
    if (this.players.size >= MAX_PLAYERS) {
      this.send({ ws }, { t: 'err', m: '서버가 가득 찼어요. 잠시 후 다시 시도해 주세요.' });
      return ws.close(4002, 'full');
    }

    const rec = (this.world.players[pid] ||= { name: '', inv: { wood: 10, stone: 0 }, kills: 0 });
    const name = sanitizeName(msg.name) || rec.name || 'Guest' + (1000 + Math.floor(Math.random() * 9000));
    rec.name = name;
    this.world.dirty = true;

    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)) | 0;
    const p = {
      id: this.nextId++, pid, tag: pid.slice(0, 8), name, color: Math.abs(h) % 8, ws,
      x: (Math.random() - 0.5) * 4, y: (Math.random() - 0.5) * 4,
      hp: MAX_HP, inv: rec.inv, kills: rec.kills,
      dx: 0, dy: 0, inputAt: 0,
      loaded: new Set(), pcx: null, pcy: null,
      lastAtk: 0, lastAct: 0, lastChat: 0, lastHurt: 0, regenAcc: 0,
      msgBudget: 60, msgRefill: Date.now(),
    };
    this.players.set(p.id, p);
    this.byPid.set(pid, p);
    ws.player = p;

    this.send(p, { t: 'welcome', id: p.id, tag: p.tag, name, x: r2(p.x), y: r2(p.y) });
    for (const q of this.players.values())
      this.send(p, { t: 'pl', id: q.id, name: q.name, color: q.color });
    this.broadcast({ t: 'pl', id: p.id, name, color: p.color }, p);
    this.send(p, this.claimsMsg());
    this.ensureChunks(p);
    this.broadcast({ t: 'chat', id: 0, name: '', m: `${name} 님이 입장했어요` });
    console.log(`[join] ${name} (#${p.id}) online=${this.players.size}`);
  }

  remove(p) {
    if (!this.players.delete(p.id)) return;
    if (this.byPid.get(p.pid) === p) this.byPid.delete(p.pid);
    this.syncRecord(p);
    this.broadcast({ t: 'pq', id: p.id });
    this.broadcast({ t: 'chat', id: 0, name: '', m: `${p.name} 님이 나갔어요` });
    console.log(`[leave] ${p.name} (#${p.id}) online=${this.players.size}`);
  }

  syncRecord(p) {
    const rec = this.world.players[p.pid];
    if (rec) { rec.kills = p.kills; rec.inv = p.inv; rec.name = p.name; }
  }
  syncAll() { for (const p of this.players.values()) this.syncRecord(p); }

  // ---------- 전송 ----------
  send(p, obj) {
    const ws = p.ws;
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }
  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const q of this.players.values())
      if (q !== except && q.ws.readyState === 1) q.ws.send(s);
  }
  claimsMsg() {
    return { t: 'claims', c: this.world.claims.map((c) => [c.x, c.y, c.name, c.owner.slice(0, 8)]) };
  }

  ensureChunks(p) {
    const cx = Math.floor(p.x / CHUNK), cy = Math.floor(p.y / CHUNK);
    if (cx === p.pcx && cy === p.pcy) return;
    p.pcx = cx; p.pcy = cy;
    for (let j = -2; j <= 2; j++)
      for (let i = -2; i <= 2; i++) {
        const k = ck(cx + i, cy + j);
        if (p.loaded.has(k)) continue;
        p.loaded.add(k);
        this.send(p, { t: 'c', cx: cx + i, cy: cy + j, d: this.world.chunkString(cx + i, cy + j) });
      }
    for (const k of p.loaded) {
      const [a, b] = k.split(',').map(Number);
      if (Math.max(Math.abs(a - cx), Math.abs(b - cy)) > 3) p.loaded.delete(k);
    }
  }

  setTile(x, y, v) {
    this.world.setTile(x, y, v);
    const k = ck(Math.floor(x / CHUNK), Math.floor(y / CHUNK));
    const msg = JSON.stringify({ t: 'tile', x, y, v });
    for (const q of this.players.values())
      if (q.loaded.has(k) && q.ws.readyState === 1) q.ws.send(msg);
  }

  // ---------- 클라이언트 입력 ----------
  handle(p, msg) {
    const now = Date.now();
    if (now - p.msgRefill > 1000) { p.msgBudget = 60; p.msgRefill = now; }
    if (--p.msgBudget < 0) return;
    if (!msg || typeof msg !== 'object') return;

    switch (msg.t) {
      case 'in': {
        let dx = Number(msg.dx), dy = Number(msg.dy);
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
        const m = Math.hypot(dx, dy);
        if (m > 1) { dx /= m; dy /= m; }
        p.dx = dx; p.dy = dy; p.inputAt = now;
        break;
      }
      case 'name': {
        const name = sanitizeName(msg.name);
        if (!name || name === p.name || now - p.lastChat < 1200) return;
        p.lastChat = now;
        const old = p.name;
        p.name = name;
        this.syncRecord(p);
        this.world.dirty = true;
        this.broadcast({ t: 'pl', id: p.id, name, color: p.color });
        this.broadcast({ t: 'chat', id: 0, name: '', m: `${old} 님이 ${name}(으)로 이름을 바꿨어요` });
        break;
      }
      case 'break': this.doBreak(p, msg, now); break;
      case 'place': this.doPlace(p, msg, now); break;
      case 'atk': this.doAttack(p, now); break;
      case 'chat': {
        if (typeof msg.m !== 'string' || now - p.lastChat < 1200) return;
        const text = msg.m.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
        if (!text) return;
        p.lastChat = now;
        this.broadcast({ t: 'chat', id: p.id, name: p.name, m: text });
        break;
      }
    }
  }

  // 편집 권한: 마을은 보호, 남의 깃발 영역은 수정 불가
  editBlock(p, x, y) {
    if (Math.hypot(x + 0.5, y + 0.5) < SAFE_R) return '마을 안에서는 건축/채집할 수 없어요';
    for (const c of this.world.claims)
      if (c.owner !== p.pid && Math.abs(x - c.x) <= CLAIM_R && Math.abs(y - c.y) <= CLAIM_R)
        return `${c.name} 님의 땅이에요`;
    return null;
  }

  parseTarget(p, msg, now) {
    const x = msg.x, y = msg.y;
    if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
    if (now - p.lastAct < 90) return null;
    if (Math.hypot(x + 0.5 - p.x, y + 0.5 - p.y) > REACH) {
      this.send(p, { t: 'err', m: '너무 멀어요' });
      return null;
    }
    p.lastAct = now;
    return { x, y };
  }

  doBreak(p, msg, now) {
    const tg = this.parseTarget(p, msg, now);
    if (!tg) return;
    const { x, y } = tg;
    const v = this.world.tileAt(x, y);
    const drop = DROPS[v];
    if (!drop) return;
    const why = this.editBlock(p, x, y);
    if (why) return this.send(p, { t: 'err', m: why });
    if (v === T.FLAG) {
      const i = this.world.claims.findIndex((c) => c.x === x && c.y === y);
      if (i >= 0) {
        if (this.world.claims[i].owner !== p.pid) return this.send(p, { t: 'err', m: '남의 깃발이에요' });
        this.world.claims.splice(i, 1);
        this.world.dirty = true;
        this.broadcast(this.claimsMsg());
      }
    }
    for (const [k, n] of Object.entries(drop)) p.inv[k] = (p.inv[k] || 0) + n;
    this.setTile(x, y, this.world.baseGround(x, y));
  }

  doPlace(p, msg, now) {
    const def = BUILD[msg.k];
    if (!def) return;
    const tg = this.parseTarget(p, msg, now);
    if (!tg) return;
    const { x, y } = tg;
    const v = this.world.tileAt(x, y);
    const isFloor = def.tile === T.FLOOR;
    const okTarget = isFloor ? (v === T.WATER || v === T.SAND || v === T.GRASS)
                             : (v === T.SAND || v === T.GRASS || v === T.FLOOR);
    if (!okTarget) return this.send(p, { t: 'err', m: '여기엔 놓을 수 없어요' });
    const why = this.editBlock(p, x, y);
    if (why) return this.send(p, { t: 'err', m: why });
    for (const [k, n] of Object.entries(def.cost))
      if ((p.inv[k] || 0) < n) return this.send(p, { t: 'err', m: '재료가 부족해요' });

    if (def.tile !== T.FLOOR) { // 사람/몬스터가 서 있는 칸엔 못 놓음
      const near = (e) => Math.hypot(e.x - (x + 0.5), e.y - (y + 0.5)) < 0.9;
      for (const q of this.players.values()) if (near(q)) return this.send(p, { t: 'err', m: '누가 서 있어요' });
      for (const m of this.mobs.values()) if (near(m)) return this.send(p, { t: 'err', m: '몬스터가 있어요' });
    }
    if (def.tile === T.FLAG) {
      const mine = this.world.claims.filter((c) => c.owner === p.pid).length;
      if (mine >= MAX_FLAGS) return this.send(p, { t: 'err', m: `깃발은 최대 ${MAX_FLAGS}개까지예요` });
      if (Math.hypot(x, y) < SAFE_R + 3) return this.send(p, { t: 'err', m: '마을에서 더 떨어진 곳에 세워요' });
      for (const c of this.world.claims)
        if (Math.max(Math.abs(c.x - x), Math.abs(c.y - y)) <= CLAIM_R * 2)
          return this.send(p, { t: 'err', m: '다른 깃발 영역과 겹쳐요' });
      this.world.claims.push({ x, y, owner: p.pid, name: p.name });
      this.world.dirty = true;
    }
    for (const [k, n] of Object.entries(def.cost)) p.inv[k] -= n;
    this.setTile(x, y, def.tile);
    if (def.tile === T.FLAG) this.broadcast(this.claimsMsg());
  }

  doAttack(p, now) {
    if (now - p.lastAtk < 350) return;
    p.lastAtk = now;
    let best = null, bd = 2.0;
    for (const m of this.mobs.values()) {
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d < bd) { bd = d; best = m; }
    }
    if (!best) return;
    best.hp -= 1;
    if (best.hp <= 0) {
      this.mobs.delete(best.id);
      p.kills++; this.world.dirty = true;
      p.inv.wood = (p.inv.wood || 0) + 1;
      return;
    }
    const d = bd || 1;
    moveEntity(best, (best.x - p.x) / d, (best.y - p.y) / d, 0.7, MOB_R, this.mobSolidAt);
  }

  // ---------- 시뮬레이션 ----------
  hurt(p, n, now) {
    if (inSafe(p.x, p.y)) return;
    p.hp -= n;
    p.lastHurt = now;
    this.send(p, { t: 'ev', k: 'hurt' });
    if (p.hp <= 0) {
      p.hp = MAX_HP;
      p.x = (Math.random() - 0.5) * 4; p.y = (Math.random() - 0.5) * 4;
      p.dx = p.dy = 0;
      this.send(p, { t: 'ev', k: 'died', x: r2(p.x), y: r2(p.y) });
    }
  }

  tick(dt) {
    const now = Date.now();
    const tod = this.timeOfDay();
    this.tickN++;

    for (const p of this.players.values()) {
      if (now - p.inputAt > 500) { p.dx = 0; p.dy = 0; }
      if (p.dx || p.dy) moveEntity(p, p.dx, p.dy, SPEED * dt, PLAYER_R, this.solidAt);
      this.ensureChunks(p);
      if (p.hp < MAX_HP && now - p.lastHurt > 5000) {
        p.regenAcc += dt;
        if (p.regenAcc >= (inSafe(p.x, p.y) ? 1 : 3)) { p.regenAcc = 0; p.hp++; }
      }
    }

    // 몬스터
    for (const m of this.mobs.values()) {
      let target = null, bd = 14 * 14;
      for (const p of this.players.values()) {
        if (inSafe(p.x, p.y)) continue;
        const d = (p.x - m.x) ** 2 + (p.y - m.y) ** 2;
        if (d < bd) { bd = d; target = p; }
      }
      m.hop += dt;
      if (!target) continue;
      const d = Math.sqrt(bd) || 1;
      const sp = 0.8 + 2.4 * Math.max(0, Math.sin(m.hop * 5));
      moveEntity(m, (target.x - m.x) / d, (target.y - m.y) / d, sp * dt, MOB_R, this.mobSolidAt);
      if (d < 0.8 && now - m.hitAt > 1000) { m.hitAt = now; this.hurt(target, 1, now); }
    }

    // 스폰/디스폰 (1초마다)
    this.spawnAcc += dt;
    if (this.spawnAcc >= 1) {
      this.spawnAcc = 0;
      if (mobTime(tod)) this.spawnMobs();
      else if (this.mobs.size) { // 낮이 되면 햇빛에 사라짐
        for (const m of this.mobs.values()) if (Math.random() < 0.3) this.mobs.delete(m.id);
      }
      for (const m of this.mobs.values()) { // 플레이어에게서 멀어진 몬스터 정리
        let near = false;
        for (const p of this.players.values())
          if (Math.abs(p.x - m.x) < 45 && Math.abs(p.y - m.y) < 45) { near = true; break; }
        if (!near) this.mobs.delete(m.id);
      }
    }

    if (this.tickN % 2 === 0) this.broadcastState(tod);

    if (now - this.lastSweep > 30000) {
      this.lastSweep = now;
      const active = new Set();
      for (const p of this.players.values()) for (const k of p.loaded) active.add(k);
      this.world.sweep(active);
    }
  }

  spawnMobs() {
    for (const p of this.players.values()) {
      if (this.mobs.size >= MAX_MOBS) return;
      let near = 0;
      for (const m of this.mobs.values())
        if (Math.abs(m.x - p.x) < 26 && Math.abs(m.y - p.y) < 26) near++;
      if (near >= 6) continue;
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2, d = 13 + Math.random() * 5;
        const x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
        const tx = Math.floor(x), ty = Math.floor(y);
        const v = this.world.tileAt(tx, ty);
        if (v !== T.GRASS && v !== T.SAND) continue;
        if (Math.hypot(x, y) < SAFE_R + 1) continue;
        const id = this.nextMobId++;
        this.mobs.set(id, { id, x, y, hp: 3, hop: Math.random() * 6, hitAt: 0 });
        break;
      }
    }
  }

  broadcastState(tod) {
    const R2 = 34 * 34;
    for (const p of this.players.values()) {
      if (p.ws.readyState !== 1 || p.ws.bufferedAmount > 1e6) continue;
      const pl = [], ml = [];
      for (const q of this.players.values())
        if (q !== p && (q.x - p.x) ** 2 + (q.y - p.y) ** 2 < R2) pl.push([q.id, r2(q.x), r2(q.y), q.hp]);
      for (const m of this.mobs.values())
        if ((m.x - p.x) ** 2 + (m.y - p.y) ** 2 < R2) ml.push([m.id, r2(m.x), r2(m.y), m.hp]);
      p.ws.send(JSON.stringify({
        t: 's', tm: r2(tod * 1000) / 1000, on: this.players.size,
        you: [r2(p.x), r2(p.y), p.hp, p.inv.wood || 0, p.inv.stone || 0, p.kills],
        p: pl, m: ml,
      }));
    }
  }
}
