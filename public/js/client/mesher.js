// 청크 메시 생성: 하늘빛/블록빛 전파 + 부드러운 조명 + 앰비언트 오클루전
// 워커에서 실행됨. 위치는 픽셀 단위(블록당 16)로 저장 → 메시 scale 1/16
import { CS, CH } from '../shared/constants.js';
import { BLOCKS, OPAQUE, LIGHT, FILTER, RENDER } from '../shared/blocks.js';

const M = 14;                 // 빛 계산 여유 폭
const R = CS + 2 * M;         // 영역 가로 (44)
const RR = R * R;
const N = RR * CH;
const vox = new Uint8Array(N);
const sky = new Uint8Array(N);
const blk = new Uint8Array(N);
const QCAP = N * 2;
const queue = new Int32Array(QCAP);
const WATER = 15;
const AXOFF = [1, RR, R];     // x, y, z 축 인덱스 간격

// 면 정의: 바깥에서 볼 때 반시계 방향 꼭짓점, 법선 축과 부호
const FACE_DEF = [
  { ax: 0, s: 1, c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.6 },
  { ax: 0, s: -1, c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.6 },
  { ax: 1, s: 1, c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1.0 },
  { ax: 1, s: -1, c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.5 },
  { ax: 2, s: 1, c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.8 },
  { ax: 2, s: -1, c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.8 },
];
// 꼭짓점 좌표(0~1) → 타일 안의 (u, v). v는 위쪽이 1
const UVF = [
  (x, y, z) => [1 - z, y], (x, y, z) => [z, y], (x, y, z) => [x, 1 - z],
  (x, y, z) => [x, z], (x, y, z) => [x, y], (x, y, z) => [1 - x, y],
];
const AO_CURVE = [0.5, 0.68, 0.84, 1.0];

class Buf {
  constructor(n = 8192) { this.alloc(n); this.v = 0; this.i = 0; }
  alloc(n) {
    const pos = new Uint16Array(n * 3), uv = new Uint16Array(n * 2), lt = new Uint8Array(n * 4), idx = new Uint32Array(n * 1.5);
    if (this.pos) { pos.set(this.pos); uv.set(this.uv); lt.set(this.lt); idx.set(this.idx); }
    this.pos = pos; this.uv = uv; this.lt = lt; this.idx = idx; this.cap = n;
  }
  reset() { this.v = 0; this.i = 0; }
  vert(x, y, z, u, v, s, b, sh, fl) {
    if (this.v >= this.cap) this.alloc(this.cap * 2);
    const k = this.v++;
    this.pos[k * 3] = x; this.pos[k * 3 + 1] = y; this.pos[k * 3 + 2] = z;
    this.uv[k * 2] = u; this.uv[k * 2 + 1] = v;
    this.lt[k * 4] = s; this.lt[k * 4 + 1] = b; this.lt[k * 4 + 2] = sh; this.lt[k * 4 + 3] = fl;
    return k;
  }
  quad(a, b, c, d, flip) {
    if (this.i + 6 > this.idx.length) this.alloc(this.cap * 2);
    const I = this.idx;
    if (flip) { I[this.i++] = b; I[this.i++] = c; I[this.i++] = d; I[this.i++] = b; I[this.i++] = d; I[this.i++] = a; }
    else { I[this.i++] = a; I[this.i++] = b; I[this.i++] = c; I[this.i++] = a; I[this.i++] = c; I[this.i++] = d; }
  }
  out() {
    if (!this.v) return null;
    return {
      pos: this.pos.slice(0, this.v * 3), uv: this.uv.slice(0, this.v * 2),
      lt: this.lt.slice(0, this.v * 4), idx: this.v > 65535 ? this.idx.slice(0, this.i) : Uint16Array.from(this.idx.subarray(0, this.i)),
    };
  }
}
const solidBuf = new Buf(16384), waterBuf = new Buf(4096);

let FT = null, COLS = 16, AW = 256, AH = 256;
export function setAtlas(faceTiles, cols, w, h) { FT = faceTiles; COLS = cols; AW = w; AH = h; }

// 타일 + 타일 내부 (u,v) → 정규화된 Uint16 텍스처 좌표
function tu(tile, u) {
  const px = (tile % COLS) * 16 + Math.min(15.97, Math.max(0.03, u * 16));
  return Math.round((px / AW) * 65535);
}
function tv(tile, v) {
  const py = ((tile / COLS) | 0) * 16 + Math.min(15.97, Math.max(0.03, (1 - v) * 16));
  return Math.round((1 - py / AH) * 65535);
}

function fillRegion(cx, cz, getChunk) {
  const ox = cx * CS - M, oz = cz * CS - M;
  for (let ncx = cx - 1; ncx <= cx + 1; ncx++)
    for (let ncz = cz - 1; ncz <= cz + 1; ncz++) {
      const v = getChunk(ncx, ncz);
      const wx0 = Math.max(ncx * CS, ox), wx1 = Math.min(ncx * CS + CS, ox + R);
      const wz0 = Math.max(ncz * CS, oz), wz1 = Math.min(ncz * CS + CS, oz + R);
      if (wx0 >= wx1 || wz0 >= wz1) continue;
      const len = wx1 - wx0;
      for (let y = 0; y < CH; y++)
        for (let wz = wz0; wz < wz1; wz++) {
          const src = (y * CS + (wz - ncz * CS)) * CS + (wx0 - ncx * CS);
          vox.set(v.subarray(src, src + len), (y * R + (wz - oz)) * R + (wx0 - ox));
        }
    }
}

function computeLight() {
  sky.fill(0); blk.fill(0);
  let maxTop = 0;
  for (let rz = 0; rz < R; rz++)
    for (let rx = 0; rx < R; rx++) {
      let L = 15;
      for (let y = CH - 1; y >= 0; y--) {
        const i = (y * R + rz) * R + rx, id = vox[i];
        if (id) maxTop = Math.max(maxTop, y);
        if (OPAQUE[id]) break;
        const f = FILTER[id];
        if (f) { L -= f; if (L <= 0) break; }
        sky[i] = L;
      }
    }
  let qh = 0, qt = 0;
  const top = Math.min(CH - 1, maxTop + 1);
  for (let y = 0; y <= top; y++)
    for (let rz = 1; rz < R - 1; rz++)
      for (let rx = 1; rx < R - 1; rx++) {
        const i = (y * R + rz) * R + rx, L = sky[i];
        if (L < 2) continue;
        const t = L - 1;
        if ((sky[i + 1] < t && !OPAQUE[vox[i + 1]]) || (sky[i - 1] < t && !OPAQUE[vox[i - 1]]) ||
            (sky[i + R] < t && !OPAQUE[vox[i + R]]) || (sky[i - R] < t && !OPAQUE[vox[i - R]])) queue[qt++] = i;
      }
  qt = bfs(sky, qh, qt);
  // 블록빛
  qh = 0; qt = 0;
  for (let i = 0; i < N; i++) {
    const l = LIGHT[vox[i]];
    if (l) { blk[i] = l; queue[qt++] = i; }
  }
  bfs(blk, qh, qt);
}

function bfs(arr, qh, qt) {
  while (qh !== qt) {
    const i = queue[qh]; qh = (qh + 1) % QCAP;
    const L = arr[i];
    if (L <= 1) continue;
    const y = (i / RR) | 0, rem = i - y * RR, rz = (rem / R) | 0, rx = rem - rz * R;
    for (let k = 0; k < 6; k++) {
      let n;
      if (k === 0) { if (rx >= R - 1) continue; n = i + 1; }
      else if (k === 1) { if (rx <= 0) continue; n = i - 1; }
      else if (k === 2) { if (rz >= R - 1) continue; n = i + R; }
      else if (k === 3) { if (rz <= 0) continue; n = i - R; }
      else if (k === 4) { if (y >= CH - 1) continue; n = i + RR; }
      else { if (y <= 0) continue; n = i - RR; }
      const id = vox[n];
      if (OPAQUE[id]) continue;
      const nl = L - 1 - FILTER[id];
      if (nl > arr[n]) { arr[n] = nl; queue[qt] = n; qt = (qt + 1) % QCAP; }
    }
  }
  return qt;
}

// y 범위 밖은 위=공기(하늘빛 15), 아래=불투명
const opq = (n, ny) => (ny < 0 ? 1 : ny >= CH ? 0 : OPAQUE[vox[n]]);
const skyAt = (n, ny) => (ny >= CH ? 15 : ny < 0 ? 0 : sky[n]);
const blkAt = (n, ny) => (ny >= CH || ny < 0 ? 0 : blk[n]);

function cubeFace(buf, i, lx, y, lz, f, tile) {
  const F = FACE_DEF[f];
  const nOff = F.s * AXOFF[F.ax];
  const fi = i + nOff, fy = y + (F.ax === 1 ? F.s : 0);
  const t1 = F.ax === 0 ? 1 : 0, t2 = F.ax === 2 ? 1 : 2;
  const uvf = UVF[f];
  const vs = [0, 0, 0, 0], br = [0, 0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const c = F.c[k];
    const sg1 = c[t1] ? 1 : -1, sg2 = c[t2] ? 1 : -1;
    const o1 = sg1 * AXOFF[t1], o2 = sg2 * AXOFF[t2];
    const y1 = fy + (t1 === 1 ? sg1 : 0), y2 = fy + (t2 === 1 ? sg2 : 0);
    const s1 = fi + o1, s2 = fi + o2, cc = fi + o1 + o2, yc = fy + (t1 === 1 ? sg1 : 0) + (t2 === 1 ? sg2 : 0);
    const a1 = opq(s1, y1), a2 = opq(s2, y2), ac = a1 && a2 ? 1 : opq(cc, yc);
    const ao = 3 - (a1 + a2 + ac);
    let ls = skyAt(fi, fy), lb = blkAt(fi, fy), cnt = 1;
    if (!a1) { ls += skyAt(s1, y1); lb += blkAt(s1, y1); cnt++; }
    if (!a2) { ls += skyAt(s2, y2); lb += blkAt(s2, y2); cnt++; }
    if (!ac) { ls += skyAt(cc, yc); lb += blkAt(cc, yc); cnt++; }
    const sv = Math.round((ls / cnt) * 17), bv = Math.round((lb / cnt) * 17);
    const sh = Math.round(AO_CURVE[ao] * F.shade * 255);
    const [u, v] = uvf(c[0], c[1], c[2]);
    vs[k] = buf.vert((lx + c[0]) * 16, (y + c[1]) * 16, (lz + c[2]) * 16, tu(tile, u), tv(tile, v), sv, bv, sh, 0);
    br[k] = AO_CURVE[ao] * (sv + bv + 30);
  }
  buf.quad(vs[0], vs[1], vs[2], vs[3], br[0] + br[2] < br[1] + br[3]);
}

function crossBlock(buf, i, lx, y, lz, tile) {
  const s = sky[i] * 17, b = blk[i] * 17, sh = Math.round(0.92 * 255);
  const X = lx * 16, Y = y * 16, Z = lz * 16;
  const P = [[[1, 1], [15, 15]], [[1, 15], [15, 1]]];
  for (const [[ax, az], [bx, bz]] of P) {
    const v0 = buf.vert(X + ax, Y, Z + az, tu(tile, 0), tv(tile, 0), s, b, sh, 0);
    const v1 = buf.vert(X + bx, Y, Z + bz, tu(tile, 1), tv(tile, 0), s, b, sh, 0);
    const v2 = buf.vert(X + bx, Y + 16, Z + bz, tu(tile, 1), tv(tile, 1), s, b, sh, 1);
    const v3 = buf.vert(X + ax, Y + 16, Z + az, tu(tile, 0), tv(tile, 1), s, b, sh, 1);
    buf.quad(v0, v1, v2, v3, false);
    buf.quad(v1, v0, v3, v2, false);
  }
}

function modelBlock(buf, i, lx, y, lz, id) {
  const d = BLOCKS[id];
  for (const bx of d.boxes) {
    const voff = (bx[6] || 0) / 16;
    for (let f = 0; f < 6; f++) {
      const F = FACE_DEF[f];
      const onEdge = F.s > 0 ? bx[F.ax + 3] === 16 : bx[F.ax] === 0;
      const ax = F.ax === 0 ? 0 : F.ax === 1 ? 1 : 2;
      let li = i, ly = y;
      if (onEdge) {
        const n = i + F.s * AXOFF[ax], ny = y + (ax === 1 ? F.s : 0);
        if (opq(n, ny)) continue;
        li = n; ly = ny;
      }
      const tile = FT[id * 6 + f];
      const s = skyAt(li, ly) * 17, b = blkAt(li, ly) * 17, sh = Math.round(F.shade * 255);
      const vs = [0, 0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const c = F.c[k];
        const px = c[0] ? bx[3] : bx[0], py = c[1] ? bx[4] : bx[1], pz = c[2] ? bx[5] : bx[2];
        const [u, v] = UVF[f](px / 16, py / 16, pz / 16);
        vs[k] = buf.vert(lx * 16 + px, y * 16 + py, lz * 16 + pz, tu(tile, u), tv(tile, v + (F.ax === 1 ? 0 : voff)), s, b, sh, 0);
      }
      buf.quad(vs[0], vs[1], vs[2], vs[3], false);
    }
  }
}

function waterBlock(buf, i, lx, y, lz, tile) {
  const surface = y + 1 >= CH || vox[i + RR] !== WATER;
  const h = surface ? 14 : 16;
  for (let f = 0; f < 6; f++) {
    const F = FACE_DEF[f];
    const n = i + F.s * AXOFF[F.ax], ny = y + (F.ax === 1 ? F.s : 0);
    if (ny < 0) continue;
    if (ny < CH) { const nid = vox[n]; if (nid === WATER || OPAQUE[nid]) continue; }
    const s = skyAt(n, ny) * 17, b = blkAt(n, ny) * 17, sh = Math.round(Math.max(0.7, F.shade) * 255);
    const vs = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const c = F.c[k];
      const top = c[1] === 1;
      const [u, v] = UVF[f](c[0], c[1], c[2]);
      vs[k] = buf.vert((lx + c[0]) * 16, y * 16 + (top ? h : 0), (lz + c[2]) * 16, tu(tile, u), tv(tile, v), s, b, sh, top && surface ? 2 : 0);
    }
    buf.quad(vs[0], vs[1], vs[2], vs[3], false);
  }
}

// getChunk(cx,cz) → Uint8Array (주변 청크 포함)
export function meshChunk(cx, cz, getChunk) {
  fillRegion(cx, cz, getChunk);
  computeLight();
  solidBuf.reset(); waterBuf.reset();
  for (let y = 0; y < CH; y++)
    for (let lz = 0; lz < CS; lz++)
      for (let lx = 0; lx < CS; lx++) {
        const i = (y * R + lz + M) * R + lx + M;
        const id = vox[i];
        if (!id) continue;
        const r = RENDER[id];
        if (r === 1) {
          const cut = BLOCKS[id].cutout;
          for (let f = 0; f < 6; f++) {
            const ny = y + (FACE_DEF[f].ax === 1 ? FACE_DEF[f].s : 0);
            if (ny < 0) continue;
            if (ny < CH) {
              const nid = vox[i + FACE_DEF[f].s * AXOFF[FACE_DEF[f].ax]];
              if (OPAQUE[nid]) continue;
              if (cut && nid === id && id === 11) continue; // 유리끼리는 숨김
            }
            cubeFace(solidBuf, i, lx, y, lz, f, FT[id * 6 + f]);
          }
        } else if (r === 2) crossBlock(solidBuf, i, lx, y, lz, FT[id * 6 + 4]);
        else if (r === 3) modelBlock(solidBuf, i, lx, y, lz, id);
        else if (r === 4) waterBlock(waterBuf, i, lx, y, lz, FT[id * 6 + 2]);
      }
  return { solid: solidBuf.out(), water: waterBuf.out() };
}
