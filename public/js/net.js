// 네트워크: Node 서버가 있으면 WebSocket, 없으면(GitHub Pages) P2P
// cb: { open(isHost), message(obj), status(text), lost(text), kicked(code), role(name), mirror()→save|null }
import { World } from './core/world.js';
import { Game, bindSocket } from './core/game.js';
import { PROTO } from './shared/constants.js';

export async function detectMode() {
  try {
    const r = await fetch('__pc_server', { cache: 'no-store' });
    if (r.ok && (await r.text()) === 'ok') return 'server';
  } catch {}
  return 'p2p';
}

export function createNet(mode, cb) {
  return mode === 'server' ? wsNet(cb) : p2pNet(cb);
}

// ---------------- Node 서버 ----------------
function wsNet(cb) {
  let ws = null, retry = 0, stopped = false;
  function connect() {
    stopped = false;
    cb.status('월드에 접속 중…');
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + location.pathname.replace(/[^/]*$/, ''));
    ws.onopen = () => { retry = 0; cb.role('server'); cb.open(false); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } cb.message(m); };
    ws.onclose = (e) => {
      if (stopped) return;
      if (e.code >= 4000 && e.code < 4100) { stopped = true; cb.kicked(e.code); return; }
      cb.lost('연결이 끊겼어요. 다시 연결 중…');
      setTimeout(connect, Math.min(5000, 800 * ++retry));
    };
  }
  connect();
  return {
    send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); },
    restart() { retry = 0; connect(); },
    isHost: () => false,
  };
}

// ---------------- P2P ----------------
const SLOTS = 4;
const hostId = (k) => `pixel-commons-tvttvvv-web-game-v${PROTO}-slot${k}`;
export const SAVE_KEY = 'pc3_world';
const MAX_GUESTS = 16;
const PART = 15000;
const PEER_SCRIPTS = [
  'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js',
  'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
];

function loadPeerJs() {
  if (window.Peer) return Promise.resolve();
  return PEER_SCRIPTS.reduce((p, src) => p.catch(() => new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => { s.remove(); fail(); };
    document.head.append(s);
  })), Promise.reject());
}

function fnvHex(s) {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 2246822519); b ^= b >>> 15;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

export function loadSave() {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); return s && s.v === 3 ? s : null; } catch { return null; }
}
export function storeSave(obj) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(obj)); return true; } catch { return false; }
}

// 긴 문자열은 조각내서 보냄
let partSeq = 1;
function sendSplit(conn, s) {
  if (s.length <= PART) { conn.send(s); return; }
  const id = partSeq++, n = Math.ceil(s.length / PART);
  for (let i = 0; i < n; i++) conn.send(JSON.stringify({ t: '_p', id, i, n, d: s.slice(i * PART, (i + 1) * PART) }));
}
function joiner() {
  const bufs = new Map();
  return (raw) => {
    if (raw.length > 6 && raw.startsWith('{"t":"_p"')) {
      let m; try { m = JSON.parse(raw); } catch { return null; }
      let b = bufs.get(m.id);
      if (!b) { b = { parts: [], got: 0 }; bufs.set(m.id, b); }
      if (b.parts[m.i] === undefined) { b.parts[m.i] = m.d; b.got++; }
      if (b.got === m.n) { bufs.delete(m.id); return b.parts.join(''); }
      if (bufs.size > 8) bufs.delete(bufs.keys().next().value);
      return null;
    }
    return raw;
  };
}

function p2pNet(cb) {
  let peer = null, conn = null, host = null, stopped = false, timer = 0, watchdog = 0;
  let sendFn = () => {};
  let merged = false;

  const cleanup = () => {
    clearTimeout(timer); clearInterval(watchdog);
    if (host) {
      for (const t of host.timers) clearInterval(t);
      host.save();
      for (const c of host.conns) { try { c.close(); } catch {} }
      host = null;
    }
    if (conn) { try { conn.close(); } catch {} conn = null; }
    if (peer) { const p = peer; peer = null; try { p.destroy(); } catch {} }
    sendFn = () => {};
  };
  const retryLater = (ms) => { cleanup(); if (!stopped) timer = setTimeout(start, ms ?? 400 + Math.random() * 1600); };
  const errMsg = (e) => (e && /network|server|socket/.test(e.type) ? '연결 서버에 닿지 않아요. 다시 시도 중…' : '연결에 문제가 생겼어요. 다시 시도 중…');

  async function start() {
    if (stopped) return;
    cleanup();
    cb.status('월드를 찾는 중…');
    try { await loadPeerJs(); } catch { cb.lost('P2P 라이브러리를 불러오지 못했어요. 다시 시도 중…'); return retryLater(4000); }
    const p = peer = new window.Peer({ debug: 0 });
    let slot = 0, attempt = null;
    const free = [];
    const next = (result) => {
      if (peer !== p || !attempt) return;
      clearTimeout(timer);
      if (result === 'none') free.push(slot);
      attempt = null;
      if (++slot < SLOTS) tryJoin();
      else if (free.length) { peer = null; p.destroy(); timer = setTimeout(() => tryHost(free[0]), Math.random() * 700); }
      else { cb.lost('월드를 여는 중… 잠시만요'); retryLater(5000); }
    };
    const tryJoin = () => {
      const c = attempt = conn = p.connect(hostId(slot), { reliable: true, serialization: 'raw' });
      timer = setTimeout(() => { if (attempt === c) { try { c.close(); } catch {} next('dead'); } }, 6000);
      c.on('open', () => { if (attempt !== c) return; attempt = null; clearTimeout(timer); guest(c); });
      c.on('error', () => {});
    };
    p.on('open', () => { if (peer === p) tryJoin(); });
    p.on('error', (e) => {
      if (peer !== p) return;
      if (e.type === 'peer-unavailable' && attempt) return next('none');
      if (!attempt && conn && conn.open) return;
      cb.lost(errMsg(e)); retryLater(2500 + Math.random() * 2000);
    });
  }

  function tryHost(slot) {
    if (stopped) return;
    const p = peer = new window.Peer(hostId(slot), { debug: 0 });
    p.on('open', () => { if (peer === p) becomeHost(p); });
    p.on('disconnected', () => { if (peer === p && host) setTimeout(() => { if (peer === p && !p.destroyed) p.reconnect(); }, 1000); });
    p.on('error', (e) => {
      if (peer !== p) return;
      if (e.type === 'unavailable-id') {
        if (host) cb.lost('다른 호스트가 생겼어요. 그쪽으로 옮기는 중…');
        return retryLater(300 + Math.random() * 700);
      }
      if (host) {
        if (/network|server|socket/.test(e.type)) setTimeout(() => { if (peer === p && !p.destroyed) p.reconnect(); }, 2000);
      } else { cb.lost(errMsg(e)); retryLater(2500 + Math.random() * 2000); }
    });
  }

  function becomeHost(p) {
    // 이번 접속 중 받은 최신 사본 > 이 기기에 저장된 월드
    const mirror = cb.mirror && cb.mirror();
    const saved = loadSave();
    const base = mirror && (!saved || (mirror.ts || 0) >= (saved.ts || 0) - 60000) ? mirror : saved;
    const world = new World(base);
    const game = new Game(world, { hash: fnvHex, p2p: true, log: (s) => console.log(s) });
    let last = performance.now();
    const h = host = {
      world, game, conns: new Set(), timers: [],
      save() { game.syncAll(); storeSave(world.serialize()); world.dirty = false; },
    };
    h.timers.push(setInterval(() => {
      const now = performance.now();
      try { game.tick(Math.min(0.1, (now - last) / 1000)); } catch (e) { console.error(e); }
      last = now;
    }, 50));
    h.timers.push(setInterval(() => { if (world.dirty) h.save(); }, 8000));

    p.on('connection', (c) => {
      c.on('open', () => {
        if (host !== h) { c.close(); return; }
        const ws = {
          get readyState() { return c.open ? 1 : 3; },
          get bufferedAmount() { return c.dataChannel?.bufferedAmount || 0; },
          send(s) { try { sendSplit(c, s); } catch {} },
          close(code) { try { c.send(JSON.stringify({ t: 'kick', code })); } catch {} setTimeout(() => c.close(), 300); },
        };
        if (h.conns.size >= MAX_GUESTS) return ws.close(4002);
        h.conns.add(c);
        const sock = bindSocket(game, ws);
        const join = joiner();
        c.on('data', (d) => { const s = join(String(d)); if (s) sock.receive(s); });
        c.on('close', () => { h.conns.delete(c); sock.closed(); });
        c.on('error', () => {});
      });
    });

    // 호스트 본인 캐릭터 (루프백)
    const lws = {
      readyState: 1, bufferedAmount: 0, local: true,
      send: (s) => queueMicrotask(() => { if (host === h) cb.message(JSON.parse(s)); }),
      close: (code) => { if (code >= 4000) cb.kicked(code); },
    };
    const lsock = bindSocket(game, lws);
    sendFn = (o) => lsock.receive(o);
    cb.role('host');
    cb.open(true);
  }

  function guest(c) {
    conn = c;
    sendFn = (o) => { if (c.open) sendSplit(c, JSON.stringify(o)); };
    let lastData = Date.now();
    const join = joiner();
    const lostHost = () => {
      if (conn !== c || stopped) return;
      cb.lost('호스트가 나갔어요. 월드를 이어받는 중…');
      retryLater(200 + Math.random() * 600);
    };
    watchdog = setInterval(() => { if (Date.now() - lastData > 5000) lostHost(); }, 1000);
    c.on('data', (d) => {
      lastData = Date.now();
      const s = join(String(d));
      if (!s) return;
      let m; try { m = JSON.parse(s); } catch { return; }
      if (m.t === 'kick') { stopped = true; cleanup(); cb.kicked(m.code); return; }
      if (m.t === 'welcome' && !merged) {
        merged = true;
        const save = loadSave();
        if (save && save.mods && Object.keys(save.mods).length) setTimeout(() => sendFn({ t: 'merge', save }), 1500);
      }
      cb.message(m);
    });
    c.on('close', lostHost);
    cb.role('guest');
    cb.open(false);
  }

  addEventListener('pagehide', () => { if (host) host.save(); if (peer) try { peer.destroy(); } catch {} });
  start();
  return {
    send(o) { sendFn(o); },
    restart() { stopped = false; cleanup(); start(); },
    isHost: () => !!host,
    hostGame: () => host && host.game,
  };
}
