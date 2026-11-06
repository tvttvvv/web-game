// 지형 생성 + 메시 생성 워커 (메인 스레드가 끊기지 않게)
import { createGenerator } from '../shared/worldgen.js';
import { CS, CH, ckey } from '../shared/constants.js';
import { meshChunk, setAtlas } from './mesher.js';

let gen = null;
const chunks = new Map();   // key → Uint8Array
const mods = new Map();     // key → Map(idx → id)
let queue = [];
const queued = new Set();
let busy = false;

function getChunk(cx, cz) {
  const k = ckey(cx, cz);
  let v = chunks.get(k);
  if (!v) {
    v = gen.genChunk(cx, cz);
    const m = mods.get(k);
    if (m) for (const [i, id] of m) v[i] = id;
    chunks.set(k, v);
  }
  return v;
}

function applyMod(k, i, id) {
  let m = mods.get(k);
  if (!m) mods.set(k, (m = new Map()));
  m.set(i, id);
  const v = chunks.get(k);
  if (v) v[i] = id;
}

function pump() {
  if (busy || !queue.length || !gen) return;
  busy = true;
  setTimeout(() => {
    const k = queue.shift();
    queued.delete(k);
    const [cx, cz] = k.split(',').map(Number);
    const t0 = performance.now();
    const res = meshChunk(cx, cz, getChunk);
    const voxels = getChunk(cx, cz).slice();
    const transfer = [voxels.buffer];
    for (const part of [res.solid, res.water]) if (part) transfer.push(part.pos.buffer, part.uv.buffer, part.lt.buffer, part.idx.buffer);
    postMessage({ t: 'mesh', cx, cz, voxels, solid: res.solid, water: res.water, ms: performance.now() - t0 }, transfer);
    busy = false;
    pump();
  }, 0);
}

onmessage = (e) => {
  const m = e.data;
  switch (m.t) {
    case 'init':
      gen = createGenerator(m.seed);
      setAtlas(m.faceTiles, m.cols, m.w, m.h);
      chunks.clear(); mods.clear(); queue = []; queued.clear();
      break;
    case 'mods': // { key: [[idx, id], ...] }
      for (const k in m.mods) for (const [i, id] of m.mods[k]) applyMod(k, i, id);
      break;
    case 'set': {
      const cx = Math.floor(m.x / CS), cz = Math.floor(m.z / CS);
      if (m.y >= 0 && m.y < CH) applyMod(ckey(cx, cz), (m.y * CS + (m.z - cz * CS)) * CS + (m.x - cx * CS), m.id);
      break;
    }
    case 'mesh': {
      const k = ckey(m.cx, m.cz);
      if (m.prio) {
        if (queued.has(k)) queue.splice(queue.indexOf(k), 1);
        queue.unshift(k); queued.add(k);
      } else if (!queued.has(k)) { queue.push(k); queued.add(k); }
      break;
    }
    case 'keep': { // 멀리 떨어진 청크 데이터 정리 + 필요 없는 요청 취소
      const r = m.r + 2;
      for (const k of chunks.keys()) {
        const [cx, cz] = k.split(',').map(Number);
        if (Math.abs(cx - m.cx) > r || Math.abs(cz - m.cz) > r) chunks.delete(k);
      }
      queue = queue.filter((k) => {
        const [cx, cz] = k.split(',').map(Number);
        const ok = Math.abs(cx - m.cx) <= m.r + 1 && Math.abs(cz - m.cz) <= m.r + 1;
        if (!ok) queued.delete(k);
        return ok;
      });
      break;
    }
  }
  pump();
};
