import { CHUNK, T, SAFE_R, CLAIM_R, darkness } from './shared.js';

const TS = 16;
const SHIRTS = ['#d9534f', '#f0ad4e', '#5cb85c', '#3fa7d6', '#8e6bd1', '#e47bb2', '#2fb5a5', '#e8e8e8'];
const HAIRS = ['#3b2a1a', '#7a4a1e', '#c9a227', '#222', '#a33', '#5b3a8c'];

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const px = (c, x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function blob(c, cx, cy, rx, ry, col) {
  c.fillStyle = col;
  for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++)
    if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) c.fillRect(x, y, 1, 1);
}

function drawGrass(c, r) {
  px(c, 0, 0, 16, 16, '#4f9d47');
  for (let i = 0; i < 10; i++) px(c, r() * 16 | 0, r() * 16 | 0, 1, 1, '#46903f');
  for (let i = 0; i < 5; i++) px(c, r() * 16 | 0, r() * 16 | 0, 1, 1, '#62b058');
  if (r() < 0.4) { const x = 2 + (r() * 11 | 0), y = 3 + (r() * 10 | 0); px(c, x, y, 1, 2, '#3d8238'); px(c, x + 1, y + 1, 1, 1, '#3d8238'); }
}
function drawTile(c, id, v) {
  const r = rng(id * 977 + v * 131 + 7);
  switch (id) {
    case T.WATER:
      px(c, 0, 0, 16, 16, '#2f6db3');
      for (let i = 0; i < 4; i++) px(c, r() * 13 | 0, r() * 16 | 0, 3, 1, '#4a8bd0');
      for (let i = 0; i < 3; i++) px(c, r() * 16 | 0, r() * 16 | 0, 1, 1, '#2760a0');
      break;
    case T.SAND:
      px(c, 0, 0, 16, 16, '#e3cd8e');
      for (let i = 0; i < 9; i++) px(c, r() * 16 | 0, r() * 16 | 0, 1, 1, '#cdb374');
      for (let i = 0; i < 3; i++) px(c, r() * 16 | 0, r() * 16 | 0, 1, 1, '#f1e0aa');
      break;
    case T.GRASS: drawGrass(c, r); break;
    case T.TREE:
      drawGrass(c, r);
      px(c, 4, 14, 9, 1, 'rgba(0,0,0,.25)');
      px(c, 7, 9, 3, 6, '#6b4423'); px(c, 9, 9, 1, 6, '#553419');
      blob(c, 8, 6, 6.5, 6, '#2a6f35');
      blob(c, 7.5, 5.5, 5.5, 5, '#368a42');
      for (let i = 0; i < 7; i++) px(c, 3 + (r() * 8 | 0), 2 + (r() * 7 | 0), 1, 1, '#4fb05a');
      for (let i = 0; i < 5; i++) px(c, 4 + (r() * 9 | 0), 6 + (r() * 6 | 0), 1, 1, '#1f5a2b');
      break;
    case T.ROCK:
      drawGrass(c, r);
      px(c, 3, 14, 11, 1, 'rgba(0,0,0,.25)');
      blob(c, 8, 10, 6.5, 5, '#5d5f66');
      blob(c, 7.7, 9.5, 5.6, 4.2, '#8d8f94');
      px(c, 5, 6, 4, 1, '#b4b6bb'); px(c, 4, 7, 2, 1, '#b4b6bb');
      px(c, 10, 11, 3, 1, '#6e7076');
      break;
    case T.WOOD_WALL:
      px(c, 0, 0, 16, 16, '#8a5a2b');
      for (let x = 0; x < 16; x += 4) { px(c, x, 0, 1, 16, '#5c3a18'); px(c, x + 1, 0, 1, 16, '#9b6a38'); }
      px(c, 0, 0, 16, 2, '#a8743d'); px(c, 0, 14, 16, 2, '#5c3a18');
      px(c, 2, 7, 1, 1, '#3e2710'); px(c, 10, 9, 1, 1, '#3e2710');
      break;
    case T.STONE_WALL:
      px(c, 0, 0, 16, 16, '#8f9399');
      for (let y = 0; y < 16; y += 4) {
        px(c, 0, y, 16, 1, '#5f6368');
        const off = (y / 4) % 2 ? 4 : 0;
        for (let x = off; x < 16; x += 8) px(c, x, y, 1, 4, '#5f6368');
      }
      px(c, 0, 0, 16, 1, '#b5b9be'); px(c, 0, 15, 16, 1, '#4a4d52');
      break;
    case T.FLOOR:
      px(c, 0, 0, 16, 16, '#b98a56');
      for (let y = 0; y < 16; y += 4) { px(c, 0, y, 16, 1, '#9a6f3f'); px(c, (y * 3 + 2) % 14, y + 2, 1, 1, '#8a6034'); }
      px(c, 0, 0, 1, 16, '#c99a64');
      break;
    case T.FLAG:
      drawGrass(c, r);
      px(c, 5, 14, 6, 2, '#555'); px(c, 7, 2, 1, 13, '#e8e8e8');
      px(c, 8, 2, 6, 5, '#d94141'); px(c, 8, 2, 6, 1, '#f26b6b'); px(c, 12, 4, 2, 3, '#b83030');
      break;
  }
}

function makeAtlas() {
  const a = mk(TS * 4, TS * 9), c = a.getContext('2d');
  for (let id = 0; id < 9; id++)
    for (let v = 0; v < 4; v++) {
      c.save(); c.translate(v * TS, id * TS); drawTile(c, id, v); c.restore();
    }
  return a;
}

function makePerson(color, frame) {
  const s = mk(TS, TS), c = s.getContext('2d');
  const shirt = SHIRTS[color % 8], hair = HAIRS[(color * 3 + 1) % HAIRS.length];
  px(c, 5, 1, 6, 2, hair); px(c, 5, 3, 6, 4, '#f2c9a0'); px(c, 4, 2, 1, 3, hair); px(c, 11, 2, 1, 3, hair);
  px(c, 6, 4, 1, 1, '#222'); px(c, 9, 4, 1, 1, '#222');
  px(c, 4, 7, 8, 5, shirt); px(c, 4, 11, 8, 1, 'rgba(0,0,0,.2)');
  px(c, 3, 8, 1, 4, '#f2c9a0'); px(c, 12, 8, 1, 4, '#f2c9a0');
  const l = frame ? 1 : 0;
  px(c, 5, 12, 2, 3 + l, '#3a3f6b'); px(c, 9, 12, 2, 4 - l, '#3a3f6b');
  return s;
}
function makeSlime(frame) {
  const s = mk(TS, TS), c = s.getContext('2d');
  const [rx, ry, cy] = frame ? [7.5, 4.5, 10.5] : [6.5, 5.5, 9.5];
  blob(c, 8, cy, rx, ry, '#2f8f3f');
  blob(c, 8, cy + 0.2, rx - 1, ry - 1, '#5fd35f');
  px(c, 5, cy - 3, 2, 1, '#a6f0a6');
  px(c, 5, cy - 1, 2, 2, '#fff'); px(c, 9, cy - 1, 2, 2, '#fff');
  px(c, 6, cy, 1, 1, '#111'); px(c, 10, cy, 1, 1, '#111');
  return s;
}

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.atlas = makeAtlas();
    this.people = [];
    for (let i = 0; i < 8; i++) this.people.push([makePerson(i, 0), makePerson(i, 1)]);
    this.slimes = [makeSlime(0), makeSlime(1)];
    this.dark = mk(2, 2);
    this.S = 3; this.W = 0; this.H = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.cv.width = Math.round(innerWidth * dpr);
    this.cv.height = Math.round(innerHeight * dpr);
    this.W = this.cv.width; this.H = this.cv.height;
    this.S = Math.max(2, Math.round(this.W / 380));
    this.dark.width = this.W; this.dark.height = this.H;
  }

  // 화면 좌표(CSS px) -> 월드 좌표
  screenToWorld(sx, sy, cam) {
    const dpr = this.W / innerWidth, k = TS * this.S;
    return { x: cam.x + (sx * dpr - this.W / 2) / k, y: cam.y + (sy * dpr - this.H / 2) / k };
  }

  draw(G, now) {
    const { ctx, S, W, H } = this;
    const k = TS * S;
    const cam = G.local;
    const ox = Math.round(W / 2 - cam.x * k), oy = Math.round(H / 2 - cam.y * k);
    const sx = (x) => Math.round(x * k + ox), sy = (y) => Math.round(y * k + oy);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#101a26'; ctx.fillRect(0, 0, W, H);

    // 타일
    const x0 = Math.floor((-ox) / k) - 1, x1 = Math.ceil((W - ox) / k) + 1;
    const y0 = Math.floor((-oy) / k) - 1, y1 = Math.ceil((H - oy) / k) + 1;
    const wf = Math.floor(now / 450);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const v = G.tileAt(tx, ty);
        if (v < 0) continue;
        const h = (Math.imul(tx, 73856093) ^ Math.imul(ty, 19349663)) >>> 0;
        const variant = v === T.WATER ? (h + wf) & 3 : h & 3;
        ctx.drawImage(this.atlas, variant * TS, v * TS, TS, TS, sx(tx), sy(ty), k, k);
      }
    }

    // 마을 경계 + 깃발 영역
    ctx.lineWidth = Math.max(2, S);
    ctx.setLineDash([k * 0.4, k * 0.3]);
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.beginPath(); ctx.arc(sx(0), sy(0), SAFE_R * k, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    for (const c of G.claims) {
      const mine = c.tag === G.tag;
      ctx.fillStyle = mine ? 'rgba(90,220,120,.08)' : 'rgba(255,170,60,.08)';
      ctx.strokeStyle = mine ? 'rgba(90,220,120,.7)' : 'rgba(255,170,60,.7)';
      const px0 = sx(c.x - CLAIM_R), py0 = sy(c.y - CLAIM_R), w = (CLAIM_R * 2 + 1) * k;
      ctx.fillRect(px0, py0, w, w); ctx.strokeRect(px0, py0, w, w);
    }

    // 커서(탭/호버한 칸)
    if (G.cursor && now - G.cursor.at < (G.cursor.hover ? 80 : 350)) {
      ctx.strokeStyle = G.cursor.ok ? '#ffe27a' : '#ff6b6b';
      ctx.lineWidth = Math.max(2, S);
      ctx.strokeRect(sx(G.cursor.x) + 1, sy(G.cursor.y) + 1, k - 2, k - 2);
    }

    // 엔티티 (y 정렬)
    const ents = [];
    for (const m of G.mobs.values()) ents.push({ y: m.y, kind: 'm', e: m });
    for (const [id, o] of G.others) ents.push({ y: o.y, kind: 'p', e: o, id });
    ents.push({ y: cam.y, kind: 'me', e: cam });
    ents.sort((a, b) => a.y - b.y);
    const fs = Math.max(10, Math.round(S * 3.2));
    ctx.font = `bold ${fs}px ui-monospace, Menlo, Consolas, "Noto Sans KR", monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const labels = [];
    for (const it of ents) {
      const e = it.e;
      const cx = sx(e.x), cy = sy(e.y);
      const bob = it.kind === 'm' ? 0 : 0;
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.ellipse(cx, cy + k * 0.32, k * 0.3, k * 0.1, 0, 0, Math.PI * 2); ctx.fill();
      if (it.kind === 'm') {
        const f = Math.floor((e.hop || 0) * 5 / Math.PI) & 1; // 통통 튀는 모션
        const hopY = Math.abs(Math.sin((e.hop || 0) * 5)) * k * 0.18;
        ctx.drawImage(this.slimes[f], cx - k / 2, cy - k * 0.62 - hopY, k, k);
        if (e.hp < 3) {
          ctx.fillStyle = '#000'; ctx.fillRect(cx - k * 0.3, cy - k * 0.78, k * 0.6, S + 1);
          ctx.fillStyle = '#e44'; ctx.fillRect(cx - k * 0.3, cy - k * 0.78, k * 0.6 * (e.hp / 3), S + 1);
        }
      } else {
        const color = it.kind === 'me' ? G.myColor : (G.names.get(it.id)?.color ?? 0);
        const f = e.moving ? (Math.floor(now / 140) & 1) : 0;
        ctx.drawImage(this.people[color][f], cx - k / 2, cy - k * 0.72 + bob, k, k);
        const name = it.kind === 'me' ? G.name : (G.names.get(it.id)?.name ?? '');
        const bid = it.kind === 'me' ? G.id : it.id;
        labels.push({ cx, y: cy - k * 0.78, name, me: it.kind === 'me', b: G.bubbles.get(bid) });
      }
    }

    // 밤 오버레이 (플레이어 주변은 밝게)
    const dk = darkness(G.time) * 0.78;
    if (dk > 0.01) {
      const d = this.dark.getContext('2d');
      d.globalCompositeOperation = 'source-over';
      d.clearRect(0, 0, W, H);
      d.fillStyle = `rgba(6,10,38,${dk})`; d.fillRect(0, 0, W, H);
      d.globalCompositeOperation = 'destination-out';
      const light = (x, y, r) => {
        const g = d.createRadialGradient(x, y, r * 0.15, x, y, r);
        g.addColorStop(0, 'rgba(0,0,0,.95)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        d.fillStyle = g; d.fillRect(x - r, y - r, r * 2, r * 2);
      };
      light(sx(cam.x), sy(cam.y), k * 6.5);
      for (const o of G.others.values()) light(sx(o.x), sy(o.y), k * 4);
      for (const c of G.claims) light(sx(c.x + 0.5), sy(c.y + 0.5), k * 4);
      light(sx(0), sy(0), k * 7);
      ctx.drawImage(this.dark, 0, 0);
    }

    // 이름표/말풍선
    ctx.lineJoin = 'round';
    for (const l of labels) {
      let y = l.y;
      if (l.name) {
        ctx.lineWidth = Math.max(3, S); ctx.strokeStyle = 'rgba(0,0,0,.85)';
        ctx.strokeText(l.name, l.cx, y);
        ctx.fillStyle = l.me ? '#ffe27a' : '#fff'; ctx.fillText(l.name, l.cx, y);
        y -= fs + 4;
      }
      if (l.b && l.b.until > now) {
        const tw = ctx.measureText(l.b.text).width + fs;
        ctx.fillStyle = 'rgba(255,255,255,.95)';
        const bx = l.cx - tw / 2, by = y - fs - 4;
        ctx.beginPath(); ctx.roundRect(bx, by, tw, fs + 8, 6); ctx.fill();
        ctx.fillStyle = '#111'; ctx.fillText(l.b.text, l.cx, by + fs + 1);
      }
    }
    // 깃발 주인 이름
    ctx.fillStyle = '#fff'; ctx.lineWidth = Math.max(3, S); ctx.strokeStyle = 'rgba(0,0,0,.85)';
    for (const c of G.claims) {
      const cx = sx(c.x + 0.5), cy = sy(c.y) - 4;
      if (cx < -100 || cx > W + 100 || cy < -50 || cy > H + 50) continue;
      ctx.strokeText(c.name, cx, cy); ctx.fillText(c.name, cx, cy);
    }
  }
}
