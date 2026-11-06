// 월드 데이터 + 지형 생성 (브라우저/노드 공용, 저장 방식은 바깥에서 처리)
import { CHUNK, T, DAY_LEN, SAFE_R } from '../shared.js';

function hash2(seed, x, y) {
  let h = (seed | 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);
function vnoise(seed, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = smooth(x - x0), fy = smooth(y - y0);
  const a = hash2(seed, x0, y0), b = hash2(seed, x0 + 1, y0);
  const c = hash2(seed, x0, y0 + 1), d = hash2(seed, x0 + 1, y0 + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
function fbm(seed, x, y, oct) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += vnoise(seed + i * 101, x * freq, y * freq) * amp;
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

export function groundAt(seed, x, y) {
  let e = fbm(seed, x / 48, y / 48, 4);
  const d = Math.hypot(x, y);
  e += Math.max(0, Math.min(1, (34 - d) / 14)) * 0.22; // 시작 지점 주변은 육지
  if (d < 20) e = Math.max(e, 0.5);
  if (e < 0.4) return T.WATER;
  if (e < 0.44) return T.SAND;
  return T.GRASS;
}

export function genTile(seed, x, y) {
  const g = groundAt(seed, x, y);
  if (g !== T.GRASS) return g;
  if (Math.hypot(x, y) < SAFE_R + 1) return T.GRASS; // 마을은 비워 둠 (자원은 마을 바깥에서)
  const r = hash2(seed + 11, x, y);
  const rn = fbm(seed + 2, x / 9, y / 9, 2);
  if ((rn > 0.64 && r < 0.3) || r < 0.006) return T.ROCK;
  const r2 = hash2(seed + 12, x, y);
  const forest = fbm(seed + 1, x / 14, y / 14, 2);
  if (r2 < 0.03 + (forest > 0.5 ? (forest - 0.5) * 1.2 : 0)) return T.TREE;
  return T.GRASS;
}

const key = (cx, cy) => cx + ',' + cy;

export class World {
  // saved: 이전에 serialize()한 객체 (없으면 새 월드)
  constructor(saved) {
    this.seed = (Math.random() * 2 ** 31) | 0;
    this.epoch = Date.now() - 0.05 * DAY_LEN * 1000; // 아침에 시작
    this.mods = {};      // "cx,cy" -> { idx: tile }  (생성값에서 바뀐 타일만 저장)
    this.claims = [];    // { x, y, owner, name }
    this.players = {};   // pid -> { name, inv, kills }
    this.chunks = new Map();
    this.dirty = true;
    this.isNew = true;
    if (saved && typeof saved.seed === 'number') {
      this.seed = saved.seed;
      this.epoch = saved.epoch ?? this.epoch;
      this.mods = saved.mods || {};
      this.claims = saved.claims || [];
      this.players = saved.players || {};
      this.dirty = false;
      this.isNew = false;
    }
  }

  serialize() {
    return { seed: this.seed, epoch: this.epoch, mods: this.mods, claims: this.claims, players: this.players };
  }

  getChunk(cx, cy) {
    const k = key(cx, cy);
    let c = this.chunks.get(k);
    if (!c) {
      const tiles = new Uint8Array(CHUNK * CHUNK);
      for (let j = 0; j < CHUNK; j++)
        for (let i = 0; i < CHUNK; i++)
          tiles[j * CHUNK + i] = genTile(this.seed, cx * CHUNK + i, cy * CHUNK + j);
      const m = this.mods[k];
      if (m) for (const idx in m) tiles[idx] = m[idx];
      c = { cx, cy, tiles, touched: Date.now() };
      this.chunks.set(k, c);
    }
    c.touched = Date.now();
    return c;
  }

  tileAt(x, y) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    const c = this.getChunk(cx, cy);
    return c.tiles[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)];
  }

  setTile(x, y, v) {
    const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
    const c = this.getChunk(cx, cy);
    const idx = (y - cy * CHUNK) * CHUNK + (x - cx * CHUNK);
    c.tiles[idx] = v;
    const k = key(cx, cy);
    (this.mods[k] ||= {})[idx] = v;
    this.dirty = true;
  }

  baseGround(x, y) { // 부수고 난 뒤 드러나는 바닥 (바닥 블록을 물 위에 깔면 다리가 됨)
    return groundAt(this.seed, x, y);
  }

  chunkString(cx, cy) {
    const t = this.getChunk(cx, cy).tiles;
    let s = '';
    for (let i = 0; i < t.length; i++) s += String.fromCharCode(48 + t[i]);
    return s;
  }

  // 아무도 보고 있지 않은 청크를 메모리에서 내림 (수정분은 mods에 남아 있음)
  sweep(activeKeys) {
    const now = Date.now();
    for (const [k, c] of this.chunks)
      if (!activeKeys.has(k) && now - c.touched > 60000) this.chunks.delete(k);
  }
}

// 클라이언트 연결 하나를 게임에 묶음 (Node ws, P2P 연결, 로컬 루프백 공용)
// ws: { send(str), close(code), readyState, bufferedAmount }
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
