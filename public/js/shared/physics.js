// 복셀 충돌(축별 클리핑 + 계단 오르기)과 광선 검사
import { SOLID, collisionBoxes, selectionBoxes } from './blocks.js';

const EPS = 1e-6;
const tmp = [];

function collect(getBlock, x0, y0, z0, x1, y1, z1, out) {
  out.length = 0;
  for (let y = Math.floor(y0) - 1; y <= Math.floor(y1); y++)
    for (let z = Math.floor(z0); z <= Math.floor(z1); z++)
      for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
        const id = getBlock(x, y, z);
        if (!SOLID[id]) continue;
        const bs = collisionBoxes(id);
        if (!bs) continue;
        for (const b of bs) out.push([x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]]);
      }
  return out;
}

function clip(boxes, a, d, ax) {
  // ax: 0=x 1=y 2=z
  const o1 = (ax + 1) % 3, o2 = (ax + 2) % 3;
  for (const b of boxes) {
    if (b[o1 + 3] <= a[o1] + EPS || b[o1] >= a[o1 + 3] - EPS) continue;
    if (b[o2 + 3] <= a[o2] + EPS || b[o2] >= a[o2 + 3] - EPS) continue;
    if (d > 0 && b[ax] >= a[ax + 3] - EPS) { const m = b[ax] - a[ax + 3]; if (m < d) d = Math.max(0, m); }
    else if (d < 0 && b[ax + 3] <= a[ax] + EPS) { const m = b[ax + 3] - a[ax]; if (m > d) d = Math.min(0, m); }
  }
  return d;
}
const shift = (a, ax, d) => { a[ax] += d; a[ax + 3] += d; };

// e: { x, y(발), z, w, h, onGround }  getBlock(x,y,z) → 블록 id
export function moveEntity(e, dx, dy, dz, getBlock, step = 0) {
  const hw = e.w / 2;
  const start = [e.x - hw, e.y, e.z - hw, e.x + hw, e.y + e.h, e.z + hw];
  const a = start.slice();
  const boxes = collect(getBlock,
    Math.min(a[0], a[0] + dx), Math.min(a[1], a[1] + dy), Math.min(a[2], a[2] + dz),
    Math.max(a[3], a[3] + dx), Math.max(a[4], a[4] + dy) + step, Math.max(a[5], a[5] + dz), tmp);
  let ry = clip(boxes, a, dy, 1); shift(a, 1, ry);
  let rx = clip(boxes, a, dx, 0); shift(a, 0, rx);
  let rz = clip(boxes, a, dz, 2); shift(a, 2, rz);
  let onGround = dy < 0 && ry !== dy;

  // 반 블록/계단 같은 낮은 턱은 자동으로 올라감
  if (step > 0 && (onGround || e.onGround) && (rx !== dx || rz !== dz)) {
    const b = start.slice();
    let sy = clip(boxes, b, step, 1); shift(b, 1, sy);
    const sx = clip(boxes, b, dx, 0); shift(b, 0, sx);
    const sz = clip(boxes, b, dz, 2); shift(b, 2, sz);
    const down = clip(boxes, b, -sy + Math.min(0, dy), 1); shift(b, 1, down);
    if (sx * sx + sz * sz > rx * rx + rz * rz + 1e-9) {
      for (let i = 0; i < 6; i++) a[i] = b[i];
      rx = sx; rz = sz; ry = sy + down; onGround = true;
    }
  }
  e.x = (a[0] + a[3]) / 2; e.y = a[1]; e.z = (a[2] + a[5]) / 2;
  return { hitX: rx !== dx, hitY: ry !== dy, hitZ: rz !== dz, onGround, dy: ry };
}

// 엔티티가 박스들과 겹치는지
export function overlapsBlocks(e, getBlock, filter) {
  const hw = e.w / 2;
  const a = [e.x - hw, e.y, e.z - hw, e.x + hw, e.y + e.h, e.z + hw];
  for (let y = Math.floor(a[1]); y <= Math.floor(a[4] - EPS); y++)
    for (let z = Math.floor(a[2]); z <= Math.floor(a[5] - EPS); z++)
      for (let x = Math.floor(a[0]); x <= Math.floor(a[3] - EPS); x++)
        if (filter(getBlock(x, y, z), x, y, z)) return true;
  return false;
}

export const boxesOverlap = (a, b) => a[0] < b[3] && a[3] > b[0] && a[1] < b[4] && a[4] > b[1] && a[2] < b[5] && a[5] > b[2];

// 광선-박스 교차: 들어가는 t와 면 번호(0=+X 1=-X 2=+Y 3=-Y 4=+Z 5=-Z)
export function rayBox(ox, oy, oz, dx, dy, dz, b) {
  let tmin = -Infinity, tmax = Infinity, face = -1;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let ax = 0; ax < 3; ax++) {
    if (Math.abs(d[ax]) < 1e-12) {
      if (o[ax] < b[ax] || o[ax] > b[ax + 3]) return null;
      continue;
    }
    let t1 = (b[ax] - o[ax]) / d[ax], t2 = (b[ax + 3] - o[ax]) / d[ax];
    let f = ax * 2 + 1; // 음의 방향에서 들어오면 -면
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; f = ax * 2; }
    if (t1 > tmin) { tmin = t1; face = f; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return { t: Math.max(0, tmin), face };
}

// 복셀 DDA 광선 검사. filter(id)가 참인 블록만 맞음
export function raycast(getBlock, ox, oy, oz, dx, dy, dz, maxDist, filter) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity, tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity, tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tmx = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tdx : Infinity;
  let tmy = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tdy : Infinity;
  let tmz = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tdz : Infinity;
  let t = 0;
  for (let n = 0; n < 256 && t <= maxDist; n++) {
    const id = getBlock(x, y, z);
    if (id && filter(id)) {
      const bs = selectionBoxes(id);
      if (bs) {
        let best = null;
        for (const b of bs) {
          const h = rayBox(ox, oy, oz, dx, dy, dz, [x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]]);
          if (h && (!best || h.t < best.t)) best = h;
        }
        if (best && best.t <= maxDist) return { x, y, z, face: best.face, dist: best.t, id };
      }
    }
    if (tmx < tmy) {
      if (tmx < tmz) { x += sx; t = tmx; tmx += tdx; } else { z += sz; t = tmz; tmz += tdz; }
    } else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; } else { z += sz; t = tmz; tmz += tdz; }
  }
  return null;
}
