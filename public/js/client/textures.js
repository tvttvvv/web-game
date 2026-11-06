// 블록 텍스처를 코드로 그리는 16x16 픽셀아트 아틀라스
import { mulberry32 } from '../shared/noise.js';
import { BLOCKS, faceTile } from '../shared/blocks.js';
import { WOOL_COLORS } from '../shared/blocks.js';

export const TILE = 16;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

class Pix {
  constructor() { this.d = new Uint8ClampedArray(TILE * TILE * 4); }
  set(x, y, c, a = 255) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return;
    const i = (y * TILE + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a;
  }
  get(x, y) { const i = ((y & 15) * TILE + (x & 15)) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }
  alpha(x, y, a) { this.d[((y & 15) * TILE + (x & 15)) * 4 + 3] = a; }
  shade(x, y, k) {
    const i = ((y & 15) * TILE + (x & 15)) * 4;
    this.d[i] = clamp(this.d[i] + k); this.d[i + 1] = clamp(this.d[i + 1] + k); this.d[i + 2] = clamp(this.d[i + 2] + k);
  }
  noise(c, amt, r, hue = 0) {
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++) {
        const n = (r() - 0.5) * 2 * amt;
        const h = hue ? (r() - 0.5) * hue : 0;
        this.set(x, y, [clamp(c[0] + n + h), clamp(c[1] + n), clamp(c[2] + n - h)]);
      }
  }
  clear() { this.d.fill(0); }
  rect(x0, y0, w, h, c, a = 255) { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c, a); }
}

// ---------- 공용 무늬 ----------
function specks(p, r, n, k) { for (let i = 0; i < n; i++) p.shade(r() * 16, r() * 16, k * (0.6 + r() * 0.8)); }
function stoneBase(p, r) {
  p.noise([124, 124, 124], 10, r);
  for (let i = 0; i < 16; i++) { const x = r() * 16 | 0, y = r() * 16 | 0; p.shade(x, y, -20); if (r() < 0.6) p.shade(x + 1, y, -14); if (r() < 0.3) p.shade(x, y + 1, -10); }
  specks(p, r, 10, 12);
}
function voronoi(p, r, n, base, varAmt, mortar, wrap = true) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([r() * 16, r() * 16, (r() - 0.5) * varAmt]);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let d1 = 1e9, d2 = 1e9, best = 0, bx = 0, by = 0;
      for (let i = 0; i < n; i++) {
        let dx = x + 0.5 - pts[i][0], dy = y + 0.5 - pts[i][1];
        if (wrap) { if (dx > 8) dx -= 16; if (dx < -8) dx += 16; if (dy > 8) dy -= 16; if (dy < -8) dy += 16; }
        const d = Math.hypot(dx, dy);
        if (d < d1) { d2 = d1; d1 = d; best = i; bx = dx; by = dy; } else if (d < d2) d2 = d;
      }
      if (d2 - d1 < 1.0) p.set(x, y, mortar);
      else {
        const k = pts[best][2] - (bx + by) * 2.2 + (r() - 0.5) * 8;
        p.set(x, y, [clamp(base[0] + k), clamp(base[1] + k), clamp(base[2] + k)]);
      }
    }
}
function planks(p, r, base) {
  const seams = [r() * 16 | 0, r() * 16 | 0, r() * 16 | 0, r() * 16 | 0];
  for (let y = 0; y < 16; y++) {
    const board = y >> 2, bk = (board * 7 % 5 - 2) * 4;
    for (let x = 0; x < 16; x++) {
      let k = bk + Math.sin((x + board * 5) * 0.9 + y * 0.3) * 4 + (r() - 0.5) * 8;
      if (y % 4 === 3) k -= 34;
      if (x === seams[board] && y % 4 !== 3) k -= 28;
      p.set(x, y, [clamp(base[0] + k), clamp(base[1] + k * 0.85), clamp(base[2] + k * 0.7)]);
    }
  }
}
function bark(p, r, base, lines) {
  const col = Array.from({ length: 16 }, () => (r() - 0.5) * 18);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let k = col[x] + (r() - 0.5) * 10;
      if ((x + ((y / 5) | 0)) % 4 === 0) k -= lines;
      p.set(x, y, [clamp(base[0] + k), clamp(base[1] + k * 0.9), clamp(base[2] + k * 0.8)]);
    }
}
function logTop(p, r, wood, barkC) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      if (edge) { p.set(x, y, barkC.map((c) => clamp(c + (r() - 0.5) * 16))); continue; }
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) + Math.hypot(x - 7.5, y - 7.5) * 0.25;
      const ring = Math.floor(d * 0.9) % 2 === 0 ? 10 : -10;
      p.set(x, y, wood.map((c) => clamp(c + ring + (r() - 0.5) * 8)));
    }
}
function leaves(p, r, base, holes = 0.24) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const k = (r() - 0.5) * 40;
      p.set(x, y, [clamp(base[0] + k * 0.6), clamp(base[1] + k), clamp(base[2] + k * 0.5)]);
      if (r() < holes) p.alpha(x, y, 0);
    }
  for (let i = 0; i < 10; i++) { const x = r() * 16 | 0, y = r() * 16 | 0; p.shade(x, y, -30); p.shade(x + 1, y, -20); }
}
function ore(p, r, color, hi) {
  stoneBase(p, r);
  const c = hex(color), h = hex(hi);
  for (let k = 0; k < 4; k++) {
    const cx = 2 + r() * 11, cy = 2 + r() * 11;
    for (let i = 0; i < 5; i++) {
      const x = cx + (r() - 0.5) * 4, y = cy + (r() - 0.5) * 4;
      p.set(x, y, c); if (r() < 0.5) p.set(x + 1, y, c);
      if (r() < 0.35) p.set(x, y - 1, h);
    }
  }
}
function bricks(p, r, brick, mortar, bw = 8, bh = 4) {
  for (let y = 0; y < 16; y++) {
    const row = (y / bh) | 0, off = row % 2 ? bw / 2 : 0;
    for (let x = 0; x < 16; x++) {
      const bx = (x + off) % bw;
      if (y % bh === bh - 1 || bx === bw - 1) { p.set(x, y, mortar.map((c) => clamp(c + (r() - 0.5) * 10))); continue; }
      const id = (((x + off) / bw) | 0) * 13 + row * 7;
      const k = ((id * 37) % 17 - 8) * 1.5 + (r() - 0.5) * 12 + (y % bh === 0 ? 8 : 0);
      p.set(x, y, brick.map((c) => clamp(c + k)));
    }
  }
}
function block(p, r, base, edge, inner) {
  p.noise(hex(base), 6, r);
  for (let i = 0; i < 16; i++) { p.set(i, 0, hex(inner)); p.set(0, i, hex(inner)); p.set(i, 15, hex(edge)); p.set(15, i, hex(edge)); }
  for (let i = 2; i < 14; i++) { p.shade(i, 2, 18); p.shade(2, i, 18); p.shade(i, 13, -18); p.shade(13, i, -18); }
}
function cross(p, draw) { p.clear(); draw(); }
function stem(p, x, y0, y1, c) { for (let y = y0; y <= y1; y++) p.set(x, y, c); }

// ---------- 타일 정의 ----------
const T = {};
T.stone = (p, r) => stoneBase(p, r);
T.dirt = (p, r) => { p.noise([134, 96, 67], 14, r, 6); specks(p, r, 14, -22); specks(p, r, 8, 14); };
T.grass_top = (p, r) => { p.noise([98, 160, 56], 18, r, 8); specks(p, r, 18, -24); specks(p, r, 10, 16); };
T.grass_side = (p, r) => {
  T.dirt(p, r);
  for (let x = 0; x < 16; x++) {
    const h = 3 + (r() < 0.5 ? 1 : 0) + (r() < 0.25 ? 1 : 0);
    for (let y = 0; y < h; y++) p.set(x, y, [clamp(98 + (r() - 0.5) * 30), clamp(160 + (r() - 0.5) * 34), 56]);
  }
};
T.snowy_grass_side = (p, r) => {
  T.dirt(p, r);
  for (let x = 0; x < 16; x++) {
    const h = 3 + (r() < 0.5 ? 1 : 0) + (r() < 0.2 ? 2 : 0);
    for (let y = 0; y < h; y++) p.set(x, y, [clamp(240 + (r() - 0.5) * 18), clamp(246 + (r() - 0.5) * 12), 252]);
  }
};
T.cobblestone = (p, r) => voronoi(p, r, 9, [128, 128, 128], 34, [74, 74, 74]);
T.mossy_cobblestone = (p, r) => {
  T.cobblestone(p, r);
  for (let i = 0; i < 40; i++) { const x = r() * 16 | 0, y = r() * 16 | 0; if (r() < 0.7) p.set(x, y, [72 + r() * 30, 110 + r() * 40, 50]); }
};
T.planks_oak = (p, r) => planks(p, r, [184, 148, 95]);
T.planks_birch = (p, r) => planks(p, r, [214, 196, 136]);
T.planks_spruce = (p, r) => planks(p, r, [122, 90, 56]);
T.bedrock = (p, r) => { p.noise([80, 80, 80], 40, r); specks(p, r, 30, -40); };
T.sand = (p, r) => { p.noise([219, 207, 160], 9, r, 4); specks(p, r, 14, -14); };
T.gravel = (p, r) => voronoi(p, r, 16, [132, 124, 120], 60, [96, 90, 88]);
T.log_oak = (p, r) => bark(p, r, [104, 82, 50], 24);
T.log_oak_top = (p, r) => logTop(p, r, [176, 140, 88], [104, 82, 50]);
T.log_birch = (p, r) => {
  p.noise([216, 214, 206], 8, r);
  for (let i = 0; i < 9; i++) { const x = r() * 14 | 0, y = r() * 16 | 0, w = 2 + (r() * 3 | 0); for (let k = 0; k < w; k++) p.set(x + k, y, [42, 42, 40]); }
};
T.log_birch_top = (p, r) => logTop(p, r, [210, 190, 140], [216, 214, 206]);
T.log_spruce = (p, r) => bark(p, r, [70, 52, 32], 18);
T.log_spruce_top = (p, r) => logTop(p, r, [150, 112, 70], [70, 52, 32]);
T.leaves_oak = (p, r) => leaves(p, r, [64, 128, 40]);
T.leaves_birch = (p, r) => leaves(p, r, [110, 150, 64]);
T.leaves_spruce = (p, r) => leaves(p, r, [52, 92, 62], 0.18);
T.glass = (p, r) => {
  p.clear();
  const c = [218, 240, 248];
  for (let i = 0; i < 16; i++) { p.set(i, 0, c); p.set(i, 15, c); p.set(0, i, c); p.set(15, i, c); }
  for (let i = 0; i < 4; i++) { p.set(3 + i, 6 - i, [250, 255, 255], 255); }
  p.set(11, 12, [250, 255, 255]); p.set(12, 11, [250, 255, 255]);
};
T.sandstone = (p, r) => {
  p.noise([216, 202, 150], 6, r);
  for (let x = 0; x < 16; x++) { p.shade(x, 3, -16); p.shade(x, 4, 8); p.shade(x, 10, -14); p.shade(x, 11, 6); p.shade(x, 0, 14); p.shade(x, 15, -18); }
};
T.sandstone_top = (p, r) => { p.noise([222, 210, 160], 7, r); specks(p, r, 10, -12); };
T.snow = (p, r) => { p.noise([242, 248, 252], 5, r); specks(p, r, 8, -12); };
T.ice = (p, r) => {
  p.noise([150, 190, 245], 8, r);
  for (let i = 0; i < 4; i++) { const y0 = r() * 16 | 0; for (let k = 0; k < 6; k++) p.set((r() * 3 + k * 2) | 0, (y0 + k) & 15, [210, 230, 255]); }
};
T.water = (p, r) => {
  p.noise([52, 96, 200], 10, r);
  for (let i = 0; i < 6; i++) { const y = r() * 16 | 0, x0 = r() * 16 | 0; for (let k = 0; k < 5; k++) p.set((x0 + k) & 15, y, [96, 140, 230]); }
};
T.coal_ore = (p, r) => ore(p, r, '#1d1d1d', '#4a4a4a');
T.iron_ore = (p, r) => ore(p, r, '#d8a882', '#f0d0b0');
T.gold_ore = (p, r) => ore(p, r, '#fcd53f', '#fff6a8');
T.diamond_ore = (p, r) => ore(p, r, '#4ee0e6', '#cffcff');
T.cactus_side = (p, r) => {
  p.noise([84, 136, 44], 10, r);
  for (let y = 0; y < 16; y++) { p.shade(1, y, 24); p.shade(4, y, -22); p.shade(8, y, 20); p.shade(11, y, -22); p.shade(14, y, 18); }
  for (let i = 0; i < 6; i++) p.set(r() * 16, r() * 16, [230, 230, 190]);
};
T.cactus_top = (p, r) => { p.noise([96, 150, 52], 8, r); for (let i = 3; i < 13; i++) { p.shade(i, 3, 18); p.shade(i, 12, 18); p.shade(3, i, 18); p.shade(12, i, 18); } };
T.tall_grass = (p, r) => cross(p, () => {
  for (let i = 0; i < 9; i++) {
    const x = 1 + r() * 14 | 0, h = 6 + r() * 9 | 0, lean = r() < 0.5 ? -1 : 1;
    for (let y = 0; y < h; y++) p.set(x + ((y > h * 0.6) ? lean : 0), 15 - y, [70 + r() * 40, 130 + r() * 50, 40 + r() * 20]);
  }
});
function flower(petal, center) {
  return (p, r) => cross(p, () => {
    stem(p, 7, 7, 15, [56, 120, 36]); p.set(8, 11, [60, 130, 40]); p.set(9, 10, [60, 130, 40]); p.set(6, 12, [56, 120, 36]);
    const pc = hex(petal), cc = hex(center);
    for (const [x, y] of [[6, 4], [7, 4], [8, 4], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [5, 6], [6, 6], [8, 6], [9, 6], [6, 7], [7, 7], [8, 7], [7, 3]]) p.set(x, y, pc.map((c) => clamp(c + (r() - 0.5) * 30)));
    p.set(7, 6, cc);
  });
}
T.flower_red = flower('#d83a2c', '#2a1a10');
T.flower_yellow = flower('#f5d324', '#c47e10');
T.flower_blue = flower('#4b6be0', '#2a3a9a');
T.flower_white = flower('#f2f2f2', '#f0c020');
T.dead_bush = (p, r) => cross(p, () => {
  const c = [124, 88, 48];
  stem(p, 7, 6, 15, c);
  for (let i = 0; i < 5; i++) { p.set(6 - i, 10 - i, c); p.set(8 + i, 9 - i, c); }
  p.set(4, 7, c); p.set(11, 6, c); p.set(9, 12, c); p.set(10, 11, c);
});
T.bricks = (p, r) => bricks(p, r, [150, 84, 66], [196, 186, 176]);
T.stone_bricks = (p, r) => bricks(p, r, [124, 124, 124], [86, 86, 86], 8, 8);
T.table_top = (p, r) => {
  planks(p, r, [176, 132, 82]);
  for (let i = 0; i < 16; i++) { p.set(i, 0, [92, 64, 36]); p.set(i, 15, [92, 64, 36]); p.set(0, i, [92, 64, 36]); p.set(15, i, [92, 64, 36]); }
  for (let i = 2; i < 14; i++) { p.set(i, 5, [110, 78, 44]); p.set(i, 10, [110, 78, 44]); p.set(5, i, [110, 78, 44]); p.set(10, i, [110, 78, 44]); }
};
T.table_side = (p, r) => {
  planks(p, r, [168, 128, 80]);
  p.rect(0, 0, 16, 3, [110, 78, 44]);
  p.rect(3, 5, 2, 7, [120, 120, 120]); p.rect(2, 5, 4, 2, [150, 150, 150]); // 망치
  p.rect(9, 6, 5, 2, [180, 180, 180]); for (let x = 9; x < 14; x += 2) p.set(x, 8, [140, 140, 140]); p.rect(13, 5, 2, 4, [110, 78, 44]); // 톱
};
T.table_front = (p, r) => {
  planks(p, r, [168, 128, 80]);
  p.rect(0, 0, 16, 3, [110, 78, 44]);
  p.rect(4, 5, 8, 8, [120, 86, 50]); p.rect(5, 6, 6, 6, [92, 64, 36]);
};
T.lamp = (p, r) => {
  p.noise([250, 214, 120], 12, r);
  for (let i = 0; i < 16; i++) { p.set(i, 0, [120, 84, 40]); p.set(i, 15, [120, 84, 40]); p.set(0, i, [120, 84, 40]); p.set(15, i, [120, 84, 40]); }
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) p.set(x, y, [255, 246, 200]);
};
T.bookshelf = (p, r) => {
  planks(p, r, [176, 140, 88]);
  const cols = ['#8e2b2b', '#2b4d8e', '#3d7a2b', '#7a5a2b', '#5a2b7a', '#2b7a74'];
  for (const y0 of [1, 9]) {
    for (let x = 1; x < 15; x++) {
      const c = hex(cols[(x * 7 + y0) % cols.length]), h = 5 + (x * 3 + y0) % 2;
      for (let y = y0 + (6 - h); y < y0 + 6; y++) p.set(x, y, c.map((v) => clamp(v + (y === y0 + 6 - h ? 30 : 0))));
    }
  }
};
T.farmland = (p, r) => { p.noise([92, 62, 38], 10, r); for (let y = 0; y < 16; y += 4) for (let x = 0; x < 16; x++) { p.shade(x, y, -26); p.shade(x, y + 1, 12); } };
function sapling(leaf, trunk) {
  return (p, r) => cross(p, () => {
    stem(p, 7, 9, 15, hex(trunk)); stem(p, 8, 11, 15, hex(trunk));
    const c = hex(leaf);
    for (let i = 0; i < 26; i++) { const x = 4 + r() * 8 | 0, y = 2 + r() * 8 | 0; p.set(x, y, c.map((v) => clamp(v + (r() - 0.5) * 40))); }
  });
}
T.sapling_oak = sapling('#4a8a2a', '#6b5130');
T.sapling_birch = sapling('#7aa84a', '#d9d5cb');
T.sapling_spruce = sapling('#3a6a44', '#4a3720');
T.smooth_stone = (p, r) => { p.noise([164, 164, 164], 5, r); for (let i = 0; i < 16; i++) { p.set(i, 0, [190, 190, 190]); p.set(0, i, [190, 190, 190]); p.set(i, 15, [120, 120, 120]); p.set(15, i, [120, 120, 120]); } };
T.hay_top = (p, r) => { p.noise([214, 176, 46], 14, r); for (let i = 0; i < 16; i++) { p.set(i, 0, [150, 110, 30]); p.set(0, i, [150, 110, 30]); p.set(i, 15, [150, 110, 30]); p.set(15, i, [150, 110, 30]); } };
T.hay_side = (p, r) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const k = (x % 3 === 0 ? -16 : 6) + (r() - 0.5) * 16; p.set(x, y, [clamp(214 + k), clamp(176 + k), clamp(46 + k * 0.5)]); }
  for (let x = 0; x < 16; x++) { p.set(x, 4, [150, 40, 30]); p.set(x, 11, [150, 40, 30]); }
};
T.bed_top = (p, r) => {
  p.noise([180, 40, 40], 8, r);
  p.rect(1, 1, 14, 5, [240, 240, 240]); for (let x = 1; x < 15; x++) p.set(x, 5, [200, 200, 200]);
  for (let y = 7; y < 16; y += 3) for (let x = 0; x < 16; x++) p.shade(x, y, -18);
};
T.bed_side = (p, r) => {
  planks(p, r, [168, 128, 80]);
  p.rect(0, 7, 16, 4, [180, 40, 40]); for (let x = 0; x < 16; x++) p.set(x, 7, [210, 70, 70]);
  p.rect(0, 11, 2, 5, [110, 78, 44]); p.rect(14, 11, 2, 5, [110, 78, 44]);
};
T.iron_block = (p, r) => block(p, r, '#dcdcdc', '#9a9a9a', '#f4f4f4');
T.gold_block = (p, r) => block(p, r, '#f6d43a', '#c09018', '#fff2a0');
T.diamond_block = (p, r) => block(p, r, '#62e8de', '#28a49c', '#cafffa');
T.slime = (p, r) => {
  p.noise([112, 196, 92], 8, r);
  for (let i = 0; i < 16; i++) { p.set(i, 0, [80, 160, 64]); p.set(i, 15, [80, 160, 64]); p.set(0, i, [80, 160, 64]); p.set(15, i, [80, 160, 64]); }
  p.rect(4, 4, 8, 8, [140, 220, 120]); p.rect(5, 5, 3, 2, [200, 250, 190]);
};
T.flag = (p, r) => {
  p.clear();
  stem(p, 7, 0, 15, [220, 220, 220]); stem(p, 8, 0, 15, [170, 170, 170]);
  for (let y = 1; y < 7; y++) for (let x = 9; x < 16; x++) p.set(x, y, [196 + (r() - 0.5) * 20, 40, 40]);
  for (let x = 9; x < 16; x++) p.set(x, 3, [250, 210, 60]);
};
T.torch = (p) => {
  p.clear();
  for (let y = 8; y < 16; y++) { p.set(7, y, [150, 112, 60]); p.set(8, y, [110, 80, 40]); }
  p.set(7, 6, [255, 250, 210]); p.set(8, 6, [255, 230, 120]); p.set(7, 7, [255, 190, 60]); p.set(8, 7, [240, 140, 40]);
  p.set(7, 5, [255, 220, 120], 200); p.set(8, 5, [255, 200, 80], 160);
};
T.ladder = (p, r) => {
  p.clear();
  const c = [130, 96, 56], d = [96, 70, 40];
  for (let y = 0; y < 16; y++) { p.set(2, y, c); p.set(3, y, d); p.set(12, y, c); p.set(13, y, d); }
  for (const y of [2, 6, 10, 14]) for (let x = 4; x < 12; x++) { p.set(x, y, c); p.set(x, y + 1, d); }
};
T.door_bottom = (p, r) => {
  planks(p, r, [160, 120, 72]);
  for (let i = 0; i < 16; i++) { p.set(0, i, [96, 70, 40]); p.set(15, i, [96, 70, 40]); p.set(i, 15, [96, 70, 40]); }
  p.rect(3, 2, 10, 10, [140, 104, 62]); p.rect(4, 3, 8, 8, [170, 130, 80]);
  p.set(12, 1, [80, 80, 80]); p.set(12, 0, [200, 200, 200]);
};
T.door_top = (p, r) => {
  planks(p, r, [160, 120, 72]);
  for (let i = 0; i < 16; i++) { p.set(0, i, [96, 70, 40]); p.set(15, i, [96, 70, 40]); p.set(i, 0, [96, 70, 40]); }
  for (let y = 3; y < 13; y++) for (let x = 3; x < 13; x++) if (x !== 7 && x !== 8 && y !== 7 && y !== 8) p.alpha(x, y, 0);
  p.set(12, 15, [200, 200, 200]);
};
T.chest_top = (p, r) => { planks(p, r, [168, 112, 48]); for (let i = 0; i < 16; i++) { p.set(i, 0, [80, 52, 24]); p.set(i, 15, [80, 52, 24]); p.set(0, i, [80, 52, 24]); p.set(15, i, [80, 52, 24]); } };
T.chest_side = (p, r) => { T.chest_top(p, r); for (let x = 0; x < 16; x++) { p.set(x, 5, [80, 52, 24]); p.set(x, 6, [120, 80, 36]); } };
T.chest_front = (p, r) => { T.chest_side(p, r); p.rect(7, 4, 2, 4, [196, 196, 196]); p.set(7, 7, [120, 120, 120]); p.set(8, 7, [120, 120, 120]); };
T.furnace_side = (p, r) => { stoneBase(p, r); for (let i = 0; i < 16; i++) { p.set(i, 0, [96, 96, 96]); p.set(i, 15, [80, 80, 80]); } };
T.furnace_top = (p, r) => { p.noise([110, 110, 110], 8, r); for (let i = 0; i < 16; i++) { p.set(i, 0, [90, 90, 90]); p.set(0, i, [90, 90, 90]); p.set(i, 15, [80, 80, 80]); p.set(15, i, [80, 80, 80]); } };
T.furnace_front = (p, r) => {
  T.furnace_side(p, r);
  p.rect(3, 2, 10, 4, [96, 96, 96]); p.rect(4, 3, 8, 2, [60, 60, 60]);
  p.rect(4, 8, 8, 6, [30, 30, 30]); p.rect(5, 12, 6, 2, [200, 90, 30]); p.set(6, 11, [240, 160, 40]); p.set(9, 11, [240, 160, 40]);
};
for (let s = 0; s < 8; s++) {
  T['wheat_' + s] = (p, r) => cross(p, () => {
    const h = 3 + Math.round(s * 1.65);
    const ripe = s === 7;
    for (const x of [2, 5, 8, 11, 13]) {
      const hh = h - ((x * 3) % 3);
      for (let y = 0; y < hh; y++) {
        const g = ripe ? [196 + r() * 30, 160 + r() * 30, 60] : s >= 5 ? [120 + s * 8, 160, 50] : [70, 150 + r() * 30, 40];
        p.set(x + (y > hh * 0.7 ? 1 : 0), 15 - y, g);
      }
      if (ripe) { p.set(x, 15 - hh, [150, 110, 40]); p.set(x + 1, 15 - hh + 1, [150, 110, 40]); }
    }
  });
}
WOOL_COLORS.forEach(([, c], i) => {
  T['wool_' + i] = (p, r) => {
    const b = hex(c);
    p.noise(b, 6, r);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + y * 3) % 5 === 0) p.shade(x, y, -10);
  };
});
for (let k = 0; k < 10; k++) {
  T['crack_' + k] = (p, r) => {
    p.clear();
    const n = 2 + k * 2;
    for (let i = 0; i < n; i++) {
      let x = 8 + (r() - 0.5) * 4, y = 8 + (r() - 0.5) * 4;
      const a = r() * Math.PI * 2, len = 3 + k * 0.6 + r() * 4;
      for (let s = 0; s < len; s++) { p.set(x, y, [20, 20, 20], 200); x += Math.cos(a) + (r() - 0.5) * 0.8; y += Math.sin(a) + (r() - 0.5) * 0.8; }
    }
  };
}

export const TILE_NAMES = Object.keys(T);

// 아틀라스 생성 → { canvas, index(name→i), cols, rows, faceTiles(Int16Array 256*6), colors }
export function buildAtlas() {
  const cols = 16, rows = Math.ceil(TILE_NAMES.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * TILE; canvas.height = rows * TILE;
  const ctx = canvas.getContext('2d');
  const index = new Map();
  const avg = new Map();
  TILE_NAMES.forEach((name, i) => {
    const p = new Pix();
    let s = 0; for (const ch of name) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
    T[name](p, mulberry32(s + 7));
    const img = new ImageData(p.d, TILE, TILE);
    ctx.putImageData(img, (i % cols) * TILE, ((i / cols) | 0) * TILE);
    index.set(name, i);
    let r = 0, g = 0, b = 0, n = 0;
    for (let k = 0; k < p.d.length; k += 4) if (p.d[k + 3] > 128) { r += p.d[k]; g += p.d[k + 1]; b += p.d[k + 2]; n++; }
    avg.set(name, n ? [r / n, g / n, b / n] : [128, 128, 128]);
  });
  const faceTiles = new Int16Array(256 * 6);
  const colors = new Float32Array(256 * 3);
  for (let id = 0; id < BLOCKS.length; id++) {
    for (let f = 0; f < 6; f++) faceTiles[id * 6 + f] = index.get(faceTile(id, f)) ?? 0;
    const c = avg.get(faceTile(id, 4)) || [128, 128, 128];
    colors[id * 3] = c[0] / 255; colors[id * 3 + 1] = c[1] / 255; colors[id * 3 + 2] = c[2] / 255;
  }
  return { canvas, index, cols, rows, W: canvas.width, H: canvas.height, faceTiles, colors };
}
