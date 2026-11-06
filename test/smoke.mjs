// 서버 스모크 테스트: 임시 서버를 띄워 실제 WebSocket으로 접속/이동/채팅/재접속 확인
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3999;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpg-'));
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT, DATA_DIR: dir }, stdio: 'inherit' });
await new Promise((r) => setTimeout(r, 1000));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++; };

function client(name, token) {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const c = { ws, msgs: [], last: (t) => [...c.msgs].reverse().find((m) => m.t === t) };
  ws.on('message', (d) => c.msgs.push(JSON.parse(d)));
  c.send = (o) => ws.send(JSON.stringify(o));
  c.open = new Promise((r) => ws.on('open', r));
  return c;
}

try {
  const r = await fetch(`http://localhost:${PORT}/__pc_server`);
  ok(r.ok && (await r.text()) === 'ok', '서버 모드 감지 엔드포인트');
  const html = await (await fetch(`http://localhost:${PORT}/`)).text();
  ok(html.includes('별빛 모험단'), '정적 페이지 제공');
  const a = client('Alice', 'alice-token-xxxxxxxxxxxx'), b = client('Bob', 'bob-token-xxxxxxxxxxxxxx');
  await Promise.all([a.open, b.open]);
  a.send({ t: 'join', ver: 4, name: 'Alice', token: 'alice-token-xxxxxxxxxxxx', cls: 'warrior', look: [0, 1, 2, 3] });
  b.send({ t: 'join', ver: 4, name: 'Bob', token: 'bob-token-xxxxxxxxxxxxxx', cls: 'cleric' });
  await wait(600);
  const w = a.last('welcome');
  ok(w && w.ver === 4 && w.ch.cls === 'warrior', '접속 + 캐릭터 생성 (welcome v4)');
  a.send({ t: 'pos', x: w.x + 1, z: w.z + 1, ry: 1, a: 1 });
  await wait(300);
  const s = b.last('s');
  ok(s && s.p.some((p) => p[0] === w.id && Math.abs(p[1] - (w.x + 1)) < 0.1), '위치 동기화');
  ok(s && Array.isArray(s.me) && s.me[2] > 0, '내 체력/마나 정보');
  a.send({ t: 'chat', m: '안녕!' });
  await wait(200);
  ok(b.msgs.some((m) => m.t === 'chat' && m.m === '안녕!' && m.name === 'Alice'), '공개 채팅');
  const old = client('Old', 'old-token-xxxxxxxxxxxxxx');
  await old.open;
  const closed = new Promise((r) => old.ws.on('close', (code) => r(code)));
  old.send({ t: 'join', ver: 3, name: 'Old', token: 'old-token-xxxxxxxxxxxxxx', cls: 'warrior' });
  ok((await closed) === 4004, '이전 버전 접속 거절');
  const a2 = client('Alice', 'alice-token-xxxxxxxxxxxx');
  await a2.open;
  const aClosed = new Promise((r) => a.ws.on('close', (code) => r(code)));
  a2.send({ t: 'join', ver: 4, name: 'Alice', token: 'alice-token-xxxxxxxxxxxx', char: w.ch });
  ok((await aClosed) === 4000, '같은 토큰 중복 접속 시 이전 연결 종료');
  await wait(300);
  ok(a2.last('welcome') && a2.last('welcome').ch.cls === 'warrior', '저장된 캐릭터로 다시 접속');
  a2.ws.close(); b.ws.close();
  await wait(300);
} catch (e) { console.error(e); fail++; }

srv.kill('SIGTERM');
await wait(500);
fs.rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n${fail}개 실패` : '\n모두 통과');
process.exit(fail ? 1 : 0);
