// 아이템 아이콘: 블록은 입체 아이콘, 나머지는 16x16 픽셀아트 (외곽선 자동)
import { ITEMS } from '../shared/items.js';
import { BLOCKS, faceTile } from '../shared/blocks.js';

const S = 32; // 아이콘 해상도
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

class Spr {
  constructor() { this.d = new Uint8ClampedArray(16 * 16 * 4); }
  set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x > 15 || y > 15) return; const i = (y * 16 + x) * 4; this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = 255; }
  a(x, y) { return x < 0 || y < 0 || x > 15 || y > 15 ? 0 : this.d[(y * 16 + x) * 4 + 3]; }
  line(x0, y0, x1, y1, c, w = 1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2 + 1;
    for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n; this.set(x, y, c); if (w > 1) this.set(x + 1, y, c); }
  }
  ell(cx, cy, rx, ry, c, shade = 0) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) { const k = shade ? (-dx - dy) * shade : 0; this.set(x, y, [clamp(c[0] + k), clamp(c[1] + k), clamp(c[2] + k)]); }
    }
  }
  poly(pts, c) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > y + 0.5) !== (yj > y + 0.5) && x + 0.5 < ((xj - xi) * (y + 0.5 - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) this.set(x, y, c);
    }
  }
  outline() {
    const add = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (this.a(x, y)) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.a(x + dx, y + dy)) {
        const i = ((y + dy) * 16 + x + dx) * 4;
        add.push([x, y, [this.d[i] * 0.3, this.d[i + 1] * 0.3, this.d[i + 2] * 0.3]]); break;
      }
    }
    for (const [x, y, c] of add) this.set(x, y, c);
  }
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const dk = (c, k) => c.map((v) => clamp(v * k));
const HANDLE = [137, 100, 56], HANDLE_D = [100, 70, 38];

function handle(s, x0, y0, x1, y1) { s.line(x0, y0, x1, y1, HANDLE); s.line(x0 + 1, y0, x1 + 1, y1, HANDLE_D); }

const SPRITES = {
  stick: (s) => handle(s, 3, 13, 11, 5),
  coal: (s) => { s.poly([[3, 8], [6, 4], [11, 4], [13, 8], [11, 12], [5, 12]], [42, 42, 46]); s.set(6, 6, [96, 96, 104]); s.set(7, 6, [80, 80, 88]); s.set(9, 9, [70, 70, 78]); },
  iron_ingot: (s) => ingot(s, [220, 220, 220]),
  gold_ingot: (s) => ingot(s, [250, 210, 60]),
  diamond: (s) => { s.poly([[3, 6], [6, 3], [10, 3], [13, 6], [8, 13]], [80, 228, 226]); s.line(4, 6, 12, 6, [170, 255, 250]); s.set(6, 4, [240, 255, 255]); s.set(7, 4, [240, 255, 255]); s.line(8, 7, 8, 11, [40, 160, 170]); },
  apple: (s) => apple(s, [206, 34, 34]),
  golden_apple: (s) => apple(s, [246, 204, 52]),
  bread: (s) => { s.ell(8, 9.5, 6.5, 3.6, [196, 134, 62], 20); for (const x of [5, 8, 11]) s.line(x, 7, x + 1, 9, [150, 96, 40]); },
  wheat: (s) => { for (const o of [0, 2, 4]) { s.line(3 + o, 14, 9 + o, 4, [200, 166, 60]); s.set(9 + o, 3, [226, 196, 90]); s.set(8 + o, 4, [226, 196, 90]); } },
  seeds: (s) => { for (const [x, y] of [[5, 7], [8, 6], [10, 9], [6, 10], [9, 11], [12, 7]]) { s.set(x, y, [96, 150, 46]); s.set(x + 1, y, [70, 120, 30]); } },
  raw_pork: (s) => meat(s, [240, 146, 146], [255, 220, 220]),
  cooked_pork: (s) => meat(s, [176, 104, 58], [224, 168, 112]),
  raw_mutton: (s) => meat(s, [206, 72, 72], [250, 200, 200]),
  cooked_mutton: (s) => meat(s, [150, 88, 50], [210, 150, 100]),
  raw_chicken: (s) => leg(s, [244, 204, 176]),
  cooked_chicken: (s) => leg(s, [206, 142, 70]),
  feather: (s) => { s.line(3, 13, 12, 3, [220, 220, 220], 2); s.line(4, 13, 12, 4, [150, 150, 150]); for (let i = 0; i < 6; i++) s.set(6 + i, 9 - i, [250, 250, 250]); },
  slimeball: (s) => { s.ell(8, 8.5, 4.5, 4.5, [112, 200, 90], 18); s.set(6, 6, [200, 250, 190]); },
  rotten_flesh: (s) => { s.ell(8, 9, 6, 4, [134, 112, 62], 12); for (const [x, y] of [[5, 8], [9, 7], [11, 10], [7, 11]]) s.set(x, y, [70, 100, 40]); },
  door: (s) => { for (let y = 1; y < 15; y++) for (let x = 4; x < 12; x++) s.set(x, y, [170, 128, 76]); for (let x = 5; x < 11; x++) { s.set(x, 4, [130, 96, 56]); s.set(x, 10, [130, 96, 56]); } s.set(10, 8, [220, 220, 220]); },
  sign: (s) => { for (let y = 3; y < 10; y++) for (let x = 2; x < 14; x++) s.set(x, y, [190, 150, 96]); for (let x = 3; x < 13; x++) { s.set(x, 5, [120, 90, 50]); s.set(x, 7, [120, 90, 50]); } s.line(7, 10, 7, 14, HANDLE); s.line(8, 10, 8, 14, HANDLE_D); },
};
function ingot(s, c) { s.poly([[2, 10], [5, 6], [14, 6], [11, 10]], c); s.poly([[2, 10], [11, 10], [11, 12], [2, 12]], dk(c, 0.7)); s.poly([[11, 10], [14, 6], [14, 8], [11, 12]], dk(c, 0.55)); s.line(5, 7, 12, 7, c.map((v) => clamp(v + 30))); }
function apple(s, c) { s.ell(8, 9.5, 5.2, 5, c, 26); s.set(6, 7, [255, 220, 220]); s.set(6, 8, [255, 200, 200]); s.line(8, 3, 8, 5, [100, 70, 30]); s.set(9, 3, [70, 160, 50]); s.set(10, 3, [70, 160, 50]); s.set(10, 4, [50, 130, 40]); }
function meat(s, c, fat) { s.ell(8, 8.5, 6.5, 4.5, c, 18); s.line(4, 9, 12, 7, fat); s.line(5, 10, 11, 8, dk(c, 0.85)); }
function leg(s, c) { s.ell(9.5, 6.5, 4.5, 4, c, 22); s.line(6, 9, 3, 13, [238, 232, 220], 2); s.set(2, 13, [250, 250, 250]); s.set(3, 14, [250, 250, 250]); }

const TOOL = {
  pickaxe: (s, m, d) => { handle(s, 3, 13, 10, 6); s.line(3, 4, 6, 2, m, 2); s.line(6, 2, 10, 2, m, 2); s.line(10, 2, 13, 5, d, 2); s.line(13, 5, 14, 9, d, 2); s.set(9, 6, d); },
  axe: (s, m, d) => { handle(s, 3, 13, 10, 6); s.poly([[7, 4], [10, 1], [14, 4], [12, 8], [9, 7]], m); s.line(10, 2, 13, 5, d.map((v) => clamp(v + 60))); },
  shovel: (s, m, d) => { handle(s, 2, 14, 9, 7); s.poly([[8, 6], [11, 2], [14, 3], [14, 6], [10, 9]], m); s.line(11, 3, 13, 4, d.map((v) => clamp(v + 60))); },
  sword: (s, m, d) => { s.line(5, 10, 13, 2, m, 2); s.line(6, 10, 13, 3, d); s.line(3, 9, 7, 13, [110, 80, 40], 2); s.line(2, 13, 4, 11, HANDLE, 2); },
  hoe: (s, m, d) => { handle(s, 3, 13, 10, 6); s.line(8, 3, 13, 3, m, 2); s.line(12, 4, 13, 6, d, 2); },
};

export class Icons {
  constructor(atlas) {
    this.atlas = atlas;
    this.cache = new Map();
    this.canvases = new Map();
  }
  tile(name) {
    const i = this.atlas.index.get(name) ?? 0;
    return [(i % this.atlas.cols) * 16, ((i / this.atlas.cols) | 0) * 16];
  }
  canvas(id) {
    if (this.canvases.has(id)) return this.canvases.get(id);
    const c = document.createElement('canvas'); c.width = S; c.height = S;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const it = ITEMS[id];
    const ic = it && it.icon;
    if (!ic) { /* 빈 아이콘 */ }
    else if (ic.type === 'cube' || ic.type === 'slab' || ic.type === 'stairs') this.iso(g, ic.block, ic.type);
    else if (ic.type === 'tile') { const [sx, sy] = this.tile(ic.tile); g.drawImage(this.atlas.canvas, sx, sy, 16, 16, 0, 0, S, S); }
    else {
      const s = new Spr();
      if (ic.type === 'tool') { const m = hex(ic.color); TOOL[ic.tool](s, m, dk(m, 0.62)); }
      else if (SPRITES[ic.sprite]) SPRITES[ic.sprite](s);
      s.outline();
      const t = document.createElement('canvas'); t.width = 16; t.height = 16;
      t.getContext('2d').putImageData(new ImageData(s.d, 16, 16), 0, 0);
      g.drawImage(t, 0, 0, S, S);
    }
    this.canvases.set(id, c);
    return c;
  }
  url(id) {
    if (!this.cache.has(id)) this.cache.set(id, this.canvas(id).toDataURL());
    return this.cache.get(id);
  }
  // 입체 블록 아이콘
  iso(g, block, shape) {
    const A = this.atlas.canvas;
    const top = this.tile(faceTile(block, 2)), left = this.tile(faceTile(block, 4)), right = this.tile(faceTile(block, 0));
    const hf = shape === 'slab' ? (BLOCKS[block].boxes ? BLOCKS[block].boxes[0][4] / 16 : 0.5) : 1;
    const oy = (1 - hf) * S / 2 + 1;
    const face = (t, a, b, c, d, e, f, sh, sy = 0, sh2 = 16) => {
      g.save(); g.setTransform(a, b, c, d, e, f);
      g.drawImage(A, t[0], t[1] + sy, 16, sh2, 0, 0, 16, sh2);
      g.restore();
      if (sh) {
        g.save(); g.setTransform(a, b, c, d, e, f);
        g.fillStyle = `rgba(0,0,0,${sh})`; g.fillRect(0, 0, 16, sh2);
        g.restore();
      }
    };
    const u = S / 32, hh = 16 * hf;
    // 왼쪽 면, 오른쪽 면, 윗면
    face(left, u, u / 2, 0, u, 0, S / 4 + oy, 0.18, 16 - hh, hh);
    face(right, u, -u / 2, 0, u, S / 2, S / 2 + oy, 0.38, 16 - hh, hh);
    face(top, u, -u / 2, u, u / 2, 0, S / 4 + oy - 0, 0);
  }
}
