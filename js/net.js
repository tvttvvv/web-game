// 네트워크 계층: Node 서버가 있으면 WebSocket, 없으면(GitHub Pages 등) P2P
// cb: { open(), message(obj), status(text), lost(text), kicked(code), role(name) }
import { World, bindSocket } from './core/world.js';
import { Game } from './core/game.js';

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

// ---------------- Node 서버 (WebSocket) ----------------
function wsNet(cb) {
  let ws = null, retry = 0, stopped = false;
  function connect() {
    stopped = false;
    cb.status('월드에 접속 중…');
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws.onopen = () => { retry = 0; cb.role('server'); cb.open(); };
    ws.onmessage = (e) => cb.message(JSON.parse(e.data));
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
  };
}

// ---------------- P2P (먼저 들어온 브라우저가 월드 호스트) ----------------
const SLOTS = 4;
const hostId = (k) => `pixel-commons-tvttvvv-web-game-v1-slot${k}`;
const STORE = 'pc_world';
const MAX_GUESTS = 20;
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

// 브라우저용 토큰 해시 (16자리 hex)
function fnvHex(s) {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 2246822519);
    b ^= b >>> 15;
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORE) || 'null')?.world || null; } catch { return null; }
}
function storeRaw(str) { try { localStorage.setItem(STORE, str); } catch {} }

function p2pNet(cb) {
  let peer = null, conn = null, host = null, stopped = false, timer = 0, watchdog = 0;
  let sendFn = () => {};
  let snapBuf = [];

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
  const retryLater = (ms) => {
    cleanup();
    if (!stopped) timer = setTimeout(start, ms ?? 400 + Math.random() * 1600);
  };
  const errMsg = (e) => (e && (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error')
    ? '연결 서버에 닿지 않아요. 다시 시도 중…' : '연결에 문제가 생겼어요. 다시 시도 중…');

  // 호스트 자리(슬롯)를 여러 개 둔다. 갑자기 꺼진 호스트의 ID는 중개 서버에 한동안 남으므로
  // 응답 없는 슬롯은 건너뛰고, 살아 있는 호스트가 있으면 접속, 없으면 빈 슬롯에서 월드를 연다.
  async function start() {
    if (stopped) return;
    cleanup();
    cb.status('월드를 찾는 중…');
    try { await loadPeerJs(); } catch {
      cb.lost('P2P 라이브러리를 불러오지 못했어요. 다시 시도 중…');
      return retryLater(4000);
    }
    const p = peer = new window.Peer({ debug: 0 });
    let slot = 0, attempt = null;
    const free = [];
    const next = (result) => {
      if (peer !== p || !attempt) return;
      clearTimeout(timer);
      if (result === 'none') free.push(slot);
      attempt = null;
      if (++slot < SLOTS) tryJoin();
      else if (free.length) { peer = null; p.destroy(); timer = setTimeout(() => tryHost(free[0]), Math.random() * 800); }
      else { cb.lost('월드를 여는 중… 잠시만요'); retryLater(5000); }
    };
    const tryJoin = () => {
      const c = attempt = conn = p.connect(hostId(slot), { reliable: true, serialization: 'raw' });
      timer = setTimeout(() => { if (attempt === c) { try { c.close(); } catch {} next('dead'); } }, 6000);
      c.on('open', () => { if (attempt !== c) return; attempt = null; clearTimeout(timer); guest(p, c); });
      c.on('error', () => {});
    };
    p.on('open', () => { if (peer === p) tryJoin(); });
    p.on('error', (e) => {
      if (peer !== p) return;
      if (e.type === 'peer-unavailable' && attempt) return next('none'); // 이 슬롯엔 호스트 없음
      if (!attempt && conn && conn.open) return; // 손님으로 접속한 뒤의 사소한 오류
      cb.lost(errMsg(e)); retryLater(2500 + Math.random() * 2000);
    });
  }

  function tryHost(slot) {
    if (stopped) return;
    const p = peer = new window.Peer(hostId(slot), { debug: 0 });
    p.on('open', () => { if (peer === p) becomeHost(p); });
    p.on('disconnected', () => {
      if (peer === p && host) setTimeout(() => { if (peer === p && !p.destroyed) p.reconnect(); }, 1000);
    });
    p.on('error', (e) => {
      if (peer !== p) return;
      if (e.type === 'unavailable-id') {
        // 누가 먼저 이 자리를 차지함 → 다시 찾아서 접속
        if (host) cb.lost('다른 호스트가 생겼어요. 그쪽으로 옮기는 중…');
        return retryLater(300 + Math.random() * 700);
      }
      if (host) {
        if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error' || e.type === 'socket-closed')
          setTimeout(() => { if (peer === p && !p.destroyed) p.reconnect(); }, 2000);
      } else { cb.lost(errMsg(e)); retryLater(2500 + Math.random() * 2000); }
    });
  }

  function becomeHost(p) {
    const world = new World(loadSaved());
    const game = new Game(world, fnvHex);
    let last = performance.now(), lastSnap = '';
    const h = host = {
      world, game, conns: new Set(), timers: [],
      save() { game.syncAll(); const s = JSON.stringify({ ts: Date.now(), world: world.serialize() }); storeRaw(s); world.dirty = false; return s; },
      snapshot(only) {
        const s = JSON.stringify({ ts: Date.now(), world: world.serialize() });
        if (!only && s.length === lastSnap.length && s === lastSnap) return;
        if (!only) lastSnap = s;
        const n = Math.ceil(s.length / 16000);
        for (const c of only ? [only] : h.conns) {
          if (!c.open) continue;
          for (let i = 0; i < n; i++) c.send(JSON.stringify({ t: 'snap', i, n, d: s.slice(i * 16000, (i + 1) * 16000) }));
        }
      },
    };
    h.timers.push(setInterval(() => {
      const now = performance.now();
      game.tick(Math.min(0.1, (now - last) / 1000));
      last = now;
    }, 50));
    h.timers.push(setInterval(() => { if (world.dirty) h.save(); }, 5000));
    h.timers.push(setInterval(() => { game.syncAll(); h.snapshot(); }, 15000));

    p.on('connection', (c) => {
      c.on('open', () => {
        if (host !== h) { c.close(); return; }
        const ws = {
          get readyState() { return c.open ? 1 : 3; },
          get bufferedAmount() { return c.dataChannel?.bufferedAmount || 0; },
          send(s) { try { c.send(s); } catch {} },
          close(code) { try { c.send(JSON.stringify({ t: 'kick', code })); } catch {} setTimeout(() => c.close(), 300); },
        };
        if (h.conns.size >= MAX_GUESTS) return ws.close(4002);
        h.conns.add(c);
        const sock = bindSocket(game, ws);
        c.on('data', (d) => sock.receive(String(d)));
        c.on('close', () => { h.conns.delete(c); sock.closed(); });
        c.on('error', () => {});
        game.syncAll();
        h.snapshot(c); // 호스트가 나가도 이어받을 수 있게 월드 사본 전달
      });
    });

    // 호스트 본인의 캐릭터 (루프백)
    const lws = {
      readyState: 1, bufferedAmount: 0,
      send: (s) => queueMicrotask(() => { if (host === h) cb.message(JSON.parse(s)); }),
      close: (code) => { if (code >= 4000) cb.kicked(code); },
    };
    const lsock = bindSocket(game, lws);
    sendFn = (o) => lsock.receive(o);
    cb.role('host');
    cb.open();
  }

  // 손님으로 접속된 연결 처리
  function guest(p, c) {
    conn = c;
    sendFn = (o) => { if (c.open) c.send(JSON.stringify(o)); };
    // 호스트는 초당 10번 상태를 보냄 → 4초간 조용하면 호스트가 사라진 것
    let lastData = Date.now();
    const lostHost = () => {
      if (conn !== c || stopped) return;
      cb.lost('호스트가 나갔어요. 월드를 이어받는 중…');
      retryLater(200 + Math.random() * 600);
    };
    watchdog = setInterval(() => { if (Date.now() - lastData > 4000) lostHost(); }, 1000);
    c.on('data', (d) => {
      lastData = Date.now();
      let m; try { m = JSON.parse(String(d)); } catch { return; }
      if (m.t === 'snap') {
        if (m.i === 0) snapBuf = [];
        snapBuf[m.i] = m.d;
        if (m.i === m.n - 1 && snapBuf.filter((x) => x !== undefined).length === m.n) storeRaw(snapBuf.join(''));
      } else if (m.t === 'kick') {
        stopped = true; cleanup(); cb.kicked(m.code);
      } else cb.message(m);
    });
    c.on('close', lostHost);
    cb.role('guest');
    cb.open();
  }

  // 창을 닫을 때 월드 저장 + ID 즉시 반납 (다른 사람이 바로 이어받도록)
  addEventListener('pagehide', () => { if (host) host.save(); if (peer) try { peer.destroy(); } catch {} });

  start();
  return {
    send(o) { sendFn(o); },
    restart() { stopped = false; cleanup(); start(); },
  };
}
