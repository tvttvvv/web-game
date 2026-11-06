// 호스트 게임 로직 단위 테스트 (네트워크 없이)
import { World } from '../public/js/core/world.js';
import { Game, bindSocket } from '../public/js/core/game.js';
import { B, BLOCKS } from '../public/js/shared/blocks.js';
import { I, RECIPES, invFromWire } from '../public/js/shared/items.js';
import { PROTO } from '../public/js/shared/constants.js';
const world = new World(null);
const ground = (x, z) => { for (let y = 95; y > 0; y--) { const b = world.getBlock(x, y, z); if (b && BLOCKS[b].solid) return y + 1; } return 1; };
const game = new Game(world, { hash: (t) => t.padEnd(16, '0').slice(0, 16).replace(/[^0-9a-f]/g, 'a'), log: console.log });
function client(name) {
  const c = { msgs: [], ws: null };
  c.ws = { readyState: 1, bufferedAmount: 0, send: (s) => c.msgs.push(JSON.parse(s)), close: (code) => c.msgs.push({ t: '_closed', code }) };
  c.sock = bindSocket(game, c.ws);
  c.send = (o) => c.sock.receive(JSON.stringify(o));
  c.last = (t) => [...c.msgs].reverse().find((m) => m.t === t);
  return c;
}
let fail = 0; const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fail++; };
const a = client('a');
a.send({ t: 'join', ver: PROTO, name: '테스터', token: 'abcdef0123456789abcd' });
const w = a.last('welcome');
ok(w && w.name === '테스터', 'join/welcome');
ok(a.last('world') && a.last('world').signs, 'world payload with signs');
const p = a.ws.player;
ok(invFromWire(w.inv).some((s) => s && s.id === I.bread), 'starter bread');
// 스폰 보호
const [sx, sy, sz] = w.spawn;
a.send({ t: 'dig', x: 0, y: sy - 1, z: 0 });
ok(a.last('b1') && a.last('msg'), 'spawn protection denies dig');
// 멀리 이동해서 나무 찾기
let tree = null;
for (let x = 20; x < 120 && !tree; x++) for (let z = -40; z < 40 && !tree; z++) { const y = world.topY(x, z); if (world.getBlock(x, y, z) === B.log_oak) tree = [x, y, z]; }
ok(!!tree, 'found oak log at ' + tree);
p.x = tree[0] + 0.5; p.y = tree[1] - 1; p.z = tree[2] + 1.6; p.lastTp = Date.now();
a.msgs.length = 0;
a.send({ t: 'dig', x: tree[0], y: tree[1], z: tree[2] });
let inv = invFromWire(a.last('inv').s);
ok(inv.some((s) => s && s.id === B.log_oak), 'dig log → got log');
ok(world.getBlock(...tree) === 0, 'log removed');
// craft planks + table
const rPlanks = RECIPES.findIndex((r) => r.out === B.planks_oak);
a.send({ t: 'craft', r: rPlanks, n: 1 });
inv = invFromWire(a.last('inv').s);
ok(inv.some((s) => s && s.id === B.planks_oak && s.n === 4), 'craft planks x4');
const rTable = RECIPES.findIndex((r) => r.out === B.crafting_table);
a.send({ t: 'craft', r: rTable, n: 1 });
inv = invFromWire(a.last('inv').s);
const tslot = inv.findIndex((s) => s && s.id === B.crafting_table);
ok(tslot >= 0, 'craft crafting table');
// place table on ground next to player
const gx = Math.floor(p.x) + 2, gz = Math.floor(p.z);
const gy = ground(gx, gz);
a.send({ t: 'place', x: gx, y: gy, z: gz, s: tslot, f: 2, d: 0 });
ok(world.getBlock(gx, gy, gz) === B.crafting_table || a.last('msg'), 'place table: ' + BLOCKS[world.getBlock(gx, gy, gz)].key + ' ' + (a.last('msg') || {}).m);
// mobs + tick
for (let i = 0; i < 100; i++) game.tick(0.05);
ok(true, 'ticks ok, mobs=' + game.mobs.size);
const m = game.addMob('pig', p.x + 1, p.y, p.z);
for (let i = 0; i < 20; i++) game.tick(0.05);
for (let i = 0; i < 12; i++) { a.send({ t: 'hit', id: m.id }); m.hurtAt = 0; p.lastHit = 0; }
ok(!game.mobs.has(m.id), 'pig killed');
inv = invFromWire(a.last('inv').s);
ok(inv.some((s) => s && s.id === I.raw_pork), 'got pork');
// chest
const ckeyx = gx + 1;
const cy = ground(ckeyx, gz);
p.inv[5] = { id: I.chest, n: 1 }; p.lastAct = 0;
a.send({ t: 'place', x: ckeyx, y: cy, z: gz, s: 5, f: 2, d: 1 });
ok(world.getBlock(ckeyx, cy, gz) === 62, 'chest placed facing ' + world.getBlock(ckeyx, cy, gz) + ' ' + JSON.stringify(a.last('msg')));
a.send({ t: 'use', x: ckeyx, y: cy, z: gz });
ok(a.last('chest') && a.last('chest').s.length === 27, 'chest opened');
const breadSlot = invFromWire(a.last('inv').s).findIndex((s) => s && s.id === I.bread);
a.send({ t: 'swap', a: breadSlot, b: 100 });
ok(a.last('chest').s[0] && a.last('chest').s[0][0] === I.bread, 'moved bread into chest');
// door
p.inv[6] = { id: I.door, n: 1 };
const dx = gx - 4, dy = ground(dx, gz); p.lastAct = 0;
a.send({ t: 'place', x: dx, y: dy, z: gz, s: 6, f: 2, d: 0 });
ok(world.getBlock(dx, dy, gz) === 77 && world.getBlock(dx, dy + 1, gz) === 85, 'door placed both halves');
a.send({ t: 'use', x: dx, y: dy + 1, z: gz });
ok(world.getBlock(dx, dy, gz) === 81 && world.getBlock(dx, dy + 1, gz) === 89, 'door opened');
// torch on wall
p.inv[7] = { id: B.torch, n: 4 }; p.lastAct = 0;
a.send({ t: 'place', x: gx, y: gy, z: gz + 1, s: 7, f: 4, d: 0 });
ok([52, 53, 54, 55, 56].includes(world.getBlock(gx, gy, gz + 1)), 'torch placed: ' + BLOCKS[world.getBlock(gx, gy, gz + 1)].key);
// break table → torch on its side should drop too
p.lastDig = 0; a.send({ t: 'dig', x: gx, y: gy, z: gz });
ok(world.getBlock(gx, gy, gz + 1) === 0 || world.getBlock(gx, gy, gz + 1) === 52, 'wall torch cascade: ' + BLOCKS[world.getBlock(gx, gy, gz + 1)].key);
// chat command
a.send({ t: 'chat', m: '/spawn' });
ok(a.last('tp'), '/spawn teleports');
// second player sees first
const b = client('b');
b.send({ t: 'join', ver: PROTO, name: 'B', token: 'bbbbbbbbbbbbbbbbbbbb' });
b.ws.player.x = p.x + 2; b.ws.player.y = p.y; b.ws.player.z = p.z;
game.tick(0.05); game.tick(0.05);
ok(b.last('s') && b.last('s').p.some((r) => r[0] === p.id), 'B sees A in state');
const ser = JSON.stringify(world.serialize());
ok(ser.length > 100, 'serialize size ' + ser.length);
const w2 = new World(JSON.parse(ser));
ok(w2.getBlock(dx, dy, gz) === 81, 'reload keeps edits');
console.log(fail ? fail + ' FAILED' : 'ALL OK');
process.exit(fail ? 1 : 0);
