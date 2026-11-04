// 서버 스모크 테스트: 임시 서버를 띄워 접속/이동/채집/건축/보호구역을 검증
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3999;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc-'));
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, DATA_DIR: dir }, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 800));

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };

function client(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const c = { ws, tiles: new Map(), errs: [], chats: [], state: null, welcome: null, chunks: 0 };
  ws.on('message', (d) => {
    const m = JSON.parse(d);
    if (m.t === 'welcome') c.welcome = m;
    if (m.t === 's') c.state = m;
    if (m.t === 'err') c.errs.push(m.m);
    if (m.t === 'chat') c.chats.push(m);
    if (m.t === 'c') c.chunks++;
    if (m.t === 'tile') c.tiles.set(m.x + ',' + m.y, m.v);
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.open = new Promise((r) => ws.on('open', r));
  c.name = name;
  c.token = name + '-token-' + 'x'.repeat(20);
  return c;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const a = client('Alice'), b = client('Bob');
  await Promise.all([a.open, b.open]);
  a.send({ t: 'join', name: 'Alice', token: a.token });
  b.send({ t: 'join', name: 'Bob', token: b.token });
  await wait(400);
  ok(a.welcome && b.welcome, '두 명 접속 (게스트 닉네임)');
  ok(a.chunks >= 25, `청크 스트리밍 (${a.chunks}개)`);
  ok(a.state && a.state.on === 2, '접속자 수 동기화');

  // 이동
  const x0 = a.state.you[0];
  a.send({ t: 'in', dx: 1, dy: 0 });
  for (let i = 0; i < 8; i++) { await wait(100); a.send({ t: 'in', dx: 1, dy: 0 }); }
  a.send({ t: 'in', dx: 0, dy: 0 });
  await wait(200);
  ok(a.state.you[0] > x0 + 2, `이동 (x ${x0} → ${a.state.you[0]})`);
  ok(b.state.p.some((p) => p[0] === a.welcome.id), '다른 플레이어에게 위치 공유');

  // 마을 안 건축 금지 (안전지대)
  a.send({ t: 'place', x: Math.floor(a.state.you[0]) + 1, y: 0, k: 'wood_wall' });
  await wait(200);
  ok(a.errs.some((e) => e.includes('마을')), '마을 안 건축 차단');

  // 마을 밖으로 나가서 건축/채집/깃발
  let dirY = 0, px = a.state.you[0];
  for (let i = 0; i < 120 && Math.hypot(a.state.you[0], a.state.you[1]) < 15; i++) {
    if (i % 8 === 7) { dirY = Math.abs(a.state.you[0] - px) < 0.5 ? (dirY >= 0 ? -1 : 1) : 0; px = a.state.you[0]; }
    a.send({ t: 'in', dx: 1, dy: dirY }); await wait(100);
  }
  a.send({ t: 'in', dx: 0, dy: 0 });
  await wait(300);
  const [ax, ay] = a.state.you;
  ok(Math.hypot(ax, ay) > 13, `마을 밖으로 이동 (${ax}, ${ay})`);
  let tx = 0, ty = 0;
  a.errs.length = 0;
  for (const [ox, oy] of [[0, 2], [0, -2], [2, 0], [-2, 0], [2, 2], [-2, -2]]) {
    tx = Math.floor(ax) + ox; ty = Math.floor(ay) + oy;
    a.send({ t: 'place', x: tx, y: ty, k: 'wood_wall' });
    await wait(250);
    if (a.tiles.get(tx + ',' + ty) === 5) break;
  }
  ok(a.tiles.get(tx + ',' + ty) === 5, `나무벽 설치 (err=${a.errs.at(-1) || '-'})`);
  ok(a.state.you[3] <= 8, '재료 차감');

  // 깃발 (나무10+돌5 → 돌이 없어서 실패해야 함)
  a.errs.length = 0;
  a.send({ t: 'place', x: tx + 1, y: ty, k: 'flag' });
  await wait(250);
  ok(a.errs.some((e) => e.includes('부족')), '재료 부족 시 깃발 실패');

  // 너무 먼 곳 설치 거부
  a.errs.length = 0;
  a.send({ t: 'place', x: tx + 30, y: ty, k: 'floor' });
  await wait(250);
  ok(a.errs.some((e) => e.includes('멀어')), '사거리 밖 거부');

  // 부수기 → 자원 회수
  const wood = a.state.you[3];
  a.send({ t: 'break', x: tx, y: ty });
  await wait(300);
  ok(a.state.you[3] === wood + 1, '벽 부수면 자원 회수');

  // 채팅
  a.send({ t: 'chat', m: '안녕!' });
  await wait(200);
  ok(b.chats.some((c) => c.m === '안녕!' && c.name === 'Alice'), '공개 채팅');

  // 같은 토큰 재접속 → 기존 연결 종료, 인벤토리 유지
  const a2 = client('Alice');
  a2.token = a.token;
  await a2.open;
  const closed = new Promise((r) => a.ws.on('close', (code) => r(code)));
  a2.send({ t: 'join', name: 'Alice', token: a2.token });
  ok((await closed) === 4000, '중복 접속 시 이전 연결 종료');
  await wait(300);
  ok(a2.state && a2.state.you[3] === wood + 1, '토큰 기반 진행 유지');
  a2.ws.close(); b.ws.close();
} catch (e) { console.error(e); fail++; }

srv.kill('SIGTERM');
await wait(300);
const saved = fs.existsSync(path.join(dir, 'world.json'));
console.log((saved ? '  ✓ ' : '  ✗ ') + '월드 저장 (world.json)');
if (!saved) fail++;
fs.rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n${fail}개 실패` : '\n모두 통과');
process.exit(fail ? 1 : 0);
