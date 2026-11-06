// 호스트가 들고 있는 권위 월드 (서버/브라우저 공용, 저장은 바깥에서)
import { createGenerator, defaultSigns } from '../shared/worldgen.js';
import { CS, CH, WORLD_SEED, DAY_LEN, ckey, idx, bkey } from '../shared/constants.js';
import { LIGHT, OPAQUE, SOLID } from '../shared/blocks.js';

export class World {
  constructor(saved) {
    const ok = saved && saved.v === 3 && saved.seed === WORLD_SEED;
    this.seed = WORLD_SEED;
    this.gen = createGenerator(this.seed);
    this.epoch = ok && Number.isFinite(saved.epoch) ? saved.epoch : Date.now() - 0.06 * DAY_LEN * 1000;
    this.mods = new Map();
    this.players = (ok && saved.players) || {};
    this.claims = (ok && saved.claims) || [];
    this.containers = (ok && saved.containers) || {};
    this.signs = Object.assign({}, (ok && saved.signs) || {}, defaultSigns(this.gen.plazaY)); // 스폰 표지판은 항상 최신 문구
    this.crops = (ok && saved.crops) || {};
    this.saplings = (ok && saved.saplings) || {};
    this.chunks = new Map();
    this.dirty = !ok;
    this.isNew = !ok;
    if (ok && saved.mods) this.loadMods(saved.mods);
  }

  loadMods(obj) {
    for (const k in obj) {
      const list = obj[k];
      if (!Array.isArray(list)) continue;
      let m = this.mods.get(k);
      if (!m) this.mods.set(k, (m = new Map()));
      for (const e of list) if (Array.isArray(e)) m.set(e[0] | 0, e[1] | 0);
    }
  }

  modsObject() {
    const o = {};
    for (const [k, m] of this.mods) if (m.size) o[k] = [...m];
    return o;
  }
  modCount() { let n = 0; for (const m of this.mods.values()) n += m.size; return n; }

  serialize() {
    return {
      v: 3, seed: this.seed, epoch: this.epoch, ts: Date.now(), mods: this.modsObject(),
      players: this.players, claims: this.claims, containers: this.containers,
      signs: this.signs, crops: this.crops, saplings: this.saplings,
    };
  }

  chunk(cx, cz) {
    const k = ckey(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      const v = this.gen.genChunk(cx, cz);
      const m = this.mods.get(k);
      if (m) for (const [i, id] of m) v[i] = id;
      c = { v, touched: 0, emit: null };
      this.chunks.set(k, c);
    }
    c.touched = Date.now();
    return c;
  }

  getBlock(x, y, z) {
    if (y < 0) return 6;
    if (y >= CH) return 0;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    return this.chunk(cx, cz).v[idx(x - cx * CS, y, z - cz * CS)];
  }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= CH) return false;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS), k = ckey(cx, cz);
    const c = this.chunk(cx, cz);
    const i = idx(x - cx * CS, y, z - cz * CS);
    if (c.v[i] === id) return false;
    if (LIGHT[c.v[i]] || LIGHT[id]) c.emit = null;
    c.v[i] = id;
    let m = this.mods.get(k);
    if (!m) this.mods.set(k, (m = new Map()));
    m.set(i, id);
    this.dirty = true;
    return true;
  }

  // 빛을 내는 블록 목록 (몬스터 스폰 억제용)
  emitters(cx, cz) {
    const c = this.chunk(cx, cz);
    if (!c.emit) {
      c.emit = [];
      const v = c.v;
      for (let i = 0; i < v.length; i++) if (LIGHT[v[i]]) c.emit.push([cx * CS + (i % CS), (i / (CS * CS)) | 0, cz * CS + (((i / CS) | 0) % CS)]);
    }
    return c.emit;
  }
  litNear(x, y, z, r) {
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++)
      for (const e of this.emitters(cx + dx, cz + dz)) if (Math.abs(e[0] - x) + Math.abs(e[1] - y) + Math.abs(e[2] - z) <= r) return true;
    return false;
  }

  // 가장 높은 불투명 블록의 y
  topY(x, z) {
    for (let y = CH - 1; y > 0; y--) if (OPAQUE[this.getBlock(x, y, z)]) return y;
    return 0;
  }
  solidAt(x, y, z) { return SOLID[this.getBlock(x, y, z)] === 1; }

  sweep(activeKeys) {
    const now = Date.now();
    for (const [k, c] of this.chunks) if (!activeKeys.has(k) && now - c.touched > 60000) this.chunks.delete(k);
  }

  claimAt(x, z) {
    return this.claims.find((c) => Math.abs(x - c.x) <= 8 && Math.abs(z - c.z) <= 8) || null;
  }
}

export { bkey };
