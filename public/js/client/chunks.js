// 메인 스레드 쪽 월드 사본: 블록 데이터(물리·광선용) + 청크 메시 관리 + 워커 통신
import { CS, CH, ckey, idx } from '../shared/constants.js';
import { SOLID, LIGHT, OPAQUE } from '../shared/blocks.js';

export class ClientWorld {
  constructor(renderer, atlas, seed) {
    this.r = renderer;
    this.chunks = new Map();   // key → { cx, cz, vox, solid, water }
    this.mods = new Map();     // key → Map(idx → id)  (호스트에서 받은 모든 변경)
    this.pending = new Set();  // 워커에 요청한 청크
    this.wanted = new Set();
    this.inflight = 0;
    this.radius = 4;
    this.center = [0, 0];
    this.emitters = new Map(); // key → [[x,y,z,level]] 엔티티 조명용
    this.meshMs = 0; this.meshCount = 0;
    this.onChunk = null;
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this.onWorker(e.data);
    this.worker.onerror = (e) => console.error('worker error', e.message || e);
    this.worker.postMessage({ t: 'init', seed, faceTiles: atlas.faceTiles, cols: atlas.cols, w: atlas.W, h: atlas.H });
  }

  dispose() {
    this.worker.terminate();
    for (const c of this.chunks.values()) this.removeMeshes(c);
    this.chunks.clear();
  }

  // 호스트가 보낸 전체 변경 목록 { key: [[idx,id],...] }
  loadMods(obj) {
    for (const k in obj) {
      let m = this.mods.get(k);
      if (!m) this.mods.set(k, (m = new Map()));
      for (const [i, id] of obj[k]) m.set(i, id);
    }
    this.worker.postMessage({ t: 'mods', mods: obj });
  }

  modsObject() {
    const o = {};
    for (const [k, m] of this.mods) o[k] = [...m];
    return o;
  }

  getBlock(x, y, z) {
    if (y < 0) return 6;
    if (y >= CH) return 0;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const c = this.chunks.get(ckey(cx, cz));
    if (!c) return -1;
    return c.vox[idx(x - cx * CS, y, z - cz * CS)];
  }
  isLoaded(x, z) { return this.chunks.has(ckey(Math.floor(x / CS), Math.floor(z / CS))); }

  // 블록 변경 (호스트 확인 또는 예측)
  setBlock(x, y, z, id) {
    if (y < 0 || y >= CH) return;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS), k = ckey(cx, cz);
    const i = idx(x - cx * CS, y, z - cz * CS);
    let m = this.mods.get(k);
    if (!m) this.mods.set(k, (m = new Map()));
    const c = this.chunks.get(k);
    const old = c ? c.vox[i] : m.get(i);
    if (c && c.vox[i] === id && m.get(i) === id) return;
    m.set(i, id);
    if (c) c.vox[i] = id;
    this.worker.postMessage({ t: 'set', x, y, z, id });
    if (!c) return;
    if (LIGHT[old] || LIGHT[id]) this.scanEmitters(c);
    // 같은 청크는 즉시, 경계 근처면 이웃도 즉시, 빛 영향은 잠시 후 주변 전체
    const lx = x - cx * CS, lz = z - cz * CS;
    this.remesh(cx, cz, true);
    const nx = lx === 0 ? -1 : lx === CS - 1 ? 1 : 0, nz = lz === 0 ? -1 : lz === CS - 1 ? 1 : 0;
    if (nx) this.remesh(cx + nx, cz, true);
    if (nz) this.remesh(cx, cz + nz, true);
    if (nx && nz) this.remesh(cx + nx, cz + nz, true);
    const lightChange = LIGHT[old] !== LIGHT[id] || OPAQUE[old] !== OPAQUE[id];
    if (lightChange) {
      clearTimeout(this._lightT);
      this._lightSet = this._lightSet || new Set();
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (dx || dz) this._lightSet.add(ckey(cx + dx, cz + dz));
      this._lightT = setTimeout(() => {
        for (const kk of this._lightSet) { const [a, b] = kk.split(',').map(Number); this.remesh(a, b, false); }
        this._lightSet.clear();
      }, 350);
    }
  }

  remesh(cx, cz, prio) {
    const k = ckey(cx, cz);
    if (!this.chunks.has(k)) return;
    this.worker.postMessage({ t: 'mesh', cx, cz, prio });
  }

  scanEmitters(c) {
    const list = [];
    const v = c.vox;
    for (let i = 0; i < v.length; i++) {
      const l = LIGHT[v[i]];
      if (l) {
        const x = i % CS, z = ((i / CS) | 0) % CS, y = (i / (CS * CS)) | 0;
        list.push([c.cx * CS + x + 0.5, y + 0.5, c.cz * CS + z + 0.5, l]);
      }
    }
    if (list.length) this.emitters.set(ckey(c.cx, c.cz), list); else this.emitters.delete(ckey(c.cx, c.cz));
  }

  // 주변 블록빛 추정 (엔티티/손 밝기용) 0~1
  blockLightAt(x, y, z) {
    let best = 0;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const list = this.emitters.get(ckey(cx + dx, cz + dz));
      if (!list) continue;
      for (const [ex, ey, ez, l] of list) {
        const d = Math.abs(ex - x) + Math.abs(ey - y) + Math.abs(ez - z);
        const v = l - d;
        if (v > best) best = v;
      }
    }
    return best <= 0 ? 0 : Math.pow(0.8, 15 - best);
  }

  // 하늘이 보이는지 (위쪽에 불투명 블록이 없는지)
  skyExposure(x, y, z) {
    const bx = Math.floor(x), bz = Math.floor(z);
    for (let yy = Math.floor(y) + 1; yy < CH; yy++) { const b = this.getBlock(bx, yy, bz); if (b > 0 && OPAQUE[b]) return 0.25; }
    return 1;
  }

  // 플레이어 위치 기준으로 필요한 청크 요청/정리
  update(px, pz) {
    const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS);
    const R = this.radius;
    const moved = pcx !== this.center[0] || pcz !== this.center[1] || !this._init;
    this.center = [pcx, pcz];
    if (moved) {
      this._init = true;
      this.wanted.clear();
      const list = [];
      for (let dx = -R; dx <= R; dx++)
        for (let dz = -R; dz <= R; dz++) {
          if (dx * dx + dz * dz > (R + 0.5) * (R + 0.5)) continue;
          list.push([dx * dx + dz * dz, pcx + dx, pcz + dz]);
        }
      list.sort((a, b) => a[0] - b[0]);
      this.order = list.map((e) => ckey(e[1], e[2]));
      for (const k of this.order) this.wanted.add(k);
      for (const [k, c] of this.chunks) if (!this.wanted.has(k)) { this.removeMeshes(c); this.chunks.delete(k); this.emitters.delete(k); }
      for (const k of [...this.pending]) if (!this.wanted.has(k)) this.pending.delete(k);
      this.worker.postMessage({ t: 'keep', cx: pcx, cz: pcz, r: R });
      this.inflight = this.pending.size;
    }
    // 가까운 것부터 몇 개씩만 요청 (이동하면 순서가 바뀌므로)
    for (const k of this.order) {
      if (this.inflight >= 4) break;
      if (this.chunks.has(k) || this.pending.has(k)) continue;
      const [cx, cz] = k.split(',').map(Number);
      this.pending.add(k); this.inflight++;
      this.worker.postMessage({ t: 'mesh', cx, cz, prio: false });
    }
  }

  progress() { return { loaded: this.chunks.size, total: this.wanted.size }; }

  removeMeshes(c) {
    for (const m of [c.solid, c.water]) if (m) { this.r.scene.remove(m); m.geometry.dispose(); }
    c.solid = c.water = null;
  }

  onWorker(m) {
    if (m.t !== 'mesh') return;
    const k = ckey(m.cx, m.cz);
    if (this.pending.delete(k)) this.inflight = Math.max(0, this.inflight - 1);
    if (!this.wanted.has(k)) return;
    this.meshMs += m.ms; this.meshCount++;
    let c = this.chunks.get(k);
    const fresh = !c;
    if (!c) { c = { cx: m.cx, cz: m.cz, vox: m.voxels, solid: null, water: null }; this.chunks.set(k, c); }
    else c.vox = m.voxels;
    const md = this.mods.get(k);
    if (md) for (const [i, id] of md) c.vox[i] = id;
    this.removeMeshes(c);
    if (m.solid) { c.solid = this.r.makeMesh(m.solid, false); c.solid.position.set(m.cx * CS, 0, m.cz * CS); c.solid.updateMatrix(); this.r.scene.add(c.solid); }
    if (m.water) { c.water = this.r.makeMesh(m.water, true); c.water.position.set(m.cx * CS, 0, m.cz * CS); c.water.updateMatrix(); this.r.scene.add(c.water); }
    this.scanEmitters(c);
    if (fresh && this.onChunk) this.onChunk(c);
  }

  solidAt(x, y, z) { const b = this.getBlock(x, y, z); return b < 0 || SOLID[b] === 1; }
}
