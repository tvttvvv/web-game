import {
  CHUNK, isSolidTile, SPEED, PLAYER_R, REACH, SAFE_R, MAX_HP, BUILD, T,
  darkness, mobTime, moveEntity,
} from './shared.js';
import { Renderer } from './render.js';
import { setupInput } from './input.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const renderer = new Renderer(canvas);
addEventListener('resize', () => renderer.resize());
for (const ev of ['contextmenu', 'gesturestart', 'dblclick'])
  addEventListener(ev, (e) => e.preventDefault());

// ---------- 게임 상태 ----------
const G = {
  id: 0, tag: '', name: '', myColor: 0,
  local: { x: 0, y: 0, moving: false },   // 내 캐릭터(클라이언트 예측)
  srv: { x: 0, y: 0 },                     // 서버가 알려준 내 위치
  hp: MAX_HP, wood: 0, stone: 0, kills: 0, online: 1, time: 0.05,
  chunks: new Map(), claims: [], names: new Map(), others: new Map(), mobs: new Map(),
  bubbles: new Map(), cursor: null, ready: false,
  mode: 'mine', sel: 'wood_wall',
  tileAt(x, y) {
    const c = G.chunks.get(Math.floor(x / CHUNK) + ',' + Math.floor(y / CHUNK));
    if (!c) return -1;
    return c[(y - Math.floor(y / CHUNK) * CHUNK) * CHUNK + (x - Math.floor(x / CHUNK) * CHUNK)];
  },
};
const solidAt = (x, y) => { const v = G.tileAt(x, y); return v < 0 || isSolidTile(v); };

// ---------- UI ----------
let toastTimer = 0;
function toast(msg) {
  const el = $('toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1600);
}
let bannerTimer = 0;
function banner(msg) {
  const el = $('banner'); el.textContent = msg; el.classList.add('show');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => el.classList.remove('show'), 3500);
}
function logChat(name, msg, sys) {
  const log = $('chatlog'), d = document.createElement('div');
  if (sys) { d.className = 'sys'; d.textContent = msg; }
  else { const b = document.createElement('b'); b.textContent = name + ' '; d.append(b, msg); }
  log.append(d);
  while (log.children.length > 6) log.firstChild.remove();
  setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 700); }, 12000);
}
function renderHud() {
  $('hp').textContent = '♥'.repeat(Math.max(0, G.hp)) + '♡'.repeat(Math.max(0, MAX_HP - G.hp));
  $('wood').textContent = '🪵 ' + G.wood;
  $('stone').textContent = '🪨 ' + G.stone;
  $('kills').textContent = '💀 ' + G.kills;
  $('online').textContent = '👥 ' + G.online;
  const d = darkness(G.time);
  $('clock').textContent = d > 0.6 ? '🌙 밤' : d > 0 ? '🌇 해질녘' : '☀️ 낮';
  $('zone').textContent = Math.hypot(G.local.x, G.local.y) < SAFE_R ? '🏘️ 마을(안전)' : '';
}
function buildPalette() {
  const pal = $('palette'); pal.textContent = '';
  const icons = { wood_wall: '🟫', stone_wall: '⬜', floor: '🟧', flag: '🚩' };
  for (const [k, def] of Object.entries(BUILD)) {
    const b = document.createElement('button');
    b.dataset.k = k;
    const cost = Object.entries(def.cost).map(([r, n]) => (r === 'wood' ? '🪵' : '🪨') + n).join(' ');
    b.innerHTML = `<span class="ic">${icons[k]}</span>${def.label}<br>${cost}`;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); G.sel = k; refreshPalette(); });
    pal.append(b);
  }
}
function refreshPalette() {
  for (const b of $('palette').children) {
    const def = BUILD[b.dataset.k];
    b.classList.toggle('sel', b.dataset.k === G.sel);
    b.classList.toggle('off', Object.entries(def.cost).some(([r, n]) => (G[r] || 0) < n));
  }
}
function setMode(m) {
  G.mode = m;
  $('btnMode').innerHTML = m === 'mine' ? '⛏️<small>채집</small>' : '🧱<small>건축</small>';
  $('btnMode').classList.toggle('build', m === 'build');
  $('palette').hidden = m !== 'build';
  refreshPalette();
}
buildPalette(); setMode('mine');

// ---------- 네트워크 ----------
let ws = null, wantJoin = null, retry = 0;
const token = (() => {
  try {
    let t = localStorage.getItem('pc_token');
    if (!t) { t = crypto.randomUUID().replace(/-/g, '') + Math.random().toString(36).slice(2); localStorage.setItem('pc_token', t); }
    return t;
  } catch { return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now(); }
})();
const send = (o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => { retry = 0; send({ t: 'join', name: wantJoin, token }); };
  ws.onmessage = (e) => onMsg(JSON.parse(e.data));
  ws.onclose = (e) => {
    G.ready = false;
    if (e.code === 4000) return showLogin('다른 곳에서 접속했어요. 다시 입장하려면 눌러 주세요.');
    if (e.code === 4002) return showLogin('서버가 가득 찼어요.');
    if (e.code === 4003) return showLogin('이 네트워크에서 접속이 너무 많아요.');
    showLogin('연결이 끊겼어요. 다시 연결 중…');
    setTimeout(connect, Math.min(5000, 800 * ++retry));
  };
}
function showLogin(msg) { $('login').classList.remove('hide'); $('loginMsg').textContent = msg || ''; }

function onMsg(m) {
  switch (m.t) {
    case 'welcome':
      G.id = m.id; G.tag = m.tag; G.name = m.name;
      G.local.x = G.srv.x = m.x; G.local.y = G.srv.y = m.y;
      G.chunks.clear(); G.others.clear(); G.mobs.clear();
      G.ready = true;
      $('login').classList.add('hide');
      try { localStorage.setItem('pc_name', m.name); } catch {}
      break;
    case 'pl':
      G.names.set(m.id, { name: m.name, color: m.color });
      if (m.id === G.id) G.myColor = m.color;
      break;
    case 'pq': G.names.delete(m.id); G.others.delete(m.id); break;
    case 'c': {
      const t = new Uint8Array(CHUNK * CHUNK);
      for (let i = 0; i < t.length; i++) t[i] = m.d.charCodeAt(i) - 48;
      G.chunks.set(m.cx + ',' + m.cy, t);
      break;
    }
    case 'tile': {
      const c = G.chunks.get(Math.floor(m.x / CHUNK) + ',' + Math.floor(m.y / CHUNK));
      if (c) c[(m.y - Math.floor(m.y / CHUNK) * CHUNK) * CHUNK + (m.x - Math.floor(m.x / CHUNK) * CHUNK)] = m.v;
      break;
    }
    case 'claims': G.claims = m.c.map(([x, y, name, tag]) => ({ x, y, name, tag })); break;
    case 's': onState(m); break;
    case 'chat':
      if (!m.id) logChat('', m.m, true);
      else { logChat(m.name, m.m); G.bubbles.set(m.id, { text: m.m, until: performance.now() + 5000 }); }
      break;
    case 'err': toast(m.m); break;
    case 'ev':
      if (m.k === 'hurt') { document.body.animate([{ boxShadow: 'inset 0 0 90px 20px rgba(255,0,0,.6)' }, { boxShadow: 'inset 0 0 0 0 rgba(255,0,0,0)' }], 350); }
      if (m.k === 'died') { G.local.x = G.srv.x = m.x; G.local.y = G.srv.y = m.y; toast('쓰러졌어요! 마을에서 다시 시작해요'); }
      break;
  }
}

let wasNight = false;
function onState(m) {
  const [x, y, hp, wood, stone, kills] = m.you;
  G.srv.x = x; G.srv.y = y;
  G.hp = hp; G.wood = wood; G.stone = stone; G.kills = kills; G.online = m.on; G.time = m.tm;
  const err = Math.hypot(x - G.local.x, y - G.local.y);
  if (err > 3) { G.local.x = x; G.local.y = y; }
  else if (err > 1.2) { G.local.x += (x - G.local.x) * 0.25; G.local.y += (y - G.local.y) * 0.25; }

  const sync = (map, list, extra) => {
    const seen = new Set();
    for (const row of list) {
      const [id, ex, ey, ehp] = row; seen.add(id);
      let o = map.get(id);
      if (!o) { o = { x: ex, y: ey, hop: Math.random() * 6 }; map.set(id, o); }
      o.tx = ex; o.ty = ey; o.hp = ehp;
    }
    for (const id of map.keys()) if (!seen.has(id)) map.delete(id);
  };
  sync(G.others, m.p); sync(G.mobs, m.m);

  // 멀어진 청크 정리
  const pcx = Math.floor(x / CHUNK), pcy = Math.floor(y / CHUNK);
  for (const k of G.chunks.keys()) {
    const [a, b] = k.split(',').map(Number);
    if (Math.max(Math.abs(a - pcx), Math.abs(b - pcy)) > 3) G.chunks.delete(k);
  }
  const night = mobTime(G.time);
  if (night && !wasNight) banner('🌙 밤이 왔어요!\n슬라임이 몰려옵니다');
  if (!night && wasNight) banner('☀️ 아침이 밝았어요');
  wasNight = night;
  refreshPalette();
}

// ---------- 입력/액션 ----------
const input = setupInput($('joy'), $('knob'));
let lastSent = { dx: 0, dy: 0 }, lastSentAt = 0;

function reachOk(tx, ty) { return Math.hypot(tx + 0.5 - G.local.x, ty + 0.5 - G.local.y) <= REACH + 0.3; }
function actOn(wx, wy, hover) {
  const tx = Math.floor(wx), ty = Math.floor(wy);
  const ok = reachOk(tx, ty);
  G.cursor = { x: tx, y: ty, at: performance.now(), ok, hover };
  if (hover) return;
  if (!G.ready) return;
  if (G.mode === 'mine') {
    // 몬스터를 탭하면 공격
    for (const m of G.mobs.values())
      if (Math.hypot(m.x - wx, m.y - 0.3 - wy) < 0.9) { attack(); return; }
    if (!ok) return toast('너무 멀어요');
    send({ t: 'break', x: tx, y: ty });
  } else {
    if (!ok) return toast('너무 멀어요');
    send({ t: 'place', x: tx, y: ty, k: G.sel });
  }
}
function attack() { if (G.ready) send({ t: 'atk' }); }

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const w = renderer.screenToWorld(e.clientX, e.clientY, G.local);
  actOn(w.x, w.y, false);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const w = renderer.screenToWorld(e.clientX, e.clientY, G.local);
  actOn(w.x, w.y, true);
});

const btn = (el, fn) => el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
btn($('btnAtk'), attack);
btn($('btnMode'), () => setMode(G.mode === 'mine' ? 'build' : 'mine'));
$('btnFull').addEventListener('click', () => {
  const d = document.documentElement;
  if (document.fullscreenElement) document.exitFullscreen?.();
  else (d.requestFullscreen || d.webkitRequestFullscreen)?.call(d);
});

// 채팅
const chatForm = $('chatForm'), chatInput = $('chatInput');
function openChat() { chatForm.hidden = false; chatInput.focus(); }
function closeChat() { chatForm.hidden = true; chatInput.value = ''; chatInput.blur(); }
$('btnChat').addEventListener('click', () => (chatForm.hidden ? openChat() : closeChat()));
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const t = chatInput.value.trim();
  if (t) send({ t: 'chat', m: t });
  closeChat();
});
addEventListener('keydown', (e) => {
  if (e.target === chatInput) { if (e.key === 'Escape') closeChat(); return; }
  if (!G.ready) return;
  if (e.code === 'Space') { e.preventDefault(); attack(); }
  else if (e.code === 'KeyB') setMode(G.mode === 'mine' ? 'build' : 'mine');
  else if (e.code === 'Enter') { e.preventDefault(); openChat(); }
  else if (/^Digit[1-4]$/.test(e.code)) { G.sel = Object.keys(BUILD)[+e.code.slice(5) - 1]; setMode('build'); }
});

// ---------- 로그인 ----------
try { $('nick').value = localStorage.getItem('pc_name') || ''; } catch {}
$('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('nick').value.trim();
  if (!name) return;
  wantJoin = name;
  $('loginMsg').textContent = '접속 중…';
  if (ws && ws.readyState <= 1) ws.close();
  connect();
});

// ---------- 메인 루프 ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (G.ready) {
    const { dx, dy } = input.vec();
    // 서버에 방향 전송 (변경 시 즉시, 이동 중엔 100ms마다 갱신)
    const changed = Math.abs(dx - lastSent.dx) > 0.05 || Math.abs(dy - lastSent.dy) > 0.05;
    if (changed || ((dx || dy) && now - lastSentAt > 100)) {
      send({ t: 'in', dx: +dx.toFixed(2), dy: +dy.toFixed(2) });
      lastSent = { dx, dy }; lastSentAt = now;
    }
    // 예측 이동 (서버와 동일한 충돌 규칙)
    const mag = Math.min(1, Math.hypot(dx, dy));
    G.local.moving = mag > 0.05;
    if (G.local.moving) moveEntity(G.local, dx, dy, SPEED * mag * dt, PLAYER_R, solidAt);
    else {
      const k = 1 - Math.exp(-dt * 10);
      G.local.x += (G.srv.x - G.local.x) * k; G.local.y += (G.srv.y - G.local.y) * k;
    }
    // 다른 플레이어/몬스터 보간
    const k = 1 - Math.exp(-dt * 12);
    for (const map of [G.others, G.mobs])
      for (const o of map.values()) {
        const ox = o.x, oy = o.y;
        o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k;
        o.moving = Math.hypot(o.x - ox, o.y - oy) > 0.004;
        o.hop += dt;
      }
    renderer.draw(G, now);
    renderHud();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
