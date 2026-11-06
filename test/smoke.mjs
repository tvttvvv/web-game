// 서버 스모크 테스트: 임시 서버를 띄워 실제 WebSocket으로 접속/이동/채팅/보호구역/저장 확인
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 3999;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pc3-'));
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
  c.join = () => c.send({ t: 'join', ver: 3, name, token, skin: [1, 2, 3, 4] });
  return c;
}

try {
  const r = await fetch(`http://localhost:${PORT}/__pc_server`);
  ok(r.ok && (await r.text()) === 'ok', '서버 모드 감지 엔드포인트');
  const html = await (await fetch(`http://localhost:${PORT}/`)).text();
  ok(html.includes('픽셀 커먼스'), '정적 페이지 제공');
  const a = client('Alice', 'alice-token-xxxxxxxxxxxx'), b = client('Bob', 'bob-token-xxxxxxxxxxxxxx');
  await Promise.all([a.open, b.open]);
  a.join(); b.join();
  await wait(600);
  const w = a.last('welcome');
  ok(w && w.ver === 3 && w.name === 'Alice', '접속 (welcome v3)');
  ok(a.last('world') && typeof a.last('world').mods === 'object', '월드 변경 목록 수신');
  ok(a.last('inv') === undefined && Array.isArray(w.inv), '시작 인벤토리');
  // 이동 → 상대에게 보임
  a.send({ t: 'pos', x: w.pos[0] + 1, y: w.pos[1], z: w.pos[2] + 1, yaw: 1, pitch: 0, f: 0, h: 0 });
  await wait(300);
  const s = b.last('s');
  ok(s && s.p.some((p) => p[0] === w.id && Math.abs(p[1] - (w.pos[0] + 1)) < 0.05), '위치 동기화');
  // 스폰 보호
  a.send({ t: 'dig', x: 0, y: w.spawn[1] - 1, z: 0 });
  await wait(200);
  ok(a.last('b1') && a.last('msg'), '스폰 광장 보호');
  // 채팅
  a.send({ t: 'chat', m: '안녕!' });
  await wait(200);
  ok(b.msgs.some((m) => m.t === 'chat' && m.m === '안녕!' && m.name === 'Alice'), '공개 채팅');
  // 버전 불일치
  const old = client('Old', 'old-token-xxxxxxxxxxxxxx');
  await old.open;
  const closed = new Promise((r) => old.ws.on('close', (code) => r(code)));
  old.send({ t: 'join', ver: 2, name: 'Old', token: 'old-token-xxxxxxxxxxxxxx' });
  ok((await closed) === 4004, '이전 버전 접속 거절');
  // 중복 접속
  const a2 = client('Alice', 'alice-token-xxxxxxxxxxxx');
  await a2.open;
  const aClosed = new Promise((r) => a.ws.on('close', (code) => r(code)));
  a2.join();
  ok((await aClosed) === 4000, '같은 토큰 중복 접속 시 이전 연결 종료');
  a2.ws.close(); b.ws.close();
  await wait(300);
} catch (e) { console.error(e); fail++; }

srv.kill('SIGTERM');
await wait(500);
const saved = fs.existsSync(path.join(dir, 'world3.json'));
ok(saved, '월드 저장 (world3.json)');
fs.rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n${fail}개 실패` : '\n모두 통과');
process.exit(fail ? 1 : 0);
